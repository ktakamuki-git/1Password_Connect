# 概要設計: CredentialMCPを使う3拠点Connect

## 1. アーキテクチャ

```text
                       1Password Cloud / 同じ許可Vault
                         ^             ^             ^
                         | Sync        | Sync        | Sync
                         |             |             |
APPv4:      [Connect API] <-> [local encrypted volume] <-> [Connect Sync] -> APPv4 app
MainUbutsu2:[Connect API] <-> [local encrypted volume] <-> [Connect Sync] -> local app
MiniPC:     [Connect API] <-> [local encrypted volume] <-> [Connect Sync] -> local app

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

## 3. ネットワーク

- **公開範囲:** Connect APIを認証なしでInternet公開しない。外向きSync通信も実環境のFW/proxy条件を調査して許可する。
- **アプリ接続:** 同一ホストならloopback bindingを第一候補とする。別ホストからならサイト内のprivate networkで接続元を限定する。実際のIP、DNS、container networkは未確認のため、固定値・公開portは決めない。
- **TLS:** 公式設定上、既定はtrusted network内利用。trusted boundary外を通るAPI接続にはTLSを設定する。証明書の発行方法と名前は実ネットワーク確認後に選ぶ。
- **内部通信:** APIとSyncは同一拠点内でだけ連携させる。Syncのhealth port (chart default 8081) はアプリには公開しない。API HTTP defaultは8080、TLS利用時のHTTPS defaultは8443。[Connect configuration](https://www.1password.dev/connect/server-configuration)

## 4. 技術選定の決め方

Docker ComposeとKubernetesのどちらを使うかはOS/現状確認後に各拠点で決める。Docker Composeを採る場合は公式例を基にする。Kubernetesを採る場合は公式1Password Helm chartを候補とし、chartのconnect.replicasがruntime replica数を設定することを根拠にする。現状情報だけから「3拠点すべて同じ実行方式」とは仮定しない。[Get started](https://www.1password.dev/connect/get-started) / [Official Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)

image tagは実装時に公式の対応版を調べて明示的に固定する。latest tagや過去の独自registry/承認JSONは使わない。片方の拠点だけを更新して動作差が生じないよう、同じConnect版を3拠点に揃える。

## 5. 公式仕様と未確定事項

公式Connect concepts/get-startedは登録時のcredential file、server access token、Connect API/Sync pairを定義する。公式Helm chartは同じConnect deploymentのreplica数を持ち、各replica pairへcredential Secretと共有データvolumeを渡す。これにより一つのlogical serverのreplicaを構成する案は支えられる。一方、別host/clusterに分かれた3つの独立deploymentが同一tokenを同時に使う構成について明示した公式説明は確認できていない。

したがって設計上は「登録1つの同一logical Connect serverを3か所で複製実行」を要求し、3拠点のcredential/token配布前に親レビューと公式根拠確認を通す。別々のConnect登録を作る必要があれば停止する。既存tokenの値は見ず、本人の安全な操作で各APIへの認証を確認する。

## 6. 概要レビュー

ゼロベースレビューで、以下を反映した。
- 「拠点間volume共有なし」がAPI/Sync間の必要なvolumeまで否定する読み違いを解消し、ローカル3 volumeにした。
- 登録1件、runtime pair 3件、コンテナ6個を分けて記載した。
- 1つのtokenが3つの独立環境で有効という根拠の強さを過大評価しないよう、未確認事項とcredential配布gateを追加した。
- ネットワークやcontainer engine未確認のため、host/IP/port mappingは設計で決めず実調査へ送った。
