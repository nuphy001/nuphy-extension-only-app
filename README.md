# Shopify App Template - Extension only

This is a template for building an [extension-only Shopify app](https://shopify.dev/docs/apps/build/app-extensions/build-extension-only-app). It contains the basics for building a Shopify app that uses only app extensions.

---

## Extensions in this App

### 环境与 App

| 环境 | App 名称 | 只安装到 | 配置文件 | App ID（client_id） | 发布命令 |
| --- | --- | --- | --- | --- | --- |
| 测试 | `Test Promo Checkout` | 测试店 `q1j8s1-yq.myshopify.com` | `shopify.app.test.toml` | `5da33ea7a94a1bd5dce36b4f4c0fc37b` | `npm run deploy:test` |
| 全球生产 | `Global Promo Checkout` | 生产店 `nuphy-store.myshopify.com` | `shopify.app.production.toml` | `ea8902f04f9c9f1c5f6fd7ed25500b71` | `npm run deploy:production` |
| 日本 | `Japan Promo Checkout` | 日本店铺（域名待补充） | `shopify.app.japan.toml` | `0b479bbf5423a03aef633015db413c8d` | `npm run deploy:japan` |

> **注意：** App 版本按 App 生效，发布后装了该 App 的所有店铺都会立即更新，所以每个 App 只安装到对应的一个店铺。

发布前先核对 `client_id`，确认目标 App：

```bash
grep -H '^client_id' shopify.app*.toml
```

### Extensions

| Handle | Target | 作用 | 文档 |
| --- | --- | --- | --- |
| `nuphy-checkout-validation` | `cart.validations.generate.run` | 结账阶段对盲盒 / 押金产品做组合校验，阻止非法下单 | [extensions/nuphy-checkout-validation/](extensions/nuphy-checkout-validation/) |
| `nuphy-free-gift-discount` | `cart.lines.discounts.generate.run` | 给购物车里带 `_promo_role=gift` 属性的行打 100% off，落地 BOGO 赠品 0 元结账 | [extensions/nuphy-free-gift-discount/README.md](extensions/nuphy-free-gift-discount/README.md) |

### 常用命令（仓库根）

```bash
npm install                                             # 装全部 workspace 依赖
npm run build:test                                      # 构建测试环境
npm run deploy:test                                     # 发布测试环境（见上方注意事项）
npm run build:production                                # 构建全球生产环境
npm run deploy:production                               # 发布全球生产环境
npm run build:japan                                     # 构建日本环境
npm run deploy:japan                                    # 发布日本环境
npm --workspace <handle> run test -- --run              # 跑指定 extension 的 vitest 用例
```

---

This template doesn't include a server or the ability to embed a page in the Shopify Admin. If you want either of these capabilities, choose the [Remix app template](https://github.com/Shopify/shopify-app-template-remix) instead.

Whether you choose to use this template or another one, you can use your preferred package manager and the Shopify CLI with [these steps](#installing-the-template).

## Benefits

Shopify apps are built on a variety of Shopify tools to create a great merchant experience. The [create an app](https://shopify.dev/docs/apps/getting-started/create) tutorial in our developer documentation will guide you through creating a Shopify app.

This app template does little more than install the CLI and scaffold a repository.

## Getting started

### Requirements

1. You must [download and install Node.js](https://nodejs.org/en/download/) if you don't already have it.
1. You must [create a Shopify partner account](https://partners.shopify.com/signup) if you don’t have one.
1. You must create a store for testing if you don't have one, either a [development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) or a [Shopify Plus sandbox store](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-store).

### Installing the template

This template can be installed using your preferred package manager:

Using yarn:

```shell
yarn create @shopify/app
```

Using npm:

```shell
npm init @shopify/app@latest
```

Using pnpm:

```shell
pnpm create @shopify/app@latest
```

This will clone the template and install the required dependencies.

#### Local Development

[The Shopify CLI](https://shopify.dev/docs/apps/tools/cli) connects to an app in your Partners dashboard. It provides environment variables and runs commands in parallel.

You can develop locally using your preferred package manager. Run one of the following commands from the root of your app.

Using yarn:

```shell
yarn dev
```

Using npm:

```shell
npm run dev
```

Using pnpm:

```shell
pnpm run dev
```

Open the URL generated in your console. Once you grant permission to the app, you can start development (such as generating extensions).

## Developer resources

- [Introduction to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [App extensions](https://shopify.dev/docs/apps/build/app-extensions)
- [Extension only apps](https://shopify.dev/docs/apps/build/app-extensions/build-extension-only-app)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)

## BOGO 活动管理

原 app 已新增 Shopify 托管的买赠配置首页，见 [活动管理说明](extensions/bogo-campaign-manager/README.md)。首次切换前保留原有白名单；切换后从店铺配置读取活动，无需为新活动重新部署。
