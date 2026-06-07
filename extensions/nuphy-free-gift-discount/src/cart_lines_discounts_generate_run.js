// @ts-check

/**
 * 赠品自动 100% off 折扣函数（服务端校验版 v2）
 * ----------------------------------------
 * 信任边界：本函数是结账阶段的最后防线，必须假设前端 / Storefront API 调用都可能是恶意构造。
 *
 * 触发链路：
 *   1. 前端 BOGO 引擎（src/lib/promotion/engine.ts）将赠品加入购物车时，
 *      在该行 cart line attribute 上写：
 *        _promo_role         = "gift"                  ← 首层判据
 *        _promo_id           = <campaign id>           ← 校验所属 campaign 闭包
 *        _promo_main_variant = <main variant gid>      ← 校验主品在 cart 内
 *   2. 用户进入 Shopify 结账时，Shopify 自动调用本 Function。
 *
 * 服务端 4 层校验（前任一层失败即视为非法赠品行，不打折）：
 *   1) attribute _promo_role === "gift"
 *   2) _promo_id 必须对应已配置的 campaign
 *   3) merchandise 必须是该 campaign 闭包内的合法赠品 variant
 *   4) _promo_main_variant 必须是该 campaign 的合法 trigger，且必须真实存在于
 *      cart 的非赠品行内（== 用户确实买了主品）
 *
 * 数量截断（1:1）：免单数量 = min(赠品行数量, 该 campaign 主品购买总量)。
 * 买 N 个主品最多免 N 个赠品；赠品行被改大 / 主品买得少时，多出的件数按原价收费
 * （防 risk 3：数量放大）。
 *
 * ⚠ Keep CAMPAIGNS in sync with:
 *   nuphy-headless-shop/src/lib/promotion/config.ts
 * 改动 config.ts 的 campaign 列表 / 变体 id 时，本文件需同步更新并重新部署 Function。
 */

/**
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} RunResult
 */

const EMPTY_RESULT = /** @type {RunResult} */ ({ operations: [] });
const GIFT_ROLE = "gift";
const FREE_PERCENTAGE = 100;
const DISCOUNT_MESSAGE = "Free Gift";

// ─── Campaign config（与 headless-shop config.ts 同步） ───────────────────────
// 主品：NuPhy Halo75 V2 / Halo96 V2 / Halo65 V2 全部变体
// 赠品：Free Halo V2 Exclusive Wrist Rest (Random Color)（Product 8054097412205，唯一变体）
const CAMPAIGNS = [
  {
    id: "bogo-product-accessory-2026",
    triggerVariantIds: new Set([
      // NuPhy Halo75 V2 (Product 7193319899245) — 22 variants
      "gid://shopify/ProductVariant/43556083499117",
      "gid://shopify/ProductVariant/41037253804141",
      "gid://shopify/ProductVariant/45054166040685",
      "gid://shopify/ProductVariant/41037254066285",
      "gid://shopify/ProductVariant/45054167580781",
      "gid://shopify/ProductVariant/43556083531885",
      "gid://shopify/ProductVariant/41037257277549",
      "gid://shopify/ProductVariant/41037257408621",
      "gid://shopify/ProductVariant/41037257539693",
      "gid://shopify/ProductVariant/43556083564653",
      "gid://shopify/ProductVariant/41037257932909",
      "gid://shopify/ProductVariant/41037258063981",
      "gid://shopify/ProductVariant/41037258195053",
      "gid://shopify/ProductVariant/41037258326125",
      "gid://shopify/ProductVariant/43556083597421",
      "gid://shopify/ProductVariant/41037258588269",
      "gid://shopify/ProductVariant/41037258719341",
      "gid://shopify/ProductVariant/41037258850413",
      "gid://shopify/ProductVariant/41037258981485",
      "gid://shopify/ProductVariant/43556083630189",
      "gid://shopify/ProductVariant/44318570512493",
      "gid://shopify/ProductVariant/45054163386477",
      // NuPhy Halo96 V2 (Product 7296925237357) — 20 variants
      "gid://shopify/ProductVariant/43556102996077",
      "gid://shopify/ProductVariant/44425538666605",
      "gid://shopify/ProductVariant/43556103028845",
      "gid://shopify/ProductVariant/45054140022893",
      "gid://shopify/ProductVariant/45054139859053",
      "gid://shopify/ProductVariant/45054137401453",
      "gid://shopify/ProductVariant/43556103061613",
      "gid://shopify/ProductVariant/41305839337581",
      "gid://shopify/ProductVariant/41305838977133",
      "gid://shopify/ProductVariant/41305839140973",
      "gid://shopify/ProductVariant/41305839501421",
      "gid://shopify/ProductVariant/43556103094381",
      "gid://shopify/ProductVariant/41305840025709",
      "gid://shopify/ProductVariant/41305839665261",
      "gid://shopify/ProductVariant/41305839861869",
      "gid://shopify/ProductVariant/41305840189549",
      "gid://shopify/ProductVariant/43556103127149",
      "gid://shopify/ProductVariant/41305840713837",
      "gid://shopify/ProductVariant/41305840353389",
      "gid://shopify/ProductVariant/41305840517229",
      // NuPhy Halo65 V2 (Product 7351299604589) — 20 variants
      "gid://shopify/ProductVariant/41414603243629",
      "gid://shopify/ProductVariant/41414603407469",
      "gid://shopify/ProductVariant/41414603604077",
      "gid://shopify/ProductVariant/41414603767917",
      "gid://shopify/ProductVariant/41414602588269",
      "gid://shopify/ProductVariant/41414602752109",
      "gid://shopify/ProductVariant/41414602915949",
      "gid://shopify/ProductVariant/41414603079789",
      "gid://shopify/ProductVariant/41414603931757",
      "gid://shopify/ProductVariant/41414604095597",
      "gid://shopify/ProductVariant/41414604259437",
      "gid://shopify/ProductVariant/41414604423277",
      "gid://shopify/ProductVariant/41414604587117",
      "gid://shopify/ProductVariant/41414604750957",
      "gid://shopify/ProductVariant/41414604914797",
      "gid://shopify/ProductVariant/41414605078637",
      "gid://shopify/ProductVariant/41414605242477",
      "gid://shopify/ProductVariant/41414605406317",
      "gid://shopify/ProductVariant/41414605570157",
      "gid://shopify/ProductVariant/41414605766765",
    ]),
    giftVariantIds: new Set([
      // Free Halo V2 Exclusive Wrist Rest (Random Color) (Product 8054097412205)
      "gid://shopify/ProductVariant/45055271043181",
    ]),
  },
];

