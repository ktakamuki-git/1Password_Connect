# 実装計画: 3拠点へCredentialMCPを配備

## 前提

既存repoはGitLab project 87779016、branch mainに初期README雛形だけがある。実装用branchには設計docsを追加し、mainは変更しない。目標CIはsiteごと1台のnon-shared self-hosted runnerにjobを固定し、shared runnerは使わない。2026-10-18時点のproject settingsはjobs/build/group runners disabledであり、runner tagもproject accessも未準備のためこのsnapshotでpipelineを起動しない。runner/tag/access settingsは別担当に委ね、本作業で変更しない。

設計段階の終了時点で親が独立レビューする。レビュー後に実装へ進む。既存Connect登録/トークン値、Vault内容、host secretsは取得しない。

## Phase 1 — 実行先を特定

1. APPv4のVM102 IDと現在の起動状態をnodepveの正式管理手段で確認する。実OS/release、RAM/CPU/disk、container runtime/Kubernetes、network/IP/DNS、firewall/proxy、既存workload/port/volumeを確認。
2. MainUbutsu2は正式なremote-wsl:Ubutsu2 worksiteを使用できるか確認し、本人指定の対応repo/pathのみを探す。Windows executorからwsl --listを再実行せず、別資格情報/昇格で拒否を迂回しない。対応フォルダが正式remote上で見つからない場合はローカルrepoとlocal test未実施として扱う。
3. MiniPC-Oyamaはユーザー報告によりWSL利用を前提とし、正式remote管理経路でWSL distribution名、container/Kubernetes runtime、自動起動、network情報を確認する。Windows native構成を仮定しない。
4. Host inventoryはsite固有値の設定と実配備の前提とする。秘密値を含まないhost-independent templateの作成は妨げない。APPv4向けのsite設定/配備前にVM102/APPv4を名前とIDの両方で確認する。

## Phase 2 — 1Password認証前提を確認

1. 1Password UI/authorized APIでCredentialMCP登録が1つ、既存トークンとVault scopeが想定通りかmetadataだけ確認する。token値・credentials file本文・item secretは表示しない。Connect初回起動に必要なcredentials fileはConnect自身から取得できないため、独立した安全なhandoffが必要。
2. Automation/ChromeVaultのread-only表示は既存設定情報として記録するが、Connect APIで認証済みの証明とは扱わない。
3. 公式1Password Communityの回答者が2 clusterで同一 `1password-credentials.json` を使った自身の例と、公式Helm deploymentのreplica/credentials Secret定義を別の根拠として記録する。これをCredentialMCP登録1つ/既存credential/token再利用の設計根拠とするが、3 siteの認証成功はsite別実動作まで未確認とする。別登録やtoken発行は行わない。
4. credential placementが必要な場合は対象siteと操作を親へ明示し、安全なhandoffを使う。OS file permission/secret storeを設定し、Git/chat/CI variable/logへ値を戻さない。

## Phase 2.1 — このrepository内の1Password plugin MCP module

PP2本体はProject ID `87779895` (`ktakamuki_wsl/pc-platform/pc_platform2`) と確認済み。この実装計画のpluginはこのConnect repository内の分離moduleに置き、PP2 Hubがlocalstdio downstreamとして起動する。PP2 coreは変更せず、別のMCP中継層も追加しない。

1. PP2 Hubがlocalstdio pluginにMCP `tools/list` を送り、実在するtool metadata/schemaを確認できる契約を実装する。Hubの既存外部認証とplugin processの既存OS identity/permissionsを使い、独自認証、caller approval、role、権限昇格を追加しない。
2. Hubは確認済みのtool/schemaをallow-listと照合し、許可されたread-only toolだけをJSON-RPC 2.0 `tools/call` でpluginへ送る。未知tool/write/delete tool、schema外argumentは拒否する。
3. pluginはそのcallを処理し、指定siteのConnect API REST endpointへ接続する。各siteのbackend route/bindingを確認し、本人の明示的な経路変更は許容して記録/reviewする。指定なしの他siteへのsilent switchingは行わない。RESTはplugin backendであり、Hubがpluginを迂回するfallbackではない。
4. Hub/Chat向けの成功結果、error、notificationはすべて定義済み公開metadataだけに射影する。`content` / `structuredContent` をraw pass-throughせず、secret値、credential file本文、Bearer token、secret-bearing resultを返さない。秘密値を返すtoolは作らず、追加のhuman confirmationも導入しない。許可consumer内での秘密供給はMCPの値返却経路と分ける。
5. JSON-RPC mock contract/unit testsで、`tools/list` metadata/schema、allow-list、`tools/call` request、success/tool error/protocol error/notification、timeout、unknown/write tool拒否、metadata-only output、secret-safe logsを検証する。site routeの選択が指定siteと一致することもmockで検証する。
6. PP2 Hubとの実接続やsite認証は、接続実装とsite route/configurationが確認された後に行う。認証情報や秘密値はテストfixture、ログ、chat、Gitに含めない。


## Phase 3 — common profile and Docker Compose candidate

