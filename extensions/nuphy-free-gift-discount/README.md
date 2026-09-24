# 赠品折扣 Function

本扩展由 Shopify 托管，在结账时为符合活动规则的赠品行计算折扣。当前实现见 [managed_campaign_discount.js](src/managed_campaign_discount.js)，输入字段见 [查询文件](src/cart_lines_discounts_generate_run.graphql)。

## 折扣依据

当前源码的管理页把活动保存到店铺的 `nuphy_bogo.campaigns`，折扣记录通过 `nuphy_bogo.campaign` 绑定活动。Function 只处理已启用页面管理、配置和绑定都有效的活动，不回退到源码内置规则。NuPhyX 此前的 3 个 `nuphy_bonus_v2` 活动已由店铺方删除，相关原生折扣已过期，本次不迁移。

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

`pnpm run deploy` 使用 `shopify.app.toml` 发布当前 App（Client ID `872f6beb8dc7437845803205b98c1436`）。这个 App 的所有安装店铺会同步收到新版本；该命令不会迁移店铺 metafield 或已有折扣的活动绑定。

当前无法在 NuPhyX 运行 `app dev`：它虽被 `shopify store list` 标为 `dev`，但未出现在 Dev Dashboard 店铺列表；指定该店后，CLI 报 `Could not find store`。Shopify 目前仅支持对 Dev Dashboard 创建的店铺运行此命令。[Shopify 工作人员说明](https://community.shopify.dev/t/shopify-app-dev-doesnt-work-with-plus-development-stores/23471/2)

2026-09-24，当前 App 版本 `nuphy-bonus-5` 已发布到当时唯一安装该 App 的 NuPhyX。本地 NuPhyX 无头店铺的四活动同车测试进入真实 Checkout：四件赠品均为 FREE，Air75 主品保留 20% 折扣，合计 $490.90；已选 canonical Node100 单测的赠品也为 FREE。此前将 78 个规格跨字段重复表达导致指令预算故障；当前配置为 2863 字节，一次成功执行日志记录 9,257,536/11,000,000 条指令。

无头前端的排期修复仍只在本地分支，尚未部署；NuPhy 正式店也未发布当前 App。旧 App 已由店铺方删除，但不能据此认定旧配置已清除。后续结账验证仍须核对实际触发的折扣与赠品 `_promo_id`。
