# 要件定義: Oyama単一Connect runtime / 3拠点Hub

作成日: 2026-10-18  
対象: GitLab project `87779016` / `ktakamuki_wsl/pc-platform/plugin/1Password_Connect`

## 1. 目的

既存の1Password Connect登録 **CredentialMCP** と既存の認証情報を用いる。Connect API/SyncはOyamaに1組だけ集約済み（本人確認）。APPv4・MainUbutsu2・MiniPC-OyamaはPP2 Hubの配備先であり、Connect runtimeを3拠点へ複製しない。各Hubのpluginは同じOyama Connect APIを使う方針だが、既存routeと認証scopeはsite別に確認する。

## 2. スコープ

- 1つのConnect登録 `CredentialMCP` を論理的なConnect server identityとして扱う。
- Connect runtimeはOyamaの1組（API 1、Sync 1、同一hostのdata volume 1つ）。APPv4/Ubutsu2/Oyamaの3拠点はHub/Runnerの対象であり、Connect serverのdeployment数ではない。
- Oyamaの1つのConnect APIが既存Vaultを同期する。3 Hubのpluginは同一APIを利用する。各Hubからのrouteが既存かつ許可済みであることは別途read-onlyで確認し、routeを追加・変更しない。
- Oyama上のAPIとSyncだけが同一の暗号化data volumeを共有する。Connect runtimeをHub siteへ複製せず、拠点間volumeを共有しない。
- 設計・実装は既存GitLab projectに追加する。既存READMEは雛形であり、上書きしない。
- PP2本体はProject ID `87779895` `ktakamuki_wsl/pc-platform/pc_platform2`。Hub localstdio downstreamとして動く1Password adapterをこのrepositoryのplugin分離moduleへ追加し、PP2 coreは変更しない。
- CIは3つのHub site専用self-hosted Runnerを使い、shared runnerは使用しない。各tag jobはstatic/mock verificationのみで、Connect runtimeを各siteへ配備しない。

## 3. 受け入れ条件

1. Connect登録は `CredentialMCP` 1つ、Connect runtimeはOyamaのAPI/Sync 1組とする。3 Hub siteをConnect deployment数に数えない。
2. Oyama上の既存API/Sync 1組が稼働し、Syncが有効な状態を返す。実状態は本人報告であり、このタスクでは再起動・再配備しない。
3. 既存認証でOyama APIへのread-only認証が通ることを、値を出さず確認する。3 Hubからの到達/認証はそれぞれ別に記録し、token値やcredential本文を出力しない。
4. 3 Hubのpluginは同一のOyama Connect API endpointを使う。Hub間にrelayやConnect replicaを追加せず、OyamaのAPI/Sync volumeはlocalのままにする。
5. Oyama runtimeが既存Vaultとread-only scopeを使う。既存token/scopeと各HubからのAPI利用可否が確認できない場合は、auth/network設定を作らず未確認として報告する。
6. 単一Oyama APIは未認証で外部公開しない。3 Hubから使うrouteは既存の許可済み経路/TLSだけを使い、未確認経路やlistenerをこの作業で追加しない。
7. Connect serverは既存のOyama runtime 1組だけを対象とする。APPv4・Ubutsu2・OyamaはHub配備先であり、APPv3は対象外。旧APPv3管理経路/host inventoryを前提にせず、既存APPv3サービスも停止・移動・変更しない。
8. static/mock verification、Oyama runtime状態、各Hubからの既存route/authを別々に記録する。Connectの3拠点配備は行わない。
9. PP2 Hub（Project ID `87779895`）は、このrepositoryのplugin分離moduleをlocalstdio MCP downstreamとして起動し、pluginは単一Oyama Connect APIへ接続する。
10. CIの3site verification jobは既存self-hosted runnerへ

## 4. セキュリティ・変更の境界

- `1password-credentials.json` とConnect API tokenはsecretであり、Git管理しない。値の取得、表示、ログ出力、共有はしない。
- 既存CredentialMCP登録・既存トークンを使う前提。新しい登録/トークン発行、Vault grant変更、既存credentialの常用先変更、credential配布は本段階で実行しない。必要になった場合は対象操作と拠点を親へ示してから安全なhandoffを行う。
- PP2 Hubからのplugin呼び出しはlocalstdioとし、Hubの既存外部認証・設定済みOS実行権限の境界で動作する。独自認証/承認、権限昇格を追加しない。MCP success/error/notificationを含む出力は公開metadataのみ。secret値やcredential/tokenをChatへ返すtoolを設けず、秘密供給は許可consumerの内部だけで扱う。
- APIを認証なしで外部公開しない。TLS終端、許可接続元、ポート公開範囲は実ネットワークを確認するまで決めない。
- テスト専用の1Password project/server/vaultは作らない。既存Vaultの安全な読み取り確認のみを対象にし、内容値をログへ出さない。
- GitLabにsecret値を保存しない。self-hosted runnerごとのsecret file path/権限で運用し、credential JSON/API tokenをGitLab CI variable、artifact、job logへ出さない。Shared runnerは使わない。Runner/CI設定の変更は別担当に委ねる。

