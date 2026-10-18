# テスト設計: Connect 3拠点

## 1. 目的と区分

次の証拠を混ぜずに管理する。

1. **単体/static tests:** manifest/設定の構文と静的制約をローカルrepoで検証。
2. **配備確認:** 各hostでcontainer、volume、API/Sync healthが成立することを確認。
3. **3拠点実動作:** 各siteのAPIが認証し、同じVaultを読み取れることを確認。
4. **Self-hosted CI:** 3 site専用runnerごとのpipeline結果。shared runnerにfallbackしない。現在のrunner tag/project accessは未設定なので、外部担当の準備完了まで実行結果は保留。

このリポジトリの実行先local cloneは確認できていないため、以下はテスト計画であってテスト実施結果ではない。

## 2. Static/unit test cases

| ID | 検査 | 合格条件 |
|---|---|---|
| ST-01 | JSON profile/schemaとCompose YAMLのparse | 3つの設定ファイルがparseでき、profileがschemaに適合する |
| ST-02 | Container version一致 | 公式API/Sync imageが同じ固定release tag 1.8.3を使い、latestを使わない |
| ST-03 | Volume mapping | 同一siteのAPI/Syncが同じencrypted data pathをmountし、他siteを参照しない |
| ST-04 | Secret hygiene | credentials/token/private key実値、Base64実値、output fixtureがGit diff/tracked file/logにない |
| ST-05 | API exposure | API bind/listenerがsite/host local onlyまたはprivate allow-list。public unauthenticated exposureなし |
| ST-06 | Sync/API inner network | APIとSyncの通信はsite-local。Sync health/bus portをapp/publicへpublishしない |
| ST-07 | Vault contract | 共通templateが許可Vaultのplaceholder/scopeを参照し、site-specific metadataも同じVault identity/read-only scopeを使う |
| ST-08 | Target identity | APPv4=VM102確認あり、APPv3 targetはなし。MainUbutsu2/MiniPC-Oyamaが正式host名と一致。MiniPC-OyamaはWSLのdistribution/runtime/autostart確認後に合格 |
| ST-09 | Self-hosted runner routing | `appv4` / `main-ubutsu2` / `oyama-wsl` jobが対応tagのnon-shared runnerだけで動き、他site/shared runnerへfallbackしない。runner identity/tagをjob内で照合する |
| ST-10 | Operational docs | install, health, update, rollback, stop/secret handoff条件が全siteに適用可能 |
| ST-11 | Optional rootless health observer | `monitoring` profileで任意起動、UID 65532、read-only、cap_drop ALL、no-new-privileges。`TOKEN_NEEDED` は初回auth GET前のnot-readyを表し、observer unhealthyだけでstartup failureと判定しない |
| ST-12 | Compose secret source | credentials file sourceは必須の未設定環境変数参照、API/Syncへread-only fileで渡す。token実値やtoken環境変数はComposeに置かない |
| ST-13 | Localhost/API exposure | APIのみ127.0.0.1:8080へbind。Sync/bus/health monitorのhost port mappingなし |
| ST-14 | Manual bus | API/Sync peersはsite Compose network上の相手serviceだけを指し、NET_BROADCAST capabilityを要求しない |
| ST-15 | PP2 MCP adapter contract | `tools/list` metadataとallow-list/schema、JSON-RPC `tools/call` envelope、protocol error / `isError`, `content`/`structuredContent`を扱い、unknown/write toolを拒否 |
| ST-16 | MCP secret hygiene | call arguments/result/item content/token/credential fileをlogs/artifacts/auditへ出さない。最低限のcorrelation/status metadataだけを記録する |
| ST-17 | Site deployment gate | 各site deploy jobがprotected/manualで、site tagに固定され、未設定のrunnerやshared runnerを使わない |

host-independent profile、Compose候補、MCP mock contractのST-01〜ST-06/ST-10〜ST-17はhost inventory前にローカル静的/unit testで検証できる。現状はテストsourceをGitLabへ保存した段階で、実行結果はない。ST-07のsite-specific scope metadataとendpoint/resource/volume、ST-08の実host情報は対象の確認後に検査する。CIは3 self-hosted runner専用に設計する。2026-10-18 snapshotではrunnerはonline/activeだがtagが空でproject accessもないため、ST-09/17の実行は別担当の設定確認後に限る。

## 2.1 PP2 MCP adapter unit/contract tests

| ID | 検査 | 合格条件 |
|---|---|---|
| MCP-01 | Tool discovery | `tools/list` JSON-RPC responseをparseし、tool nameと`inputSchema`をallow-listへ照合 |
| MCP-02 | Call envelope | allow-list済みread toolを `tools/call` JSON-RPC 2.0に載せ、unique correlation idとschema-valid argumentsを送る |
| MCP-03 | Unknown/disallowed tool | unknown、write、delete toolやschema違反argumentをtransportへ送らず拒否 |
| MCP-04 | Result/errors | protocol `error`、`result.isError`、success `content`、optional `structuredContent`、timeoutを別状態としてPP2 callerへ返す |
| MCP-05 | Secret-safe output | call inputs/results/item fields/tokens/credentialsをlog/audit/artifactへ出さない。必要な最小read responseだけをcallerへ返す |
| MCP-06 | Human approval | secret-bearing read toolはユーザー確認を経てからcallする。denyはserver callなしで終了 |
| MCP-07 | Site-local Connect binding | site selectorが対応するsite-local Connect backendに結び付き、中央/他site routeへsilent bypassしない。unknown/unverified bindingは拒否またはunverifiedで返す |

