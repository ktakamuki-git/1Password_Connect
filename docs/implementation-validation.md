# 実装検証と計画トレーサビリティ

更新日: 2026-10-18  
検証対象: GitLab project 87779016 / branch codex/1password-connect-design-review  
実装commit: 7c581762daf031c8e320b61af82bfd47fb336698  
draft MR: !1

## 結果の要約

当初の5つのplugin mockケースだけでは、承認済みのMCP、static、deployment、3-site runtime計画を満たしません。実装commitではREST client unit tests、SDK stdio protocol negative tests、生PP2 Hub source modulesを使うloopback integration testを追加しました。Node suiteは22/22成功しましたが、MCP設計項目にも部分確認が残り、Compose static suiteと全ての実配備・実認証・3拠点試験は完了していません。全体計画をpassとは扱いません。

テストは Windows scratch workspace のNode packageとGitLabから読んだPP2 source snapshotで実行しました。正式Ubutsu2 local cloneではありません。秘密ファイル、1Password tokenの実値、Vault item dataを使用していません。

## MCP test traceability

| 承認済みID | 実装テストと証拠 | 評価 |
|---|---|---|
| MCP-01 Tool discovery | plugin.test.js と hub-integration.test.js がtools/list、唯一のread-only tool、empty strict inputSchemaを検査 | mock/Hub sourceで確認 |
| MCP-02 Call envelope | official MCP SDK stdio clientと実PP2 Hub source integrationでtools/call。相関ID形式、監査との一致、呼出ごとの一意性を検査 | mock/Hub sourceで確認 |
| MCP-03 Allow-list/schema | protocol-boundary.test.js がpluginへunknown/write/delete名を直接送り、tool名、argument key/valueのcanary非反射、REST未接続を確認。null/string/array envelopeも安全なprotocol error | mockで確認 |
| MCP-04 Success/error/notification | success、401 tool error、malformed envelope/protocol errorを検査し、通常実行で通知が発行されないことを検査 | success/errorは確認。通知入力/出力の個別ケースは未確認 |
| MCP-05 Secret-safe projection/audit | mock vault name/item/password、HTTP error body、引数canaryがcaller response/stdout/stderrに出ないこと、structuredContentなし、auditは固定tool/status/correlationId/durationMs/eventだけを検査 | mockで確認 |
| MCP-06 Existing Hub boundary | integration testがGitLab PP2 Hubのconfig、downstream registry、HTTP serverを実際にimportし、Hub→plugin stdio→mock RESTを通す。loopback test-only authenticatorと合成tokenを使用 | 経路は確認。既存認証/OS identityの配備環境検証は未実施 |
| MCP-07 Site route | unit testで固定route、明示site指定、redirect拒否を検査。appv4/main-ubutsu2はmockで扱う | mockで一部確認。oyama-wslと3拠点実routeは未確認 |
| MCP-08 No bypass | Hub integrationの成功経路ではHubがplugin経由でRESTへ到達し、pluginは固定GETのみを実行 | 成功経路確認。障害時にHubが直接RESTへfallbackしない実運用確認は未実施 |

当初のplugin.test.jsにあった5つのケースは、MCP contract全体や配備計画を単独では網羅しません。追加したREST/protocol/Hub integration testsがmock範囲を広げましたが、表中の部分項目と下記計画項目は保留です。

## Static test plan traceability

| 承認済みID | 結果 | 根拠・残り |
|---|---|---|
| ST-01 profile/schema/Compose parse | 部分確認 | PyYAMLでCompose YAML parse成功。jsonschema==4.26.0不足のためJSON Schemaおよび完全Compose contract testsは未実行 |
| ST-02..ST-08 | 未実行 | image/tag、volume、secret hygiene、exposure、vault scope、site identityは正式Python suite/実環境で未検証 |
| ST-09 self-hosted runner routing | 実行不可 | project jobs/builds disabled、group/shared runners disabled。対象plugin group runner list 0台。CIジョブなし、pipeline未起動 |
| ST-10 operator docs | 実装・文書レビューのみ | 実hostでの手順確認・rollback演習は未実施 |
| ST-11 health observer | 部分確認 | test_healthcheck.py 6/6、Python compile、Compose parse成功。schema依存のcontract suiteとDocker configは未実施 |
| ST-12..ST-14 Compose secrets/network/bus | 未実行 | Python contract testがjsonschema import時点で停止。実Compose構成未評価 |
| ST-15 Hub→plugin contract | mock/Hub sourceで確認 | 実PP2 source modulesとplugin stdio、loopback mock Connect RESTを通す |
| ST-16 output secret hygiene | mockで確認 | success、401、unknown/write/delete、malformed request、canary、stderr/auditを検査 |
| ST-17 CI configuration alignment | 部分確認 | project flagsと対象group runner一覧を読み取り確認。CI設定ファイルなし、CI未起動。共有runner/外部設定を変更していない |

Python healthcheck testsは6件すべて成功し、対象Pythonファイルのpy_compileも成功しました。Windows scratch環境にはjsonschema==4.26.0がなく、pip取得はsocket permission error WinError 10013で失敗したため、test_compose_contractを含むPython suite全体は実行できませんでした。docker、docker-compose、podman、nerdctl executableが見つからず、docker compose configは実行していません。

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

- Windows scratch Node v24.19.0: npm run check成功、PP2_HUB_ROOT指定のnpm test 22/22成功。integration testはPP2 Hub source snapshotのconfig/downstream/HTTP server moduleを使い、実Hub deploymentではありません。
- Python 3.10.11: healthcheck 6/6成功、py_compile成功、PyYAML Compose parse成功。jsonschema不足のため完全suite未実行。
- docker/Compose CLIは見つからず、docker compose config未実行。
- Windows executorからUbutsu2正式cloneへの確認はWSL Service E_ACCESSDENIEDで利用不可。別資格情報/elevationで迂回していません。
- GitLab project 87779016のread-only snapshotではjobs_enabled=false、builds_access_level=disabled、shared_runners_enabled=false、group_runners_enabled=false。対象plugin group ID 145101775のgroup runner一覧は0台、CI config fileもbranch treeにありません。pipelineは開始せず、CI/Runner設定も変更していません。
- 1Password secret/tokenの実値取得、表示、Git保存、新規登録、認証、deployment、3拠点実動作は行っていません。

## 5段階設計成果

- 要件定義: 501900e704a74f2c277ee2d9809c237d64f2a47f
- 概要設計: 894e318186f44ed24998ddaa058867226071d09f
- 詳細設計: 9ad2c34e4a3d0cbd0ec4d302c47841e69e117339
- 実装計画: 67c25a51765be9c7e40199d0175bbf8c08a50fe2
- テスト設計: 2f118988c66500b643faa5fb8f0b5e3402e22fb1