## 5. 環境情報と未確認事項

| 配備先 | 現時点の情報 | 配備前に確認すること |
|---|---|---|
| APPv4 | Hub deployment target; CI verification runner tag `appv4` | Hub runtime identityと既存routeでOyama Connect APIへ到達できるか、既存auth/scope |
| MainUbutsu2 | Hub deployment target; CI verification runner tag `ubutsu2` | Hub runtime identityと既存route/authからOyama Connect APIへ到達できるか |
| MiniPC-Oyama | Connect server centralization target; user reports existing API/Sync pair running and post-fix `docker ps` success. Also a Hub target; runner tag `oyama-wsl` | Existing API/Sync config, exact endpoint, external route from other Hub sites, existing credential scope; do not display secret values |

2026-10-19にGitLab CI pipeline `2964251286` (main) と `2964197060` (implementation branch) で `site-appv4`、`site-ubutsu2`、`site-oyama-wsl` が全て成功した。Runner IDs `57553720`、`57553750`、`57553761` はいずれも `is_shared=false`。このjob群はstatic/mock/Compose syntax verificationで、配備、既存credentialの読取り、Vault auth、Docker/systemd配備権限を検証していない。

Oyama上のConnect pairとpost-fix `docker ps` successは本人確認済み。APPv4/Ubutsu2 Hubからの既存routeとruntime authはこのタスクでは未確認であり、secret値は読んでいない。

## 6. 公式仕様と設計仮説

公式Helm chartではConnect Deploymentのreplica数を設定でき、API/Sync containerは同じcredential Secretを参照する。公式1Password Communityの該当回答者は、自身の検証として2つのKubernetes clusterそれぞれへConnectを配置し、同一の `1password-credentials.json` を使ったと報告している。これは複数clusterでの利用可能性を支える実践報告であり、3拠点の実動作確認や将来の全構成への保証ではない。

Central runtimeはOyamaの1組とし、同じ既存CredentialMCP identityを利用する。3 Hub plugin processが同じexisting credential/token referenceを使えるかは各siteの既存safe-secret routeとauth scopeで確認するが、値を表示/複製/CIへ保存しない。

現在はsecret placement/authenticationを行わない。将来の配布操作が必要なときだけ、対象siteと操作を親へ明示し、値をチャット/Gitへ出さない安全なhandoffを行う。[1Password Community: multi-cluster report](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Official Connect Helm deployment](https://raw.githubusercontent.com/1Password/connect-helm-charts/main/charts/connect/templates/connect-deployment.yaml)

## 7. レビュー

ゼロベース確認: 用途/台数/権限境界、秘匿情報、CI、環境識別、受け入れ条件、運用境界を定義した。  
発見と解消:
- APIとSyncのvolume要件を「拠点間共有volume不要」と混同する恐れ → 拠点内共有のみを要件化。
- Hub site 3か所とConnect deployment数を混同していた → Connect runtimeはOyamaの1組、Hub deploymentはAPPv4/Ubutsu2/Oyamaとして分離。
- 3 HubからOyama Connect APIへのroute/authは未確認 → 既存経路をsecret-freeで確認し、routeを新設せず不明なsiteはunavailableとする。
- Community利用者の2-cluster例と公式Helm構成は参考情報に留める。Connect runtimeは1組であり、3 Hubからの実認証/到達性はsite別に未確認。
- screenshot状態は登録/tokenの存在のみでデプロイ/認証確認ではない → 認証受け入れ条件を別途定義。
- PP2 Hubからpluginへのstdio downstream呼び出し方向と、3 Hubから単一Oyama Connect RESTへの既存backend経路、MCP成功/エラー/通知のsecret-safe出力、既存外部認証/OS permissionsが未記載
- CI実行可能性と配備可能性を混同しない。既存self-hosted Runner上の3site verificationは成功済みだが、現場service設定、権限、secret配置、実認証および実配備は未確認。
