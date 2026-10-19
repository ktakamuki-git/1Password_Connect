# Oyama集約案: PP2 plugin限定の要件差分

状態: **提案案**。既存の五段階設計レビューは3拠点local Connect案を対象としており、この集約案の承認・実装承認ではない。具体的なhost、URL、port、route、証明書、ACL、認証値は未確定。ネットワーク、credentials、1Password登録/権限は変更しない。

## 1. 提案する最小対象

当面の対象consumerは、APPv4・MainUbutsu2・MiniPC-Oyamaで動くPP2 Hubの1Password pluginだけとする。各Hubがlocalstdioで起動するplugin processは、Hub間relayを介さず、Oyama上の同一Connect API HTTPS originへ直接REST接続する。MCP success/error/notificationは既定の公開metadataのみとし、Vault ID以外のsecret値やtokenは返さない。

PP2 plugin backendとして使うConnect deploymentはOyamaに1組とする: API 1、Sync 1、同一host上の暗号化data volume 1つ。登録identityは既存CredentialMCP 1つ。登録、token、deployment、containerの数は別単位として記録する。API/Sync間ではローカルvolumeを共有するが、拠点間volume共有はしない。

他アプリのConnect endpoint、credentials、route、実行方式は未確認である。提案範囲では変更しない。APPv4/MainUbutsu2上に既存Connect deploymentがあるかも確認できていないため、撤去・停止・切替を計画しない。各アプリをOyamaへ移行する要求は別途定義・レビューする。

## 2. 現行設計からの差分

| 観点 | レビュー済みの旧設計 | 今回の最小集約案 |
|---|---|---|
| PP2 pluginのbackend | 3つのsite-local Connect APIへ固定 | 3 Hubのplugin processが1つのOyama HTTPS originへ直接接続 |
| PP2 backend runtime | 3 API+Sync pair、計6 container、3 local volume | Oyamaに1 API+Sync pair、計2 container、1 local volume |
| 1Password登録 | CredentialMCP 1つ | 同じく1つ。新規登録・token発行なし |
| 他consumer | 各拠点アプリもlocal APIを使う想定 | 今回は変更対象外。既存routeを推測・書換えしない |
| route障害時 | 拠点別に独立 | Oyama Connectまたは経路停止が3拠点PP2 pluginに影響。site-local fallback/自動切替なし |

「deployment 1組」はPP2 plugin backendの提案上の数であり、現在の各siteで稼働する実deployment数の確認結果ではない。

## 3. ネットワークとTLSの前提

現在のCompose候補はAPIを127.0.0.1にbindする。これは他siteのhostから直接到達できる設定ではない。遠隔pluginから到達させるには、OyamaのAPIへ結ぶ**既存の**非公開経路が存在し、3つの送信元hostから利用できることを確認する必要がある。既存routeがなければ設計・配備を止める。routeやlistenerの追加、port bind変更、DNS/証明書発行はこの提案では実施しない。

実装前の確認項目:

- 3 Hub hostから同じHTTPS originへの名前解決とTCP経路
- TLS certificateの有効期間、hostname/SAN一致、各Node processからのtrust、redirect拒否
- route/provider側とhost側の実効アクセス制御がPP2 plugin hostを必要範囲に限定すること
- APIへの未認証Internet公開がないこと、routeが別site/別APIへ黙って切替わらないこと
- Oyamaの実OS、WSL distribution、container engine、listener namespaceと自動起動

候補を比較する際も、実在する設定を読み取るだけに留める。Tailscale Serveはtailnet内でserviceを共有する機能だが、tailnet policyがない場合のdefault allowを含め実効access policyの確認が必要である。[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) / [Tailscale access control](https://tailscale.com/docs/features/access-control/acls)。Cloudflareにはprivate networking用途とpublic application hostname用途があるため、存在確認だけでpublic routeを採用済みと判断しない。[Cloudflare One Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) / [Public application routes](https://developers.cloudflare.com/tunnel/get-started/)。

## 4. 秘密情報・認証境界

- 1password-credentials.jsonはConnect API/Syncを動かすOyama hostだけに、安全な独立handoff後に配置する。fileやtoken値をGit、ログ、Chatに出さない。今回はhandoff・読み取り・認証を行わない。
- 3つのplugin processは各々Bearer API tokenを必要とする。集約によってこのtokenを各Hubからなくせるわけではない。既存approved secret referenceが各hostで利用可能かを確認するまで設定・配布しない。
- PP2 Hub sourceではsecretRefs provider未設定時にdownstreamをfail closedにする。実在するtoken供給経路は未確認であり、新規credential、provider、独自auth/approval/elevationを推測で追加しない。
- MCPのtool inputでendpoint、site、tokenを選ばせない。通常REST callの失敗時に別siteや直接的なHub fallbackを行わない。

## 5. 受け入れ条件とテスト設計の差分

実装に進む前に、親による新しい段階別・全体レビューを行う。最低限、以下を五段階文書へ一貫して反映する。

1. PP2 plugin専用central backendはOyamaのAPI+Sync 1 pairであり、3拠点のplugin processは同一originへ直接接続する。
2. 他アプリのConnect route変更・移行と、未確認deploymentの撤去は本範囲に含めない。
3. endpoint/CA/trust/access controlは既存routeの読み取り確認後に固定する。確認できなければlive test、配備をしない。
4. static/mock testは、全client-site contextで固定central originへの成功、HTTPS/TLS不正時のfail-closed、redirect拒否、site別fallbackがないこと、Bearer tokenとupstream bodyが出力/logへ漏れないことを検査する。
5. live試験は各siteのplugin processから、承認済みtokenでOyama APIに認証付きGET /v1/vaultsを行い、Vault IDのみを照合する。route/health/auth/Hub integrationを別々に記録し、1Password item/secretは取得しない。
6. Central runtimeの障害は3siteすべてへ影響する前提を記録する。自動HA、replica、site-local fallbackは新しい要件承認なしに加えない。
7. Oyama Connect pairの配備・単体試験・3拠点からの実接続は別の証拠として記録する。PP2 plugin以外のconsumerは検証対象にしない。

### 五段階文書に反映する候補

- 要件定義: PP2専用1 deployment pair、other consumerのendpoint非変更、central failure domain、既存route/credential blockerを受け入れ条件にする。
- 概要設計: 三Hub→各localstdio plugin→共通Oyama HTTPS originの図にし、Connect API/Sync pairはOyama 1組として数える。
- 詳細設計: origin固定方法、TLS検証、Bearer tokenの既存供給境界、許可元、redirect/no-fallbackを定義する。具体値はroute inventory後。
- 実装計画: plugin設定変更とmock検証、route evidence収集、credential handoff/配備を分離し、後二者は未承認・未実施として残す。
- テスト設計: 3site contextの同一origin contract、TLS/redirect negative case、Hub/plugin/mock API、現地接続を段階別に定義する。

この差分案は、認証、配備、公開経路、アプリendpointを変更する指示ではない。親の独立レビューで承認されるまで、既存五段階文書やruntime配置をこの案で上書きしない。