const CAMPAIGN_BY_ID = new Map(CAMPAIGNS.map((c) => [c.id, c]));

/**
 * @param {RunInput} input
 * @returns {RunResult}
 */
export function goboFreeGiftDiscountFunction(input) {
  const lines = input.cart.lines;

  // 单次遍历非赠品行：
  //   nonGiftVariantIds   —— 「主品在 cart 内」校验（4b）用
  //   remainingByCampaign —— 每个 campaign 的免单配额 = 该 campaign 全部 trigger variant
  //                          在非赠品行内的 quantity 之和（即用户实际买了几个主品）
  const nonGiftVariantIds = new Set();
  const remainingByCampaign = new Map();
  for (const line of lines) {
    if (line.attribute?.value === GIFT_ROLE) continue;
    const variantId = line.merchandise?.id;
    if (!variantId) continue;
    nonGiftVariantIds.add(variantId);
    const qty = line.quantity ?? 0;
    if (qty < 1) continue;
    for (const campaign of CAMPAIGNS) {
      if (campaign.triggerVariantIds.has(variantId)) {
        remainingByCampaign.set(
          campaign.id,
          (remainingByCampaign.get(campaign.id) ?? 0) + qty,
        );
      }
    }
  }

  // 4 层校验，全部通过才发折扣
  const cartLineTargets = [];
  for (const line of lines) {
    // 校验 1：必须挂 _promo_role=gift
    if (line.attribute?.value !== GIFT_ROLE) continue;

    // 校验 2：必须声明合法的所属 campaign
    const campaignId = line.promoIdAttr?.value;
    const campaign = campaignId ? CAMPAIGN_BY_ID.get(campaignId) : null;
    if (!campaign) continue;

    // 校验 3：merchandise 必须是该 campaign 内的合法赠品 variant
    const giftVariantId = line.merchandise?.id;
    if (!giftVariantId || !campaign.giftVariantIds.has(giftVariantId)) continue;

    // 校验 4a：声明的主品 variant 必须是该 campaign 的合法 trigger
    const mainVariantId = line.mainVariantAttr?.value;
    if (!mainVariantId || !campaign.triggerVariantIds.has(mainVariantId)) continue;

    // 校验 4b：该主品必须真实存在于购物车的非赠品行（防只用赠品创建 cart）
    if (!nonGiftVariantIds.has(mainVariantId)) continue;

    // 数量截断（1:1）：免单数 = min(赠品行数量, 该 campaign 剩余主品配额)。
    // 攻击者把赠品行 qty 改大、或主品买得少时，只对配额内的件数免单，其余原价。
    const remaining = remainingByCampaign.get(campaign.id) ?? 0;
    const allowed = Math.min(line.quantity ?? 0, remaining);
    if (allowed < 1) continue;
    remainingByCampaign.set(campaign.id, remaining - allowed);

    cartLineTargets.push({
      cartLine: {
        id: line.id,
        quantity: allowed,
      },
    });
  }

  if (cartLineTargets.length === 0) return EMPTY_RESULT;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              targets: cartLineTargets,
              value: {
                percentage: {
                  value: FREE_PERCENTAGE,
                },
              },
              message: DISCOUNT_MESSAGE,
            },
          ],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
