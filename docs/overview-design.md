# 概要設計: CredentialMCPを使う3拠点Connect

## 1. アーキテクチャ

```text
                         1Password Cloud / 同じ許可Vault
                           ▲ sync        ▲ sync        ▲ sync
                           │              │              │
APPv4 app ──API request──> [APPv4 Connect API] ───────┐
                                                       ├── [APPv4 local encrypted cache]
1Password Cloud <──sync─── [APPv4 Connect Sync] ──────┘

MainUbutsu2 app ──API request──> [MainUbutsu2 Connect API] ─┐
                                                            ├── [MainUbutsu2 local encrypted cache]
1Password Cloud <────sync─────── [MainUbutsu2 Connect Sync] ─┘

MiniPC-Oyama app ─API request──> [MiniPC Connect API] ──────┐
                                                            ├── [MiniPC local encrypted cache]
1Password Cloud <────sync─────── [MiniPC Connect Sync] ─────┘

One logical Connect registration: CredentialMCP
One existing registered token and credentials identity; runtime copies at 3 sites
No cache volume shared between sites
```

### 数え方

| 層 | 数 | 意味 |
|---|---:|---|
| 1Password Connect登録 | 1 | CredentialMCP。登録/権限の管理単位 |
| Connect API | 3 | 各拠点でアプリが呼ぶローカルREST API |
| Connect Sync | 3 | 各拠点のローカルcacheを同じVaultと同期 |
| Connectのruntime pair | 3 | それぞれAPI+Sync。計6コンテナ |
| データvolume | 3 | 拠点ごとに1つ。各拠点内のAPI+Syncだけで共有 |

