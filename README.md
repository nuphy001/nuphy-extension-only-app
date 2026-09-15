# NuPhy Bonus：Shopify 扩展应用

本项目包含买赠活动管理首页、赠品折扣和结账校验三个扩展，均由 Shopify 托管，无需另外部署 Web 服务。功能变更见 [CHANGELOG.md](CHANGELOG.md)。

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

| 配置文件 | 应用 | Client ID | 用途 |
| --- | --- | --- | --- |
| `shopify.app.oooyi.toml` | nuphy-local-dev | `4ccd118df9fc40c42d865fd151b0ec2a` | 61style 开发店，本地调试 |
| `shopify.app.toml` | NuPhy Bonus | `ea8902f04f9c9f1c5f6fd7ed25500b71` | NuPhyX 预演店，域名 `q1j8s1-yq.myshopify.com` |
| `shopify.app.production.toml` | nuphy-extension-only-app | `1dfa5ac4c1e95115a158b547c4228540` | 独立生产应用 |

NuPhyX 的店铺类型是“预演商店”（Staging），不支持 `shopify app dev`；代码需发布后才能在该店验证。本地预览使用 61style，添加 `--use-localhost` 不会改变店铺类型限制。[Shopify 店铺类型说明](https://community.shopify.dev/t/clarifying-store-types-for-development/25089)

发布目标由所选配置的 `client_id` 决定，`dev_store_url` 只用于开发预览，不会限制发布范围。安装了同一应用的店铺会使用发布后的版本。发布 NuPhyX 时使用 `shopify.app.toml`；`:production` 对应另一应用。

## 活动配置来源

**已启用 App 页面管理的店铺，只需在 App 中配置活动，无需再修改源码中的商品或赠品 ID，也无需为活动内容变化重新发布代码。**

赠品折扣函数目前保留两种配置来源：

- 店铺已进入页面管理模式（`nuphy_bogo.mode = managed`）时，读取 App 保存到 `nuphy_bogo.campaigns` 的活动配置。
- 店铺完全没有管理模式标记，且折扣没有活动绑定信息时，才读取源码中的 `CAMPAIGNS` 数组。这是为尚未迁移到页面管理的旧活动保留的兼容规则。

进入配置读取路径后，如果模式、配置或绑定信息无效，函数不会回退到源码旧规则。[读取逻辑](extensions/nuphy-free-gift-discount/src/cart_lines_discounts_generate_run.development.js)与[配置校验](extensions/nuphy-free-gift-discount/src/configuration.ts)以当前源码为准。

`development` 和 `production` 两份源码各自保留了旧活动的主商品、赠品规格 ID，因此构建时仍需选择对应实现。这里不要求开发同学把 App 中的活动同步维护到两份源码。确认相关店铺均不再依赖旧配置后，再清理内置规则、合并实现并简化切换脚本。

## 快捷脚本说明

脚本定义在 [package.json](package.json)。为兼容上述旧规则，`dev`、`build`、`deploy` 相关脚本会调用 [run-shopify-environment.mjs](scripts/run-shopify-environment.mjs)，先选择赠品折扣实现，再执行 Shopify CLI：

- `development` 用于 61style 调试和 NuPhyX 构建、发布；`production` 用于独立生产应用。
- 切换只影响 `nuphy-free-gift-discount` 的入口文件，CLI 结束后通过 `finally` 恢复 `development`；另外两个扩展不做环境切换。
- **实现选择和应用配置是两回事。** `:test` 没有内置 `--config`，也不表示运行单元测试；操作 NuPhyX 时必须补上 `--config shopify.app.toml`。
- 开发预览与生产构建、发布会改写同一个入口文件，不要在同一工作目录并行运行。

| 脚本名 | 用途与参数 |
| --- | --- |
| `dev:61style` | 启动开发预览；已指定 `--config oooyi`，使用 `development` 实现 |
| `dev` / `dev:test` | 同功能别名，未指定应用配置；本项目本地调试直接用 `dev:61style` |
| `build` / `build:test` | 同功能别名，仅构建三个扩展，不发布；NuPhyX 需加 `--config shopify.app.toml` |
| `deploy` / `deploy:test` | 同功能别名，构建并发布三个扩展及应用配置；NuPhyX 需加 `--config shopify.app.toml` |
| `validate:test` | 校验应用配置并输出 JSON，不构建、不运行测试；NuPhyX 需加 `--config shopify.app.toml` |
| `build:production` | 使用 `production` 实现构建；已指定 `--config production` |
| `deploy:production` | 使用 `production` 实现构建并发布；已指定 `--config production` |
| `validate:production` | 校验独立生产应用配置；已指定 `--config production` |
| `info` / `info:production` | 查看应用信息；`info` 需自行指定 `--config`，后者已指定 `production` |
| `generate` | 转发到 `shopify app generate`，还需子命令，例如 `pnpm generate extension --config oooyi` |
| `shopify` | 直接转发 CLI 命令，例如 `pnpm shopify version`；不切换赠品折扣实现 |

pnpm 的附加参数直接放在脚本名后，例如 `pnpm dev:61style --use-localhost`。使用 npm 执行同一脚本时，参数前需要 `--`，例如 `npm run dev:61style -- --use-localhost`。

<details>
<summary>61style 本地调试</summary>

### 默认方式：CLI 自动创建随机域名隧道

```bash
pnpm dev:61style
```

Shopify CLI 自动创建 Cloudflare Quick Tunnel，提供随机域名的 HTTPS 入口，无需手动启动隧道或配置自定义域名。保持 CLI 运行，打开终端输出的 Preview URL 进入 61style 后台。[Shopify 默认网络方式](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#cloudflare-quick-tunnels)

### 可选方式：仅本机浏览器，不使用隧道

```bash
pnpm dev:61style --use-localhost
```

需要 Shopify CLI 3.80+。首次运行按提示使用 `mkcert` 生成并信任本地 HTTPS 证书；默认地址为 `https://localhost:3458`，端口被占用时可追加 `--localhost-port 3459`。仍从终端输出的 Shopify 后台 Preview URL 进入页面。

`--use-localhost` 有以下限制：

- 只能在运行 CLI 的电脑上预览。其他电脑或手机的 `localhost` 指向各自设备，不能用它测试另一设备上的 Shopify POS。
- Webhooks、App proxy、Flow actions 等 Shopify 服务端回调无法访问本机 `localhost`；这类场景需要上面的默认隧道方式提供公网 HTTPS 入口。
- 浏览器必须信任本地证书。WSL 中启动 CLI、Windows 浏览器预览时，还需要在 Windows 安装对应证书。

版本要求、证书配置和网络限制见 [Shopify 本地网络说明](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development)。两种方式都需要联网登录 Shopify、同步扩展和读取店铺数据。

终端显示 `Ready` 后，还需确认后台 Dev Console 显示 `Connected`，并检查页面操作。两个 Shopify Function 在本地构建、同步到开发店，实际折扣与结账校验仍由 Shopify 执行；页面能打开不代表这些业务已验证，需在开发店配置并触发购物车、结账流程。[Function 测试说明](https://shopify.dev/docs/apps/build/functions/test-debug-functions)

2026-09-15 已验证两种方式均能加载 61style 活动列表；localhost 模式还验证了创建、取消操作。未保存测试活动，未验证购物车或结账效果。

</details>

## 校验、测试与构建

配置校验和业务测试分别执行：

```bash
# 校验 NuPhyX 应用配置；这里的 test 不表示单元测试
pnpm validate:test --config shopify.app.toml

# 活动管理测试：脚本已包含 vitest run，无需再加 --run
pnpm --filter bogo-campaign-manager test
pnpm --filter bogo-campaign-manager check:types

# 两个 Function 的 test 脚本默认监听；--run 表示执行一次后退出
pnpm --filter nuphy-free-gift-discount test --run
pnpm --filter nuphy-checkout-validation test --run
```

需要单独检查构建时执行以下命令；发布命令会自行构建，不必每次先运行一次 build。[CLI 构建说明](https://shopify.dev/docs/api/shopify-cli/app/app-build)

```bash
# 构建 NuPhyX 的三个扩展，不发布
pnpm build:test --config shopify.app.toml

# 校验、构建独立生产应用，不发布
pnpm validate:production
pnpm build:production
```

执行生产脚本需要该应用所属组织的账号权限。若 CLI 返回 `403` 和 `You are not a member of the requested organization`，使用 `shopify auth login` 切换到有权限的账号后再执行。

## 发布到 NuPhyX

1. 完成上面的配置校验、测试和类型检查。
2. 发布应用配置和三个扩展：

   ```bash
   pnpm deploy:test --config shopify.app.toml
   ```

   终端应显示组织 `Shenzhen NuPhy Technology Co., Ltd.`、应用 `NuPhy Bonus`。核对变更后确认发布，看到 `New version released to users.` 才表示完成。发布使用当前工作区内容，无需先提交或推送 Git，也无需启动本地开发服务器或隧道。`--no-release` 仅创建未发布版本。[CLI 发布说明](https://shopify.dev/docs/api/shopify-cli/app/app-deploy)

3. 打开 [NuPhyX 后台 → NuPhy Bonus](https://admin.shopify.com/store/nuphyx/apps/nuphy-functions-development)。已安装应用无需重装；若 Shopify 提示新增权限，核对后更新授权。当前配置权限为 `read_products,write_discounts`。
4. 验证活动列表、创建活动、商品及赠品选择、取消草稿。放弃验证草稿；涉及折扣或结账行为的改动，还需验证对应购物车、结账流程。

首次安装到获准使用该应用的其他店铺时，在 App distribution 中使用 Custom distribution，填写目标店铺域名并生成安装链接，再打开链接授权。[自定义分发说明](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method)

发布独立生产应用使用 `pnpm deploy:production`，该命令不用于 NuPhyX。

### 2026-09-15 发布记录

- [nuphyx-extension-app-20](https://dev.shopify.com/dashboard/15531373/apps/393654435841/versions/1129071411201)：使用 `pnpm deploy:test --config shopify.app.toml` 发布。修复 `MAX_CONFIG_BYTES` 缺失导出，使页面显示与保存校验共用 10,000 字节上限。153 项测试通过（活动管理 76、赠品折扣 55、结账校验 22），类型检查、三个扩展构建通过。
- 完成新增“编辑折扣”权限授权后，已在 NuPhyX 验证活动列表、商品规格回填、赠品单规格及库存筛选入口、放弃草稿。现有 3 个活动未改动，未验证购物车或结账折扣。
- [nuphy-bonus-21](https://dev.shopify.com/dashboard/15531373/apps/393654435841/versions/1129074294785)：将 TOML 的 `name` 改为 `NuPhy Bonus` 后重新校验、构建、发布，后台导航和标题已确认新名称。此次只改应用名，未重跑业务测试。

应用显示名来自 TOML 的 `name`；`--version` 只设置发布版本标签。后续发布可省略该参数，由 CLI 命名；若自行指定，使用新的唯一标签。
