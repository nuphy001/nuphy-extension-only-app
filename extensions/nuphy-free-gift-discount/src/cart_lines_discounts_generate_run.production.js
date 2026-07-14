// @ts-check

// Production-store implementation. Keep production Variant GIDs in this file only.

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
    id: "bogo-QMK-Keycaps-2026-0708",
    triggerVariantIds: new Set([
        // NuPhy Air75 V2
        'gid://shopify/ProductVariant/40677451399277', // Lunar Gray / Blue 2.0
        'gid://shopify/ProductVariant/40635217674349', // Lunar Gray / Aloe (37gf)
        'gid://shopify/ProductVariant/40635217739885', // Lunar Gray / Wisteria (55gf)
        'gid://shopify/ProductVariant/40635217805421', // Lunar Gray / Moss (60gf)
        'gid://shopify/ProductVariant/40635218034797', // Lunar Gray / Red 2.0
        'gid://shopify/ProductVariant/40635218067565', // Lunar Gray / Brown 2.0
        'gid://shopify/ProductVariant/40635217707117', // Lunar Gray / Cowberry (45gf)
        'gid://shopify/ProductVariant/40677451497581', // Ionic White / Blue 2.0
        'gid://shopify/ProductVariant/40635217838189', // Ionic White / Aloe (37gf)
        'gid://shopify/ProductVariant/40635217903725', // Ionic White / Wisteria (55gf)
        'gid://shopify/ProductVariant/40635217969261', // Ionic White / Moss (60gf)
        'gid://shopify/ProductVariant/40671476744301', // Basalt Black / Aloe (37gf)
        'gid://shopify/ProductVariant/45054112366701', // Basalt Black / Wisteria (55gf)
        'gid://shopify/ProductVariant/40671477039213', // Basalt Black / Moss (60gf)
        'gid://shopify/ProductVariant/45054113972333', // Basalt Black / Cowberry (45gf)
        // NuPhy Air96 V2
        'gid://shopify/ProductVariant/40735416025197', // Lunar Gray / Blue 2.0
        'gid://shopify/ProductVariant/40735416123501', // Lunar Gray / Aloe (37gf)
        'gid://shopify/ProductVariant/40735415828589', // Lunar Gray / Red 2.0
        'gid://shopify/ProductVariant/45054125408365', // Lunar Gray / Wisteria (55gf)
        'gid://shopify/ProductVariant/45054125441133', // Lunar Gray / Cowberry (45gf)
        'gid://shopify/ProductVariant/40735414648941', // Ionic White / Blue 2.0
        'gid://shopify/ProductVariant/40735415042157', // Ionic White / Moss (60gf)
        'gid://shopify/ProductVariant/45370113589357', // Lunar Gray / Moss (60gf)
        'gid://shopify/ProductVariant/45054126293101', // Ionic White / Aloe (37gf)
        'gid://shopify/ProductVariant/45054126325869', // Ionic White / Wisteria (55gf)
        'gid://shopify/ProductVariant/45054126358637', // Ionic White / Cowberry (45gf)
        'gid://shopify/ProductVariant/40735415337069', // Basalt Black / Blue 2.0
        'gid://shopify/ProductVariant/40735415730285', // Basalt Black / Moss (60gf)
        'gid://shopify/ProductVariant/40735415435373', // Basalt Black / Aloe (37gf)
        // NuPhy Air60 V2
        'gid://shopify/ProductVariant/40715867750509', // Ionic White / Red 2.0
        'gid://shopify/ProductVariant/40715867848813', // Ionic White / Brown 2.0
        'gid://shopify/ProductVariant/40715867947117', // Ionic White / Blue 2.0
        'gid://shopify/ProductVariant/40715868045421', // Ionic White / Aloe (37gf)
        'gid://shopify/ProductVariant/40715868143725', // Ionic White / Cowberry (45gf)
        'gid://shopify/ProductVariant/45053840785517', // Basalt Black / Cowberry (45gf)
        'gid://shopify/ProductVariant/40715868242029', // Ionic White / Wisteria (55gf)
        'gid://shopify/ProductVariant/40715868340333', // Ionic White / Moss (60gf)
        'gid://shopify/ProductVariant/40715868536941', // Basalt Black / Brown 2.0
        'gid://shopify/ProductVariant/40715868635245', // Basalt Black / Blue 2.0
        'gid://shopify/ProductVariant/40715868733549', // Basalt Black / Aloe (37gf)
        'gid://shopify/ProductVariant/40715868930157', // Basalt Black / Wisteria (55gf)
        'gid://shopify/ProductVariant/40715869028461', // Basalt Black / Moss (60gf)
        'gid://shopify/ProductVariant/40715869126765', // Lunar Gray / Red 2.0
        'gid://shopify/ProductVariant/40715869225069', // Lunar Gray / Brown 2.0
        'gid://shopify/ProductVariant/40715869323373', // Lunar Gray / Blue 2.0
        'gid://shopify/ProductVariant/40715869421677', // Lunar Gray / Aloe (37gf)
        'gid://shopify/ProductVariant/40715869519981', // Lunar Gray / Cowberry (45gf)
        'gid://shopify/ProductVariant/40715869618285', // Lunar Gray / Wisteria (55gf)
        'gid://shopify/ProductVariant/40715869716589', // Lunar Gray / Moss (60gf)
    ]),
    giftVariantIds: new Set([
     'gid://shopify/ProductVariant/45378325839981', // Default Title
    ]),
  },

  //手托  赠品🎁 New Free Halo V2 Exclusive Wrist Rest (Random Color) ───────────────
  {
    id: "bogo-QMK-2026-0708",
    triggerVariantIds: new Set([
        // NuPhy Halo96 V2
        'gid://shopify/ProductVariant/43556102996077', // Ionic White / Blush (42gf)
        'gid://shopify/ProductVariant/44425538666605', // Ionic White / Lemon (55gf)
        'gid://shopify/ProductVariant/43556103028845', // Obsidian Black / Blush (42gf)
        'gid://shopify/ProductVariant/45054140022893', // Obsidian Black / Lemon (55gf)
        'gid://shopify/ProductVariant/45054139859053', // Obsidian Black / Mint (37gf)
        'gid://shopify/ProductVariant/45054137401453', // Obsidian Black / Raspberry (46gf)
        'gid://shopify/ProductVariant/43556103061613', // Mojito / Blush (42gf)
        'gid://shopify/ProductVariant/41305839337581', // Mojito / Lemon (55gf)
        'gid://shopify/ProductVariant/41305838977133', // Mojito / Mint (37gf)
        'gid://shopify/ProductVariant/41305839140973', // Mojito / Raspberry (46gf)
        'gid://shopify/ProductVariant/41305839501421', // Mojito / Silent Red Clear-Top (45gf)
        'gid://shopify/ProductVariant/43556103094381', // Blue Lagoon / Blush (42gf)
        'gid://shopify/ProductVariant/41305840025709', // Blue Lagoon / Lemon (55gf)
        'gid://shopify/ProductVariant/41305839665261', // Blue Lagoon / Mint (37gf)
        'gid://shopify/ProductVariant/41305839861869', // Blue Lagoon / Raspberry (46gf)
        'gid://shopify/ProductVariant/41305840189549', // Blue Lagoon / Silent Red Clear-Top (45gf)
        'gid://shopify/ProductVariant/43556103127149', // Sakura Fizz / Blush (42gf)
        'gid://shopify/ProductVariant/41305840713837', // Sakura Fizz / Lemon (55gf)
        'gid://shopify/ProductVariant/41305840353389', // Sakura Fizz / Mint (37gf)
        'gid://shopify/ProductVariant/41305840517229', // Sakura Fizz / Raspberry (46gf)
        // NuPhy Halo75 V2
        'gid://shopify/ProductVariant/43556083499117', // Ionic White / Blush (42gf)
        'gid://shopify/ProductVariant/41037253804141', // Obsidian Black / Mint (37gf)
        'gid://shopify/ProductVariant/45054166040685', // Ionic White / Mint (37gf)
        'gid://shopify/ProductVariant/41037254066285', // Obsidian Black / Lemon (55gf)
        'gid://shopify/ProductVariant/45054167580781', // Ionic White / Lemon (55gf)
        'gid://shopify/ProductVariant/43556083531885', // Obsidian Black / Blush (42gf)
        'gid://shopify/ProductVariant/41037257277549', // Mojito / Mint (37gf)
        'gid://shopify/ProductVariant/41037257408621', // Mojito / Raspberry (46gf)
        'gid://shopify/ProductVariant/41037257539693', // Mojito / Lemon (55gf)
        'gid://shopify/ProductVariant/43556083564653', // Mojito / Blush (42gf)
        'gid://shopify/ProductVariant/41037257932909', // Blue Lagoon / Mint (37gf)
        'gid://shopify/ProductVariant/41037258063981', // Blue Lagoon / Raspberry (46gf)
        'gid://shopify/ProductVariant/41037258195053', // Blue Lagoon / Lemon (55gf)
        'gid://shopify/ProductVariant/41037258326125', // Blue Lagoon / Silent Red Clear-Top (45gf)
        'gid://shopify/ProductVariant/43556083597421', // Blue Lagoon / Blush (42gf)
        'gid://shopify/ProductVariant/41037258588269', // Sakura Fizz / Mint (37gf)
        'gid://shopify/ProductVariant/41037258719341', // Sakura Fizz / Raspberry (46gf)
        'gid://shopify/ProductVariant/41037258850413', // Sakura Fizz / Lemon (55gf)
        'gid://shopify/ProductVariant/41037258981485', // Sakura Fizz / Silent Red Clear-Top (45gf)
        'gid://shopify/ProductVariant/43556083630189', // Sakura Fizz / Blush (42gf)
        'gid://shopify/ProductVariant/44318570512493', // Obsidian Black / Raspberry (46gf)
        'gid://shopify/ProductVariant/45054163386477', // Ionic White / Raspberry (46gf)
        // NuPhy Halo65 V2
        'gid://shopify/ProductVariant/41414603243629', // Ionic White / Mint (37gf)
        'gid://shopify/ProductVariant/41414603407469', // Ionic White / Raspberry (46gf)
        'gid://shopify/ProductVariant/41414603604077', // Ionic White / Lemon (55gf)
        'gid://shopify/ProductVariant/41414603767917', // Ionic White / Blush (42gf)
        'gid://shopify/ProductVariant/41414602588269', // Obsidian Black / Mint (37gf)
        'gid://shopify/ProductVariant/41414602752109', // Obsidian Black / Raspberry (46gf)
        'gid://shopify/ProductVariant/41414602915949', // Obsidian Black / Lemon (55gf)
        'gid://shopify/ProductVariant/41414603079789', // Obsidian Black / Blush (42gf)
        'gid://shopify/ProductVariant/41414603931757', // Mojito / Mint (37gf)
        'gid://shopify/ProductVariant/41414604095597', // Mojito / Raspberry (46gf)
        'gid://shopify/ProductVariant/41414604259437', // Mojito / Lemon (55gf)
        'gid://shopify/ProductVariant/41414604423277', // Mojito / Blush (42gf)
        'gid://shopify/ProductVariant/41414604587117', // Blue Lagoon / Mint (37gf)
        'gid://shopify/ProductVariant/41414604750957', // Blue Lagoon / Raspberry (46gf)
        'gid://shopify/ProductVariant/41414604914797', // Blue Lagoon / Lemon (55gf)
        'gid://shopify/ProductVariant/41414605078637', // Blue Lagoon / Blush (42gf)
        'gid://shopify/ProductVariant/41414605242477', // Sakura Fizz / Mint (37gf)
        'gid://shopify/ProductVariant/41414605406317', // Sakura Fizz / Raspberry (46gf)
        'gid://shopify/ProductVariant/41414605570157', // Sakura Fizz / Lemon (55gf)
        'gid://shopify/ProductVariant/41414605766765', // Sakura Fizz / Blush (42gf)
      ]
    ),
    giftVariantIds: new Set([
        'gid://shopify/ProductVariant/45048753029229',
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
