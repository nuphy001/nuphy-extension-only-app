# NuPhy Bonus：Shopify 扩展应用

本项目包含买赠活动管理首页、赠品折扣和结账校验三个扩展，均由 Shopify 托管，无需另外部署 Web 服务。功能变更见 [CHANGELOG.md](CHANGELOG.md)。

新版与旧版的折扣记录、定时生效机制、FREE GIFT 标签的实际行为，以及「标题必须唯一」的保存报错，见[买赠活动 Q&A](docs/bogo-faq.md)（2026-09-23）。

| 扩展 | 作用 | 入口 |
| --- | --- | --- |
| `bogo-campaign-manager` | 在 Shopify 后台管理买赠活动 | [活动管理说明](extensions/bogo-campaign-manager/README.md) |
| `nuphy-free-gift-discount` | 校验活动与商品，计算可免费赠送的数量 | [赠品折扣源码](extensions/nuphy-free-gift-discount/src/) |
| `nuphy-checkout-validation` | 校验盲盒、押金等产品的购物车组合 | [结账校验源码](extensions/nuphy-checkout-validation/src/) |

## 环境准备

需要 Node.js 22.12+、Git 2.28+、pnpm 和 Shopify CLI。CLI 需要单独安装，项目依赖不会安装它；本次已验证的 CLI 版本为 4.8.0。[Shopify CLI 环境要求](https://shopify.dev/docs/api/shopify-cli#requirements)

```bash
# 尚未安装 Shopify CLI 时执行
npm install -g @shopify/cli

# 以下命令均在仓库根目录执行，按 pnpm-lock.yaml 安装依赖
pnpm install --frozen-lockfile
```

CLI 需登录有对应组织、应用和店铺权限的账号。本文统一使用 pnpm 运行项目命令。

## 应用配置与店铺

| 配置文件 | Client ID | 用途 |
| --- | --- | --- |
| `shopify.app.toml` | `872f6beb8dc7437845803205b98c1436` | 本项目的构建、校验和发布目标 |

旧共享 App（Client ID `ea8902f04f9c9f1c5f6fd7ed25500b71`）已由店铺方删除。NuPhyX 在 `shopify store list` 中标为 `dev`，但它是 Plus 开发店，未出现在同组织的 Dev Dashboard 店铺列表。当前执行 `pnpm dev`，或用 `--store q1j8s1-yq.myshopify.com` 指定该店，都会报 `Could not find store`。Shopify 目前仅支持对 Dev Dashboard 创建的店铺运行 `app dev`；`store list` 的 `dev` 标记不足以判断这条命令能否使用。[Shopify 工作人员说明](https://community.shopify.dev/t/shopify-app-dev-doesnt-work-with-plus-development-stores/23471/2)

`pnpm run deploy` 使用 `shopify.app.toml` 的 `client_id` 发布一个 App 版本。所有安装了这个 App 的店铺都会收到新版本；`dev_store_url` 只是 `app dev` 的默认店铺地址，不能让 NuPhyX 支持开发预览，也不能将发布限制在 NuPhyX。[Shopify App 版本说明](https://shopify.dev/docs/apps/launch/deployment/deploy-app-versions)

## 活动配置来源

**已启用 App 页面管理的店铺，只需在 App 中配置活动，无需再修改源码中的商品或赠品 ID，也无需为活动内容变化重新发布代码。**

当前源码的管理页保存活动到店铺的 `nuphy_bogo.campaigns`，并写入 `nuphy_bogo.mode = managed`；赠品折扣函数读取这份配置及对应折扣的 `nuphy_bogo.campaign` 绑定。NuPhyX 无头店铺原本也读取 `nuphy_bogo`。配置或绑定无效时不发放赠品折扣，不回退到源码内置的旧活动。[读取逻辑](extensions/nuphy-free-gift-discount/src/managed_campaign_discount.js)与[配置校验](extensions/nuphy-free-gift-discount/src/configuration.ts)以当前源码为准。

赠品折扣只使用 `managed_campaign_discount` 这一套实现。构建和发布时无需按店铺切换入口。

`legacy-campaigns.json` 是保留的数据文件，当前管理页不读取它。切换前须核对店铺 `nuphy_bogo` 中是否留有旧配置；只有 `mode` 和 `campaigns` 都不存在时，管理页才从空活动列表开始。

NuPhyX 此前用当前 App 创建的 3 个 `nuphy_bonus_v2` 活动已由店铺方删除，原生折扣也已过期；`nuphy_bogo` 中仍有旧配置。2026-09-24，`nuphy-bonus-5` 已发布，当时当前 App 仅安装于 NuPhyX。本地 NuPhyX 无头店铺的四活动同车测试进入真实 Checkout：四件赠品均为 FREE，Air75 主品保留 20% 折扣，合计 $490.90。排期相关的无头前端修复仍只在本地分支，尚未部署；NuPhy 正式店也未发布当前 App。开始和结束时间的单活动实测见[买赠活动 Q&A](docs/bogo-faq.md)。

## 快捷脚本说明

脚本定义在 [package.json](package.json)。构建、校验和发布命令都明确使用 `shopify.app.toml`，不再切换赠品折扣入口。

| 脚本名 | 用途与参数 |
| --- | --- |
| `dev` | 按默认配置启动开发预览；当前默认的 NuPhyX 店铺不支持 `app dev`，命令会失败 |
| `build` | 构建三个扩展，不发布 |
| `deploy` | 发布当前 App 版本到该 App 的全部安装店铺 |
| `validate` | 校验默认配置并输出 JSON，不构建、不运行测试 |
| `info` | 查看默认 App 信息 |
| `generate` | 转发到 `shopify app generate`，使用时需指定子命令 |
| `shopify` | 直接转发 Shopify CLI 命令 |

## 校验、测试与构建

配置校验和业务测试分别执行：

```bash
# 校验当前 App 配置
pnpm run validate

# 活动管理测试：脚本已包含 vitest run，无需再加 --run
pnpm --filter bogo-campaign-manager test
pnpm --filter bogo-campaign-manager check:types

# 两个 Function 的 test 脚本默认监听；--run 表示执行一次后退出
pnpm --filter nuphy-free-gift-discount test --run
pnpm --filter nuphy-checkout-validation test --run
```

需要单独检查构建时执行以下命令；发布命令会自行构建，不必每次先运行一次 build。[CLI 构建说明](https://shopify.dev/docs/api/shopify-cli/app/app-build)

```bash
# 构建当前 App 的三个扩展，不发布
pnpm run build
```

CLI 需要对应组织的账号权限。若返回 `403` 和 `You are not a member of the requested organization`，使用 `shopify auth login` 切换到有权限的账号后再执行。

## 发布当前 App

`nuphy-bonus-5` 发布时，当前 App 只安装于 NuPhyX。后续每次发布前仍须核对安装店铺；如果当前 App 安装到 NuPhy，下面的命令也会更新 NuPhy。

1. 完成上面的配置校验、测试和类型检查。
2. 用 `pnpm run info` 核对目标 App 的 Client ID 为 `872f6beb8dc7437845803205b98c1436`；在 Partner Dashboard 的应用管理页面另行核对安装店铺范围。
3. 发布应用配置和三个扩展：

   ```bash
   pnpm run deploy
   ```

   核对发布变更后确认。看到 `New version released to users.` 才表示完成。发布使用当前工作区内容，无需先提交或推送 Git，也无需启动本地开发服务器或隧道。`--no-release` 仅创建未发布版本。[CLI 发布说明](https://shopify.dev/docs/api/shopify-cli/app/app-deploy)

4. 在 NuPhyX 后台应用列表打开当前 App。若 Shopify 提示新增权限，核对后更新授权。当前配置权限为 `read_products,write_discounts`。
5. 验证活动列表、创建活动、商品及赠品选择、取消草稿。放弃验证草稿；涉及折扣或结账行为的改动，还需验证对应购物车、结账流程。

首次安装到获准使用该应用的其他店铺时，在 App distribution 中使用 Custom distribution，填写目标店铺域名并生成安装链接，再打开链接授权。安装之后，该店也会收到此 App 后续发布的版本。[自定义分发说明](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method)

### 2026-09-15 发布记录

以下记录对应旧 NuPhyX App（Client ID `ea8902f04f9c9f1c5f6fd7ed25500b71`）。当时的 `shopify.app.toml` 指向旧 App，与当前配置不同。

- [nuphyx-extension-app-20](https://dev.shopify.com/dashboard/15531373/apps/393654435841/versions/1129071411201)：使用当时的脚本发布。修复 `MAX_CONFIG_BYTES` 缺失导出，使页面显示与保存校验共用 10,000 字节上限。153 项测试通过（活动管理 76、赠品折扣 55、结账校验 22），类型检查、三个扩展构建通过。
- 完成新增“编辑折扣”权限授权后，已在 NuPhyX 验证活动列表、商品规格回填、赠品单规格及库存筛选入口、放弃草稿。现有 3 个活动未改动，未验证购物车或结账折扣。
- [nuphy-bonus-21](https://dev.shopify.com/dashboard/15531373/apps/393654435841/versions/1129074294785)：将 TOML 的 `name` 改为 `NuPhy Bonus` 后重新校验、构建、发布，后台导航和标题已确认新名称。此次只改应用名，未重跑业务测试。

上述旧 App 的显示名来自当时 TOML 的 `name`，后台路径中的 `nuphy-bonus` 来自当时的 `handle`；修改显示名不会自动修改路径。[应用配置说明](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration#global)

`--version` 只设置发布版本标签。后续发布可省略该参数，由 CLI 命名；若自行指定，使用新的唯一标签。
