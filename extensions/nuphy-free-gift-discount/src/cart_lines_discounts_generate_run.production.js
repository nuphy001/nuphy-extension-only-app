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
    id: "bogo-V3-Keycaps-2026-0803",
    triggerVariantIds: new Set([
              // NuPhy Air75 V3
        'gid://shopify/ProductVariant/42579051315309', // Nova White / Blush nano / ANSI - US English
        'gid://shopify/ProductVariant/42633976053869', // Nova White / Blush nano / JIS - Japanese
        'gid://shopify/ProductVariant/42633976086637', // Nova White / Blush nano / ISO - German
        'gid://shopify/ProductVariant/42633976119405', // Nova White / Blush nano / ISO - British
        'gid://shopify/ProductVariant/42633976152173', // Nova White / Blush nano / lSO - French
        'gid://shopify/ProductVariant/42368130711661', // Nova White / Red nano / ANSI - US English
        'gid://shopify/ProductVariant/42633975791725', // Nova White / Red nano / JIS - Japanese
        'gid://shopify/ProductVariant/42633975824493', // Nova White / Red nano / ISO - German
        'gid://shopify/ProductVariant/42633975857261', // Nova White / Red nano / ISO - British
        'gid://shopify/ProductVariant/42633975890029', // Nova White / Red nano / lSO - French
        'gid://shopify/ProductVariant/42579051282541', // Nova White / Brown nano / ANSI - US English
        'gid://shopify/ProductVariant/42633975922797', // Nova White / Brown nano / JIS - Japanese
        'gid://shopify/ProductVariant/42633975955565', // Nova White / Brown nano / ISO - German
        'gid://shopify/ProductVariant/42633975988333', // Nova White / Brown nano / ISO - British
        'gid://shopify/ProductVariant/42633976021101', // Nova White / Brown nano / lSO - French
        'gid://shopify/ProductVariant/42579051380845', // Nebula Dark / Blush nano / ANSI - US English
        'gid://shopify/ProductVariant/42368130744429', // Nebula Dark / Red nano / ANSI - US English
        'gid://shopify/ProductVariant/42579051348077', // Nebula Dark / Brown nano / ANSI - US English
        // NuPhy Air65 V3
        'gid://shopify/ProductVariant/43879425736813', // Nova White / Blush nano / ANSI - US English
        'gid://shopify/ProductVariant/43879425769581', // Nova White / Blush nano / JIS - Japanese
        'gid://shopify/ProductVariant/43879425802349', // Nova White / Blush nano / ISO - German
        'gid://shopify/ProductVariant/43879425835117', // Nova White / Blush nano / ISO - British
        'gid://shopify/ProductVariant/43879425867885', // Nova White / Blush nano / lSO - French
        'gid://shopify/ProductVariant/43879425409133', // Nova White / Red nano / ANSI - US English
        'gid://shopify/ProductVariant/43879425441901', // Nova White / Red nano / JIS - Japanese
        'gid://shopify/ProductVariant/43879425474669', // Nova White / Red nano / ISO - German
        'gid://shopify/ProductVariant/43879425507437', // Nova White / Red nano / ISO - British
        'gid://shopify/ProductVariant/43879425540205', // Nova White / Red nano / lSO - French
        'gid://shopify/ProductVariant/43879425572973', // Nova White / Brown nano / ANSI - US English
        'gid://shopify/ProductVariant/43879425605741', // Nova White / Brown nano / JIS - Japanese
        'gid://shopify/ProductVariant/43879425638509', // Nova White / Brown nano / ISO - German
        'gid://shopify/ProductVariant/43879425671277', // Nova White / Brown nano / ISO - British
        'gid://shopify/ProductVariant/43879425704045', // Nova White / Brown nano / lSO - French
        'gid://shopify/ProductVariant/43879425966189', // Nebula Dark / Blush nano / ANSI - US English
        'gid://shopify/ProductVariant/43879425900653', // Nebula Dark / Red nano / ANSI - US English
        'gid://shopify/ProductVariant/43879425933421', // Nebula Dark / Brown nano / ANSI - US English
        // NuPhy Air100 V3
        'gid://shopify/ProductVariant/44885760344173', // Nova White / Blush nano / ANSI - US English
        'gid://shopify/ProductVariant/44885760376941', // Nova White / Blush nano / JIS - Japanese
        'gid://shopify/ProductVariant/44885760409709', // Nova White / Blush nano / ISO - German
        'gid://shopify/ProductVariant/44885760442477', // Nova White / Blush nano / ISO - British
        'gid://shopify/ProductVariant/44885760475245', // Nova White / Blush nano / lSO - French
        'gid://shopify/ProductVariant/44885760016493', // Nova White / Red nano / ANSI - US English
        'gid://shopify/ProductVariant/44885760049261', // Nova White / Red nano / JIS - Japanese
        'gid://shopify/ProductVariant/44885760082029', // Nova White / Red nano / ISO - German
        'gid://shopify/ProductVariant/44885760114797', // Nova White / Red nano / ISO - British
        'gid://shopify/ProductVariant/44885760147565', // Nova White / Red nano / lSO - French
        'gid://shopify/ProductVariant/44885760180333', // Nova White / Brown nano / ANSI - US English
        'gid://shopify/ProductVariant/44885760213101', // Nova White / Brown nano / JIS - Japanese
        'gid://shopify/ProductVariant/44885760245869', // Nova White / Brown nano / ISO - German
        'gid://shopify/ProductVariant/44885760278637', // Nova White / Brown nano / ISO - British
        'gid://shopify/ProductVariant/44885760311405', // Nova White / Brown nano / lSO - French
        'gid://shopify/ProductVariant/44885760573549', // Nebula Dark / Blush nano / ANSI - US English
        'gid://shopify/ProductVariant/44885760508013', // Nebula Dark / Red nano / ANSI - US English
        'gid://shopify/ProductVariant/44885760540781', // Nebula Dark / Brown nano / ANSI - US English
    ]),
    giftVariantIds: new Set([
     'gid://shopify/ProductVariant/45378325839981', // Default Title
    ]),
  },

  //手托  赠品🎁 New Free Halo V2 Exclusive Wrist Rest (Random Color) ───────────────
  // {
  //   id: "bogo-QMK-2026-0708",
  //   triggerVariantIds: new Set([
  //       // NuPhy Halo96 V2
  //       'gid://shopify/ProductVariant/43556102996077', // Ionic White / Blush (42gf)
  //       'gid://shopify/ProductVariant/44425538666605', // Ionic White / Lemon (55gf)
  //       'gid://shopify/ProductVariant/43556103028845', // Obsidian Black / Blush (42gf)
  //       'gid://shopify/ProductVariant/45054140022893', // Obsidian Black / Lemon (55gf)
  //       'gid://shopify/ProductVariant/45054139859053', // Obsidian Black / Mint (37gf)
  //       'gid://shopify/ProductVariant/45054137401453', // Obsidian Black / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/43556103061613', // Mojito / Blush (42gf)
  //       'gid://shopify/ProductVariant/41305839337581', // Mojito / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41305838977133', // Mojito / Mint (37gf)
  //       'gid://shopify/ProductVariant/41305839140973', // Mojito / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41305839501421', // Mojito / Silent Red Clear-Top (45gf)
  //       'gid://shopify/ProductVariant/43556103094381', // Blue Lagoon / Blush (42gf)
  //       'gid://shopify/ProductVariant/41305840025709', // Blue Lagoon / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41305839665261', // Blue Lagoon / Mint (37gf)
  //       'gid://shopify/ProductVariant/41305839861869', // Blue Lagoon / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41305840189549', // Blue Lagoon / Silent Red Clear-Top (45gf)
  //       'gid://shopify/ProductVariant/43556103127149', // Sakura Fizz / Blush (42gf)
  //       'gid://shopify/ProductVariant/41305840713837', // Sakura Fizz / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41305840353389', // Sakura Fizz / Mint (37gf)
  //       'gid://shopify/ProductVariant/41305840517229', // Sakura Fizz / Raspberry (46gf)
  //       // NuPhy Halo75 V2
  //       'gid://shopify/ProductVariant/43556083499117', // Ionic White / Blush (42gf)
  //       'gid://shopify/ProductVariant/41037253804141', // Obsidian Black / Mint (37gf)
  //       'gid://shopify/ProductVariant/45054166040685', // Ionic White / Mint (37gf)
  //       'gid://shopify/ProductVariant/41037254066285', // Obsidian Black / Lemon (55gf)
  //       'gid://shopify/ProductVariant/45054167580781', // Ionic White / Lemon (55gf)
  //       'gid://shopify/ProductVariant/43556083531885', // Obsidian Black / Blush (42gf)
  //       'gid://shopify/ProductVariant/41037257277549', // Mojito / Mint (37gf)
  //       'gid://shopify/ProductVariant/41037257408621', // Mojito / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41037257539693', // Mojito / Lemon (55gf)
  //       'gid://shopify/ProductVariant/43556083564653', // Mojito / Blush (42gf)
  //       'gid://shopify/ProductVariant/41037257932909', // Blue Lagoon / Mint (37gf)
  //       'gid://shopify/ProductVariant/41037258063981', // Blue Lagoon / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41037258195053', // Blue Lagoon / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41037258326125', // Blue Lagoon / Silent Red Clear-Top (45gf)
  //       'gid://shopify/ProductVariant/43556083597421', // Blue Lagoon / Blush (42gf)
  //       'gid://shopify/ProductVariant/41037258588269', // Sakura Fizz / Mint (37gf)
  //       'gid://shopify/ProductVariant/41037258719341', // Sakura Fizz / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41037258850413', // Sakura Fizz / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41037258981485', // Sakura Fizz / Silent Red Clear-Top (45gf)
  //       'gid://shopify/ProductVariant/43556083630189', // Sakura Fizz / Blush (42gf)
  //       'gid://shopify/ProductVariant/44318570512493', // Obsidian Black / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/45054163386477', // Ionic White / Raspberry (46gf)
  //       // NuPhy Halo65 V2
  //       'gid://shopify/ProductVariant/41414603243629', // Ionic White / Mint (37gf)
  //       'gid://shopify/ProductVariant/41414603407469', // Ionic White / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41414603604077', // Ionic White / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41414603767917', // Ionic White / Blush (42gf)
  //       'gid://shopify/ProductVariant/41414602588269', // Obsidian Black / Mint (37gf)
  //       'gid://shopify/ProductVariant/41414602752109', // Obsidian Black / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41414602915949', // Obsidian Black / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41414603079789', // Obsidian Black / Blush (42gf)
  //       'gid://shopify/ProductVariant/41414603931757', // Mojito / Mint (37gf)
  //       'gid://shopify/ProductVariant/41414604095597', // Mojito / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41414604259437', // Mojito / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41414604423277', // Mojito / Blush (42gf)
  //       'gid://shopify/ProductVariant/41414604587117', // Blue Lagoon / Mint (37gf)
  //       'gid://shopify/ProductVariant/41414604750957', // Blue Lagoon / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41414604914797', // Blue Lagoon / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41414605078637', // Blue Lagoon / Blush (42gf)
  //       'gid://shopify/ProductVariant/41414605242477', // Sakura Fizz / Mint (37gf)
  //       'gid://shopify/ProductVariant/41414605406317', // Sakura Fizz / Raspberry (46gf)
  //       'gid://shopify/ProductVariant/41414605570157', // Sakura Fizz / Lemon (55gf)
  //       'gid://shopify/ProductVariant/41414605766765', // Sakura Fizz / Blush (42gf)
  //     ]
  //   ),
  //   giftVariantIds: new Set([
  //       'gid://shopify/ProductVariant/45048753029229',
  //   ]),
  // },


 //  皮套  NuFolio for Air75 HE
  // {
  //   id: "bogo-Air75HE-2026-0731",
  //   triggerVariantIds: new Set([
  //     // NuPhy Air75 HE
  //       'gid://shopify/ProductVariant/41842485461101', // Low-Profile Magnetic Jade / None / None
  //       'gid://shopify/ProductVariant/41842485526637', // Low-Profile Magnetic Jade / None / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842485493869', // Low-Profile Magnetic Jade / Acrylic Frosted / None
  //       'gid://shopify/ProductVariant/41842485559405', // Low-Profile Magnetic Jade / Acrylic Frosted / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842486902893', // Low-Profile Magnetic Jade / Acrylic Noir / None
  //       'gid://shopify/ProductVariant/41842487033965', // Low-Profile Magnetic Jade / Acrylic Noir / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842486935661', // Low-Profile Magnetic Jade / Beech / None
  //       'gid://shopify/ProductVariant/41842487066733', // Low-Profile Magnetic Jade / Beech / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842486968429', // Low-Profile Magnetic Jade / Black Oak / None
  //       'gid://shopify/ProductVariant/41842487099501', // Low-Profile Magnetic Jade / Black Oak / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842487001197', // Low-Profile Magnetic Jade / Walnut / None
  //       'gid://shopify/ProductVariant/41842487132269', // Low-Profile Magnetic Jade / Walnut / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842485592173', // Low-Profile Magnetic Jade Pro / None / None
  //       'gid://shopify/ProductVariant/41842485657709', // Low-Profile Magnetic Jade Pro / None / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842485624941', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / None
  //       'gid://shopify/ProductVariant/41842485690477', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842487165037', // Low-Profile Magnetic Jade Pro / Acrylic Noir / None
  //       'gid://shopify/ProductVariant/41842487296109', // Low-Profile Magnetic Jade Pro / Acrylic Noir / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842487197805', // Low-Profile Magnetic Jade Pro / Beech / None
  //       'gid://shopify/ProductVariant/41842487328877', // Low-Profile Magnetic Jade Pro / Beech / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842487230573', // Low-Profile Magnetic Jade Pro / Black Oak / None
  //       'gid://shopify/ProductVariant/41842487361645', // Low-Profile Magnetic Jade Pro / Black Oak / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41842487263341', // Low-Profile Magnetic Jade Pro / Walnut / None
  //       'gid://shopify/ProductVariant/41842487394413', // Low-Profile Magnetic Jade Pro / Walnut / Canopus Shine-through nSA
  //     ]
  //   ),
  //   giftVariantIds: new Set([
  //      'gid://shopify/ProductVariant/42015108137069',
  //   ]),
  // },

  //  皮套  NuFolio for Air60 HE
  // {
  //   id: "bogo-Air60HE-2026-0731",
  //   triggerVariantIds: new Set([
  //     // NuPhy Air60 HE
  //       'gid://shopify/ProductVariant/41724980822125', // Low-Profile Magnetic Jade / None / None
  //       'gid://shopify/ProductVariant/41724992585837', // Low-Profile Magnetic Jade / None / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41724980854893', // Low-Profile Magnetic Jade / Acrylic Frosted / None
  //       'gid://shopify/ProductVariant/41724992651373', // Low-Profile Magnetic Jade / Acrylic Frosted / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41795205890157', // Low-Profile Magnetic Jade Pro / None / None
  //       'gid://shopify/ProductVariant/41795205955693', // Low-Profile Magnetic Jade Pro / None / Canopus Shine-through nSA
  //       'gid://shopify/ProductVariant/41795205922925', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / None
  //       'gid://shopify/ProductVariant/41795205988461', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / Canopus Shine-through nSA
  //     ]
  //   ),
  //   giftVariantIds: new Set([
  //     'gid://shopify/ProductVariant/42015104893037',
  //   ]),
  // },
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
