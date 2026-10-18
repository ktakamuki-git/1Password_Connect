# 実装計画: 3拠点へCredentialMCPを配備

## 前提

既存repoはGitLab project 87779016、branch mainに初期README雛形だけがある。実装用branchには設計docsを追加し、mainは変更しない。CI/CDと各Runnerはproject settingで無効にした。GitLab APIからはdisabled後にpipeline一覧を読む権限が返らないため、停止状態の設定値を再取得した記録を採用する。

設計段階の終了時点で親が独立レビューする。レビュー後に実装へ進む。既存Connect登録/トークン値、Vault内容、host secretsは取得しない。

## Phase 1 — 実行先を特定

1. APPv4のVM102 IDと現在の起動状態をnodepveの正式管理手段で確認する。実OS/release、RAM/CPU/disk、container runtime/Kubernetes、network/IP/DNS、firewall/proxy、既存workload/port/volumeを確認。
2. MainUbutsu2は正式なremote-wsl:Ubutsu2 worksiteを使用できるか確認し、本人指定の対応repo/pathのみを探す。Windows executorからwsl --listを再実行せず、別資格情報/昇格で拒否を迂回しない。対応フォルダが正式remote上で見つからない場合はローカルrepoとlocal test未実施として扱う。
3. MiniPC-Oyamaはユーザー報告によりWSL利用を前提とし、正式remote管理経路でWSL distribution名、container/Kubernetes runtime、自動起動、network情報を確認する。Windows native構成を仮定しない。
4. Host inventoryはsite固有値の設定と実配備の前提とする。秘密値を含まないhost-independent templateの作成は妨げない。APPv4向けのsite設定/配備前にVM102/APPv4を名前とIDの両方で確認する。

## Phase 2 — 1Password認証前提を確認

1. 1Password UI/authorized APIでCredentialMCP登録が1つ、既存トークンとVault scopeが想定通りかmetadataだけ確認する。token値・credentials file本文・item secretは表示しない。
2. Automation/ChromeVaultのread-only表示は既存設定情報として記録するが、Connect APIで認証済みの証明とは扱わない。
3. 公式コミュニティスタッフ回答で同一Secrets Automation workflowの複数deployment利用を確認済み。CredentialMCP一登録/既存tokenを3siteで使い、別登録/tokenは増やさない。
4. 各siteへ秘密を渡す場合は一siteずつ承認済みのsafe handoffを使う。OS file permission/secret storeを設定し、Gitやchatに戻さない。

## Phase 3 — common profile and Docker Compose candidate

1. `templates/connect-site-profile.example.json` とJSON Schemaは、runtime-neutralなsite入力契約として維持する。
2. 公式Docker Compose例を基にした一site候補を `deploy/docker/compose.yaml` に実装する。Connect API/Syncは同じ公式Connect release `1.8.3`、同じsite-local encrypted data volume、必須のread-only credentials file reference、internal manual busを使う。APIのhost bindは `127.0.0.1:8080` のみ。
3. Official Connect image内でrootを使うHTTP probeを仮定せず、別のhealthcheck serviceをUID 65532で実行する。API `/health` の `sync` と `sqlite` dependencyが `ACTIVE` であることを標準libraryだけで確認する。probeは任意の `monitoring` profileで起動し、API/Sync本体をgateしない。初回auth GET前の `TOKEN_NEEDED` はpendingであり、observer unhealthy単独では失敗扱いしない。
4. `tests/` にYAML contract testとhealth response unit testを保存する。GitLab CIは使用せず、テストは対応clone上で明示的に実行する。
5. Compose候補/テストの追加は実hostへの適用ではない。hostのDocker Compose/runtime・loopback到達性確認と、credential fileの別途承認済みsafe handoffが揃うまで起動しない。

## Phase 4 — hostごとのruntime設定と配備

1. Docker Composeを最小候補として先に用意した。各siteの現行runtimeがCompose対応か確認し、既存の運用に合わないsiteだけは理由を記録して他方式を選ぶ。全hostへ同じ方式を強制しない。
2. 同じ公式Connect versionを固定し、API+Sync pair、同拠点のみで共有するencrypted data volume、site-local API endpoint、secret file mount、health checkを定義する。
3. API公開範囲はアプリhost/site内だけ。host内loopbackまたはprivate network、firewall allow-list、必要ならTLSを明記する。Public unauthenticated accessは作らない。
4. root ignore rulesを設定し、credentials/token/cert/private keyの実値がGitに入らないようにする。既存READMEは意図的に上書きしない。
5. 3拠点のcontainer version、vault scope、port policyを比較できる設定表と、rollback/backup/rotationの運用記述を追加する。

## Phase 5 — ローカル検証（GitLab CIなし）

実際の対応local repositoryが開ける場合、GitLabへ保存したテストコードをローカルで実行する。失敗した場合もsecret値を表示しない。GitLab CI pipeline/runnerは起動しない。

- `python -m pip install -r tests/requirements.txt` の後、`python -m unittest discover -s tests -v` でCompose契約/healthcheck unit testsを実行する。Composeファイルの `CONNECT_CREDENTIALS_FILE` は承認handoff後に設定し、その時だけ `docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml config` で構文確認する。
- Helmを使うsiteはhelm lint、helm template、chart/schema version確認。
- manifest内に秘密値、public bind、未許可port、APPv3 target、cross-site shared volumeがないことを静的check。
- secret fileはdummy/path placeholderを使用し、実credentialをfixtureやsampleにしない。
- local test結果にはrepository path、commit SHA、実行コマンド、exit codeのみを残す。正式remote/local repo接続不能なら「未実施」と明記する。

## Phase 6 — siteごとの配備と実動作

実環境と安全なcredential handoffの承認後、一siteずつ進める。最初はAPPv4を候補にするがVM102を正式確認してからにする。次にMainUbutsu2、最後にMiniPC-Oyamaを個別配備する。

各siteで順番を守って確認する: API/Sync processとAPI `/heartbeat`、承認済みsafe handoffを使う既存tokenでの認証 `GET /v1/vaults`（初回syncを開始）、API `/health` のsync/sqlite `ACTIVE`、Vault識別情報、site-local app cutover。初回認証GET前の `TOKEN_NEEDED` / observer unhealthy単独を起動失敗としない。observerは任意起動であり、health failureがAPI/Syncの起動制御に使われることはない。結果には読み取りスコープ、アプリ経路、public exposureなし、image SHA/tagも記録する。testにVault write/deleteを含めない。

三siteの実動作が全部成功するまで「完了」と報告しない。認証失敗、Sync停滞、version差、host identity不一致、public exposureの疑いがある場合はそのsiteを閉じて親に報告する。

## Stop条件/承認handoff

以下のどれかが起きたら、その操作を行わず停止する: 1Password登録/permission/token変更が必要、secretの閲覧や転送について承認済みhandoffがない、APIのpublic accessを求められる、VM/hostの識別が曖昧、remote hostの正式経路が使えない。親へ対象操作・対象host・影響を明示してから安全な方法を決める。

## 実装計画レビュー

ゼロベース確認で「host/VM ID不明」「secret handoff承認が必要」「既存scope表示をauth成功と混同」「ローカルrepo不在」を整理し、ホスト依存値とsecret配置だけを実機確認のgateにした。設計レビュー完了後、host-independent templateの実装を開始し、再レビュー前は実装を開始しない。
