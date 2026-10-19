# 詳細設計: Oyama単一Connect runtimeとHub連携

更新日: 2026-10-19  
対象: `ktakamuki_wsl/pc-platform/plugin/1Password_Connect`

## 1. 配備単位

| Site | Connect API | Connect Sync | Connect volume | PP2 Hub |
|---|---:|---:|---|---|
| Oyama | 1 (既存稼働) | 1 (既存稼働) | Oyama host上の暗号化volume 1つをAPI/Sync間で共有 | Hub配備先 |
| APPv4 | 0 | 0 | なし | Hub配備先 |
| Ubutsu2 | 0 | 0 | なし | Hub配備先 |

Connect API/Syncの実行単位はOyamaの1組のみ。本人確認ではOyamaに既存サービスが稼働し、復旧後の `docker ps` も成功している。このrepositoryからConnectを再配備・再起動・移動しない。

3つのHub localstdio plugin processは同じOyama APIをbackendに使う設計とする。API endpointと既存の各Hub→Oyama route/authは未確認なので、実際の接続を有効にする前に既存の許可済み経路、TLS trust、実効principal/scopeをsite別にread-onlyで確認する。経路が未確認または拒否された場合は接続せず、そのsiteと拒否理由を報告する。

## 2. CredentialsとVault境界

- 既存の1Password registration `CredentialMCP`を維持する。registration/tokenを追加発行しない。
- Connect API/Syncのbootstrap credentialsはOyamaの既存runtimeに属する。値やfile contentsは読まず、出力・Git・CI variable/artifact/logへ出さない。
- Hub pluginがConnect APIを呼ぶ既存認証経路はsiteごとに未確認。Codex/GitLab connectorの認証をHub runtimeへ流用しない。
- 既存Hub secret providerが対象Hubのruntime identityへcredentialを安全に供給できるかを確認する。provider、secret reference、権限が未設定なら追加せず、対象と必要な設定を報告する。
- Pluginは現行のVault ID/status metadata機能のみ提供する。secret-valued tool、consumer delivery、独自authorizationをこの変更で追加しない。

## 3. Runtime/API構成

Connect APIとSyncは同一Oyama host/network内で動作し、同じ暗号化Connect data volumeを共有する。拠点間volume共有はしない。Oyama上のCompose referenceはその既存1組に限る。

Compose referenceのAPI loopback bindは他Hub hostからの到達を提供しない。対象Hubの既存network namespace/routeが未確認なため、remote接続用listener、port bind、DNS、TLS certificate、ACL、firewall ruleは追加しない。既存経路がないと確認された場合はそのまま報告し、APPv3管理routeへfallbackしない。

## 4. MCPの呼び出し

```text
既存Hub認証/OS identity
  -> site-local PP2 Hub
  -> localstdio 1Password plugin
  -> 既存許可済みroute (未確認)
  -> Oyama Connect API (1組)
```

Hubはpluginの `tools/list` と `tools/call` を既存downstream経由で扱う。Plugin backendは全Hubで単一Oyama Connect APIを指す。Site、endpoint、tokenをtool argumentで選択させない。現在の `connect_list_vaults` は `GET /v1/vaults` のVault ID/status metadataだけを返し、item値の読み取りやconsumer内配送は行わない。

Read-only API responseでもraw upstream error、authorization header、credential、Vault item contentsをlogまたはChatへ出さない。明示的なpermission denialは同じ操作を別経路に隠して迂回せず、対象と理由を報告する。結果がunknownのoperationを無条件に再実行しない。

## 5. Networkと障害境界

- Connect APIは未認証public Internetへ公開しない。
- 既存Oyama API/Sync pairのoutbound sync動作は既存runtimeを変更せず維持する。
- 3 Hubからのrouteは既存構成だけを使用する。経路追加、public bind、ACL/TLS/credential変更は別の明示された作業対象として報告する。
- Central Oyama runtimeまたはroute停止は3 siteのplugin利用へ影響する。site-local fallbackやautomatic failoverは定義しない。
- Connect API/Sync health、Hub route reachability、auth/scope、plugin MCP successを別々のevidenceとして記録する。health successだけでauthenticated API accessを推定しない。

## 6. CIと配備責務

このrepository CIはstatic/mock verificationだけを行い、Connect deploy jobを含まない。self-hosted non-shared runnersを使い、shared/paid runnerやdeploy fallbackは使わない。CI pipeline successはConnect実runtime、Hub route/auth、secret availabilityを証明しない。

APPv4・Ubutsu2・Oyama Hub deploymentとplugin artifact packagingはHub担当の既存Runner-based flowの責務とする。本repositoryからHub/deploy scriptを変更しない。APPv3 management/Gatewayを新システムのdependencyにしない。

## 7. Acceptance evidence

1. Oyama上の既存API/Sync pairはユーザー確認済み。Connect再配備・再起動をしない。
2. Oyama APIへの各Hub route、TLS trust、effective identity/scopeは別々にread-only確認する。未確認のsiteは接続を有効化しない。
3. Connect credential/token値、Vault item/secretを読まず、ログ・tool error・CIへ出さない。
4. Pluginはsingle Oyama APIへ接続する設計とし、fallbackやAPPv3管理経路を追加しない。
5. CIはsite-bound non-shared verificationのみ。deployは実行しない。
6. 既存許可・OS identityでのoperationだけを行い、no-clobber・安全なrecoveryを維持する。