共有volumeが必要なのは**同一拠点内のAPIとSync間**である。拠点間でvolume/cacheを共有する設計ではない。1Password公式資料は両containerが同一networkで動作し、暗号化データを置く共有volumeが必要とする。Connect Syncが各deploymentの情報を1Password.comと同期する。[Connect concepts](https://www.1password.dev/connect/concepts) / [Configure your Connect server](https://www.1password.dev/connect/server-configuration)

## 2. データ経路と境界

1. Connect Syncが登録CredentialMCPのcredentialを使い、許可された同じVaultの更新を各拠点の暗号化cacheへ同期する。
2. アプリは同じ拠点のAPI endpointだけを呼ぶ。アプリ設定はendpoint (OP_CONNECT_HOST) と既存Connect token (OP_CONNECT_TOKEN) を使用する。
3. APIはtokenで認証し、登録済み許可範囲のVaultを返す。read-onlyの要件を満たすtoken scopeが確認できなければ切り替えない。
4. 同期状態・API応答は拠点ごとに独立している。停止/ネットワーク分断時はその拠点の最終同期状態に基づく可用性となり、最新性を他の2拠点が保証するものではない。

## 2.1 PP2から1Password plugin MCPへの呼び出し

```text
外部client ──既存の認証──> [PP2 Hub] ──localstdio / 設定済みOS identity──> [このrepoの1Password plugin module]
                                                                      │
                                         指定された拠点のConnect API REST endpoint
                                                                      ▼
                                                         [site-local Connect API]
```

現在確認したPP2 Hub sourceはNode.js host processからlocalstdio downstreamをchild processとして起動する。この設計はHubとpluginが同一host network namespaceを共有する前提とし、Composeのloopback公開先へpluginの `OP_CONNECT_HOST` から到達する。これはsource/契約上の実行モデルであり、siteへ配備済みという意味ではない。Hubが実環境でcontainerや別network namespace内なら `127.0.0.1` はそのnamespace自身を指すため、実routeを再確認してから使う。既存Hubの外部認証と設定済みOS実行identity/permissionsを使い、独自認証、caller approval、role、権限昇格は追加しない。PP2 coreにも変更を加えず、このrepository内のplugin分離moduleとして実装する。

pluginはMCP `tools/list` で定義済みmetadata/schemaを公開し、許可されたread-only toolをJSON-RPC 2.0 `tools/call` で実行する。現在の実装tool `connect_list_vaults` は指定siteのConnect REST `GET /v1/vaults` のみを呼び、Vault IDとstatus metadataを返す。item詳細やsecret値の取得、consumerへの秘密供給は実装範囲に含まれない。この機能だけでは既存consumerのsecret取得依存は解消しない。依存をなくすには、値をChat/MCP応答へ出さずconsumer内部に届ける別経路について、consumer identity/認可元、Vault/item/field参照、配送先とIPC/API、refresh/rotation、失敗時動作、監査/秘匿、integration testを明示した追加要件が必要であり、今の要件へ推測で追加しない。Connect APIとの通信にはsiteごとに指定された既存の経路と認証情報を使う。本人が明示的に指定した経路変更は妨げないが、指定なしに別siteへ黙って切り替えず、実際のbackend routeを環境ごとに確認する。Direct RESTはこのpluginのConnect API backendであり、MCP経路のsilent fallbackを意味しない。

Hub/Chat向けMCP出力では、成功結果、error、notificationのいずれも定義済みの公開metadataへ射影する。`content` や `structuredContent` をそのまま転送せず、secret値、credential file本文、Bearer token、secret-bearing resultを返さない。秘密値が必要な利用は許可されたconsumer内部の別経路に限定し、値をChatへ返すtoolは作らない。既存のHub認証・OS permissionを尊重し、認可のない操作や許可外toolは実行しない。[MCP Tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

## 3. ネットワーク

- **公開範囲:** Connect APIを認証なしでInternet公開しない。外向きSync通信も実環境のFW/proxy条件を調査して許可する。
- **アプリ接続:** Compose候補ではAPI container port 8080を固定し、host側portのみ `CONNECT_API_HOST_PORT` で変更する。未指定時8080、許容範囲1–65535で `127.0.0.1` にだけbindする。Hub Node host processが起動するplugin childは同じhost network namespaceから `http://127.0.0.1:<host port>` を使う想定。別namespaceならrouteを再確認し、loopback bindを無断で広げない。実際のIP、DNS、container networkは未確認である。
- **TLS:** 公式設定上、既定はtrusted network内利用。trusted boundary外を通るAPI接続にはTLSを設定する。証明書の発行方法と名前は実ネットワーク確認後に選ぶ。
- **内部通信:** APIとSyncは同一拠点内でだけ連携させる。Sync health portは選択したdeployment設定に従う（汎用コンテナのOP_HTTP_PORT defaultは8080、公式Helm chartはSyncのHTTP portを8081に設定）。アプリには公開しない。API HTTP defaultは8080、TLS利用時のHTTPS defaultは8443。[Connect configuration](https://www.1password.dev/connect/server-configuration)

## 4. CI/Runner構成

目標はself-hosted runnerをsiteごとに1台ずつ使用すること。job tagは `appv4`、`main-ubutsu2`、`oyama-wsl` とし、各siteのjobは対応するrunnerだけに割り当てる。shared runnerへのfallbackは設けない。job triggerや保護は既存のGitLab設定と本人指示に従い、manual/protectedを新しい必須条件として追加しない。

2026-10-18のGitLab読み取り結果では、plugin subgroupに非shared group runnerが3台あり、説明は `appv4`、`main-ubutsu2`、`oyama-wsl`、statusはonline/activeだった。一方、runner tagは全て空で、project runner listは0件。projectの `group_runners_enabled=false`、`jobs_enabled=false`、`builds_access_level=disabled` も確認した。したがって目標のsite mappingは既存runnerを使う案だが、現状のままjobを起動できるとは見なさない。group/project runner accessやtag付与などの設定は別担当の作業とし、この設計作業から変更しない。

CIはConnect tokenやcredential fileをGitLab variable/artifactに置かない。runner hostに管理される安全なfile referenceを使う。test/deployの実行時期とtriggerは、親の全体レビュー、外部runner設定、既存のGitLab保護設定、本人指示に従って決める。

## 5. 技術選定の決め方

Docker ComposeとKubernetesのどちらを使うかはOS/現状確認後に各拠点で決める。Docker DesktopのWSL backendは専用 `docker-desktop` distro/Engineを使い、WSL distro内へ独立installしたDocker Engineとはdaemon、image、volumeが別である。対象siteごとに `docker context` / `docker info` で接続先を特定し、二重daemon、port衝突、別Engine側へのimage/volume取り違えを避ける。現状情報だけから「3拠点すべて同じ実行方式」とは仮定しない。MiniPC-Oyamaはユーザー報告でWSL利用と確認したが、distribution名、container/Kubernetes runtime、自動起動は未確認である。Windows native向けの配備は前提にしない。[Get started](https://www.1password.dev/connect/get-started) / [Official Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)

2026-10-19の公式package pagesではConnect 1.8.3がAPI/Sync双方でPublic Latest。Compose候補はGHCRのmulti-arch image index digestを固定し、tagだけに依存しない。Docker Hubはlinux/amd64のcompressed sizeをAPI 23.89 MB、Sync 21.62 MBと掲載していた（合計45.51 MBの配布圧縮サイズで、展開後disk、RAM、Vault cache sizeではない）。GHCRとDocker Hubのdigestを取り違えず、実hostのimage source/architectureを配備時に照合する。公式CHANGELOGには現時点でv1.8.3のentryがなく、GitHub advisory pageにも公開advisoryは表示されていない。これは脆弱性不存在の証明ではない。latest自動追随はせず、3拠点で同一の明示digestを使う。

## 6. 公式仕様と未確定事項

公式Helm deployment templateはConnect Deploymentのreplica数とAPI/Sync containerが参照するcredentials Secretを定義する。さらに公式1Password Communityの回答者は、自身の検証で別々の2 Kubernetes clusterにConnectを配備し、同じ `1password-credentials.json` を使ったと報告している。この報告は同一credentials fileでの複数cluster利用を支える実例だが、3 siteの検証結果やあらゆるserver構成の保証ではない。

本設計ではCredentialMCP registration identity 1つ、runtime pair 3組を区別する。既存tokenが3つの独立APIで受け入れられる点は設計仮説として、配備後のsite別認証確認まで未実証とする。追加registration/tokenや権限の変更はこの設計に含めない。credential配布が必要な場合は対象siteと操作を親へ明示して安全なhandoffを行う。[1Password Community: multi-cluster report](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Official Helm deployment template](https://raw.githubusercontent.com/1Password/connect-helm-charts/main/charts/connect/templates/connect-deployment.yaml)
この仕様根拠は実際のcredential配布を指示するものではない。credential配布が必要な場合は対象siteと操作を親へ示し、既存の安全なhandoffを使う。既存registration/token再利用に追加の登録・token承認gateは設けない。配備後はAPI認証を各拠点で個別に検証する。

## 6. 概要レビュー

ゼロベースレビューで、以下を反映した。
- 「拠点間volume共有なし」がAPI/Sync間の必要なvolumeまで否定する読み違いを解消し、ローカル3 volumeにした。
- 登録1件、runtime pair 3件、コンテナ6個を分けて記載した。
- 2 clusterの同一credentials file使用はCommunity利用者の実例、Helm replicaは単一deploymentの公式設定として区別。3 siteでの既存token認証は設計仮説であり、実地試験前に未確認としている.
- PP2→1Password pluginはこのrepoの分離moduleとしてHubのlocalstdio downstreamになる。既存外部認証/OS権限を使い、success/error/notificationを公開metadataへ射影してsecret-bearing結果をHub/Chatへ返さない。site-local routeを確認し、無断route changeだけを禁じ、本人指定の経路変更は許容する。
- CI targetをsite専用self-hosted runner 3台へ変更。現状runnerはonlineでもtag/project accessが未設定のため、別担当の設定完了前にpipelineは起動しない。
- host/IPとcontainer engineは未確認。Compose候補のhost API portは既定8080/可変1–65535、container portは8080固定。Docker Engine 28.0.0より前ではlocalhost published portが同一L2 segmentから到達できる場合があるため、Engine versionも実環境で確認する。
