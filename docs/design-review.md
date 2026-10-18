# 設計段階レビュー結果

確認日: 2026-10-18  
対象branch: codex/1password-connect-design-review  
基準main SHA: d35c8ed654a10a3b4aa02628fbe32ee61d38300e

## 1. 各段階の修正済み成果

| 段階 | 現行成果SHA | レビュー結果 |
|---|---|---|
| 要件定義 | docs/requirements.md — de6c791d59964fae7030b70853284c2b52261ed1 | CredentialMCP登録1つとruntime 3拠点を分け、公式staff回答で同一workflow複数deploymentを確認。credential配置承認とsite別auth試験は別gate。 |
| 概要設計 | docs/overview-design.md — de6c791d59964fae7030b70853284c2b52261ed1 | app→local API、site-local volumeをAPI/Syncが使用し、Sync→1Password Cloudの方向に修正。拠点間volume共有なし。 |
| 詳細設計 | docs/detailed-design.md — e9ff157175aa6c336d9aba7bb65f33968e0c4fef | 行78の残存した旧停止条件を削除し、同一workflow再利用とsite別secret handoff/API認証試験を分離。OP_HTTP_PORT default 8080と公式Helm chart Sync port 8081も区別。 |
| 実装計画 | docs/implementation-plan.md — e9ff157175aa6c336d9aba7bb65f33968e0c4fef | Docker Compose候補とrootless health observerを実装し、test sourceを追加。host-specific適用とcredential配置は別gate。 |
| テスト設計 | docs/test-design.md — e9ff157175aa6c336d9aba7bb65f33968e0c4fef | JSON Schema、Compose contract/unit test、site別runtime試験を区別。Compose healthはAPI /health dependency statusをrootless sidecarで確認する。 |

これらは修正後のGitLab commit SHA。元のmain branchとREADMEは変更していない。MiniPC-OyamaのWSL前提更新も含む。  
共通template: profile `templates/connect-site-profile.example.json` — 17bd350a5b238eaaf61a4bd19ebab8fe3aefba49; schema — 5c6eac3d19c4254ffb2c6a3cf343b788a5139ef5; usage README — 7f8dc4b6fceddeb91cfcc2902518171942da3ef3.
Compose/test source updated in e9ff157175aa6c336d9aba7bb65f33968e0c4fef: optional `monitoring` profile in `deploy/docker/compose.yaml`; ordered startup/runbook in `deploy/docker/README.md`; revised test design and implementation plan; updated Compose contract and health unit tests. The health test source now covers ACTIVE, initial TOKEN_NEEDED pending, non-200, connection failure, malformed JSON, and missing dependency cases. Tests remain unexecuted; e9ff is a GitLab source commit, not a test result.

## 2. 独立レビュー指摘と修正

