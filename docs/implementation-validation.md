# 実装検証と計画トレーサビリティ

更新日: 2026-10-19  
検証対象: GitLab project 87779016 / branch codex/1password-connect-design-review  
実装commit: 7c581762daf031c8e320b61af82bfd47fb336698  
draft MR: !1  
最後に成功したCI: head `9cdefdcab446d64ed71d5e5febb76c8a4162b8f7` / pipeline `2960553438`; 初回実装CI: `1d8a628b7e304d6f064987f6c76de25c716abb37` / pipeline `2960546091`  
PP2 fixture pin: `f4871b58624d975be9737d1327390b4ebdb311fc`

## 結果の要約

文書追記前に最後に成功したGitLab pipelineは [2960553438](https://gitlab.com/ktakamuki_wsl/pc-platform/plugin/1Password_Connect/-/pipelines/2960553438)（head `9cdefdcab446d64ed71d5e5febb76c8a4162b8f7`）で、3 site jobが既存non-shared self-hosted runnerで完了しました。文書追記commitで自動生成されたpipeline 2961989963は、停止指示の適用前に3 site jobがsuccessで完了しました。後続pipeline 2961990853はCI停止指示に従ってcancelされました。実装は変更しておらず、以降の文書修正commitでは `[skip ci]` を使います。Node/Python/Composeの詳細な実行内訳は実装commit `1d8a628b7e304d6f064987f6c76de25c716abb37` のpipeline [2960546091](https://gitlab.com/ktakamuki_wsl/pc-platform/plugin/1Password_Connect/-/pipelines/2960546091) に記録されています。site tag `appv4`、`ubutsu2`、`oyama-wsl` の3 jobが、それぞれ対応する既存non-shared self-hosted runnerで成功しています。各jobでNode.js v24.22.0の `npm run check` が成功し、Node suiteは25件中24 pass、0 fail、1 skip、Python suiteは14/14成功、Docker Compose v5.6.0のchecksum検証と `docker-compose config` が成功しました。Compose daemonやserviceは起動していません。

唯一のskipはPP2 Hub sourceを必要とするloopback integration testです。固定PP2 source commitは `f4871b58624d975be9737d1327390b4ebdb311fc`。PP2 project 87779895はprivateで、read-only確認ではinbound CI job token allowlistが有効、許可対象は同project自身のみでした。Connect project 87779016からのcloneを試したり、Job Token scopeを拡張したり、別credentialを作成していません。GitLab公式仕様ではprivate project repositoryをCI jobからcloneするにはjob tokenの対象project allowlistと実行ユーザーのアクセス権が必要です（[CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/)）。このintegrationをCIで実行する最低条件は、PP2 project側でConnect project 87779016のjob tokenによるrepository readを許可し、pipeline実行ユーザーにもread権限があることです。write/push権限は不要です。現在のCIは `PP2_HUB_ROOT` を設定せず、該当testをskipする構成を維持しています。

このCI結果はhost-independentなmock/static試験です。Connectの実credential/token取得、実API認証、deployment、3拠点実runtime動作は行っていません。Windowsの本task workspaceで行った、PP2固定sourceを使うローカルmock integration（下記）はCIとは別の証拠であり、正式Ubutsu2 local cloneでの検証とも区別します。

## MCP test traceability

| 承認済みID | 実装テストと証拠 | 評価 |
|---|---|---|
| MCP-01 Tool discovery | plugin.test.js と hub-integration.test.js がtools/list、唯一のread-only tool、empty strict inputSchemaを検査 | mock/Hub sourceで確認 |
| MCP-02 Call envelope | official MCP SDK stdio clientと実PP2 Hub source integrationでtools/call。相関ID形式、監査との一致、呼出ごとの一意性を検査 | mock/Hub sourceで確認 |
| MCP-03 Allow-list/schema | protocol-boundary.test.js がpluginへunknown/write/delete名を直接送り、tool名、argument key/valueのcanary非反射、REST未接続を確認。null/string/array envelopeも安全なprotocol error | mockで確認 |
| MCP-04 Success/error/notification | success、401 tool error、malformed envelope/protocol errorを検査し、通常実行で通知が発行されないことを検査 | success/errorは確認。通知入力/出力の個別ケースは未確認 |
| MCP-05 Secret-safe projection/audit | mock vault name/item/password、HTTP error body、引数canaryがcaller response/stdout/stderrに出ないこと、structuredContentなし、auditは固定tool/status/correlationId/durationMs/eventだけを検査 | mockで確認 |
| MCP-06 Existing Hub boundary | `PP2_HUB_ROOT` を指定した場合にGitLab PP2 Hubのconfig、downstream registry、HTTP serverをimportするloopback integration test。合成tokenとtest-only authenticatorを使用 | 2026-10-19にPP2固定source全5 moduleの一致を検証した新規task-workspace snapshotで25/25 local pass。最新CIではPP2 private sourceへの既存read permissionがなく1件skip。既存認証/OS identityの配備検証は未実施 |
| MCP-07 Site route | unit testで固定route、明示site指定、redirect拒否を検査。appv4/main-ubutsu2はmockで扱う | mockで一部確認。oyama-wslと3拠点実routeは未確認 |
| MCP-08 No bypass | Hub integrationの成功経路ではHubがplugin経由でRESTへ到達し、pluginは固定GETのみを実行 | 成功経路確認。障害時にHubが直接RESTへfallbackしない実運用確認は未実施 |

当初のplugin.test.jsにあった5つのケースは、MCP contract全体や配備計画を単独では網羅しません。追加したREST/protocol/Hub integration testsがmock範囲を広げましたが、表中の部分項目と下記計画項目は保留です。

## Static test plan traceability

| 承認済みID | 結果 | 根拠・残り |
|---|---|---|
| ST-01 profile/schema/Compose parse | PASS (static) | profile/schema contract testsとDocker Compose v5.6.0 `config` が3 site jobすべて成功。実runtimeは未検証 |
| ST-02..ST-08 | 部分確認 | 8件のCompose/schema/secret-reference/network/volume/image contract testsは成功。実host identity、実Vault scope、runtime配置は未検証 |
| ST-09 self-hosted runner routing | PASS | pipeline 2960546091の3 jobが対応tag `appv4`/`ubutsu2`/`oyama-wsl` のnon-shared runnersで成功。runner description `main-ubutsu2` はtagではない |
| ST-10 operator docs | 実装・文書レビューのみ | 実hostでの手順確認・rollback演習は未実施 |
| ST-11 health observer | PASS (unit/static) | health unit testsを含むPython suite 14/14成功。実Connect readiness/observer deploymentは未実施 |
| ST-12..ST-14 Compose secrets/network/bus | PASS (static) | Python Compose contract suiteと `docker-compose config` が3 siteで成功。Connect serviceは起動していない |
| ST-15 Hub-to-plugin MCP contract | CIは1件skip。ローカルはPASS | MR pipelineではPP2 Hub sourceがprivateでConnect projectのCI job token inbound allowlist未登録のためskip。2026-10-19のローカル新規fixtureではPP2固定source全5 moduleを照合し、`npm run check` と `npm test` 25/25（skip 0）を確認。CI skipをCI passに読み替えない |
| ST-16 output secret hygiene | PASS (mock) | 実データを使わないMCP mock testsが成功。PP2 Hub integrationは上記の理由でCI skip |
| ST-17 CI configuration alignment | PASS | MR pipelineは既存の3 site専用self-hosted runner tagsに固定され、shared/他site fallbackなし。新しいmanual/protected必須gateは追加していない |

ST-01..ST-17の最新CI/static statusは上表を正とします。host固有情報・実credential・実API・実Connect serviceを必要とする配備計画は別区分であり、下記のとおり未実施です。

## Deployment plan traceability

| 承認済みID | 結果 |
|---|---|
| DP-01 process/heartbeat | 未実施。Connect container/serviceを起動していない |
| DP-02 initial authenticated sync GET | 未実施。実token/Connect認証を行っていない |
| DP-03 sync readiness | 未実施 |
| DP-04 Vault identity | 未実施 |
| DP-05 app cutover | 未実施 |
| DP-06 read-only scope evidence | 未実施 |
| DP-07 network exposure | 未実施 |
| DP-08 cache isolation | 未実施 |
| DP-09 deployment evidence | 未実施 |
| DP-10 Hub/plugin/site route | Hub→plugin→mock RESTのみ。実3拠点経路は未実施 |

## Environment and CI status

- Last completed successful CI before documentation-only updates: head `9cdefdcab446d64ed71d5e5febb76c8a4162b8f7`, pipeline [2960553438](https://gitlab.com/ktakamuki_wsl/pc-platform/plugin/1Password_Connect/-/pipelines/2960553438). Detailed source validation is in pipeline [2960546091](https://gitlab.com/ktakamuki_wsl/pc-platform/plugin/1Password_Connect/-/pipelines/2960546091) for implementation/CI commit `1d8a628b7e304d6f064987f6c76de25c716abb37`.
- `site-appv4`, `site-ubutsu2`, and `site-oyama-wsl` all succeeded on the existing non-shared self-hosted runners. The job tag for MainUbutsu2 is `ubutsu2`; `main-ubutsu2` is the Runner description.
- Node.js v24.22.0 checks passed on all sites: `npm run check`; `npm test` reports 25 total, 24 pass, 0 fail, 1 skipped. The skip is the PP2 Hub source integration only.
- Python suite reports 14/14 on all sites. Official Docker Compose standalone v5.6.0 checksum and binary verification passed; `docker-compose -f deploy/docker/compose.yaml config` exited successfully. No daemon or service was started.
- PP2 project 87779895 is private. Read-only Job Token inspection showed inbound scope limited to the allowlist, which contains only PP2 itself; Connect project 87779016 is not on it. No cross-project source fetch was attempted, no credentials were created, and no allowlist/scope was changed. The integration test remains skipped until PP2 grants read-only repository access to the Connect CI job token and the pipeline user has read access.
- On 2026-10-19, a fresh task-workspace PP2 snapshot was checked against all five files at pinned PP2 commit `f4871b58624d975be9737d1327390b4ebdb311fc`. `npm run check` passed and `npm test` passed 25/25 with 0 skipped; the Hub → local stdio plugin → mock Connect REST test ran with synthetic test data. This local mock result is not CI evidence, an official Ubutsu2 clone test, deployment, or live authentication. The earlier Ubutsu2 WSL Service E_ACCESSDENIED remains unresolved; no alternate credentials or elevation were used.
- 1Password secret/token values, credential files, and Vault item data were not retrieved, displayed, or committed. No Connect authentication, deployment, or 3-site live verification occurred.

## 5段階設計成果

- 要件定義: 501900e704a74f2c277ee2d9809c237d64f2a47f
- 概要設計: 894e318186f44ed24998ddaa058867226071d09f
- 詳細設計: 9ad2c34e4a3d0cbd0ec4d302c47841e69e117339
- 実装計画: 67c25a51765be9c7e40199d0175bbf8c08a50fe2
- テスト設計: 2f118988c66500b643faa5fb8f0b5e3402e22fb1

