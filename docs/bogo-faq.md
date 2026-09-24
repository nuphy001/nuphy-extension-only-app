# 买赠活动 Q&A

记录日期：2026-09-23。本文说明旧版 `NuPhy Bonus` 与新版 `NuPhy Bonus Unified` 的折扣记录、活动排期、FREE GIFT 标签，以及「标题必须唯一」的保存报错。定时折扣已有 NuPhyX 实测结果；标签部分依据本地代码核对，尚未完成线上切换验证。

## 1. 为什么旧版会在 Shopify「折扣」列表生成 Free Gift？

赠品免费通过 Shopify 自动折扣实现。旧版在后台创建名为 `Free Gift` 的自动折扣，绑定 `nuphy-free-gift-discount` Function；函数判断购物车是否满足活动条件，并将符合条件的赠品减免至免费。因此，这条记录会出现在 Shopify 的「折扣」列表中。

旧方案共用一条 `Free Gift` 折扣，由函数内部判断活动。新版为启用的活动创建并绑定独立折扣，标题使用「活动名称（唯一标识）」，每条记录有自己的开始和结束时间。新版记录也会出现在同一个列表。

列表的「类型」显示 `nuphy-free-gift-discount`，这是函数名称。新旧 App 都沿用此名称，单凭这一列无法判断记录属于哪个 App。截图中的搜索词为 `free`，可能筛掉按中文活动名称创建的新记录，查看时应先清空搜索。

相关实现见[旧版折扣创建说明](../extensions/nuphy-free-gift-discount/README.md)、[新版折扣创建与绑定](../extensions/bogo-campaign-manager/src/api.ts)。Shopify 的 [discountAutomaticAppCreate](https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/discountAutomaticAppCreate) 用于创建这类由 App 管理的自动折扣。

## 2. 为什么不用自己运行定时任务，也能设置活动开始和结束时间？

Shopify 自动折扣原生支持排期。App 保存活动时，将店铺时区下填写的时间转换为 UTC，写入对应折扣的两个字段：

| 字段 | 作用 |
| --- | --- |
| `startsAt` | 折扣开始生效的时间 |
| `endsAt` | 折扣到期、不再可用的时间；不设结束时间时为 `null` |

Shopify 按这些时间控制折扣是否可用，Function 负责判断商品、活动绑定和可免费赠送的数量。App 无需在自己的服务器上运行 cron，也无需到点再发送启停请求。关闭 App 页面或电脑，不影响已经保存的排期。[Shopify 字段说明](https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/DiscountAutomaticAppInput)

App 页面中的「未开始／进行中／已结束」按时间刷新，用于展示状态。实际折扣是否生效，由 Shopify 处理，不能只凭页面标签判断测试通过。

2026-09-23 已通过 NuPhyX 新 App 的可视化页面设置 18:09–18:11（`Asia/Shanghai`）的测试活动，并在同一个真实 Shopify 结账中验证：

| 阶段 | App 状态 | Shopify 折扣状态 | 手托价格 |
| --- | --- | --- | --- |
| 开始前 | 未开始 | `SCHEDULED` | $19.00 |
| 活动中 | 进行中 | `ACTIVE` | Free |
| 结束后 | 已结束 | `EXPIRED` | $19.00 |

测试商品为 NuPhy Air75 V3 与 Extra Mono Wrist Rest for Air75 V3（Acrylic Frosted）。键盘的 20% 折扣全程保留，未提交订单；测试后已将临时活动恢复停用。此次验证覆盖定时折扣生效与失效，未验证 `dev.nuphy.com` 接入新 App 后自动加赠的完整流程。

## 3. 开启「在购物车显示 FREE GIFT 标签」后，保存时实际做了什么？

开启时，App 将该活动的 `showLabel` 保存为 `true`；关闭时保存为 `false`。新 App 把这个字段连同活动规则写入店铺 metafield `nuphy_bonus_v2.campaigns`。见[开关定义](../extensions/bogo-campaign-manager/src/app-home.tsx)和[配置保存逻辑](../extensions/bogo-campaign-manager/src/api.ts)。

这个开关设计上控制购物车赠品的显示标识。它不会给商品添加 Shopify Tag，也不会修改赠品免费规则。结账折扣函数返回的文案固定为 `Free Gift`，不读取 `showLabel`，因此关闭开关不会隐藏结账里的折扣文案。见[折扣计算逻辑](../extensions/nuphy-free-gift-discount/src/managed_campaign_discount.js)。

无头店铺已经有标签显示逻辑。现有前端读取旧 App 的 `nuphy_bogo.campaigns`；尚未启用页面管理时，回退到前端原有活动配置。新增赠品时，前端写入 `_promo_role=gift`，并将活动的 `showLabel` 转为购物车行属性 `_promo_show_label`。购物车抽屉确认该行是赠品后，读取这个属性，决定是否在图片左上角显示 `FREE GIFT`。活动未设置 `showLabel` 时默认显示；旧购物车行缺少标签属性时，会查询前端原有活动配置，仍找不到则默认显示。

