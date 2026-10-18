# 設計段階レビュー結果

確認日: 2026-10-18  
対象branch: codex/1password-connect-design-review  
基準main SHA: d35c8ed654a10a3b4aa02628fbe32ee61d38300e

## 1. 各段階レビュー

| 段階 | 成果/commit SHA | ゼロベースレビュー | 状態 |
|---|---|---|---|
| 要件定義 | docs/requirements.md — 29e1226573203e7313a91d2127d6b5ff4573da2f | 認証未実施、1登録/3site、secret境界、CI停止、APPv3誤配備防止、ローカル情報未確認を明記。volume要件をsite-local pairに限定。 | 文書レビュー完了。独立3deploymentへの同じtokenの明示根拠は残件としてgate |
| 概要設計 | docs/overview-design.md — d2002fd647da37e9c345c59d79ef8eaf02133fe2 | 登録1つ、API/Sync pair 3組、6 containers、site-local volume 3つを分離。network公開範囲・TLS・実環境決定を定義。 | 文書レビュー完了。token再利用の正確な支援範囲を過大表現しないよう修正済み |
| 詳細設計 | docs/detailed-design.md — 5e7ac9ec77bdc94844d3b7a24878c1f9ffc75d4f | credentialとapp token、API/Sync health、read-only、秘密値を出さない認証確認、local networkの境界を定義。 | 文書レビュー完了。secret handoffとscope metadata確認は配備gate |
| 実装計画 | docs/implementation-plan.md — 3d2bc7d714b782e8caf14a37cdc9e9dbaf63e163 | VM/host identity、OS/runtime/network、公式remoteの現状把握をmanifest作成より先に配置。CI不使用。 | 文書レビュー完了。各hostの検査/credential配布は未実施 |
| テスト設計 | docs/test-design.md — a0eea5d6ec6609bb6315a5adffd747cb2e06c121 | static test、deployment health、認証/ Vault確認、3site実動作を区分。production write/delete試験とCIを除外。 | 文書レビュー完了。repo/runtime未確認のため実行試験は未実施 |

各SHAはGitLab branch commit listから取得した。既存main commitと既存READMEは保持されている。

## 2. 全体レビュー

設計を全段階横断で読み直し、次を指摘し文書に反映した。

1. **登録数とdeployment数の混同** — CredentialMCP登録1、runtime pair 3、API 3、Sync 3、合計6 containersと定義。
2. **cache volumeの混同** — 1Password公式仕様上APIとSyncは同一拠点内shared volumeを要する。3拠点間は共有しない設計に訂正。
3. **同じ登録/tokenの再利用根拠** — 公式docsはserverごとにunique credential fileとtoken、公式Helm chartは同じConnect deploymentのreplicasを定義する。一方、独立3拠点間で同じ既存tokenを同時に使うことの明示文書は見つかっていない。よって実装/secret配布の前に親が独立確認し、別登録や追加tokenが必要なら停止する。
4. **host情報未確認** — APPv4のVM102以外、3site全てのruntime/network詳細に根拠がないため、環境別manifestを作らない。APPv3誤配備を防ぐ識別条件を追加。
5. **登録と認証の混同** — ユーザー提供画面ではCredentialMCP登録とCredentialMCP token、Automation/ChromeVaultのread-only設定が示されているが、Connectの配備・API認証成立は示されていない。設計上も認証を独立した受け入れ条件にした。
6. **test安全性** — token/credentials/item値を表示しない、権限metadataでread-only確認、実Vaultへのwrite/deleteをしない方針にした。
7. **CI停止** — GitLab project.updateでjobs_enabled=false、builds_access_level=disabled、shared_runners_enabled=false、group_runners_enabled=false、auto_devops_enabled=falseに更新し、get_projectで再確認した。CI pipeline/runnerを起動していない。停止後のpipeline listはGitLab APIが403を返したため、一覧は取得できていない。

## 3. ローカル環境と実施状態

対象のローカルrepositoryは現在のWindows workspaceにはなく、Codex project registryのremote-wsl:Ubutsu2登録先は /home/kiyohisa/Project/PDFtoCSV (非Git)のみだった。Connect対応repository/folderへの正式remote accessを確認できていない。既報のWSL Service E_ACCESSDENIEDを再現/迂回するコマンドは実行していない。したがってlocal cloneへの保存、static/local tests、3site deployment、API authentication testは未実施である。

## 4. 結論/レビューgate

設計文書の各段階レビューと横断レビューは完了し、親が独立レビューできる状態にした。親レビューは未実施。1登録/3独立siteへのtoken再利用に関する公式根拠、実環境、safe secret handoffが未確認のため、実装・テスト・配備へはまだ進まない。親の設計レビュー後に未解決点を修正してから実装計画Phase 1へ移る。

## 5. 参照した一次情報

- [Get started with a 1Password Connect server](https://www.1password.dev/connect/get-started)
- [Connect concepts](https://www.1password.dev/connect/concepts)
- [Configure your Connect server](https://www.1password.dev/connect/server-configuration)
- [Connect API reference](https://www.1password.dev/connect/api-reference)
- [Official 1Password Connect Helm chart values](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/values.yaml)
- [Official Connect Helm deployment template](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/templates/connect-deployment.yaml)
