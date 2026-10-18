# 要件定義: 1Password Connect 3拠点構成

作成日: 2026-10-18  
対象: GitLab project `87779016` / `ktakamuki_wsl/app/1Password_Connect`

## 1. 目的

既存の1Password Connect登録 **CredentialMCP** と既存トークンを使い、APPv4、MainUbutsu2、MiniPC-Oyama の各拠点に Connect を配備する。各拠点のアプリは同じ拠点にあるConnect APIへ接続し、同じVaultを読む。登録・トークン・実行deploymentの数は混同しない。

## 2. スコープ

- 1つのConnect登録 `CredentialMCP` を論理的なConnect server identityとして扱う。
- 配備先は3拠点。各拠点でConnect APIとConnect Syncを1コンテナずつ動かす。総数はAPI 3、Sync 3。
- 3拠点とも同じVaultを同期する。アプリが通常使う接続先は各拠点のローカルConnect APIとする。
- 各拠点内ではAPIとSyncが同じ暗号化データ領域を共有する。拠点間では共有しない。
- 設計・実装は既存GitLab projectに追加する。既存READMEは雛形であり、上書きしない。
- GitLab CI/CD、プロジェクトRunner、共有Runner、Group Runnerは停止状態を維持する。検証はローカルで行う。

## 3. 受け入れ条件

1. 1Password側のConnect登録が `CredentialMCP` 1つであり、同じ登録の認証情報を使う実deploymentが3つであると説明上も設定上も明確である。
2. 各拠点でAPIとSyncが起動し、Syncが有効な状態を返す。
3. 既存トークンで各拠点のAPI認証が通る。認証値やcredentialファイルの中身はログ・Git・チャットへ出さない。
4. アプリの接続先は各拠点内のAPI endpoint。3拠点間でキャッシュ/データvolumeを共有しない。
5. 各deploymentが同じVaultを参照し、許可済みの読み取り操作だけを行える。既存トークンのVault/権限を確認できない場合は配備を停止する。
6. APIは未認証で外部公開しない。各拠点で接続元を限定し、信頼ネットワーク外をまたぐ場合はTLSを使う。
7. APPv3には配備しない。APPv4とAPPv3を識別できるホスト情報を確認してから変更する。
8. 実配備と実動作を拠点別に検証し、単体/static test、配備、3拠点実動作を別々に記録する。

## 4. セキュリティ・変更の境界

- `1password-credentials.json` とConnect API tokenはsecretであり、Git管理しない。値の取得、表示、ログ出力、共有はしない。
- 既存CredentialMCP登録・既存トークンを使う前提。新しい登録/トークン発行、Vault grant変更、既存credentialの常用先変更、credential配布は本段階で実行しない。必要になった場合は対象操作と拠点を親へ示してから安全なhandoffを行う。
- APIを認証なしで外部公開しない。TLS終端、許可接続元、ポート公開範囲は実ネットワークを確認するまで決めない。
- テスト専用の1Password project/server/vaultは作らない。既存Vaultの安全な読み取り確認のみを対象にし、内容値をログへ出さない。
- GitLab CI/CDは停止し、pipelineやshared/group runnerは起動しない。プロジェクト設定では `jobs_enabled=false`、`builds_access_level=disabled`、`shared_runners_enabled=false`、`group_runners_enabled=false`、`auto_devops_enabled=false` を確認済み。

## 5. 環境情報と未確認事項

| 配備先 | 現時点の情報 | 配備前に確認すること |
|---|---|---|
| APPv4 | ユーザー報告ではnodepveのVM102、Ubuntu 24.04 base、起動済み、RAM 8–16 GiB | 現VMの識別、実OS、コンテナ/Kubernetes実装、IP/名前解決、接続経路、空き容量 |
| MainUbutsu2 | 正式な `remote-wsl:Ubutsu2` hostは存在 | 対応ローカルrepo/フォルダ、実行可能な正式remote、OS/コンテナ環境、IP/接続 |
| MiniPC-Oyama | 正式なMiniPC-Oyama remoteが存在 | 対応ローカルrepo/フォルダ、OS/コンテナ環境、IP/接続、既存workloadとの共存 |

APPv4の申告情報は現地確認済みではない。APPv3へ誤配備しない。Windows executorからの `wsl --list` は既報の `WSL Service E_ACCESSDENIED` を再現させる可能性があるため呼び出さず、別資格情報や昇格で迂回しない。現在のCodex project registryにはUbutsu2上の `/home/kiyohisa/Project/PDFtoCSV` (非Git)のみがあり、1Password Connect対応フォルダは確認できていない。

## 6. 公式仕様と設計仮説

公式資料はConnect serverのdeploy時に一意の `1password-credentials.json` が生成され、serverごとにトークンが属すること、APIとSyncが各deployment内で同じ暗号化data volumeを使うこと、Connect Helm chartがdeploymentのreplica数を持つことを示す。これをもとに「登録CredentialMCP 1つを3拠点のruntime replicaで実行する」案を採用する。

1Password公式コミュニティのスタッフ回答は、同じSecrets Automation workflowを複数のKubernetes Operator/deploymentで利用できることを示している。また公式Helm chartはConnect deploymentのreplica数を定義する。これを根拠に、CredentialMCP登録1つと既存credential/tokenを同一logical identityとして3拠点で使う。別登録や追加tokenは作らない。

workflow再利用の仕様確認とcredentialを各hostへ配置する承認は別である。1password-credentials.json/tokenの配置にはユーザー/親の安全なhandoff承認を得る。配備後は各site APIの認証成功を個別に実動作確認する。[Official 1Password community staff answer](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315)

## 7. レビュー

ゼロベース確認: 用途/台数/権限境界、秘匿情報、CI、環境識別、受け入れ条件、運用境界を定義した。  
発見と解消:
- APIとSyncのvolume要件を「拠点間共有volume不要」と混同する恐れ → 拠点内共有のみを要件化。
- 既存登録1つとdeployment3つが別概念である → 登録数とAPI/Syncコンテナ数を明記。
- 3拠点のOS/ネットワークが未確認 → 推測で配備せず、ホスト別調査を受け入れ条件に追加。
- 同一workflowの複数deployment利用は公式スタッフ回答で確認。credentialのsite別配置承認と実API認証確認は別条件にした。
- screenshot状態は登録/tokenの存在のみでデプロイ/認証確認ではない → 認証受け入れ条件を別途定義。