页面上的 `Free Gift` 还可能来自其他位置，开关并不统一控制这些文字：

| 显示位置 | 文字来源与判断条件 | 前端代码位置 |
| --- | --- | --- |
| 桌面购物车抽屉的赠品图片角标 | 赠品行属性与 `isGiftLabelEnabled` 决定是否显示 | `src/components/cart/drawer/cart-item.tsx` |
| 抽屉里的折扣明细，如 `Free Gift (-$19.00)` | 展示 Shopify 返回的折扣分摊标题及减免金额，不读取 `showLabel` | `src/components/cart/drawer/cart-line-discounts.tsx` |
| 独立 `/cart` 页面中的赠品标签 | 识别到赠品行就显示 `Free Gift` | `src/app/cart/cart-item.tsx` |
| 商品卡片角标 | 商品自身的 `_label_Free Gift` Tag 由前端渲染；活动开关不会添加这个 Tag | `src/components/common/products/card/badge.tsx` |

新 App 使用独立的 `nuphy_bonus_v2` 配置，当前保留无头店铺读取旧 App 的链路。这是新旧 App 的隔离安排，现有标签仍由上述逻辑显示。具体边界与限制如下：

| 边界或限制 | 实际影响 | 前端代码位置 |
| --- | --- | --- |
| 前端保留读取 `nuphy_bogo.mode/campaigns`，尚未切换到 `nuphy_bonus_v2` | 旧 App 配置继续供前端读取；新 App 的开关尚不能控制这条链路 | `src/lib/shopify/queries/promotions.ts` |
| 已有赠品行只校正数量，没有同步更新标签属性 | 修改开关并保存后，已有赠品可能保留原来的标签状态 | `src/lib/promotion/engine.ts`、`src/components/cart/api/reconcile-promotions.server.ts` |
| 独立 `/cart` 页面只判断是否为赠品，没有判断 `showLabel` | 独立购物车页面与抽屉的标签表现不一致 | `src/app/cart/cart-item.tsx` |

表中的前端路径属于 `nuphy-headless-shop` 项目。抽屉显示逻辑位于 `src/components/cart/drawer/cart-item.tsx`，购物车行属性处理位于 `src/lib/promotion/attributes.ts`。

以上标签结论来自只读代码核对，未修改 headless 项目，未实测线上标签切换。新 App 的「保存成功」说明新配置已写入；前台已有的 `Free Gift` 显示不能用来证明新 App 开关已经接通。

## 4. 活动名称没有改，为什么修改排期仍报「标题必须唯一」？

### 问题现象与原因

编辑已有活动，只修改开始或结束时间，保留原活动名称，保存时出现「对于自动折扣，标题必须唯一」的错误，排期无法保存。

本项目修改排期时采用以下保存顺序：先创建并绑定一条新自动折扣，再发布活动配置，最后停用旧折扣。这样，准备新折扣或保存配置失败时，原活动仍能保留。新折扣创建时，旧折扣还存在；修复前两条记录使用相同标题，触发了 Shopify 的标题唯一性校验。

因此，即使活动名称从未改过，修改排期也可能触发标题冲突。锁定活动名称无法解决这次报错，因为保存时仍会尝试创建同名折扣。

### 当前处理方式

创建新自动折扣时，标题使用「活动名称（唯一版本标识）」。代码复用该次折扣绑定的 `token` 作为唯一标识，使同一活动在不同排期下生成的折扣标题不同。活动名称仍可编辑。

新配置发布成功后，系统切换到新折扣绑定，再尝试停用旧折扣；停用失败会给出警告。名称和排期未变、原绑定及折扣状态符合复用条件时，会沿用已有折扣。

实现见 [createDiscountOwner 与保存流程](../extensions/bogo-campaign-manager/src/api.ts)、[折扣复用条件](../extensions/bogo-campaign-manager/src/utils/discount.ts)。保存流程的[回归测试](../extensions/bogo-campaign-manager/src/__test__/save-campaign.test.ts)模拟了 Shopify 拒绝同名自动折扣的错误。

### 社区参考

- [创建 automaticAppDiscount 时出现 title must be unique](https://community.shopify.com/t/not-able-to-create-automaticappdiscount-due-to-title-must-be-unique-error/253503)：2023-09-25 的提问展示了 `discountAutomaticAppCreate` 对标题返回 `must be unique`。回复者推测，旧 Function 被移除后仍可能留下占用标题的折扣；该解释是社区用户的推测，不能当成本项目这次报错的已确认原因。
- [重复创建自动折扣时的标题校验](https://community.shopify.dev/t/mutation-discountautomaticbasiccreate-will-not-throw-an-error-if-failed/25647)：2025-11-17，Shopify 员工回复称，在 API `2025-10` 中用相同标题再次创建自动折扣，会收到标题唯一性错误。该帖验证的是 `discountAutomaticBasicCreate`，可作为同名自动折扣校验的参考；本项目使用的是 `discountAutomaticAppCreate`。

本项目这次问题的原因来自上述保存调用顺序；社区链接用于记录同类报错及其适用范围。
