# 設計段階レビュー結果

確認日: 2026-10-18  
対象branch: codex/1password-connect-design-review  
基準main SHA: d35c8ed654a10a3b4aa02628fbe32ee61d38300e

## 1. 各段階の修正済み成果

| 段階 | 現行成果SHA | レビュー結果 |
|---|---|---|
| 要件定義 | docs/requirements.md — 012f30f28c9554fd4e30f30052cb5f4b94c2b186 | CredentialMCP登録1つとruntime 3拠点を分け、公式staff回答で同一workflow複数deploymentを確認。credential配置承認とsite別auth試験は別gate。 |
| 概要設計 | docs/overview-design.md — 40ea97e07d5effb8742dac08ea8e810a687d55dc | app→local API、site-local volumeをAPI/Syncが使用し、Sync→1Password Cloudの方向に修正。拠点間volume共有なし。 |
| 詳細設計 | docs/detailed-design.md — ef572afdeab8a6c4d1ab370b9252f4254618da73 | 同一workflow再利用を公式staff回答で明記。汎用OP_HTTP_PORT default 8080と公式Helm chart Sync port 8081を区別。secret placementと実動作試験は残す。 |
| 実装計画 | docs/implementation-plan.md — 9484c83419b050b3aebcd2014813f260a73bda5c | design sign-off後のhost-independent/secret-free template実装と、host-specific設定/配備の確認を分離。実機未接続をtemplate作成の阻害条件にしない。 |
| テスト設計 | docs/test-design.md — 74faf614bae8b172a859528a130bfa43b5173954 | host-independent templateの静的試験とsite別runtime試験を分離。Sync healthは実設定portで確認し、8081を汎用defaultとしない。 |

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

設計文書は指摘に沿って修正済みで、独立再レビュー待ち。設計レビュー完了前の実装コードは作成しない。レビュー完了後、secretを含まない共通template実装・静的検証を進められる。各拠点のruntime/endpoint/volume valuesはhost inventory後に設定する。credential/tokenの配置には対象hostごとの安全なhandoff承認が必要で、各APIの認証・Sync状態は配備後に個別確認する。

現在、ローカルclone/test、実装、1Password credential配置、認証試験、deployment、3site実動作試験は未実施である。
