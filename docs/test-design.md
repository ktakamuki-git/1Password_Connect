# テスト設計: Connect 3拠点

## 1. 目的と区分

次の証拠を混ぜずに管理する。

1. **単体/static tests:** manifest/設定の構文と静的制約をローカルrepoで検証。
2. **配備確認:** 各hostでcontainer、volume、API/Sync healthが成立することを確認。
3. **3拠点実動作:** 各siteのAPIが認証し、同じVaultを読み取れることを確認。
4. **GitLab CI:** 本プロジェクトでは停止中。pipelineやshared/group runnerを起動して試験しない。

このリポジトリの実行先local cloneは確認できていないため、以下はテスト計画であってテスト実施結果ではない。

## 2. Static/unit test cases

| ID | 検査 | 合格条件 |
|---|---|---|
| ST-01 | Compose YAML parseまたはHelm values/template | syntax errorなし。各siteでAPI+Sync pairが1つ |
| ST-02 | Container version一致 | APIとSyncが公式に対応する同一Connect release |
| ST-03 | Volume mapping | 同一siteのAPI/Syncが同じencrypted data pathをmountし、他siteを参照しない |
| ST-04 | Secret hygiene | credentials/token/private key実値、Base64実値、output fixtureがGit diff/tracked file/logにない |
| ST-05 | API exposure | API bind/listenerがsite/host local onlyまたはprivate allow-list。public unauthenticated exposureなし |
| ST-06 | Sync/API inner network | APIとSyncの通信はsite-local。Sync health/bus portをapp/publicへpublishしない |
| ST-07 | Vault contract | 三siteのdeployment metadataが同じ許可Vault identityを示し、対象範囲のread-only設定が一致 |
| ST-08 | Target identity | APPv4=VM102確認あり、APPv3 targetはなし。MainUbutsu2/MiniPC-Oyamaが正式host名と一致 |
| ST-09 | CI avoidance | GitLab CI/jobs/runners disabledのread-only project settings確認。CI file, pipeline trigger, runner commandを追加しない |
| ST-10 | Operational docs | install, health, update, rollback, stop/secret handoff条件が全siteに適用可能 |

秘密を含まないhost-independent templateはsite inventory前にST-01〜ST-06/09/10を静的検証できる。site-specific endpoint/resource/volume valuesの確認とST-08は該当hostを確認してから行う。GitLab CIは使わず、local repositoryが利用可能になってからローカルtoolingで実施する。

## 3. 配備 smoke test cases

全てユーザー承認済みsecret handoffを受けてからsiteごとに順番に行う。tokenやcredential値をshell history/log/chatに出さない。

| ID | 確認 | 方法/期待結果 |
|---|---|---|
| DP-01 | process/container status | APIとSyncが起動。予期せぬrestart loopなし |
| DP-02 | API health | internal endpoint /health が成功 |
| DP-03 | Sync health | 選定manifestで明示したOP_HTTP_PORTの /health が成功。汎用container defaultは8080、公式Helm chartのSync port defaultは8081。containerから外へ公開しない |
| DP-04 | Auth | local APIへ既存Bearer tokenでGET /v1/vaults。2xx。token文字列は画面/ログに表示しない |
| DP-05 | Vault identity | レスポンスのVault ID/nameだけを許可済み値と比較。item contentsは取らない |
| DP-06 | App routing | site-localアプリのhost設定がsite-local API endpointを指す |
| DP-07 | read-only boundary | 1Password側scope metadataでread-only確認。実Vaultへwrite/deleteを送って試験しない |
| DP-08 | exposure | 外部経路から接続不能かつsite内の許可app hostからだけ到達 |
| DP-09 | cache isolation | 各site固有のdata volumeで稼働。他site volume mountまたは共有NFSがない |
| DP-10 | evidence | host識別子、時間、image version、health/auth result、Vault identifierだけ記録 |

DP-04は健康状態と認証を別に確認する。health endpointだけの成功をVault authの証拠としない。DP-07はscope metadataから判定し、read-onlyを試すためにVaultを壊さない。

## 4. Negative/rollback tests

- tokenなし/不正tokenのAPI要求は401/unauthorizedで拒否されることを確認する。ただし実secretをlogに残さない。
- 非許可ネットワークからAPIへ接続できないことを確認する。
- initial sync失敗時はAPIをアプリ向けに有効化せず、diagnostic logをsecret scrubした形で保存する。
- 一siteを停止/rollbackしても残りsiteとそのvolumeに副作用がないことを確認する。volume deletionはtestに含めない。
- 作業後にGit branch diffからsecret値・host access token・public addressを再確認する。

## 5. 実施記録テンプレート

各testには以下を記録する。未確認欄を推測で埋めない。

| Field | Record |
|---|---|
| Test ID / Site |  |
| Repo path / commit SHA |  |
| Host identity / runtime version |  |
| Command or check |  |
| Exit/status result |  |
| Secret-safe evidence |  |
| Reviewer / date |  |

secret value、Connect credentials JSON、Vault item value、Bearer headerは記録に含めない。

## 6. テスト設計レビュー

ゼロベースレビューの結果:
- static, deployment, 3-site runtime testを分離した。host-independent templateの静的検証は実機アクセスを要件としない。
- token値を使ったテストを設計しつつ、値の取得表示を避ける手順にした。
- 本番Vaultへwrite/deleteを送る試験を排除し、scope metadataでread-onlyを検証する。
- GitLab pipeline/runnerを使わない。
- API healthのみで認証成功と誤認せず、Sync health・Vault identity・local routingも別項目にした。
- local repositoryが開けない場合はlocal testを未実施と記録する。実機未接続でも可能なsecret-free template checkとsiteごとのruntime試験を混同しない。
