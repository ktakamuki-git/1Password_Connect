# 設計段階レビュー結果

確認日: 2026-10-18  
対象branch: codex/1password-connect-design-review  
基準main SHA: d35c8ed654a10a3b4aa02628fbe32ee61d38300e

## 1. 各段階の修正済み成果

| 段階 | 現行成果SHA | レビュー結果 |
|---|---|---|
| 要件定義 | docs/requirements.md — 012f30f28c9554fd4e30f30052cb5f4b94c2b186 | CredentialMCP登録1つとruntime 3拠点を分け、公式staff回答で同一workflow複数deploymentを確認。credential配置承認とsite別auth試験は別gate。 |
| 概要設計 | docs/overview-design.md — 40ea97e07d5effb8742dac08ea8e810a687d55dc | app→local API、site-local volumeをAPI/Syncが使用し、Sync→1Password Cloudの方向に修正。拠点間volume共有なし。 |
| 詳細設計 | docs/detailed-design.md — 4268322b33f8dc926ecf7005d47d15de9e2066c3 | 行78の残存した旧停止条件を削除し、同一workflow再利用とsite別secret handoff/API認証試験を分離。OP_HTTP_PORT default 8080と公式Helm chart Sync port 8081も区別。 |
| 実装計画 | docs/implementation-plan.md — 7f8dc4b6fceddeb91cfcc2902518171942da3ef3 | runtime-neutralなJSON site profile/Schemaを実装し、host-specific設定と配備をhost inventory後に限定。 |
| テスト設計 | docs/test-design.md — 7f8dc4b6fceddeb91cfcc2902518171942da3ef3 | JSON profile/Schema、既知invariant、placeholder、site別runtime試験を区別。Sync healthは実設定portで確認。 |

これらは修正後のGitLab commit SHA。元のmain branchとREADMEは変更していない。

## 2. 独立レビュー指摘と修正

1. **同一registrationの複数cluster利用** — 1Password公式コミュニティのstaff回答は同一Secrets Automation workflowを複数のKubernetes Operator/deploymentで利用可能と明示する。公式Helm chartのreplica定義とも照合し、CredentialMCP登録1つ/既存tokenを3拠点で使う。別登録/tokenは作らない。[Official staff answer](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Official Helm chart](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)
2. **概要図の向き** — アプリからConnect APIへ要求し、API/Syncが拠点内cacheを共有し、SyncがCloudと同期する向きに直した。
3. **Sync health port** — 公式Connect containerのOP_HTTP_PORT defaultは8080。公式Helm chartではSyncのhealth portを8081に設定する。テストはgeneric defaultを決め打ちせず、選定manifestで設定したportに合わせる。[Connect configuration](https://www.1password.dev/connect/server-configuration) / [Official Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)
4. **host inventoryとtemplate作成の分離** — secret-free、host-independent templateは各hostに接続できる前でも作成/静的検証できる。IP、runtime、volume path、resource limitなどsite-specific設定とcredential配置、実配備だけを各hostの確認後に行う。
5. **ローカル環境** — MainUbutsu2 Project接続はMCPHub担当が並行対応中。ここでは既報のWSL拒否を迂回しておらず、ローカルrepo/testを未実施と区別する。

## 3. 設計全体の検査

- 1Password登録1つ、runtime pair 3組、API 3、Sync 3、合計6 containersを区別。
- API/Sync間の拠点内暗号化volumeは必要。3拠点間では共有しない。
- token/credentialsの値を取得・表示・Git保存しない。
- 既存画面のAutomation/ChromeVault read-only表示はConnect API認証成功の証拠と扱わない。
- APIを未認証でInternetへ公開しない。site-specific network/TLS/port設定は実環境確認後。
- GitLab CI/jobs/builds/shared/group runners/Auto DevOpsはdisabled。こちらからpipeline/runnerを起動していない。停止後pipeline list取得は403で、履歴一覧は未確認。
- test専用1Password project/server/vaultは作らない。実Vaultへのwrite/delete試験も行わない。

## 4. 実施状態と次のgate

詳細設計の残件は行78で修正し、旧停止条件が残っていないことを確認した。これを受けて、host/runtimeに依存しないsecret-free site profile、JSON Schema、使用上の注意を実装した。profile JSONのparseと主要invariant（CredentialMCP、API/Sync各1、同一release placeholder、secret値なし、site-local volume、public unauthenticated APIなし）を一時的な静的確認でpassした。これはローカルrepo上のテスト実施ではなく、完全なJSON Schema validatorの実行でもない。

親が独立全体レビューできるよう設計段階SHAと指摘解消を記録した。Compose/Helmなどhost-specific manifest、実行方式、runtime valuesは対象hostのinventory後に決める。credential/tokenの配置には対象hostごとの安全なhandoff承認が必要で、各APIの認証・Sync状態は配備後に個別確認する。

ローカルclone/test、1Password credential配置、認証試験、deployment、3site実動作試験は未実施である。
