# 赠品折扣 Function

本扩展由 Shopify 托管，在结账时为符合活动规则的赠品行计算折扣。当前实现见 [managed_campaign_discount.js](src/managed_campaign_discount.js)，输入字段见 [查询文件](src/cart_lines_discounts_generate_run.graphql)。

## 折扣依据

管理页把活动保存到店铺的 `nuphy_bonus_v2.campaigns`，折扣记录通过 `nuphy_bonus_v2.campaign` 绑定活动。Function 只处理已启用页面管理、配置和绑定都有效的活动，不回退到旧 App 的源码规则。

赠品行必须带 `_promo_role=gift` 和匹配的 `_promo_id`，商品规格必须属于该活动的赠品。`_promo_main_variant` 还须指向购物车中真实购买、符合活动规则的主品规格。折扣数量以主品购买数量为上限；没有符合条件的行时，Function 不返回折扣。

## 本地检查

在仓库根目录运行：

```bash
pnpm --filter nuphy-free-gift-discount test --run
pnpm run validate
pnpm run build
```

`validate` 和 `build` 都使用根目录的 `shopify.app.toml`，只校验和构建，不发布。完整的测试与发布流程见 [项目 README](../../README.md)。

## 发布范围

`pnpm run deploy` 使用 `shopify.app.toml` 发布当前 App（Client ID `872f6beb8dc7437845803205b98c1436`）。这个 App 的所有安装店铺会同步收到新版本。NuPhy 现有折扣属于另一个旧共享 App；本命令不会更新旧 App，也不会迁移旧折扣。

当前无法在 NuPhyX 运行 `app dev`：它虽被 `shopify store list` 标为 `dev`，但未出现在 Dev Dashboard 店铺列表；指定该店后，CLI 报 `Could not find store`。Shopify 目前仅支持对 Dev Dashboard 创建的店铺运行此命令。[Shopify 工作人员说明](https://community.shopify.dev/t/shopify-app-dev-doesnt-work-with-plus-development-stores/23471/2)

当前 App 的页面、Function 和结账效果尚未在 NuPhyX 完整实测。旧共享 App 的折扣仍在店内，看到赠品价格变化时，需核对是哪一个 App 的折扣生效。正式发布前还须核对当前 App 的安装范围。
