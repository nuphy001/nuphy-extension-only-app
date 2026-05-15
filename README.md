# Shopify App Template - Extension only

This is a template for building an [extension-only Shopify app](https://shopify.dev/docs/apps/build/app-extensions/build-extension-only-app). It contains the basics for building a Shopify app that uses only app extensions.

---

## Extensions in this App

`client_id = "1dfa5ac4c1e95115a158b547c4228540"` · 已安装授权到生产店铺 · 共存多个 Function extension。

| Handle | Target | 作用 | 文档 |
| --- | --- | --- | --- |
| `nuphy-checkout-validation` | `cart.validations.generate.run` | 结账阶段对盲盒 / 押金产品做组合校验，阻止非法下单 | [extensions/nuphy-checkout-validation/](extensions/nuphy-checkout-validation/) |
| `nuphy-free-gift-discount` | `cart.lines.discounts.generate.run` | 给购物车里带 `_promo_role=gift` 属性的行打 100% off，落地 BOGO 赠品 0 元结账 | [extensions/nuphy-free-gift-discount/README.md](extensions/nuphy-free-gift-discount/README.md) |

### 常用命令（仓库根）

```bash
npm install                                          # 装全部 workspace 依赖
npx shopify app build                                # 构建所有 extension 的 wasm
npx shopify app deploy                               # 部署所有 extension 到当前 App
npm --workspace <handle> run test -- --run           # 跑指定 extension 的 vitest 用例
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
