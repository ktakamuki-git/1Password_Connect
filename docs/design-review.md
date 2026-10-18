# 設計段階レビュー結果

確認日: 2026-10-18  
対象branch: codex/1password-connect-design-review  
基準main SHA: d35c8ed654a10a3b4aa02628fbe32ee61d38300e

## 1. 各段階の修正済み成果

| 段階 | 現行成果SHA | レビュー結果 |
|---|---|---|
| 要件定義 | docs/requirements.md — 13a88a820bedc4615a5e96a1d29dc687804340d6 | CredentialMCP identity 1つ/3 runtime pairs、MCP tools/call adapter要件、site専用Runner 3台を追加。現statusは未準備と区別。 |
| 概要設計 | docs/overview-design.md — 34b2fc5d3a990add4db7dcf7ca972a5a0483857f | Connect REST data planeとPP2→plugin MCP call境界を分離し、runner/tag/accessの現在値と目標を明記。 |
| 詳細設計 | docs/detailed-design.md — ecdb774be1c639bd1431eeae4dbf4ee93435d765 | MCP tools/list/call、schema allow-list、error/result安全取扱いを定義。Community 2-cluster例とHelm replica根拠を分け、site runner preconditionを追加。 |
| 実装計画 | docs/implementation-plan.md — a3bbef93798ad4bd65a990952cac151f9605ab12 | PP2 codebase特定後のadapter実装、mock tests、site-bound manual/protected runner jobsを計画。 |
| テスト設計 | docs/test-design.md — bf7574db3ccb39c3c90d43ca0ed643561d2d01e3 | MCP mock contract/unitとsite runner routing/deployment gate試験を追加。live calls、pipeline実行は未実施。 |

これらは今回の追加要件を含むstage文書のGitLab commit SHA。元のmain branchとREADMEは変更していない。MiniPC-OyamaのWSL前提更新も維持している。今回の5段階変更は親の新しい独立レビュー待ちであり、過去の `de6c791d` に対する承認は今回の追加要件や次の実装には継承しない。  
共通template: profile `templates/connect-site-profile.example.json` — 17bd350a5b238eaaf61a4bd19ebab8fe3aefba49; schema — 5c6eac3d19c4254ffb2c6a3cf343b788a5139ef5; usage README — 7f8dc4b6fceddeb91cfcc2902518171942da3ef3.
Compose/test source updated in e9ff157175aa6c336d9aba7bb65f33968e0c4fef: optional `monitoring` profile in `deploy/docker/compose.yaml`; ordered startup/runbook in `deploy/docker/README.md`; revised test design and implementation plan; updated Compose contract and health unit tests. The health test source now covers ACTIVE, initial TOKEN_NEEDED pending, non-200, connection failure, malformed JSON, and missing dependency cases. Tests remain unexecuted; e9ff is a GitLab source commit, not a test result.

## 2. 今回の追加要件とレビュー観点