1. `templates/connect-site-profile.example.json` とJSON Schemaは、runtime-neutralなsite入力契約として維持する。
2. 公式Docker Compose例を基にした一site候補を `deploy/docker/compose.yaml` に実装する。API/Syncは公式Connect 1.8.3を使い、GHCRのmulti-arch image-index digestを固定する（API `sha256:a0cefa9fb93999b1ca67325ec3a79b38f3d3803a0790a6ec6630d4657896a54f`、Sync `sha256:5b6dcfa57e86f44b4d8a766b0edbf0321c519a9b6d327ed0a79d8583b6c7bfb5`）。API/Syncは同じsite-local encrypted data volume、必須read-only credentials file reference、内部manual busを使う。host portは `CONNECT_API_HOST_PORT` で設定し、未指定時8080・範囲1–65535をwrapperが検証する。bindは `127.0.0.1` 固定、container API portは8080。
3. Official Connect image内でrootを使うHTTP probeを仮定せず、別のhealthcheck serviceをUID 65532で実行する。API `/health` の `sync` と `sqlite` dependencyが `ACTIVE` であることを標準libraryだけで確認する。probeは任意の `monitoring` profileで起動し、API/Sync本体をgateしない。初回auth GET前の `TOKEN_NEEDED` はpendingであり、observer unhealthy単独では失敗扱いしない。
4. `tests/` にYAML contract testとhealth response unit testを保存する。ローカル実行を一次検証にする。CI jobを追加するときはsite-specific tagを付け、3台のself-hosted runnerへ固定する。shared runnerは使わない。
5. Compose候補/テストの追加は実hostへの適用ではない。実credential handoff前に、secretを含まないdummy credentials-file path参照で `docker compose config` による構文検証ができる。これはコンテナ起動や認証を行わない。実hostへの起動はhostのDocker Compose/runtime・loopback到達性確認と既存credentialの安全なhandoff後に行う。

## CI/Runner plan — site-bound execution

GitLab CI/runnerの実行はユーザーの停止指示により当面起動しない。将来CIが再開された場合のsite割当案はself-hosted runnerを各siteに1台ずつ使い、tagを `appv4`、`main-ubutsu2`、`oyama-wsl` に対応させる。別site runnerやshared runnerへのfallbackはしない。job trigger/保護は既存GitLab設定と本人指示に従い、manual/protected gateを新たな必須条件として追加しない。host-local secret file referenceをrunner側で安全に供給し、credential JSONやConnect tokenをGitLab CI variable/artifactへ渡さない。

2026-10-18のrunner inventoryではnon-shared group runnerが3台online/activeだがtag listは空で、project runner listは0、`group_runners_enabled=false`。project jobs/buildsもdisabled。tag/access/settings更新は別担当の作業とし、本作業では変更しない。site別runnerの割当と利用可否は設定準備後にread-onlyで確認し、実行可能状態と本人指示を満たしてから対象jobを開始する。


## Phase 4 — hostごとのruntime設定と配備

1. Docker Composeを最小候補として先に用意した。各siteで `docker context show` / `docker info` を使い、実際に接続するdaemonを特定する。Docker Desktopの専用 `docker-desktop` WSL engineと、WSL distro内の独立Docker Engineは別daemonで、images/volumes/portsも分かれる。二重起動とhost port collisionを避け、各siteの現行runtimeがCompose対応か確認してから方式を選ぶ。全hostへ同じ方式を強制しない。
2. 同じ公式Connect version/digestを固定し、API+Sync pair、同拠点のみで共有するencrypted data volume、site-local API endpoint、secret file mount、health checkを定義する。
3. API公開範囲はアプリhost/site内だけ。Compose候補はloopback bind `127.0.0.1` だけを使い、host portはdefault 8080から変更可能、container portは8080固定とする。private network mapping/firewall allow-list、必要ならTLSを明記する。Docker Engine 28.0.0未満のlocalhost-published portのsame-L2 caveatを確認する。Public unauthenticated accessは作らない。
4. root ignore rulesを設定し、credentials/token/cert/private keyの実値がGitに入らないようにする。既存READMEは意図的に上書きしない。
5. 3拠点のcontainer version、vault scope、port policyを比較できる設定表と、rollback/backup/rotationの運用記述を追加する。

## Phase 5 — ローカル検証（GitLab CI停止中）

実際の対応local repositoryが開ける場合、GitLabへ保存したテストコードをローカルで実行し、失敗時もsecret値を出さない。MCP adapter testsはlive 1Password接続を使わず、mock transportを使う。Compose syntax validation、unit/contract testsはAPI readinessに依存しない。正式local repositoryが開けなければ未実施と記録する。GitLab CI/runnerの実行は停止指示に従い起動しない。job trigger/保護に新しいmanual/protected必須gateを追加しない。

