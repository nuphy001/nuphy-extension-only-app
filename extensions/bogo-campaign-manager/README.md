# BOGO 活动管理首页

此扩展位于原 BOGO app 内，使用 Shopify 托管的 `admin.app.home.render`。

支持活动名称、主商品变体、赠品变体、原有赠送数量规则、启停和移除。保存后商城与折扣函数读取同一份 `nuphy_bogo` 店铺 metafields，无需为新活动修改代码。

首次发布两端代码后，在页面核对当前店铺与旧活动导入预览，再点击“导入并启用页面管理”。导入之前两端保持原有源码配置。完整切换流程见商城项目的 `docs/bogo-management.md`。

配置文件 `legacy-campaigns.json` 是一次性迁移快照，来自商城生产与测试配置；导入后不再用于管理活动。JSON 仅保存数字字符串形式的变体 ID，不保存商品名称和图片，页面按需从 Shopify 读取。

## 本地检查

- `pnpm --filter bogo-campaign-manager check:types`
- `pnpm build:test`
- `pnpm build:production`

CLI 为 App Home 生成的 UI SDK 属于 release candidate，已锁定本次构建版本。须在目标店铺发布前确认该托管首页能力可用，并验收原 checkout validation 的配置入口。新增的产品读取权限需要安装店铺批准。
