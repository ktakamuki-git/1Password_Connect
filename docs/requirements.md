# 要件定義: 1Password Connect 3拠点構成

作成日: 2026-10-18  
対象: GitLab project `87779016` / `ktakamuki_wsl/pc-platform/plugin/1Password_Connect`

## 1. 目的

既存の1Password Connect登録 **CredentialMCP** と既存の認証情報を用いる前提を検証し、APPv4、MainUbutsu2、MiniPC-Oyama の各拠点に独立したConnect runtimeを配備する。各拠点のアプリは同じ拠点にあるConnect APIへ接続し、同じVaultを読む。PP2は既存1Password plugin MCPを `tools/call` で呼ぶアダプターを持つ。登録identity、token、deploymentの数は混同しない。

## 2. スコープ

- 1つのConnect登録 `CredentialMCP` を論理的なConnect server identityとして扱う。
- 配備先は3拠点。各拠点でConnect APIとConnect Syncを1コンテナずつ動かす。総数はAPI 3、Sync 3。
- 3拠点とも同じVaultを同期する。アプリが通常使う接続先は各拠点のローカルConnect APIとする。
- 各拠点内ではAPIとSyncが同じ暗号化データ領域を共有する。拠点間では共有しない。
- 設計・実装は既存GitLab projectに追加する。既存READMEは雛形であり、上書きしない。
- CIの目標構成は3台のsite専用self-hosted runnerであり、shared runnerは使用しない。site別jobは `appv4`、`main-ubutsu2`、`oyama-wsl` のrunner tagで対応する拠点だけに割り当てる。CI/Runnerの有効化・タグ付け・権限変更は別担当が行う。

## 3. 受け入れ条件

1. 1Password側のConnect登録が `CredentialMCP` 1つであり、同じ登録の認証情報を使う実deploymentが3つであると説明上も設定上も明確である。
2. 各拠点でAPIとSyncが起動し、Syncが有効な状態を返す。
3. 既存トークンで各拠点のAPI認証が通る。認証値やcredentialファイルの中身はログ・Git・チャットへ出さない。
4. アプリの接続先は各拠点内のAPI endpoint。3拠点間でキャッシュ/データvolumeを共有しない。
5. 各deploymentが同じVaultを参照し、許可済みの読み取り操作だけを行える。既存トークンのVault/権限を確認できない場合は配備を停止する。
6. APIは未認証で外部公開しない。各拠点で接続元を限定し、信頼ネットワーク外をまたぐ場合はTLSを使う。
7. APPv3には配備しない。APPv4とAPPv3を識別できるホスト情報を確認してから変更する。
8. 実配備と実動作を拠点別に検証し、単体/static test、配備、3拠点実動作を別々に記録する。
9. PP2のアダプターがMCP JSON-RPC `tools/list` で許可ツールを確認し、allow-list済みのread-only toolに `tools/call` を使う。tool名/argument schema、protocol error、`isError`、構造化/非構造化結果を取り扱い、secret値や結果本文をログへ残さない。実際のplugin接続を作成・変更せず、未知のtool名やtransportを推測しない。
10. CIのsite jobは専用の3台のself-hosted runnerへtagで固定し、shared runnerにfallbackしない。site単位のdeployはmanual/protected gateを持つ。実runnerのtag/project access設定を確認するまでは対象jobを実行しない。

## 4. セキュリティ・変更の境界

- `1password-credentials.json` とConnect API tokenはsecretであり、Git管理しない。値の取得、表示、ログ出力、共有はしない。
- 既存CredentialMCP登録・既存トークンを使う前提。新しい登録/トークン発行、Vault grant変更、既存credentialの常用先変更、credential配布は本段階で実行しない。必要になった場合は対象操作と拠点を親へ示してから安全なhandoffを行う。
- APIを認証なしで外部公開しない。TLS終端、許可接続元、ポート公開範囲は実ネットワークを確認するまで決めない。
- テスト専用の1Password project/server/vaultは作らない。既存Vaultの安全な読み取り確認のみを対象にし、内容値をログへ出さない。
- GitLabにsecret値を保存しない。self-hosted runnerごとのsecret file path/権限で運用し、credential JSON/API tokenをGitLab CI variable、artifact、job logへ出さない。Shared runnerは使わない。Runner/CI設定の変更は別担当に委ねる。

