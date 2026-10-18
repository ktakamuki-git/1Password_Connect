# 詳細設計: 3拠点のConnect実行単位

## 1. 配備単位と構成

各拠点に独立したdeploymentを1つ作る。deploymentは同じ拠点ネットワーク内で連携するConnect APIとConnect Syncからなる。両コンテナは同じ暗号化cache volumeを読む/書く。volumeは拠点ごとにローカルであり、他拠点からmountしない。

| Instance | API endpoint | API container | Sync container | volume owner | Consumer |
|---|---|---|---|---|---|
| APPv4 | 未確定。実ネットワーク確認後に設定 | 1 | 1 | APPv4内のみ | APPv4上のアプリ |
| MainUbutsu2 | 未確定。正式remote/host確認後に設定 | 1 | 1 | MainUbutsu2内のみ | MainUbutsu2上のアプリ |
| MiniPC-Oyama (WSL) | 未確定。WSL distro/runtime/host network確認後に設定 | 1 | 1 | MiniPC-Oyama WSL内のみ | MiniPC-Oyama上のアプリ |

MiniPC-OyamaがWSLであることはユーザー報告で確認済み。distribution名、自動起動、コンテナ実行方式は未確認。APPv4/MainUbutsu2を含め、volume driver、host名/IP、TLS終端も確定していないため固定しない。Docker Compose/Kubernetesのmanifestは各環境の棚卸し後に選ぶ。

## 1.1 Docker Compose候補

`deploy/docker/compose.yaml` はAPPv4/MainUbutsu2/MiniPC-Oyamaのいずれか一拠点に使う共通候補であり、実hostには未適用。公式 `1password/connect-api:1.8.3` と `1password/connect-sync:1.8.3` を同一networkで動かし、両方がCompose project-scoped `connect-data` named volumeを共有する。credential fileは必須の外部file path参照をread-only secret mountし、secret値やAPI tokenはファイルに含めない。APIのみ `127.0.0.1:8080` に公開し、sync/bus portはinternal networkだけにする。API/Sync busは公式manual configurationでservice peerを指定する。

公式Connect API image内にroot health commandがあると仮定しない。`connect-healthcheck` は別のPython containerでAPI `GET /health` を読み、`sync` と `sqlite` が`ACTIVE`の時だけhealthyにする。probeはUID 65532で動かし、read-only filesystem、全capabilities drop、no-new-privilegesを設定する。observerは `monitoring` Compose profileで任意起動し、Connect API/Syncの起動や相互接続を制御しない。各siteでobserverを有効にした場合は6つのConnect本体に最大3つのobserverが加わる。初回起動時、API `/health` がHTTP 200でも `sync: TOKEN_NEEDED` と `sqlite: ACTIVE` を返すことがある。これは初回の認証GETで1Password同期を開始する前の待機状態であり、起動失敗ではない。observerは `TOKEN_NEEDED` 中はunhealthyを示すが、それ単独で起動失敗と判断しない。実際のCompose/host互換性、localhost route、secret file読取permissionは各siteのruntime確認後に静的/実動作検証する。

## 2. 認証とVault境界

- 1Password account側に既存Connect登録 CredentialMCPが1つある前提とする。Connect serverを作り直したり、tokenを追加発行しない。
- 1password-credentials.jsonはConnect Sync/API containerが1Password Connect identityとして動作するためのsecret。各hostへ安全に届ける必要がある。値はGit/ログ/チャットに載せない。
- アプリがConnect APIを呼ぶ際には既存access tokenをBearer tokenとして使う。アプリのruntime secret storeから読み、source codeやtracked .envには置かない。
- Connect tokenが対象Vaultの読み取りのみを許すことを、値を表示せずアカウント側の権限情報で確認する。読み取り専用でない場合は既存credentialを変更せず、親に権限変更の必要性を報告する。
- ChromeVaultなどitem名/内容をAPI応答やtest logに記録しない。受け入れ記録は成功/失敗と応答statusだけにする。

1Password Communityの回答者は、自身が2つのKubernetes clusterそれぞれにConnectを配備し、同一 `1password-credentials.json` を使ったと報告している。公式Helm deploymentはreplica数を設定し、API/Sync containerが同じcredentials Secretをmountする。前者は2-clusterの実践報告、後者はHelmのdeployment/replica構成の根拠であり、3-site動作の保証や実地確認ではない。

