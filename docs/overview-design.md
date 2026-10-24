# 概要設計: Oyama集約Connectと3拠点Hub連携

更新日: 2026-10-19  
対象: `ktakamuki_wsl/pc-platform/plugin/1Password_Connect`

## 1. 現行トポロジー

Connect runtimeはOyama上のAPI/Sync 1組で、本人確認により既に稼働中である。APPv4・Ubutsu2・OyamaはPP2 Hubの配備先であり、Connectの配備先はOyamaだけとする。3つのHub用にConnectを複製しない。

```text
APPv4 Hub ── localstdio ──> 1Password plugin ──┐
Ubutsu2 Hub ─ localstdio ──> 1Password plugin ─┼─> 既存の許可済み経路 (site別に未確認)
Oyama Hub ─── localstdio ──> 1Password plugin ─┘
                                                  └─> Oyama Connect API (1組)
                                                       ├─ Connect API × 1
                                                       └─ Connect Sync × 1
                                                          └─ 同一Oyama hostの暗号化data volume
```

各Hub pluginのbackendは同じOyama APIを指す方針とする。HubからOyamaまでのendpoint、route、TLS、ACL、実効principal/scopeはこの作業では確認・変更していない。既存の許可済み経路が確認できないHubからの接続は有効化しない。

| 要素 | 数 | 配置・責務 |
|---|---:|---|
| 1Password Connect registration | 1 | 既存 `CredentialMCP` identity。再登録・token再発行なし |
| Connect API | 1 | Oyama上で既存稼働中。Hub pluginが使うREST API |
| Connect Sync | 1 | Oyama上でAPIと連携し、既存Vaultを同期 |
| 暗号化data volume | 1 | Oyamaの同一host内でAPI/Syncが共有。site間共有なし |
| PP2 Hub | 3 | APPv4、Ubutsu2、Oyama。各siteのHub配備はHub担当 |
| 1Password plugin | Hubごと | Hub localstdio child。Connect APIへ直接REST接続 |

## 2. データ経路と境界

Connect Syncは既存registrationのcredentialsを使って1Password Cloudと同期する。APIとSyncはOyama内の同じ暗号化volumeを使う。登録credentialの値、API token、Vault itemは読み取らず、このrepo/CI/logへ配置しない。

Hubからpluginへは既存localstdio downstream経路を使う。現在の `connect_list_vaults` は認証付き `GET /v1/vaults` のVault ID/status metadataだけを扱う。item詳細やsecret値の取得、consumerへの秘密配送は含まれない。既存consumerのsecret取得依存を解消したとは扱わない。

追加のsecret-returning MCP tool、独自credential provider、approval gate、APPv3管理経路は追加しない。既存Hub認証とOS identity/permissionsを使い、明示された権限拒否は対象と理由を返す。

## 3. 接続・障害動作

ConnectはOyamaに集約されるため、Oyama runtimeまたはそこへの経路障害は3 Hubのplugin利用に影響する。site-local Connect fallback、別siteへの自動切替、HA replicaはない。API operationが完了したか不明なときは結果をunknownとして扱い、無条件に再実行しない。

Compose referenceはOyamaの1組だけを表す。現Compose bindはloopbackであり、他hostからの直接到達を示さない。既存のprivate routeが確認されない限り、listener/bind/DNS/TLS/ACL/firewallを追加・変更しない。Composeは本タスクで適用・再起動しない。

## 4. 配備とCIの境界

このrepositoryはstatic/mock verificationを行い、Connect runtimeのdeploy jobを持たない。APPv4・Ubutsu2・Oyama Hubの配備と別repositoryのplugin packagingはHub担当の既存Runner-based pipelineで扱う。Hub本体のdeployment scriptはこのrepoで重複実装しない。

CIは既存のsite-bound non-shared self-hosted Runner tagだけを使う。Shared/paid runner fallbackは設けない。CI successはHub/Connectのruntime認証、route到達性、秘密配置、実配備を証明しない。

## 5. 確認済み・未確認

- 確認済み: OyamaにConnect API/Syncが1組稼働中。ユーザーは復旧後の `docker ps` 成功を報告。これはsite別route/authの証明ではない。
- 確認済み: 3 Hub siteのstatic/mock self-hosted verification jobが成功している。Connectの実配備は行っていない。
- 未確認: 各Hub実行環境からOyama APIへの既存route、TLS trust、認証主体/scope、secret providerが実行時に利用できること。
- 未確認: 既存Hub releaseがこのplugin repositoryをpackage/pinしているか。
- 禁止: 新規credential/token、権限、ネットワーク経路、public exposureをこの設計文書だけで作成すること。

## 6. 仕様参照

- [1Password Connect concepts](https://www.1password.dev/connect/concepts)
- [1Password Connect server configuration](https://www.1password.dev/connect/server-configuration)

本設計は3拠点Connect案を置き換える。Connect runtimeはOyamaの1組、3拠点はHubの配置先として数える。