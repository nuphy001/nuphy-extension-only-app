// @ts-check
import { configuredCampaigns, matchesTrigger } from "./configuration";

/**
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} RunResult
 */

const EMPTY_RESULT = /** @type {RunResult} */ ({ operations: [] });
const GIFT_ROLE = "gift";
const FREE_PERCENTAGE = 100;
const DISCOUNT_MESSAGE = "Free Gift";

/**
 * @param {RunInput} input
 * @returns {RunResult}
 */
export function goboFreeGiftDiscountFunction(input) {
  // 缺少该店 managed 配置时停止发放折扣，不能回退到其他店铺的商品白名单。
  const binding = input.discount?.campaignBinding;
  const campaigns = configuredCampaigns(
    input.shop?.promotionMode?.value,
    input.shop?.promotionConfig?.jsonValue,
    binding,
  );
  const CAMPAIGN_BY_ID = new Map(campaigns.map(c => [c.id, c]));
  const lines = input.cart.lines;

  // 先按活动累计真实购买的主品数量，赠品行不能增加配额。
  const nonGiftProductsByVariant = new Map();
  const remainingByCampaign = new Map();
  for (const line of lines) {
    if (line.attribute?.value === GIFT_ROLE) continue;
    const variantId = line.merchandise?.id;
    if (!variantId) continue;
    const qty = line.quantity ?? 0;
    if (qty < 1) continue;
    const productId = line.merchandise?.__typename === 'ProductVariant' ? line.merchandise.product?.id : undefined;
    nonGiftProductsByVariant.set(variantId, productId);
    for (const campaign of campaigns) {
      if (matchesTrigger(campaign, variantId, productId)) {
        remainingByCampaign.set(
          campaign.id,
          (remainingByCampaign.get(campaign.id) ?? 0) + qty,
        );
      }
    }
  }

  // 四层校验：赠品标记、活动 ID、赠品规格、真实购买的合格主品。
  const cartLineTargets = [];
  for (const line of lines) {
    if (line.attribute?.value !== GIFT_ROLE) continue;

    const campaignId = line.promoIdAttr?.value;
    const campaign = campaignId ? CAMPAIGN_BY_ID.get(campaignId) : null;
    if (!campaign) continue;

    const giftVariantId = line.merchandise?.id;
    if (!giftVariantId || !campaign.giftVariantIds.has(giftVariantId)) continue;

    const mainVariantId = line.mainVariantAttr?.value;
    if (!mainVariantId || !matchesTrigger(campaign, mainVariantId, nonGiftProductsByVariant.get(mainVariantId))) continue;
    if (!nonGiftProductsByVariant.has(mainVariantId)) continue;

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