## 5. 環境情報と未確認事項

| 配備先 | 現時点の情報 | 配備前に確認すること |
|---|---|---|
| APPv4 | ユーザー報告ではnodepveのVM102、Ubuntu 24.04 base、起動済み、RAM 8–16 GiB | 現VMの識別、実OS、コンテナ/Kubernetes実装、IP/名前解決、接続経路、空き容量 |
| MainUbutsu2 | 正式な `remote-wsl:Ubutsu2` hostは存在 | 対応ローカルrepo/フォルダ、実行可能な正式remote、OS/コンテナ環境、IP/接続 |
| MiniPC-Oyama | ユーザー報告ではWSLを利用。Windows native前提ではない | WSL distribution名、実OS/release、container/Kubernetes runtime、自動起動、IP/接続、既存workloadとの共存 |

GitLab runner inventoryは2026-10-18時点でsite名に対応する非shared Group Runner 3台 (`appv4`、`main-ubutsu2`、`oyama-wsl`) がonline/activeで登録済み。いずれもtag未設定で、project runner listは0件。project snapshotでは `group_runners_enabled=false` / `jobs_enabled=false` / `builds_access_level=disabled`。そのためself-hosted 3拠点案は設計前提だが、現在このprojectからpipelineを実行できる状態とは確認できていない。runner/tag/CI access設定は別担当の範囲とし、本作業では変更しない。

APPv4の申告情報は現地確認済みではない。APPv3へ誤配備しない。Windows executorからの `wsl --list` は既報の `WSL Service E_ACCESSDENIED` を再現させる可能性があるため呼び出さず、別資格情報や昇格で迂回しない。現在のCodex project registryにはUbutsu2上の `/home/kiyohisa/Project/PDFtoCSV` (非Git)のみがあり、1Password Connect対応フォルダは確認できていない。

## 6. 公式仕様と設計仮説

公式Helm chartではConnect Deploymentのreplica数を設定でき、API/Sync containerは同じcredential Secretを参照する。公式1Password Communityの該当回答者は、自身の検証として2つのKubernetes clusterそれぞれへConnectを配置し、同一の `1password-credentials.json` を使ったと報告している。これは複数clusterでの利用可能性を支える実践報告であり、3拠点の実動作確認や将来の全構成への保証ではない。

この根拠からCredentialMCP登録identityを1つとし、同じ既存credential/tokenを3拠点の独立deploymentへ使う設計を採用する。登録1つとruntime pair 3組は別単位である。Helm replica構成は同一deployment内のreplica、Community投稿は2 clusterの例である。既存tokenが各独立APIで受け入れられることは設計上の推論であり、各siteの認証試験まで未確認とする。追加登録/token発行やCredentialMCPの変更は行わない。

現在はsecret placement/authenticationを行わない。将来の配布操作が必要なときだけ、対象siteと操作を親へ明示し、値をチャット/Gitへ出さない安全なhandoffを行う。[1Password Community: multi-cluster report](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Official Connect Helm deployment](https://raw.githubusercontent.com/1Password/connect-helm-charts/main/charts/connect/templates/connect-deployment.yaml)

## 7. レビュー

ゼロベース確認: 用途/台数/権限境界、秘匿情報、CI、環境識別、受け入れ条件、運用境界を定義した。  
発見と解消:
- APIとSyncのvolume要件を「拠点間共有volume不要」と混同する恐れ → 拠点内共有のみを要件化。
- 既存登録1つとdeployment3つが別概念である → 登録数とAPI/Syncコンテナ数を明記。
- 3拠点のOS/ネットワークが未確認 → 推測で配備せず、ホスト別調査を受け入れ条件に追加。
- 同一workflowの複数deployment利用は公式スタッフ回答で確認。credentialのsite別配置承認と実API認証確認は別条件にした。
- screenshot状態は登録/tokenの存在のみでデプロイ/認証確認ではない → 認証受け入れ条件を別途定義。
- PP2→1Password plugin MCPの `tools/call` 経路が未記載 → tools/list/allow-list/read-only call/result/error契約を受け入れ条件と設計に追加。PP2のcodebase/具体tool schemaは未確認。
- CI停止を目標状態と混同 → self-hosted runner 3台をsite別に使う目標へ改め、現snapshotでtagなし/project許可なしの事実と別担当設定を明記。