- 実credential handoffの前に、`CONNECT_CREDENTIALS_FILE` をsecret-free dummy pathへ向ける一時env fileを用い、`python deploy/docker/compose_wrapper.py --env-file <temporary-dummy-env> config` でdefault portのCompose configを検証する。host port default/override/invalid casesは `tests/test_compose_contract.py` とwrapper unit testで確認し、override時もloopback bindとcontainer port 8080を維持する。Composeがsource fileの存在を要求する場合に限り、repo外に空の非secret placeholder fileを作る。実credentialを読ませず、`up` は実環境/credential準備後に限る。
- `python -m pip install -r tests/requirements.txt` の後、`python -m unittest discover -s tests -v` でCompose契約/healthcheck/port validation unit testsを実行する。
- Helmを使うsiteはhelm lint、helm template、chart/schema version確認。
- MCP adapterはmockで `tools/list` metadata、schema allow-list、`tools/call` request/response、success/error/notificationの公開metadata projection、protocol/tool errors、timeout、unknown tool rejection、secret-safe logsを検証する。秘密値を返すtoolや人手確認gateは作らない。
- manifest内に秘密値、public bind、未許可port、APPv3 target、cross-site shared volumeがないことを静的checkする。
- secret fileはdummy/path placeholderを使用し、実credentialをfixtureやsampleにしない。
- local test結果にはrepository path、commit SHA、実行コマンド、exit codeのみを残す。正式remote/local repo接続不能なら「未実施」と明記する。


## Phase 6 — siteごとの配備と実動作

siteのhost/runtime情報と既存credentialの独立した安全なhandoffが整った後、siteごとに配備を開始する。API readinessは配備後に得る結果であり、配備開始の前提ではない。アプリ切替はreadinessとVault identityの確認後に限る。GitLab CI/runnerは停止指示により実行しない。trigger/保護は将来再開時も既存GitLab設定と本人指示に従い、新しいmanual/protected gateを追加しない。最初はAPPv4を候補にするがVM102 identityを正式確認してからにする。次にMainUbutsu2、最後にMiniPC-Oyamaを個別配備する。

各siteで次の順序を守る:
1. API/Sync deploymentを起動する。
2. process/container statusとAPI `/heartbeat` を確認する。heartbeatはlivenessであり、初回同期/readinessを示さない。
3. siteごとに承認済みsafe secret handoffを用い、既存tokenで認証付き `GET /v1/vaults` を実行して初回syncを開始する。tokenや本文をログに出さない。
4. API `/health` のsync/sqliteがともに `ACTIVE` になるまで待つ。`TOKEN_NEEDED` / observer unhealthyだけで失敗と断定しない。
5. Vault識別情報とread-only scopeを確認する。
6. readinessとVault identityが確認できた後に限り、そのsite-local APIへアプリ経路を切り替える。

この順序で配備、heartbeat、初回認証GET、readiness、app cutoverを分けて記録する。各siteでは起動前baseline、image pull後、初回sync後、平常workload時にConnect API/Sync別とHub/plugin CPU/RAM、image/volume/log/host disk、WSL virtual disk deltaを観測する。これらはsite比較用であり、合否thresholdやapproval gateにはしない。static tests/CIはreadinessを待たずに独立実行できる（CI実行自体は停止中）。結果には読み取りscope、app route、public exposureなし、image SHA/tagを記録する。testにVault write/deleteを含めない。

三siteの実動作が全部成功するまで「完了」と報告しない。認証失敗、Sync停滞、version差、host identity不一致、public exposureの疑いがある場合はそのsiteを閉じて親に報告する。


## Stop条件/承認handoff

以下のどれかが起きたら、その操作を行わず停止する: 1Password登録/permission/token変更が必要、secretの閲覧や転送に必要な安全なhandoffが用意されていない、APIのpublic accessを求められる、VM/hostの識別が曖昧、remote hostの正式経路が使えない、runner tag/site identity/accessが一致しない、shared runnerへ割り当てられる可能性がある。変更対象・host・影響を親へ示し、安全な方法を決める。

## 実装計画レビュー

ゼロベース確認で「host/VM ID不明」「MCP tool/API contract未確認」「runner tag/project access未設定」「既存scope表示をauth成功と混同」「ローカルrepo不在」を整理した。PP2本体はProject ID 87779895と確認済み。pluginはこのConnect repositoryの分離moduleとしてHub localstdioから起動し、Hub→plugin→site-local Connect RESTの呼び出し方向、PP2 core非変更、既存Hub認証/OS permissions、本人指定の経路変更、metadata-only outputを計画に反映した。現実装は `connect_list_vaults` の `GET /v1/vaults` によるVault ID/status metadataだけであり、既存consumerのitem secret取得依存を解消していない。consumer内部delivery route等は別要件が必要。secret-returning tool/新しいhuman confirmation gateや新規manual/protected gateは設けない。

Compose構文検証とsecret-free static CIはcredential handoff・実配備・API readinessに依存させず、dummy path referenceで先行可能とした。site deploymentは起動→heartbeat→初回認証GET→readiness→Vault identity→app cutoverの順とし、readinessは配備開始条件でなくアプリ切替条件である。per-host deploymentとsite-bound CI jobはhost/runtime、safe secret distribution、runner/tag/project accessのreadinessを別に確認し、既存GitLab設定と本人指示に従う。
