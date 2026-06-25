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
  // ─── Air V3 系列（Air75/Air65/Air100 V3）→ Wrist Rest (2026) ─────────────────
  {
    id: "bogo-air-v3-wrist-rest-2026",
    triggerVariantIds: new Set([
      // NuPhy Air75 V3
      "gid://shopify/ProductVariant/42579051315309",
      "gid://shopify/ProductVariant/42633976053869",
      "gid://shopify/ProductVariant/42633976086637",
      "gid://shopify/ProductVariant/42633976119405",
      "gid://shopify/ProductVariant/42633976152173",
      "gid://shopify/ProductVariant/42368130711661",
      "gid://shopify/ProductVariant/42633975791725",
      "gid://shopify/ProductVariant/42633975824493",
      "gid://shopify/ProductVariant/42633975857261",
      "gid://shopify/ProductVariant/42633975890029",
      "gid://shopify/ProductVariant/42579051282541",
      "gid://shopify/ProductVariant/42633975922797",
      "gid://shopify/ProductVariant/42633975955565",
      "gid://shopify/ProductVariant/42633975988333",
      "gid://shopify/ProductVariant/42633976021101",
      "gid://shopify/ProductVariant/42579051380845",
      "gid://shopify/ProductVariant/42368130744429",
      "gid://shopify/ProductVariant/42579051348077",
      // NuPhy Air65 V3
      "gid://shopify/ProductVariant/43879425736813",
      "gid://shopify/ProductVariant/43879425769581",
      "gid://shopify/ProductVariant/43879425802349",
      "gid://shopify/ProductVariant/43879425835117",
      "gid://shopify/ProductVariant/43879425867885",
      "gid://shopify/ProductVariant/43879425409133",
      "gid://shopify/ProductVariant/43879425441901",
      "gid://shopify/ProductVariant/43879425474669",
      "gid://shopify/ProductVariant/43879425507437",
      "gid://shopify/ProductVariant/43879425540205",
      "gid://shopify/ProductVariant/43879425572973",
      "gid://shopify/ProductVariant/43879425605741",
      "gid://shopify/ProductVariant/43879425638509",
      "gid://shopify/ProductVariant/43879425671277",
      "gid://shopify/ProductVariant/43879425704045",
      "gid://shopify/ProductVariant/43879425966189",
      "gid://shopify/ProductVariant/43879425900653",
      "gid://shopify/ProductVariant/43879425933421",
      // NuPhy Air100 V3
      "gid://shopify/ProductVariant/44885760344173",
      "gid://shopify/ProductVariant/44885760376941",
      "gid://shopify/ProductVariant/44885760409709",
      "gid://shopify/ProductVariant/44885760442477",
      "gid://shopify/ProductVariant/44885760475245",
      "gid://shopify/ProductVariant/44885760016493",
      "gid://shopify/ProductVariant/44885760049261",
      "gid://shopify/ProductVariant/44885760082029",
      "gid://shopify/ProductVariant/44885760114797",
      "gid://shopify/ProductVariant/44885760147565",
      "gid://shopify/ProductVariant/44885760180333",
      "gid://shopify/ProductVariant/44885760213101",
      "gid://shopify/ProductVariant/44885760245869",
      "gid://shopify/ProductVariant/44885760278637",
      "gid://shopify/ProductVariant/44885760311405",
      "gid://shopify/ProductVariant/44885760573549",
      "gid://shopify/ProductVariant/44885760508013",
      "gid://shopify/ProductVariant/44885760540781",
    ]),
    giftVariantIds: new Set([
      "gid://shopify/ProductVariant/45330731794541",
    ]),
  },

  // ─── Node 系列（Node Low + High，75 + 100）→ Wrist Rest (2026) ───────────────
  {
    id: "bogo-node-wrist-rest-2026",
    triggerVariantIds: new Set([
      // NuPhy Node Low-profile
      "gid://shopify/ProductVariant/43791048835181",
      "gid://shopify/ProductVariant/43791048867949",
      "gid://shopify/ProductVariant/43791048900717",
      "gid://shopify/ProductVariant/43791048933485",
      "gid://shopify/ProductVariant/43791048966253",
      "gid://shopify/ProductVariant/43791048999021",
      "gid://shopify/ProductVariant/43791049031789",
      "gid://shopify/ProductVariant/43791049064557",
      "gid://shopify/ProductVariant/43791049097325",
      "gid://shopify/ProductVariant/43797388820589",
      "gid://shopify/ProductVariant/43797388853357",
      "gid://shopify/ProductVariant/43797388886125",
      "gid://shopify/ProductVariant/43797388918893",
      "gid://shopify/ProductVariant/43797388951661",
      "gid://shopify/ProductVariant/43797388984429",
      "gid://shopify/ProductVariant/43797389017197",
      "gid://shopify/ProductVariant/43797389049965",
      "gid://shopify/ProductVariant/43797389082733",
      "gid://shopify/ProductVariant/45135049556077",
      "gid://shopify/ProductVariant/45135049588845",
      "gid://shopify/ProductVariant/45135049621613",
      "gid://shopify/ProductVariant/45135049654381",
      "gid://shopify/ProductVariant/45135049687149",
      "gid://shopify/ProductVariant/45135049719917",
      "gid://shopify/ProductVariant/45135050342509",
      "gid://shopify/ProductVariant/45135050375277",
      "gid://shopify/ProductVariant/45135050408045",
      "gid://shopify/ProductVariant/45135050440813",
      "gid://shopify/ProductVariant/45135050473581",
      "gid://shopify/ProductVariant/45135050506349",
      "gid://shopify/ProductVariant/45135049359469",
      "gid://shopify/ProductVariant/45135049392237",
      "gid://shopify/ProductVariant/45135049425005",
      "gid://shopify/ProductVariant/45135049457773",
      "gid://shopify/ProductVariant/45135049490541",
      "gid://shopify/ProductVariant/45135049523309",
      "gid://shopify/ProductVariant/45135050145901",
      "gid://shopify/ProductVariant/45135050178669",
      "gid://shopify/ProductVariant/45135050211437",
      "gid://shopify/ProductVariant/45135050244205",
      "gid://shopify/ProductVariant/45135050276973",
      "gid://shopify/ProductVariant/45135050309741",
      "gid://shopify/ProductVariant/45135049752685",
      "gid://shopify/ProductVariant/45135049785453",
      "gid://shopify/ProductVariant/45135049818221",
      "gid://shopify/ProductVariant/45135049850989",
      "gid://shopify/ProductVariant/45135049883757",
      "gid://shopify/ProductVariant/45135049916525",
      "gid://shopify/ProductVariant/45135050539117",
      "gid://shopify/ProductVariant/45135050571885",
      "gid://shopify/ProductVariant/45135050604653",
      "gid://shopify/ProductVariant/45135050637421",
      "gid://shopify/ProductVariant/45135050670189",
      "gid://shopify/ProductVariant/45135050702957",
      "gid://shopify/ProductVariant/45135049949293",
      "gid://shopify/ProductVariant/45135049982061",
      "gid://shopify/ProductVariant/45135050014829",
      "gid://shopify/ProductVariant/45135050047597",
      "gid://shopify/ProductVariant/45135050080365",
      "gid://shopify/ProductVariant/45135050113133",
      "gid://shopify/ProductVariant/45135050735725",
      "gid://shopify/ProductVariant/45135050768493",
      "gid://shopify/ProductVariant/45135050801261",
      "gid://shopify/ProductVariant/45135050834029",
      "gid://shopify/ProductVariant/45135050866797",
      "gid://shopify/ProductVariant/45135050899565",
      // NuPhy Node High-profile
      "gid://shopify/ProductVariant/43805139730541",
      "gid://shopify/ProductVariant/43805139763309",
      "gid://shopify/ProductVariant/43813526700141",
      "gid://shopify/ProductVariant/43805139828845",
      "gid://shopify/ProductVariant/43805139861613",
      "gid://shopify/ProductVariant/43813526732909",
      "gid://shopify/ProductVariant/43805139927149",
      "gid://shopify/ProductVariant/43805139959917",
      "gid://shopify/ProductVariant/43813526765677",
      "gid://shopify/ProductVariant/43805140025453",
      "gid://shopify/ProductVariant/43805140058221",
      "gid://shopify/ProductVariant/43813526798445",
      "gid://shopify/ProductVariant/43805140123757",
      "gid://shopify/ProductVariant/43805140156525",
      "gid://shopify/ProductVariant/43813526831213",
      "gid://shopify/ProductVariant/43805140222061",
      "gid://shopify/ProductVariant/43805140254829",
      "gid://shopify/ProductVariant/43813526863981",
      "gid://shopify/ProductVariant/45135131476077",
      "gid://shopify/ProductVariant/45135131508845",
      "gid://shopify/ProductVariant/45135131541613",
      "gid://shopify/ProductVariant/45135131574381",
      "gid://shopify/ProductVariant/45135131607149",
      "gid://shopify/ProductVariant/45135131639917",
      "gid://shopify/ProductVariant/45135132262509",
      "gid://shopify/ProductVariant/45135132295277",
      "gid://shopify/ProductVariant/45135132328045",
      "gid://shopify/ProductVariant/45135132360813",
      "gid://shopify/ProductVariant/45135132393581",
      "gid://shopify/ProductVariant/45135132426349",
      "gid://shopify/ProductVariant/45135131279469",
      "gid://shopify/ProductVariant/45135131312237",
      "gid://shopify/ProductVariant/45135131345005",
      "gid://shopify/ProductVariant/45135131377773",
      "gid://shopify/ProductVariant/45135131410541",
      "gid://shopify/ProductVariant/45135131443309",
      "gid://shopify/ProductVariant/45135132065901",
      "gid://shopify/ProductVariant/45135132098669",
      "gid://shopify/ProductVariant/45135132131437",
      "gid://shopify/ProductVariant/45135132164205",
      "gid://shopify/ProductVariant/45135132196973",
      "gid://shopify/ProductVariant/45135132229741",
      "gid://shopify/ProductVariant/45135131672685",
      "gid://shopify/ProductVariant/45135131705453",
      "gid://shopify/ProductVariant/45135131738221",
      "gid://shopify/ProductVariant/45135131770989",
      "gid://shopify/ProductVariant/45135131803757",
      "gid://shopify/ProductVariant/45135131836525",
      "gid://shopify/ProductVariant/45135132459117",
      "gid://shopify/ProductVariant/45135132491885",
      "gid://shopify/ProductVariant/45135132524653",
      "gid://shopify/ProductVariant/45135132557421",
      "gid://shopify/ProductVariant/45135132590189",
      "gid://shopify/ProductVariant/45135132622957",
      "gid://shopify/ProductVariant/45135131869293",
      "gid://shopify/ProductVariant/45135131902061",
      "gid://shopify/ProductVariant/45135131934829",
      "gid://shopify/ProductVariant/45135131967597",
      "gid://shopify/ProductVariant/45135132000365",
      "gid://shopify/ProductVariant/45135132033133",
      "gid://shopify/ProductVariant/45135132655725",
      "gid://shopify/ProductVariant/45135132688493",
      "gid://shopify/ProductVariant/45135132721261",
      "gid://shopify/ProductVariant/45135132754029",
      "gid://shopify/ProductVariant/45135132786797",
      "gid://shopify/ProductVariant/45135132819565",
    ]),
    giftVariantIds: new Set([
      "gid://shopify/ProductVariant/45194508664941",
    ]),
  },

  // ─── Kick75 → 3D Printed Accessory (2026) ────────────────────────────────────
  {
    id: "bogo-kick75-3d-accessory-2026",
    triggerVariantIds: new Set([
      // NuPhy Kick75
      "gid://shopify/ProductVariant/43805710352493",
      "gid://shopify/ProductVariant/43805710385261",
      "gid://shopify/ProductVariant/43805710418029",
      "gid://shopify/ProductVariant/43805710450797",
      "gid://shopify/ProductVariant/43805710483565",
      "gid://shopify/ProductVariant/43805710516333",
      "gid://shopify/ProductVariant/43805710549101",
      "gid://shopify/ProductVariant/43805710581869",
      "gid://shopify/ProductVariant/43805710614637",
      "gid://shopify/ProductVariant/43805710647405",
      "gid://shopify/ProductVariant/43805710680173",
      "gid://shopify/ProductVariant/43805710712941",
      "gid://shopify/ProductVariant/43805710745709",
      "gid://shopify/ProductVariant/43805710778477",
      "gid://shopify/ProductVariant/43805710811245",
      "gid://shopify/ProductVariant/43805710844013",
    ]),
    giftVariantIds: new Set([
      "gid://shopify/ProductVariant/45329023795309",
    ]),
  },
  // ─NuPhy Air75 HE 测试 ────────────────────────────────────
  {
    id: "bogo-Air75-HE-TEST-2026",
    triggerVariantIds: new Set([
        'gid://shopify/ProductVariant/45374100766829', // Low-Profile Magnetic Jade / None / None
        'gid://shopify/ProductVariant/45374100799597', // Low-Profile Magnetic Jade / None / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374100832365', // Low-Profile Magnetic Jade / Acrylic Frosted / None
        'gid://shopify/ProductVariant/45374100865133', // Low-Profile Magnetic Jade / Acrylic Frosted / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374100897901', // Low-Profile Magnetic Jade / Acrylic Noir / None
        'gid://shopify/ProductVariant/45374100930669', // Low-Profile Magnetic Jade / Acrylic Noir / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374100963437', // Low-Profile Magnetic Jade / Beech / None
        'gid://shopify/ProductVariant/45374100996205', // Low-Profile Magnetic Jade / Beech / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101028973', // Low-Profile Magnetic Jade / Black Oak / None
        'gid://shopify/ProductVariant/45374101061741', // Low-Profile Magnetic Jade / Black Oak / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101094509', // Low-Profile Magnetic Jade / Walnut / None
        'gid://shopify/ProductVariant/45374101127277', // Low-Profile Magnetic Jade / Walnut / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101160045', // Low-Profile Magnetic Jade Pro / None / None
        'gid://shopify/ProductVariant/45374101192813', // Low-Profile Magnetic Jade Pro / None / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101225581', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / None
        'gid://shopify/ProductVariant/45374101258349', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101291117', // Low-Profile Magnetic Jade Pro / Acrylic Noir / None
        'gid://shopify/ProductVariant/45374101323885', // Low-Profile Magnetic Jade Pro / Acrylic Noir / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101356653', // Low-Profile Magnetic Jade Pro / Beech / None
        'gid://shopify/ProductVariant/45374101389421', // Low-Profile Magnetic Jade Pro / Beech / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101422189', // Low-Profile Magnetic Jade Pro / Black Oak / None
        'gid://shopify/ProductVariant/45374101454957', // Low-Profile Magnetic Jade Pro / Black Oak / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/45374101487725', // Low-Profile Magnetic Jade Pro / Walnut / None
        'gid://shopify/ProductVariant/45374101520493', // Low-Profile Magnetic Jade Pro / Walnut / Canopus Shine-through nSA
    ]),
    giftVariantIds: new Set([
      'gid://shopify/ProductVariant/45373293723757', // Default Title
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
