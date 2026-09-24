# BOGO 活动管理首页

此扩展是当前 App（Client ID `872f6beb8dc7437845803205b98c1436`）的管理首页，使用 Shopify 托管的 `admin.app.home.render`。

支持活动名称、主商品变体、赠品变体、赠送数量规则、排期、启停和移除。保存后，赠品折扣函数读取店铺的 `nuphy_bonus_v2` 配置，无需为新活动修改代码。

首页按“活动名称、主商品、赠品、状态、操作”展示，主商品统计排除后的参与规格，赠品统计独立规格。商品未完整读取时显示“规格待确认”，长名称可通过提示查看全文；活动排期在编辑页查看。

配置用量统计全部已保存活动的 UTF-8 字节数，不包含未提交的草稿。未导入的旧配置和新店不会标为“已保存”。页面提示与保存校验共用 10000 字节上限，依据是 [Shopify Functions 对单个 metafield 的读取限制](https://shopify.dev/docs/apps/build/metafields/metafield-limits)。

当前 App 从页面管理活动。旧 App 的 `nuphy_bogo` 活动和折扣不会因为发布此 App 自动迁移。

`legacy-campaigns.json` 是保留的数据文件；当前管理页不读取它。实际活动以店铺保存的配置为准。

## 本地检查

- `pnpm --filter bogo-campaign-manager check:types`
- `pnpm --filter bogo-campaign-manager test`：运行全部 Vitest 测试。
- `pnpm --filter bogo-campaign-manager test:watch`：修改时自动重跑测试。
- `pnpm run build`：使用根目录 `shopify.app.toml` 构建当前 App，不发布。

## 代码与测试目录

源码使用 `.ts` / `.tsx`，测试统一放在 `src/__test__/*.test.ts`，显式导入 Vitest API。`check:types` 同时检查源码、测试和 Vitest 配置，不再跳过 JavaScript 测试的类型问题。

文件名使用小写烤串命名，如 `app-home.tsx`、`product-selection.test.ts`。`src/app-home.tsx` 是页面入口，非页面 UI 组件统一放在 `src/components`，包括产品选择、提示图标和确认弹窗；组件函数名仍按 JSX 约定使用大驼峰。

`src/utils` 按用途存放表单校验、商品选择、排期、ID、错误处理与折扣判断。页面负责交互，`api.ts` 负责请求和保存流程；分页、写入和旧折扣停用仍按原有顺序执行。

`src/types` 集中存放复用或较复杂的类型：`api.ts` 定义商品、选择器与店铺配置，`campaign.ts` 定义活动草稿、校验和页面状态，`responses.ts` 定义 GraphQL 响应，`selection.ts` 与 `components.ts` 定义组件参数。活动存储契约继续复用折扣 Function 的定义。简单局部类型和测试模拟类型保留在使用处，避免为每个函数单独建类型文件。

测试保留业务规则、输入边界、并发冲突和失败恢复场景；重复场景合并为参数化用例，不保留只约束内部调用次数的重复检查。`legacy-campaigns.json` 与本地化 JSON 仍是数据文件。

函数注释使用简短中文，说明职责、业务边界或特殊处理的原因，不逐行翻译代码。

CLI 为 App Home 生成的 UI SDK 属于 release candidate，已锁定本次构建版本。须在目标店铺发布前确认该托管首页能力可用，并验收原 checkout validation 的配置入口。新增的产品读取权限需要安装店铺批准。
