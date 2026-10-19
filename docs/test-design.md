# テスト設計: Connect 3拠点

## 1. 目的と区分

次の証拠を混ぜずに管理する。

1. **単体/static tests:** manifest/設定の構文と静的制約をローカルrepoで検証。
2. **配備確認:** 各hostでcontainer、volume、API/Sync healthが成立することを確認。
3. **3拠点実動作:** 各siteのAPIが認証し、同じVaultを読み取れることを確認。
4. **Self-hosted CI:** 3 site専用runnerのsite tagでpipelineを実行し、shared runnerへfallbackしない。最新MR head `9cdefdcab446d64ed71d5e5febb76c8a4162b8f7` のpipeline 2960553438では3 site jobが成功。Hub sourceを使う1件はPP2 projectがprivateで、Connect projectのinbound job-token許可がないためskip。\n5. **Exact-source local integration:** task workspace内の新規PP2 source snapshotでHub → local stdio plugin → mock Connect RESTを実行。2026-10-19に固定PP2 commitの5 source module照合後、Node checkと25/25 testsが成功した。これはCI/Ubutsu2 clone/live環境の試験とは分け、詳細結果をdocs/implementation-validation.mdに記録する。

以下はテスト計画であり、実施結果はdocs/implementation-validation.mdに記録する。GitLab CIとtask workspace内のexact-source local mock integrationは実行済みだが、正式Ubutsu2 local clone、配備、3拠点live試験は未確認。

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
| ST-09 | Self-hosted runner routing | `appv4` / `ubutsu2` / `oyama-wsl` tagのjobが対応non-shared runnerだけで動き、他site/shared runnerへfallbackしない。Ubutsu2のRunner descriptionは `main-ubutsu2`。 |
| ST-10 | Operational docs | install, health, update, rollback, stop/secret handoff条件が全siteに適用可能 |
| ST-11 | Optional rootless health observer | `monitoring` profileで任意起動、UID 65532、read-only、cap_drop ALL、no-new-privileges。`TOKEN_NEEDED` は初回auth GET前のnot-readyを表し、observer unhealthyだけでstartup failureと判定しない |
| ST-12 | Compose secret source | credentials file sourceは必須の未設定環境変数参照、API/Syncへread-only fileで渡す。token実値やtoken環境変数はComposeに置かない |
| ST-13 | Localhost/API exposure | APIのみ127.0.0.1:8080へbind。Sync/bus/health monitorのhost port mappingなし |
| ST-14 | Manual bus | API/Sync peersはsite Compose network上の相手serviceだけを指し、NET_BROADCAST capabilityを要求しない |
| ST-15 | Hub-to-plugin MCP contract | Hub相当clientが本repoのlocal stdio pluginへ `tools/list` / `tools/call` を送り、pluginだけがmock Connect RESTへ接続する。PP2 core変更や追加中継層なし |
| ST-16 | MCP output secret hygiene | success/protocol error/tool error/notificationのHub向け出力とlog/audit/artifactは定義済み公開metadataのみ。raw `content`/`structuredContent`、secret、credential本文、tokenを漏らさず、secret-returning toolなし |
| ST-17 | CI configuration alignment | job trigger/protectionは既存GitLab設定と本人指示に整合し、新たなmanual/protected必須gateを追加しない。site jobは対応するself-hosted runner tagへ固定し、shared/他site fallbackなし。設定が未準備なら利用不可として記録 |

文書追記前に最後に成功したMR head pipeline 2960553438は3 site runner jobすべて成功した。実装/CI pipeline 2960546091ではNode tests 24 pass/0 fail/1 skip、Python tests 14/14、Compose config成功を確認し、skipはprivate PP2 sourceへのCI read access不足による。別に、task workspace内のexact-source snapshotでNode checkと25/25 tests（skipなし）を実行し、Hub integrationのlocal mock経路を確認した。ST-09 routingは `appv4` / `ubutsu2` / `oyama-wsl` tagで確認。ST-07の実Vault scope metadataとendpoint/resource/volume、ST-08の実host identityは未検証。証拠区分とCI access条件はdocs/implementation-validation.mdに記録する。

## 2.1 Hub相当clientから本repo pluginへのMCP unit/contract tests

test harnessはHub相当のMCP clientとして本repository内のplugin moduleをlocal stdio child processで起動し、pluginのConnect API通信先をmock REST serverにする。PP2 coreは変更せず、別のMCP relay/client実装も追加しない。既存Hub外部認証とprocessの既存OS identity/permissionsを維持し、テスト専用の認証・承認・権限昇格を作らない。

