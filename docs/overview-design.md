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
PP2 ──MCP JSON-RPC tools/call──> [PP2 MCP adapter] ──existing plugin connection──> [1Password plugin MCP]
                                      │
                                      ├─ tools/list でtool/schemaを取得
                                      ├─ allow-list内のread toolだけを呼び出す
                                      └─ content / structuredContent / isErrorを型付きで返す
```

このadapterはMCPのcall境界であり、Connect REST APIそのものではない。PP2の各site用plugin MCP接続が、そのsite-local Connect経路に結び付くことを実環境で追跡・確認する。中央または別siteのConnectへ向いている場合や経路が確認できない場合はsite-local準拠と見なさず、中央/他siteへのsilent bypassやDirect REST fallbackを行わない。既存plugin接続のtransport、server identity、tool名/schemaとConnect backendの対応は稼働環境から確認するまで固定しない。MCP標準の `tools/list` とJSON-RPC 2.0 `tools/call` envelopeを使い、未確認tool名を推測しない。read-only allow-list、caller approval、error分類、timeout、結果/引数をsecret-safeに扱う。新credential発行は行わない。[MCP Tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

## 3. ネットワーク

- **公開範囲:** Connect APIを認証なしでInternet公開しない。外向きSync通信も実環境のFW/proxy条件を調査して許可する。
- **アプリ接続:** 同一ホストならloopback bindingを第一候補とする。別ホストからならサイト内のprivate networkで接続元を限定する。実際のIP、DNS、container networkは未確認のため、固定値・公開portは決めない。
- **TLS:** 公式設定上、既定はtrusted network内利用。trusted boundary外を通るAPI接続にはTLSを設定する。証明書の発行方法と名前は実ネットワーク確認後に選ぶ。
- **内部通信:** APIとSyncは同一拠点内でだけ連携させる。Sync health portは選択したdeployment設定に従う（汎用コンテナのOP_HTTP_PORT defaultは8080、公式Helm chartはSyncのHTTP portを8081に設定）。アプリには公開しない。API HTTP defaultは8080、TLS利用時のHTTPS defaultは8443。[Connect configuration](https://www.1password.dev/connect/server-configuration)

## 4. CI/Runner構成

目標はself-hosted runnerをsiteごとに1台ずつ使用すること。job tagは `appv4`、`main-ubutsu2`、`oyama-wsl` とし、各siteのdeploy jobは対応するrunnerだけで実行する。shared runnerへのfallbackは設けず、deploymentはsite別のmanual/protected jobとして分ける。

2026-10-18のGitLab読み取り結果では、plugin subgroupに非shared group runnerが3台あり、説明は `appv4`、`main-ubutsu2`、`oyama-wsl`、statusはonline/activeだった。一方、runner tagは全て空で、project runner listは0件。projectの `group_runners_enabled=false`、`jobs_enabled=false`、`builds_access_level=disabled` も確認した。したがって目標のsite mappingは既存runnerを使う案だが、現状のままjobを起動できるとは見なさない。group/project runner accessやtag付与などの設定は別担当の作業とし、この設計作業から変更しない。

CIはConnect tokenやcredential fileをGitLab variable/artifactに置かない。runner hostに管理される安全なfile referenceを使う。test/deployのcommit triggerやmanual実行は親の全体レビューと外部runner設定が揃った後に計画する。

## 5. 技術選定の決め方

Docker ComposeとKubernetesのどちらを使うかはOS/現状確認後に各拠点で決める。Docker Composeを採る場合は公式例を基にする。Kubernetesを採る場合は公式1Password Helm chartを候補とし、chartのconnect.replicasがruntime replica数を設定することを根拠にする。現状情報だけから「3拠点すべて同じ実行方式」とは仮定しない。MiniPC-Oyamaはユーザー報告でWSL利用と確認したが、distribution名、コンテナ/Kubernetes runtime、自動起動は未確認である。Windows native向けの配備は前提にしない。[Get started](https://www.1password.dev/connect/get-started) / [Official Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)

image tagは実装時に公式の対応版を調べて明示的に固定する。latest tagや過去の独自registry/承認JSONは使わない。片方の拠点だけを更新して動作差が生じないよう、同じConnect版を3拠点に揃える。

## 6. 公式仕様と未確定事項

公式Helm deployment templateはConnect Deploymentのreplica数とAPI/Sync containerが参照するcredentials Secretを定義する。さらに公式1Password Communityの回答者は、自身の検証で別々の2 Kubernetes clusterにConnectを配備し、同じ `1password-credentials.json` を使ったと報告している。この報告は同一credentials fileでの複数cluster利用を支える実例だが、3 siteの検証結果やあらゆるserver構成の保証ではない。

本設計ではCredentialMCP registration identity 1つ、runtime pair 3組を区別する。既存tokenが3つの独立APIで受け入れられる点は設計仮説として、配備後のsite別認証確認まで未実証とする。追加registration/tokenや権限の変更はこの設計に含めない。credential配布が必要な場合は対象siteと操作を親へ明示して安全なhandoffを行う。[1Password Community: multi-cluster report](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Official Helm deployment template](https://raw.githubusercontent.com/1Password/connect-helm-charts/main/charts/connect/templates/connect-deployment.yaml)
この仕様根拠は実際のcredential配布を指示するものではない。credential配布が必要な場合は対象siteと操作を親へ示し、既存の安全なhandoffを使う。既存registration/token再利用に追加の登録・token承認gateは設けない。配備後はAPI認証を各拠点で個別に検証する。

## 6. 概要レビュー

ゼロベースレビューで、以下を反映した。
- 「拠点間volume共有なし」がAPI/Sync間の必要なvolumeまで否定する読み違いを解消し、ローカル3 volumeにした。
- 登録1件、runtime pair 3件、コンテナ6個を分けて記載した。
- 2 clusterの同一credentials file使用はCommunity利用者の実例、Helm replicaは単一deploymentの公式設定として区別。3 siteでの既存token認証は設計仮説であり、実地試験前に未確認としている.
- PP2→1Password plugin MCPはConnect RESTと混同せず、MCP tools/list / tools/call adapter契約に加え、plugin backendがsite-local Connectへ結び付くことの実環境確認とsilent bypass禁止を明記した。
- CI targetをsite専用self-hosted runner 3台へ変更。現状runnerはonlineでもtag/project accessが未設定のため、別担当の設定完了前にpipelineは起動しない。
- ネットワークやcontainer engine未確認のため、host/IP/port mappingは設計で決めず実調査へ送った。
