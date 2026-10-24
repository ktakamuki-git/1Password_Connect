# 実装計画: Oyama単一Connect runtimeと3拠点Hub連携

## 前提

Connect runtimeはOyamaにAPI/Sync 1組で集約済み（本人確認）。APPv4・Ubutsu2・OyamaはHub deployment targetであり、Connectを3拠点へ再配備しない。This repository CI is static/mock verification only; Hub owner handles Hub deployment. The old 2026-10-18 runner snapshot below is historical, not current readiness.

設計段階の終了時点で親が独立レビューする。レビュー後に実装へ進む。既存Connect登録/トークン値、Vault内容、host secretsは取得しない。

## Phase 1 — 実行先を特定

1. Connect runtime hostはOyamaだけ。既存API/Sync pairとDocker状態は本人報告で確認済みだが、これはauth/route proofではない。新たなhost management経路を使わない。
2. MainUbutsu2はHub deployment targetであり、Connect deployment targetではない。既存のHub→Oyama Connect route/authだけを確認し、Windows executorからWSL/SSHを呼ばない。
3. MiniPC-OyamaはConnect runtime hostとHub deployment targetの両方。ユーザーが既存Connect/API Syncとpost-fix `docker ps`を確認済み。追加のruntime操作/再起動はしない。
4. `runner_host.inventory` 等の旧APPv3 management actionは配備前提にしない。Hub deploy jobが既存Runner上で対象host/site identityを検証し、ConnectはOyamaのみとする。

## Phase 2 — 1Password認証前提を確認

1. 1Password UI/authorized APIでCredentialMCP登録が1つ、既存トークンとVault scopeが想定通りかmetadataだけ確認する。token値・credentials file本文・item secretは表示しない。Connect初回起動に必要なcredentials fileはConnect自身から取得できないため、独立した安全なhandoffが必要。
2. Automation/ChromeVaultのread-only表示は既存設定情報として記録するが、Connect APIで認証済みの証明とは扱わない。
3. 公式1Password Communityの複数cluster例とHelm replica定義は設計資料に留め、3つの独立Connect serverを正当化する根拠にしない。現行はOyamaの一組だけ。
4. credential placementが必要な場合は対象siteと操作を親へ明示し、安全なhandoffを使う。OS file permission/secret storeを設定し、Git/chat/CI variable/logへ値を戻さない。

## Phase 2.1 — このrepository内の1Password plugin MCP module

PP2本体はProject ID `87779895` (`ktakamuki_wsl/pc-platform/pc_platform2`) と確認済み。この実装計画のpluginはこのConnect repository内の分離moduleに置き、PP2 Hubがlocalstdio downstreamとして起動する。PP2 coreは変更せず、別のMCP中継層も追加しない。

1. PP2 Hubがlocalstdio pluginにMCP `tools/list` を送り、実在するtool metadata/schemaを確認できる契約を実装する。Hubの既存外部認証とplugin processの既存OS identity/permissionsを使い、独自認証、caller approval、role、権限昇格を追加しない。
2. Hubは確認済みのtool/schemaをallow-listと照合し、許可されたread-only toolだけをJSON-RPC 2.0 `tools/call` でpluginへ送る。未知tool/write/delete tool、schema外argumentは拒否する。
3. pluginはそのcallを処理し、各Hubから共通の既存Oyama Connect API endpointへ接続する。endpointは既存のsite configから読み、値をログへ出さない。
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

CI verificationは既存のnon-shared self-hosted Runner tags `appv4`、`ubutsu2`、`oyama-wsl` で成功済み。これらは3 Hub targetsであり、Connect deploymentはOyamaだけ。このrepositoryはdeploy jobを持たず、Hub配備を重複実装しない。

2026-10-19のmain/implementation pipelinesでは3 verification jobsが既存 non-shared Runner tags `appv4`、`ubutsu2`、`oyama-wsl`で成功済み。以前のinventory snapshot (tags empty / projects disabled) は過去状態であり、deployment permissionやruntime authを証明しない。


## Phase 4 — 既存Oyama runtime / central接続の記録

1. Connect API/Sync pairは既存Oyama上の1組を維持する。このrepositoryからConnectを新規配備、再起動、移動しない。
2. Compose/manifestは参照用のstatic contractとして扱い、今回の変更では適用しない。認証情報やdata volumeを読み取らない。
3. APPv4、Ubutsu2、OyamaはHubの配備先であり、Hub ownerの既存Runner-based pipelineに委ねる。このrepositoryへ並行deploy jobを追加しない。
4. 各HubからOyamaの既存Connect endpointへの経路/auth readinessは個別のread-only evidenceとして記録する。経路、listener、DNS、TLS、ACL、credentialを新設・変更しない。
5. Connect pairのversion、vault scope、port policyはOyamaの単一runtimeについて記録し、各Hub siteについてはHub→Oyamaの経路/auth確認状態を分けて記録する。