1. **Connect identity/replicas evidence** — 公式Helm deployment templateはreplica countと同一credentials SecretをAPI/Sync containerへ渡す定義を示す。公式1Password Community回答者は自身の試行として2 clusterで同一 `1password-credentials.json` を使用したと報告。community実例と公式Helm構造は別の根拠として記録し、3 site認証は未確認、同一tokenの全API受理は設計仮説とした。新規registration/token作成は含めない。[Community report](https://www.1password.community/developers-69/can-i-run-multiple-kubernetes-operators-under-the-same-secrets-automation-workflow-10315) / [Helm template](https://raw.githubusercontent.com/1Password/connect-helm-charts/main/charts/connect/templates/connect-deployment.yaml)
2. **PP2→plugin MCP adapter** — 欠けていたMCP JSON-RPC `tools/list` / `tools/call` 要件を追加。実tool名/transport/server identityを推測せず、allow-list/schema、error/result handling、secret-safe outputを契約化。PP2 repository identityは未確認なのでcodeを別repoへ配置しない。[MCP Tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
3. **CI runner plan** — 恒久停止の要求文を除き、3 site専用self-hosted runnerのtag mappingとshared runner禁止を設計した。read-only inventory: `appv4` / `main-ubutsu2` / `oyama-wsl` group runnersはonline/active/non-sharedだがtag list空、project runner list 0件、project group/jobs/builds設定disabled。別担当が設定するまでpipelineは未実行。設定変更はしていない。
4. **Overview/Connect details retained** — app→local API、API/Sync同site volume、Sync→Cloud方向、Sync health port、API initial `TOKEN_NEEDED` pending sequenceを既存設計から保持。
5. **Host inventory/local access** — APPv4 VM102等の実環境確認、MainUbutsu2正式remote path、MiniPC-Oyama WSL runtimeは未確認。既報Windows executor WSL拒否の昇格/別資格情報迂回はしていない。
6. **Secret boundary** — secret values, existing token, credentials JSON, and Vault item values have not been retrieved, logged, or committed. No Connect registration/auth/deployment actions occurred.

## 3. 設計全体の検査

- 1Password登録1つ、runtime pair 3組、API 3、Sync 3、合計6 Connect containersを区別。optional `monitoring` profileを3site全てで有効にするとobserverが最大3つ加わる。
- API/Sync間の拠点内暗号化volumeは必要。3拠点間では共有しない。
- token/credentialsの値を取得・表示・Git保存しない。
- 既存画面のAutomation/ChromeVault read-only表示はConnect API認証成功の証拠と扱わない。
- APIを未認証でInternetへ公開しない。site-specific network/TLS/port設定は実環境確認後。
- Intended CI uses only three site-bound self-hosted runners and no shared runner. Current project settings disable jobs/builds/group runners; three non-shared group runners are online but untagged and unavailable to this project. No pipeline/runner was started; access/tag configuration is assigned to a separate owner.
- test専用1Password project/server/vaultは作らない。実Vaultへのwrite/delete試験も行わない。

## 4. 実施状態と次のgate

以前の `de6c791d` baselineは親レビューで残指摘なしと確認され、そのbaseline向け実装は許可された。今回のPP2 adapter、self-hosted runner mapping、credentials evidence修正は新しい差分であり、stage別/全体の親独立レビューを待つ。次実装への許可は今回の新レビュー後に判断する。

その承認後にruntime-neutral profile/Schema、Docker Compose候補、health probe、unit/contract test sourceをGitLab branchへ保存した。今回の初回同期レビューに合わせ、順序をprocess/heartbeat → 承認済み初回auth GET → API `/health` のsync/sqlite ACTIVE待ち → Vault ID確認 → app cutoverに修正した。observerは `monitoring` profileで任意起動し、初回 `TOKEN_NEEDED` 中のunhealthyだけで失敗判定しない。test codeはJSON Schema validation、Compose contract、API `/health` のACTIVE/TOKEN_NEEDED/non-200/communication failure/malformed JSON/missing dependency casesを対象にする。テストコードは保存済みだが、`python -m unittest` と `docker compose config` は未実行であり、PASSとは報告していない。

Compose候補はofficial API/Sync 1.8.3、API loopback bind、same-site named volume、secret path reference、rootless aggregate health observerを持つ。実hostのDocker Compose runtime/port/secret file permissionは確認前なので、実適用・起動はしていない。credential/token配置はsiteごとの別safe handoff承認後に限る。MiniPC-OyamaはWSL前提だがdistro/runtime/autostart/localhost route未確認。

PP2 adapter source、`.gitlab-ci.yml`/site deploy jobs、local clone/test、MCP live call、credential placement, API authentication, deployment, and three-site runtime checks are not executed in this change. Test source and Compose candidate from prior commits remain unexecuted. Group/runner/project setting change is not performed here. MR !1 remains draft. Its description is synchronized with this updated review summary.