これらはmock MCP server/transportで実行し、live plugin/authは使わない。実際のplugin schema/transportはPP2 repo/connectionが特定された後にcontract fixtureを確定する。

## 3. 配備 smoke test cases

全てユーザー承認済みsecret handoffを受けてからsiteごとに順番に行う。tokenやcredential値をshell history/log/chatに出さない。

| ID | 確認 | 方法/期待結果 |
|---|---|---|
| DP-01 | Process/liveness | APIとSync process/containerが起動し、API `/heartbeat` が200。これはVault readinessを証明しない |
| DP-02 | 初回認証と同期開始 | 承認済みの既存Bearer tokenでlocal API `GET /v1/vaults`。このGETが初回syncを開始する。token/応答本文は記録・表示しない |
| DP-03 | Sync readiness | DP-02後にAPI `/health` のsync/sqliteがともに `ACTIVE` になる。DP-02前の `TOKEN_NEEDED` とoptional observerのunhealthyはpendingであり、単独でstartup failureと判定しない。Sync/bus portはhost外へ公開しない |
| DP-04 | Vault identity | readiness後の認証GETでVault ID/nameだけを許可済み値と比較。item contentsを取らない |
| DP-05 | App cutover | readiness・Vault identity確認後、site-localアプリがsite-local API endpointを指す |
| DP-06 | Read-only boundary | 1Password側scope metadataでread-only確認。実Vaultへwrite/deleteを送って試験しない |
| DP-07 | Exposure | 外部経路から接続不能かつsite内の許可app hostからだけ到達 |
| DP-08 | Cache isolation | 各site固有のdata volumeで稼働。他site volume mountまたは共有NFSがない |
| DP-09 | Evidence | host識別子、時間、image version、heartbeat/health/auth result、Vault identifierだけ記録 |
| DP-10 | PP2 plugin route | 対象siteのplugin MCP backendがそのsite-local Connectへ結び付くことを実環境で追跡確認。中央/他site経由や未確認routeはpassにしない |

Compose observerは任意の `monitoring` profileで起動し、Connect本体の起動をgateしない。DP-03の前にunhealthyを示しても、それだけを初回起動失敗としない。DP-06はscope metadataから判定し、read-onlyを試すためにVaultを壊さない。

## 4. MCP live integration and negative/rollback tests

- Mock MCP testsでunknown tool/write/deleteを拒否し、JSON-RPC protocol error、tool result `isError`, timeout、malformed responseを分類する。
- Live plugin integrationはexisting plugin connection/authの状態と対象read operationを親へ提示し確認した後に行う。read-only allow-list toolのみを使い、secret contentsはPP2 caller以外へ表示しない。
- MCP error時にConnect RESTや別credentialへfallbackしない。失敗結果にはtool name/status/correlation idを含め、arguments/result bodyは含めない。

## 5. Negative/rollback tests

- tokenなし/不正tokenのAPI要求は401/unauthorizedで拒否されることを確認する。ただし実secretをlogに残さない。
- 非許可ネットワークからAPIへ接続できないことを確認する。
- 初回 `/health` の `sync: TOKEN_NEEDED` は認証GET前のpending状態として扱い、observer unhealthyだけで起動失敗と判定しない。認証GETが失敗する、heartbeatが失敗する、または認証GET後もreadinessが成立しない場合はアプリを未切替のままにし、diagnostic logをsecret scrubした形で調べる。
- 一siteを停止/rollbackしても残りsiteとそのvolumeに副作用がないことを確認する。volume deletionはtestに含めない。
- 作業後にGit branch diffからsecret値・host access token・public addressを再確認する。

## 6. 実施記録テンプレート

各testには以下を記録する。未確認欄を推測で埋めない。

| Field | Record |
|---|---|
| Test ID / Site |  |
| Repo path / commit SHA |  |
| Host identity / runtime version |  |
| Command or check |  |
| Exit/status result |  |
| Secret-safe evidence |  |
| Reviewer / date |  |

secret value、Connect credentials JSON、Vault item value、Bearer headerは記録に含めない。

## 7. テスト設計レビュー

ゼロベースレビューの結果:
- static, deployment, 3-site runtime testを分離した。host-independent templateの静的検証は実機アクセスを要件としない。
- token値を使ったテストを設計しつつ、値の取得表示を避ける手順にした。
- 本番Vaultへwrite/deleteを送る試験を排除し、scope metadataでread-onlyを検証する。
- CIのsite jobは各self-hosted runner tagへ固定し、shared runnerを使わない。現在はtag/project accessの準備前なのでCI結果は未実施と記録する。
- PP2 MCP adapterはtools/list/tools/callとerror/result handlingをmockで試験し、site route selectionの中央/他site silent bypassもnegative testする。live plugin route binding確認はsiteごとの実環境試験として別に報告する。
- API heartbeat、承認済み初回認証GET、dependency readiness、Vault identity、アプリ切替を順番に分けた。初回 `TOKEN_NEEDED` とobserver unhealthyをpending状態として扱う。
- local repositoryが開けない場合はlocal testを未実施と記録する。実機未接続でも可能なsecret-free template checkとsiteごとのruntime試験を混同しない。
