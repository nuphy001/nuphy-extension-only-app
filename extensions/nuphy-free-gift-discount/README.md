# nuphy-free-gift-discount

Shopify Discount Function 扩展，为购物车中带 `_promo_role=gift` 属性的行自动打 100% off，实现「赠品 0 元结账」。

本扩展是 BOGO（买一送一）MVP 的服务端落地点，与 Next.js 端前端引擎（`src/lib/promotion/engine.ts`）配合工作。

---

## 背景与决策

> 本扩展是主 PRD `murphy-docs/买赠系统产品需求文档.docx` → MVP 实施计划 `docx-mvp-cozy-pie.md` → **决策 1（方案 B）** 的代码产物。

### 为什么需要这个 Function

Shopify Storefront API 不允许把 line item 价格改为 $0。前端 Next.js 端只能负责「识别触发主品、自动追加赠品行、给赠品行打 `_promo_*` 属性、UI 显示 Free Gift / 锁定 qty / 显示 $0」。

**真正在结账时把赠品价格归零，必须靠 Shopify 服务端**——而 Shopify 提供的合法机制只有 Discount Function。

### 候选方案评估

| 方案 | 评估 |
| --- | --- |
| ~~A. Shopify Admin 自动折扣（行属性匹配 `_promo_role==gift`）~~ | ❌ 不可行。Admin 折扣界面不支持按行属性配置 |
| **B. Shopify Discount Function**（本扩展） | ✅ 完全可控、属性匹配一定支持、与前端属性标记天然契合 |
| ~~C. 自建中间层后端改价~~ | ❌ 不可行。Storefront API 的 line 价格只读 |

### 为什么挂在本 App 而不是新建 App

本 App `nuphy-extension-only-app` 已经：
- 安装授权到生产店铺（`client_id = "1dfa5ac4c1e95115a158b547c4228540"`）
- 含一个 Cart Validation Function 扩展 `nuphy-checkout-validation`
- 使用 `workspaces: ["extensions/*"]`，多 extension 共存

Shopify 一个 App 可挂多个 extension，类型互不冲突。本扩展的 target `cart.lines.discounts.generate.run` 与现有 `cart.validations.generate.run` 是不同 Function 类型，**完全可以共存**。复用现有 App 省去重新创建 / 重新授权 / 客户端 ID 切换的运营成本。

---

## 与前端的契约

前端 BOGO 引擎将赠品加入购物车时，在该行 cart line attribute 上打 **3 类便利贴**：

| Attribute key | 取值 | 由谁读 |
| --- | --- | --- |
| `_promo_role` | `"gift"` | **本 Function（唯一判据）** |
| `_promo_id` | `<campaign id>`，如 `"bogo-air75-wristrest-2026"` | 前端引擎 / 订单事后排查用 |
| `_promo_main` | `<main variant id>` | 前端引擎做"孤儿赠品"清理用 |

> 本 Function **只读 `_promo_role`**——校验主品/活动归属由前端引擎负责。这样可以把 Function input payload 控到最小，规避 Function 执行配额。
>
> 若前端未来将 `"gift"` 改名（例如 `"free_gift"`），需同步修改本扩展的 `GIFT_ROLE` 常量。这是本 Function 与前端引擎之间唯一的「契约字段」。

---

## 文件结构

```
nuphy-free-gift-discount/
├── shopify.extension.toml                                # extension 配置（api_version、target、export）
├── package.json                                          # workspace 包，依赖 @shopify/shopify_function + vitest
├── vite.config.js                                        # 空注释，阻断父级 Remix vite 继承
├── schema.graphql                                        # 由 `shopify app function schema` 自动拉取
├── locales/en.default.json                               # extension 显示名（toml 用 t:name 引用）
├── src/
│   ├── index.js                                          # 转发导出
│   ├── cart_lines_discounts_generate_run.graphql        # 查询：line.id + _promo_role attribute
│   ├── cart_lines_discounts_generate_run.js             # 折扣逻辑（纯函数）
│   └── cart_lines_discounts_generate_run.test.js        # 7 条 vitest 用例
├── generated/                                            # 由 `npm run typegen` 自动生成
│   └── api.ts
└── dist/                                                 # 由 `shopify app build` 自动生成
    ├── function.js
    └── function.wasm
```

`schema.graphql` / `generated/` / `dist/` 通常由 `.gitignore` 管理。

---

## 折扣逻辑（核心代码）

文件：[src/cart_lines_discounts_generate_run.js](src/cart_lines_discounts_generate_run.js)

```js
const GIFT_ROLE = "gift";

export function cartLinesDiscountsGenerateRun(input) {
  const targets = input.cart.lines
    .filter((line) => line.attribute?.value === GIFT_ROLE)
    .map((line) => ({ cartLineTarget: { id: line.id, quantity: null } }));

  if (targets.length === 0) return { operations: [] };

  return {
    operations: [{
      productDiscountsAdd: {
        candidates: [{
          message: "Free Gift",
          targets,
          value: { percentage: { value: 100 } },
        }],
        selectionStrategy: "FIRST",
      },
    }],
  };
}
```

### 关键决策

