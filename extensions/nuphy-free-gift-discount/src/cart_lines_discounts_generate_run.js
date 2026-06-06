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
 * 数量截断：通过输出端 cartLine.quantity = 1 限定，只对该行 1 件打 100% off，
 * 其余件数原价（防 risk 3：数量放大）。
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
// 赠品：Wrist Rest for QMK（唯一变体）
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
      // Wrist Rest for QMK (Product 8051326419053)
      "gid://shopify/ProductVariant/45048753029229",
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

  // 收集购物车内所有非赠品行的 variant id，用于「主品在 cart 内」校验
  const nonGiftVariantIds = new Set();
  for (const line of lines) {
    if (line.attribute?.value === GIFT_ROLE) continue;
    const variantId = line.merchandise?.id;
    if (variantId) nonGiftVariantIds.add(variantId);
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

    // 通过 → 输出 target，quantity:1 截断防数量放大
    cartLineTargets.push({
      cartLine: {
        id: line.id,
        quantity: 1,
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