## Phase 5 — ローカル検証とCI（self-hosted Runnerのみ）

GitLab CIはself-hosted verification onlyで既に実行されており、shared runnerは使わない。実際の対応local repositoryが開ける場合は、保存したテストを実行しsecret値を出さない。

- 実credential handoffの前に、`CONNECT_CREDENTIALS_FILE` をsecret-free dummy pathへ向ける一時env fileを用い、`python deploy/docker/compose_wrapper.py --env-file <temporary-dummy-env> config` でdefault portのCompose configを検証する。host port default/override/invalid casesは `tests/test_compose_contract.py` とwrapper unit testで確認し、override時もloopback bindとcontainer port 8080を維持する。Composeがsource fileの存在を要求する場合に限り、repo外に空の非secret placeholder fileを作る。実credentialを読ませず、`up` は実環境/credential準備後に限る。
- `python -m pip install -r tests/requirements.txt` の後、`python -m unittest discover -s tests -v` でCompose契約/healthcheck/port validation unit testsを実行する。
- Helmを使うsiteはhelm lint、helm template、chart/schema version確認。
- MCP adapterはmockで `tools/list` metadata、schema allow-list、`tools/call` request/response、success/error/notificationの公開metadata projection、protocol/tool errors、timeout、unknown tool rejection、secret-safe logsを検証する。秘密値を返すtoolや人手確認gateは作らない。
- manifest内に秘密値、public bind、未許可port、APPv3 target、cross-site shared volumeがないことを静的checkする。
- secret fileはdummy/path placeholderを使用し、実credentialをfixtureやsampleにしない。
- local test結果にはrepository path、commit SHA、実行コマンド、exit codeのみを残す。正式remote/local repo接続不能なら「未実施」と明記する。


## Phase 6 — siteごとの配備と実動作

Connect serverはOyamaに一組で稼働中（本人確認）のため、このrepositoryから再配備・再起動しない。APPv4/Ubutsu2/OyamaはHub deployment targetsで、Hub ownerの既存Runner-based deploy pipelineを使う。各siteのHub→Oyama Connect route/authのみread-onlyで確認し、不明時は接続を有効化しない。

各Hub siteの既存route/authをread-onlyで検証する。Connect containerを起動・再起動しない。
1. Oyama上の既存API/Sync pairの状態をユーザー提供結果と既存read-only health evidenceで記録する。
2. 認証を伴わないhealth checkとauthenticated API checkを区別する。
3. 各Hubから許可済みの既存auth routeを使った `GET /v1/vaults` の可否を、Vault ID以外を出さず確認する。secret値の新規handoffやroute変更は行わない。
4. Central Oyama API/Sync healthは一組だけ確認し、Hub siteごとのroute reachabilityは個別に記録する。
5. Read-only scopeを確認し、token値やVault item dataは取得しない。
6. 既存のcentral routeが確認されるまでアプリ設定を切り替えない。Hub ownerによる配備・route作業はこのrepositoryで重複実装しない。

この順序で既存runtime状態、各Hubからのroute、初回認証GET、readiness、app routeを別々に記録する。

単一Oyama Connect runtimeの状態と各Hub siteからのroute/authを別々に確認する。


## Stop条件/承認handoff

以下のどれかが起きたら、その操作を行わず停止する: 1Password登録/permission/token変更が必要、secretの閲覧や転送に必要な安全なhandoffが用意されていない、APIのpublic accessを求められる、VM/hostの識別が曖昧、remote hostの正式経路が使えない、runner tag/site identity/accessが一致しない、shared runnerへ割り当てられる可能性がある。変更対象・host・影響を親へ示し、安全な方法を決める。

## 実装計画レビュー

ゼロベース確認で「host/VM ID不明」「MCP tool/API contract未確認」「runner tag/project access未設定」「既存scope表示をauth成功と混同」「ローカルrepo不在」を整理した。PP2本体はProject ID 87779895と確認済み。pluginはこのConnect repositoryの分離moduleとしてHub localstdioから起動し、Hub→plugin→central Oyama Connect RESTの呼び出し方向、PP2 core非変更、既存Hub認証/OS permissions、本人指定の経路変更、metadata-only outputを計画に反映した。現実装は `connect_list_vaults` の `GET /v1/vaults` によるVault ID/status metadataだけであり、既存consumerのitem secret取得依存を解消していない。consumer内部delivery route等は別要件が必要。secret-returning tool/新しいhuman confirmation gateや新規manual/protected gateは設けない。

Compose構文検証とsecret-free static CIはcredential handoff・実配備・API readinessに依存させず、dummy path referenceで先行可能とした。site deploymentは起動→heartbeat→初回認証GET→readiness→Vault identity→app cutoverの順とし、readinessは配備開始条件でなくアプリ切替条件である。per-host deploymentとsite-bound CI jobはhost/runtime、safe secret distribution、runner/tag/project accessのreadinessを別に確認し、既存GitLab設定と本人指示に従う。