したがってCredentialMCPの登録identityとruntime pair 3組は分け、既存credential/tokenの再利用を設計前提として扱う。既存tokenが各site APIで受理されることは3 siteの認証結果が揃うまで仮説である。追加登録/tokenや権限変更は行わない。実際にcredentialをhostへ置く段階では、対象siteと操作を親へ示し既存の安全なhandoffを使う。[1Password Community: multi-cluster report](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Official Helm deployment template](https://raw.githubusercontent.com/1Password/connect-helm-charts/main/charts/connect/templates/connect-deployment.yaml)
この根拠は実際のcredential配布を指示するものではない。credential配布が必要な場合は対象siteと操作を親へ示し、既存の安全なhandoffを使う。既存registration/token再利用に追加の登録・token承認gateは設けない。配備後は各APIを個別に認証試験する。

## 2.1 PP2から1Password plugin MCPを呼ぶadapter

PP2 adapterは既存1Password plugin MCP接続を通じてMCP toolを呼ぶ。Connect REST APIと同一のAPI/credentialと見なさず、PP2 repo/transport/server identity/tool schemaを確認するまではendpoint、認証方式、実tool名を固定しない。各site用plugin MCP接続が該当site-local Connect APIをbackendとして使うか、実環境でroute/bindingを追跡・確認する。中央または別siteを経由する構成や未確認の経路はsite-local準拠と見なさず、silent bypassやDirect REST fallbackを禁止する。routeが確認できない場合は準拠と報告せず、親に例外/未確認状態を示す。新規の1Password credentialやtokenは生成・設定しない。

1. serverのtool metadataを標準MCP `tools/list` で取得し、PP2側の固定allow-listと `inputSchema` に照合する。未知tool、write/delete tool、schema外argumentは拒否する。
2. allow-list内toolだけをJSON-RPC 2.0 `tools/call` で呼ぶ。requestは `{"jsonrpc":"2.0","id":"<correlation-id>","method":"tools/call","params":{"name":"<allow-listed-tool>","arguments":{}}}` 形式。`id` はcallごとに一意とし、実際のtool名/argumentsは登録plugin metadataとPP2要求から決める。
3. JSON-RPC protocol `error` と `result.isError=true` を区別し、`content` と任意 `structuredContent` をschemaに従って検証する。transport timeout/切断は別の失敗として返す。tool名/引数を推測してリトライしない。
4. PP2 callerへ許可範囲の最小結果だけを返す。ログ/auditにはcorrelation id、tool名、status、所要時間などだけを記録し、arguments、result content、item values、Bearer token、credential fileを出さない。secretを返すread toolは呼出し前に人の確認を要求する。
5. MCP call失敗時にConnect RESTへsilent fallbackしない。既存plugin接続/authの問題は診断結果を返し、credential再発行や設定変更を自動化しない。

MCP protocolのtool discovery/callとtool result/errorの形式を使用する。[MCP Tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。PP2本体の対象repositoryと接続実装が未確認のため、この節は実装contractとmock-test要求であり、実接続の証明ではない。

## 3. コンテナ設定項目

| 要素 | 方針 |
|---|---|
| API image | 1Password公式Connect API image。正式版tagを固定。 |
| Sync image | APIと同じConnect releaseの公式Sync image。 |
| Credential input | 1password-credentials.jsonをsecret fileとして両containerへread-onlyで渡す。OpenAI/GitLab CI secretには置かない。 |
| OP_SESSION | container内のcredentials file pathを指定。公式環境変数。 |
| Local data | APIとSyncが同じ拠点内volumeを共有。公式default pathは /home/opuser/.op/data。 |
| API endpoint | APIのみアプリに公開。HTTP default 8080、TLS時のHTTPS default 8443。APIのhealth endpointは /health と /heartbeat。 |
| Sync endpoint | health portは選択したdeployment設定に従う。汎用Connect containerのOP_HTTP_PORT defaultは8080、公式Helm chartはSyncのHTTP portを8081に設定。拠点内監視だけに使い、アプリへ公開しない。 |
| Container bus | API/Sync間の内部busだけを許可。public/host networkに露出しない。 |
| Resource limits | 実VM/hostの空きRAM/CPUを確認後に指定。APPv4の申告RAM値を3拠点共通のlimitと仮定しない。 |

画像・環境変数・volumeとhealth情報は公式Configure/Helm chartを基準にする。[Connect server configuration](https://www.1password.dev/connect/server-configuration) / [Official Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)

## 4. ネットワーク/保護

1. APIのbind addressは当初loopbackまたはサイト内private networkのみにする。
2. サイト内でAPIへ到達するアプリ/hostをallow-list化する。外部向けport-forward、public DNS、public load balancerは設定しない。
3. 接続がtrusted network boundaryを越える場合はTLSを使う。証明書とTLS termination方式は実ネットワークの確認後に選ぶ。
4. 外向きSync接続は各siteのegress/proxy/FWを調査してから許可する。接続先を推定してFWルールを作らない。
5. credential file、token、private keyをcontainer environmentの直接値や出力可能なcompose configに埋め込まない。container secret/file mountを優先する。
6. CIを使う場合はsite-bound self-hosted runnerを3台使い、shared runnerを使わない。tagは `appv4` / `main-ubutsu2` / `oyama-wsl` を想定し、runner hostの安全なsecret file referenceを使う。token/credentialsはGitLab CI variable、artifact、job log、checkoutへ置かない。

## 4.1 CI/Runner境界

site別jobは各専用runner tagに固定し、他site runnerやshared runnerへfallbackしない。deploy jobはsiteごとにmanual/protectedにする。static testにsecret値を必要としない。実配備jobではConnect credential/API tokenの値をGitLabへ渡さず、runner host側の管理済みsecret file pathを参照する。

GitLab inventory snapshot (2026-10-18): plugin subgroupに非shared group runner `appv4`、`main-ubutsu2`、`oyama-wsl` の3台がonline/activeで登録されているが、全runnerのtag listが空で、このprojectのrunner listは0件。project settingsも `group_runners_enabled=false`、`jobs_enabled=false`、`builds_access_level=disabled`。この設計/実装タスクからこれら設定を変更しない。別担当がaccess/tag/settingsを整えたことを読み取り確認するまでpipelineやrunner jobを実行しない。

## 5. 接続の確認方法

各拠点を一つずつ、ユーザーが承認した安全なsecret handoff後に確認する。tokenはshell historyやコマンド出力へ書かない。

1. API/Sync process/container statusを確認し、API `GET /heartbeat` がHTTP 200を返すことを確認する。これはliveness確認であり、Vault認証や初回同期の完了を示さない。[Get heartbeat](https://www.1password.dev/connect/api-reference/get-heartbeat)
2. siteごとに承認済みの安全なsecret handoffを使い、既存Bearer tokenでAPI `GET /v1/vaults` を実行する。この初回認証GETが1Password.comへの接続と初回Vault同期を開始する。tokenをshell history、CLI引数、ログ、画面、チャットに出さず、初回応答本文も記録しない。[Official Kubernetes example](https://github.com/1Password/connect/blob/main/examples/kubernetes/README.md) / [API reference](https://www.1password.dev/connect/api-reference/get-vaults)
3. API `GET /health` の `sync` と `sqlite` がともに `ACTIVE` になるまで待つ。初回認証GET前の `sync: TOKEN_NEEDED` とobserverのunhealthyは想定内のpending状態であり、それ単独では起動失敗を意味しない。認証GET後もinactiveのまま、heartbeat失敗、または認証要求失敗の場合はアプリを切り替えずsecretを表示しない手順で調査する。[Get server health](https://www.1password.dev/connect/api-reference/get-server-health)
4. ACTIVE確認後に `GET /v1/vaults` のVault識別情報だけを許可済み値と比較し、item contentsを取得・表示しない。
5. healthとVault identityが確認できた後に限り、site-localアプリをlocal APIへ切り替える。scope metadataでread-onlyを確認し、実Vaultへのwrite/deleteを試験しない。
6. 結果をhost名、image version、heartbeat/health/auth結果、Vault ID一致、時刻だけで記録する。

## 6. 初期同期、障害、rollback

- APIプロセスの起動とVault readinessを分ける。初回はprocess/heartbeatを確認し、承認済み認証GETで同期を開始してから `/health` の `sync` / `sqlite` が `ACTIVE` になるまでアプリを切り替えない。初回の `TOKEN_NEEDED` / observer unhealthyだけでは失敗と断定しない。認証GETの失敗や、GET後もreadinessが成立しない場合はアプリ切替を止めて調査する。
- site A/B/Cの同期状態とhealthを個別に確認する。あるsiteの成功から残りsiteの成功を推定しない。
- runtime更新は3 siteで同一versionを維持し、1拠点ずつ実施。secret変更は伴わせない。
- rollback時は当該siteのcontainer/manifestだけを前版へ戻す。共有先を伴わないsite-local volumeは削除しない。
- token/credentialsを更新・失効する対応は実施せず、必要な場合は親へ対象・影響を報告してから承認を得る。

## 7. 詳細設計レビュー

ゼロベース確認で以下を修正済み:
- 「volume共有不要」をcontainerペア内の共有まで否定しないよう、拠点内volumeを明記。
- credentials fileとapp access tokenの目的を分け、両者を既存secretとして扱う。
- Sync health portをアプリ公開と混同しないよう整理。
- 認証試験でtokenをCLI引数/ログに出したりVault内容を表示する危険を除き、GET /v1/vaultsの識別情報だけを見る方針へ変更。
- write権限確認のために本Vaultを変更しない。権限metadataからread-onlyを確認する。
- Community上の2-cluster同一credentials file実例と公式Helmのreplica設定を区別し、3-site API acceptanceは未実証の設計仮説とした。
- PP2→plugin MCP adapterに `tools/list` / `tools/call`、schema/allow-list、JSON-RPC errorと `isError`、result redaction/confirmationを定義し、plugin backendがsite-local Connectへ結び付くことの実環境確認とsilent bypass禁止を追加した。
- 3台のsite runnerを指定し、実際のtag/project eligibilityが無効のままであることと外部設定担当の境界を記載した。