- **`quantity: null`** = 把这一行所有数量都打折（赠品行 quantity 恒为 1，写 `null` 是 Shopify 2025-07 推荐的"整行"写法）
- **`selectionStrategy: "FIRST"`** = 多 candidate 时按声明顺序取第一个；本函数只产出一条 candidate，"FIRST" 等价于「就用它」
- **`message: "Free Gift"`** = 折扣在结账页面 line item 旁的显示名（用户可见的"凭据"）
- **不依赖配置常量、不读 metafield、不区分 production/test** —— 行属性是唯一判据

---

## 本地开发

### 安装依赖

```bash
# 在仓库根
cd /Users/murphy/source-code/wp-front/nuphy-extension-only-app
npm install
```

### 跑单测

```bash
npm --workspace nuphy-free-gift-discount run test -- --run
```

预期：7 条用例全绿（涵盖空车、无属性、其它属性、单 gift、主品+gift、多 gift、混合 4 种属性）。

### 拉 schema / 生成类型 / 构建 wasm

```bash
# 拉取 target 对应的 GraphQL schema（首次或 API 升级时跑一次）
npx shopify app function schema --path=extensions/nuphy-free-gift-discount

# 从 schema + *.graphql 生成 generated/api.ts（IDE 类型补全用）
npm --workspace nuphy-free-gift-discount run typegen

# 把整个 App（含两个 extension）build 成 wasm
npx shopify app build
```

构建产物：[dist/function.wasm](dist/function.wasm)。

---

## 部署到 Shopify

> 本扩展属于 App `nuphy-extension-only-app`，已安装授权到生产店铺。新增 extension 不需要重新安装，CLI deploy 会自动上线。

### 阶段 1：deploy Function

```bash
cd /Users/murphy/source-code/wp-front/nuphy-extension-only-app
npx shopify app deploy
```

CLI 会要求确认"这次 deploy 会新增 `nuphy-free-gift-discount` extension"，按 `y` 确认。

### 阶段 2：在 Shopify Admin 创建自动折扣

```
Shopify Admin
 → 折扣 (Discounts)
 → 创建折扣 (Create discount)
 → 应用折扣 (App-powered) ← 选这个
 → 选择 "nuphy-free-gift-discount" function
 → 类型：自动 (Automatic) 而不是 折扣码 (Code)
 → 标题：Free Gift
 → 不要设最低消费、不要设结束日期（或按运营需要设）
 → 保存并激活
```

启用后，结账时 Shopify 引擎会对每个购物车自动调用本 Function，匹配的行价格归零。

### 阶段 3：上线 Checklist

按顺序执行，每步可独立回滚：

1. ☐ Function 已 `shopify app deploy` 到目标店
2. ☐ Shopify Admin 已创建并激活自动折扣（用上一步的 Function）
3. ☐ 在 Preview URL 验证一次：加触发品 → 看到 Free Gift → 结账页面赠品价格 $0
4. ☐ Next.js 端 `promotionConfig.campaigns[*].enabled` 翻 `true`，提 PR 合入 main
5. ☐ Vercel 自动 deploy 到 Production
6. ☐ Smoke test 生产链路

---

## 回滚策略

| 想关掉哪一面 | 怎么做 | 影响 |
| --- | --- | --- |
| 暂停 BOGO 活动但保留 Function | Next.js 端 `config.ts` 把 campaign `enabled` 改回 `false` | 引擎不再加赠品；旧购物车里已有的赠品在下一次操作时被引擎清掉 |
| 暂停折扣但保留前端送赠品 | Admin → 折扣 → 暂停该自动折扣 | 赠品仍加入购物车，但结账时**不再归零**，用户看到原价。⚠️ **不要在生产用这种状态** |
| 完全下线 Function | 删除整个 `extensions/nuphy-free-gift-discount/` 目录，再 `npx shopify app deploy` | CLI 上报"移除该 extension"，Admin 端折扣自动失效 |

---

## 风险与已知边界

| 风险 | 应对 |
| --- | --- |
| 与现有 `nuphy-checkout-validation` 字段冲突 | 不会。target 不同、目录隔离、`shopify.app.toml` 不变 |
| `uid` 字段冲突 | **不要手工写** `uid`，由 CLI 在首次 deploy 或拉 schema 时自动回填 |
| `generated/api.ts` 缺失导致 IDE 报红 | 跑 `npm run typegen` 即可；`shopify app build` 也会自动生成 |
| 本次合入即生效"赠品归零"造成误归零 | 不会。Function 部署后还需要在 Shopify Admin 手动创建并激活该自动折扣 |

---

## 参考

- 主 PRD：`murphy-docs/买赠系统产品需求文档.docx`
- MVP 实施计划：`docx-mvp-cozy-pie.md` —— 决策 1（方案 B）
- 本扩展执行计划：[users-murphy-claude-plans-docx-mvp-cozy-recursive-puzzle.md](https://example.invalid/) （归档在 `~/.claude/plans/`）
- Shopify 文档：
  - [Cart and Checkout Discount Function API](https://shopify.dev/docs/api/functions/reference/cart-lines-discounts-generate-run)
  - [Function `cartLineTarget` schema](https://shopify.dev/docs/api/functions/reference/cart-lines-discounts-generate-run/graphql/cartlinetarget)