| ID | 検査 | 合格条件 |
|---|---|---|
| MCP-01 | Tool discovery | Hub相当clientがpluginへ `tools/list` requestを送り、tool nameと`inputSchema`をallow-listへ照合 |
| MCP-02 | Call envelope | allow-list済みread toolを `tools/call` JSON-RPC 2.0でpluginへ送り、unique correlation idとschema-valid argumentsを使う |
| MCP-03 | Unknown/disallowed tool | unknown、write、delete toolやschema違反argumentをREST mockへ送る前に拒否 |
| MCP-04 | Success/errors/notifications | success、JSON-RPC protocol `error`、tool `result.isError`、notificationを個別に処理し、Hub向けの出力は定義済み公開metadataだけ。raw resultを転送しない |
| MCP-05 | Secret-safe output/logging | mockの禁止フィールドに置いた非secret sentinelをcaller output/notification/log/audit/artifactに含めない。credential/token/item valueを返すtoolを公開しない |
| MCP-06 | Existing execution boundary | pluginをlocal stdioで起動し、既存Hub外部認証とOS identity/permissionsの境界を保つ。PP2 core変更、独自認証/approval/elevationなし |
| MCP-07 | Site route change | pluginのREST requestは指定site routeに届く。本人が明示したroute変更はその指定先を使い記録する。指定なしの他siteへの切替は行わない |
| MCP-08 | No Hub bypass | pluginからConnect RESTへの通常backend通信は許可する。MCP/plugin失敗時にHub相当clientがpluginを迂回してRESTを直接呼ぶfallbackはしない |

これらはmock MCP/stdio clientとmock Connect REST serverで実行し、live credentialやVault dataは使わない。実際のplugin tool schema/transportはPP2 Hubとの接続実装を確認した後にcontract fixtureへ固定する。
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
| DP-10 | Hub/plugin route | Hub相当clientから本repoのlocal stdio pluginを通じ、Connect REST backendが指定site-local APIに到達することを確認。本人の明示route変更は許容して記録し、指定なしの他site切替やHubのplugin迂回をpassにしない |

Compose observerは任意の `monitoring` profileで起動し、Connect本体の起動をgateしない。DP-03の前にunhealthyを示しても、それだけを初回起動失敗としない。DP-06はscope metadataから判定し、read-onlyを試すためにVaultを壊さない。

## 4. MCP integration and negative/rollback tests

- Mock integrationはHub相当client→本repositoryのlocal stdio plugin→mock Connect RESTで行う。PP2 coreを変更せず、実際の1Password credential、token、Vault itemを使わない。
- success、protocol error、tool error、notificationのすべてについて、Hub/Chat向け出力とlog/audit/artifactに定義済み公開metadata以外が現れないことを検証する。禁止フィールドに置いた非secret sentinelもcallerや記録へ漏れず、secret-returning toolが存在しないことを確認する。
- Live route確認はsite-local backendの実環境検査として別記録する。Connect RESTはpluginの通常backendとして呼び出す。plugin/MCP call失敗時にHubがpluginを迂回してRESTを直接呼ぶfallbackはしない。

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
- CIのsite jobは対応する既存non-shared runner tagへ固定し、shared runnerを使わない。文書追記後に自動生成されたpipeline 2961990853は、CI停止指示に従ってcancelを要求した。文書追記前の成功pipeline 2960553438で3 job成功。PP2 Hub integrationはCIでprivate source read access不足によりskip。一方、task workspaceのPP2 pinned-source fixtureで全5 module一致を確認し、25/25 local testsを実行。job-token allowlist変更やcredential作成は行わない。
- Hub相当client→本repo local stdio plugin→mock Connect RESTをcontract boundaryとし、PP2 core非変更・既存認証/OS権限を維持する。success/error/notificationとログを公開metadata onlyで検証し、secret-returning tool/human approvalを置かない。Connect RESTは通常plugin backendであり、Hubのplugin迂回fallbackだけを拒否する。指定route変更は許容・記録し、無指定の他site切替は拒否する。
- API heartbeat、承認済み初回認証GET、dependency readiness、Vault identity、アプリ切替を順番に分けた。初回 `TOKEN_NEEDED` とobserver unhealthyをpending状態として扱う。
- local repositoryが開けない場合はlocal testを未実施と記録する。実機未接続でも可能なsecret-free template checkとsiteごとのruntime試験を混同しない。