1. **同一registrationの複数cluster利用** — 1Password公式コミュニティのstaff回答は同一Secrets Automation workflowを複数のKubernetes Operator/deploymentで利用可能と明示する。公式Helm chartのreplica定義とも照合し、CredentialMCP登録1つ/既存tokenを3拠点で使う。別登録/tokenは作らない。[Official staff answer](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Official Helm chart](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)
2. **概要図の向き** — アプリからConnect APIへ要求し、API/Syncが拠点内cacheを共有し、SyncがCloudと同期する向きに直した。
3. **Sync health port** — 公式Connect containerのOP_HTTP_PORT defaultは8080。公式Helm chartではSyncのhealth portを8081に設定する。テストはgeneric defaultを決め打ちせず、選定manifestで設定したportに合わせる。[Connect configuration](https://www.1password.dev/connect/server-configuration) / [Official Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)
4. **host inventoryとtemplate作成の分離** — secret-free、host-independent templateは各hostに接続できる前でも作成/静的検証できる。IP、runtime、volume path、resource limitなどsite-specific設定とcredential配置、実配備だけを各hostの確認後に行う。
5. **ローカル環境** — MainUbutsu2 Project接続はMCPHub担当が並行対応中。ここでは既報のWSL拒否を迂回しておらず、ローカルrepo/testを未実施と区別する。
6. **MiniPC-Oyama環境** — 最新のユーザー情報でWSL利用を確認した。Windows native前提を除外し、WSL distro/runtime/autostartは未確認として要件・設計・計画・テスト文書を更新した。
7. **Compose実装** — 独立レビュー後の承認に従い、official API/Sync 1.8.3、localhost-only bind、project-local shared volume、外部file-path secret reference、manual internal bus、UID 65532のhealth observer、ローカルtest sourceを追加した。実hostへの適用は行っていない。
8. **初回同期の順序** — 独立レビューで `/health` の `TOKEN_NEEDED` を認証GET前のpending状態として扱う必要を確認。公式health例にこの状態があり、公式Kubernetes exampleは認証済み `GET /v1/vaults` が初回syncを開始すると記載。process/heartbeat → 承認済みauth GET → `sync`/`sqlite` ACTIVE待ち → Vault ID確認 → app切替に修正した。observer unhealthy単独ではstartup failureと判断しない。[Health](https://www.1password.dev/connect/api-reference/get-server-health) / [Kubernetes example](https://github.com/1Password/connect/blob/main/examples/kubernetes/README.md) / [Heartbeat](https://www.1password.dev/connect/api-reference/get-heartbeat)
9. **最小Compose構成** — 観測用containerが本体6つに3つ加わり得ることを明記。`monitoring` profileでobserverをopt-inにし、defaultは各site API+Syncの2つ、3site合計6 Connect containers。本体起動/相互接続はobserverのhealthに依存しない。

## 3. 設計全体の検査

- 1Password登録1つ、runtime pair 3組、API 3、Sync 3、合計6 Connect containersを区別。optional `monitoring` profileを3site全てで有効にするとobserverが最大3つ加わる。
- API/Sync間の拠点内暗号化volumeは必要。3拠点間では共有しない。
- token/credentialsの値を取得・表示・Git保存しない。
- 既存画面のAutomation/ChromeVault read-only表示はConnect API認証成功の証拠と扱わない。
- APIを未認証でInternetへ公開しない。site-specific network/TLS/port設定は実環境確認後。
- GitLab CI/jobs/builds/shared/group runners/Auto DevOpsはdisabled。こちらからpipeline/runnerを起動していない。停止後pipeline list取得は403で、履歴一覧は未確認。
- test専用1Password project/server/vaultは作らない。実Vaultへのwrite/delete試験も行わない。

## 4. 実施状態と次のgate

de6c791dの設計全体は親の独立レビューで残指摘なし・実装開始可と確認された。詳細設計の旧停止条件は現行行78で解消済みであり、3siteworkflow再利用とsite別secret handoff/API認証を分けている。

その承認後にruntime-neutral profile/Schema、Docker Compose候補、health probe、unit/contract test sourceをGitLab branchへ保存した。今回の初回同期レビューに合わせ、順序をprocess/heartbeat → 承認済み初回auth GET → API `/health` のsync/sqlite ACTIVE待ち → Vault ID確認 → app cutoverに修正した。observerは `monitoring` profileで任意起動し、初回 `TOKEN_NEEDED` 中のunhealthyだけで失敗判定しない。test codeはJSON Schema validation、Compose contract、API `/health` のACTIVE/TOKEN_NEEDED/non-200/communication failure/malformed JSON/missing dependency casesを対象にする。テストコードは保存済みだが、`python -m unittest` と `docker compose config` は未実行であり、PASSとは報告していない。

Compose候補はofficial API/Sync 1.8.3、API loopback bind、same-site named volume、secret path reference、rootless aggregate health observerを持つ。実hostのDocker Compose runtime/port/secret file permissionは確認前なので、実適用・起動はしていない。credential/token配置はsiteごとの別safe handoff承認後に限る。MiniPC-OyamaはWSL前提だがdistro/runtime/autostart/localhost route未確認。

ローカルclone/test、1Password credential配置、API認証、deployment、3site実動作試験は未実施。
