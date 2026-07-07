// @ts-check

// NuPhyX test-store implementation. Replace campaign Variant GIDs with NuPhyX GIDs here.

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
 * 多 campaign 并存：各 campaign 的配额相互独立，互不干扰。
 * 例：购物车里同时有 Air V3 + Node → Air V3 campaign 送手托、Node campaign 独立送手托，共 2 个。
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
const CAMPAIGNS = [
  // 键帽 赠品🎁 Free Summer Keycaps (2026) ───────────────
  {
    id: "bogo-nuphyx-test",
    triggerVariantIds: new Set([
      // NuPhy Halo IO Series
        'gid://shopify/ProductVariant/49965619839216', // NuPhy Halo IO Series / 75 / Ionic White / Red Max
        'gid://shopify/ProductVariant/49965619871984', // NuPhy Halo IO Series / 75 / Ionic White / Brown Max
        'gid://shopify/ProductVariant/49965619904752', // NuPhy Halo IO Series / 75 / Ionic White / Blush Max
        'gid://shopify/ProductVariant/49965619937520', // NuPhy Halo IO Series / 75 / Obsidian Black / Red Max
        'gid://shopify/ProductVariant/49965619970288', // NuPhy Halo IO Series / 75 / Obsidian Black / Brown Max
        'gid://shopify/ProductVariant/49965620003056', // NuPhy Halo IO Series / 75 / Obsidian Black / Blush Max
        'gid://shopify/ProductVariant/49965620035824', // NuPhy Halo IO Series / 75 / Sakura Fizz / Red Max
        'gid://shopify/ProductVariant/49965620068592', // NuPhy Halo IO Series / 75 / Sakura Fizz / Brown Max
        'gid://shopify/ProductVariant/49965620101360', // NuPhy Halo IO Series / 75 / Sakura Fizz / Blush Max
        'gid://shopify/ProductVariant/49965620134128', // NuPhy Halo IO Series / 96 / Ionic White / Red Max
        'gid://shopify/ProductVariant/49965620166896', // NuPhy Halo IO Series / 96 / Ionic White / Brown Max
        'gid://shopify/ProductVariant/49965620199664', // NuPhy Halo IO Series / 96 / Ionic White / Blush Max
        'gid://shopify/ProductVariant/49965620232432', // NuPhy Halo IO Series / 96 / Obsidian Black / Red Max
        'gid://shopify/ProductVariant/49965620265200', // NuPhy Halo IO Series / 96 / Obsidian Black / Brown Max
        'gid://shopify/ProductVariant/49965620297968', // NuPhy Halo IO Series / 96 / Obsidian Black / Blush Max
        'gid://shopify/ProductVariant/49965620330736', // NuPhy Halo IO Series / 96 / Sakura Fizz / Red Max
        'gid://shopify/ProductVariant/49965620363504', // NuPhy Halo IO Series / 96 / Sakura Fizz / Brown Max
        'gid://shopify/ProductVariant/49965620396272', // NuPhy Halo IO Series / 96 / Sakura Fizz / Blush Max
        'gid://shopify/ProductVariant/49965620429040', // NuPhy Halo IO Series / 65 / Ionic White / Red Max
        'gid://shopify/ProductVariant/49965620461808', // NuPhy Halo IO Series / 65 / Ionic White / Brown Max
        'gid://shopify/ProductVariant/49965620494576', // NuPhy Halo IO Series / 65 / Ionic White / Blush Max
        'gid://shopify/ProductVariant/49965620527344', // NuPhy Halo IO Series / 65 / Obsidian Black / Red Max
        'gid://shopify/ProductVariant/49965620560112', // NuPhy Halo IO Series / 65 / Obsidian Black / Brown Max
        'gid://shopify/ProductVariant/49965620592880', // NuPhy Halo IO Series / 65 / Obsidian Black / Blush Max
        'gid://shopify/ProductVariant/49965620625648', // NuPhy Halo IO Series / 65 / Sakura Fizz / Red Max
        'gid://shopify/ProductVariant/49965620658416', // NuPhy Halo IO Series / 65 / Sakura Fizz / Brown Max
        'gid://shopify/ProductVariant/49965620691184', // NuPhy Halo IO Series / 65 / Sakura Fizz / Blush Max
    ]),
    giftVariantIds: new Set([
     'gid://shopify/ProductVariant/49956279877872',
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
