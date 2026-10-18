# 詳細設計: 3拠点のConnect実行単位

## 1. 配備単位と構成

各拠点に独立したdeploymentを1つ作る。deploymentは同じ拠点ネットワーク内で連携するConnect APIとConnect Syncからなる。両コンテナは同じ暗号化cache volumeを読む/書く。volumeは拠点ごとにローカルであり、他拠点からmountしない。

| Instance | API endpoint | API container | Sync container | volume owner | Consumer |
|---|---|---|---|---|---|
| APPv4 | 未確定。実ネットワーク確認後に設定 | 1 | 1 | APPv4内のみ | APPv4上のアプリ |
| MainUbutsu2 | 未確定。正式remote/host確認後に設定 | 1 | 1 | MainUbutsu2内のみ | MainUbutsu2上のアプリ |
| MiniPC-Oyama | 未確定。host確認後に設定 | 1 | 1 | MiniPC-Oyama内のみ | MiniPC-Oyama上のアプリ |

OS/実行基盤、volume driver、host名/IP、TLS終端は未確認のため固定しない。Docker Compose/Kubernetesのmanifestは各環境の棚卸し後に選ぶ。

## 2. 認証とVault境界

- 1Password account側に既存Connect登録 CredentialMCPが1つある前提とする。Connect serverを作り直したり、tokenを追加発行しない。
- 1password-credentials.jsonはConnect Sync/API containerが1Password Connect identityとして動作するためのsecret。各hostへ安全に届ける必要がある。値はGit/ログ/チャットに載せない。
- アプリがConnect APIを呼ぶ際には既存access tokenをBearer tokenとして使う。アプリのruntime secret storeから読み、source codeやtracked .envには置かない。
- Connect tokenが対象Vaultの読み取りのみを許すことを、値を表示せずアカウント側の権限情報で確認する。読み取り専用でない場合は既存credentialを変更せず、親に権限変更の必要性を報告する。
- ChromeVaultなどitem名/内容をAPI応答やtest logに記録しない。受け入れ記録は成功/失敗と応答statusだけにする。

公式Connect conceptsによるとcredentials fileはConnect serverごとに一意で、serverは1つ以上のtokenを持ち、tokenはそのserverが許可されたVaultへアクセスするためのもの。従って3拠点は同じlogical Connect server identityのreplicaでなければならない。3拠点独立deploymentが同一tokenを受け入れることは、公式文書上で明記されていないため、3拠点へのcredential投入前に確認を残す。[Connect concepts](https://www.1password.dev/connect/concepts) / [Get started](https://www.1password.dev/connect/get-started)

## 3. コンテナ設定項目

| 要素 | 方針 |
|---|---|
| API image | 1Password公式Connect API image。正式版tagを固定。 |
| Sync image | APIと同じConnect releaseの公式Sync image。 |
| Credential input | 1password-credentials.jsonをsecret fileとして両containerへread-onlyで渡す。OpenAI/GitLab CI secretには置かない。 |
| OP_SESSION | container内のcredentials file pathを指定。公式環境変数。 |
| Local data | APIとSyncが同じ拠点内volumeを共有。公式default pathは /home/opuser/.op/data。 |
| API endpoint | APIのみアプリに公開。HTTP default 8080、TLS時のHTTPS default 8443。APIのhealth endpointは /health と /heartbeat。 |
| Sync endpoint | health port default 8081は拠点内運用監視だけ。アプリの接続先にしない。 |
| Container bus | API/Sync間の内部busだけを許可。public/host networkに露出しない。 |
| Resource limits | 実VM/hostの空きRAM/CPUを確認後に指定。APPv4の申告RAM値を3拠点共通のlimitと仮定しない。 |

画像・環境変数・volumeとhealth情報は公式Configure/Helm chartを基準にする。[Connect server configuration](https://www.1password.dev/connect/server-configuration) / [Official Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)

## 4. ネットワーク/保護

1. APIのbind addressは当初loopbackまたはサイト内private networkのみにする。
2. サイト内でAPIへ到達するアプリ/hostをallow-list化する。外部向けport-forward、public DNS、public load balancerは設定しない。
3. 接続がtrusted network boundaryを越える場合はTLSを使う。証明書とTLS termination方式は実ネットワークの確認後に選ぶ。
4. 外向きSync接続は各siteのegress/proxy/FWを調査してから許可する。接続先を推定してFWルールを作らない。
5. credential file、token、private keyをcontainer environmentの直接値や出力可能なcompose configに埋め込まない。container secret/file mountを優先する。
6. GitLab project CI/CDを全停止済み。GitLabに配備用secretやtoken variableを作らない。

## 5. 接続の確認方法

各拠点を一つずつ、ユーザーが承認した安全なsecret handoff後に確認する。tokenはshell historyやコマンド出力へ書かない。

1. API healthを内部から確認する。API /health が成功し、API /heartbeatがhealthyなこと。
2. Sync /health が成功し、Sync依存がactiveであることを確認する。health portをhost外へ開放しない。
3. 同じ拠点内からBearer tokenでAPI GET /v1/vaultsを実行し、期待Vaultの識別情報だけを比較する。token文字列もitem valuesも出力しない。[API reference](https://www.1password.dev/connect/api-reference)
4. 既存read-only scopeの確認は権限metadataで行い、実Vault上のwrite/deleteを試験しない。
5. 結果をhost名、image version、API/Sync health、Vault ID一致、時刻だけで記録する。

## 6. 初期同期、障害、rollback

- 初回syncが完了するまでAPIをアプリ向けに公開しない。未同期またはtoken不正ならfail-closedとする。
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
- 3site同時利用と登録の関係が公式資料で確約されるまでcredential配布をstop conditionにした。
