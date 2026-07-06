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
    id: "bogo-Summer-Keycaps-2026",
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
        // NuPhy Node Series Low-profile
        'gid://shopify/ProductVariant/43791048835181', // 75-ANSI-US English / Lunar White / Red nano
        'gid://shopify/ProductVariant/43791048867949', // 75-ANSI-US English / Lunar White / Brown nano
        'gid://shopify/ProductVariant/43791048900717', // 75-ANSI-US English / Lunar White / Blush nano
        'gid://shopify/ProductVariant/43791048933485', // 75-ANSI-US English / Ink Gray / Red nano
        'gid://shopify/ProductVariant/43791048966253', // 75-ANSI-US English / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/43791048999021', // 75-ANSI-US English / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/43791049031789', // 75-ANSI-US English / Light Pink / Red nano
        'gid://shopify/ProductVariant/43791049064557', // 75-ANSI-US English / Light Pink / Brown nano
        'gid://shopify/ProductVariant/43791049097325', // 75-ANSI-US English / Light Pink / Blush nano
        'gid://shopify/ProductVariant/43797388820589', // 100-ANSI-US English / Lunar White / Red nano
        'gid://shopify/ProductVariant/43797388853357', // 100-ANSI-US English / Lunar White / Brown nano
        'gid://shopify/ProductVariant/43797388886125', // 100-ANSI-US English / Lunar White / Blush nano
        'gid://shopify/ProductVariant/43797388918893', // 100-ANSI-US English / Ink Gray / Red nano
        'gid://shopify/ProductVariant/43797388951661', // 100-ANSI-US English / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/43797388984429', // 100-ANSI-US English / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/43797389017197', // 100-ANSI-US English / Light Pink / Red nano
        'gid://shopify/ProductVariant/43797389049965', // 100-ANSI-US English / Light Pink / Brown nano
        'gid://shopify/ProductVariant/43797389082733', // 100-ANSI-US English / Light Pink / Blush nano
        'gid://shopify/ProductVariant/45135049556077', // 75-ISO-German / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135049588845', // 75-ISO-German / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135049621613', // 75-ISO-German / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135049654381', // 75-ISO-German / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135049687149', // 75-ISO-German / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135049719917', // 75-ISO-German / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/45135050342509', // 100-ISO-German / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135050375277', // 100-ISO-German / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135050408045', // 100-ISO-German / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135050440813', // 100-ISO-German / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135050473581', // 100-ISO-German / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135050506349', // 100-ISO-German / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/45135049359469', // 75-ISO-British / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135049392237', // 75-ISO-British / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135049425005', // 75-ISO-British / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135049457773', // 75-ISO-British / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135049490541', // 75-ISO-British / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135049523309', // 75-ISO-British / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/45135050145901', // 100-ISO-British / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135050178669', // 100-ISO-British / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135050211437', // 100-ISO-British / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135050244205', // 100-ISO-British / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135050276973', // 100-ISO-British / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135050309741', // 100-ISO-British / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/45135049752685', // 75-lSO-French / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135049785453', // 75-lSO-French / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135049818221', // 75-lSO-French / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135049850989', // 75-lSO-French / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135049883757', // 75-lSO-French / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135049916525', // 75-lSO-French / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/45135050539117', // 100-lSO-French / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135050571885', // 100-lSO-French / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135050604653', // 100-lSO-French / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135050637421', // 100-lSO-French / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135050670189', // 100-lSO-French / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135050702957', // 100-lSO-French / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/45135049949293', // 75-JIS-Japanese / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135049982061', // 75-JIS-Japanese / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135050014829', // 75-JIS-Japanese / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135050047597', // 75-JIS-Japanese / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135050080365', // 75-JIS-Japanese / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135050113133', // 75-JIS-Japanese / Ink Gray / Blush nano
        'gid://shopify/ProductVariant/45135050735725', // 100-JIS-Japanese / Lunar White / Red nano
        'gid://shopify/ProductVariant/45135050768493', // 100-JIS-Japanese / Lunar White / Brown nano
        'gid://shopify/ProductVariant/45135050801261', // 100-JIS-Japanese / Lunar White / Blush nano
        'gid://shopify/ProductVariant/45135050834029', // 100-JIS-Japanese / Ink Gray / Red nano
        'gid://shopify/ProductVariant/45135050866797', // 100-JIS-Japanese / Ink Gray / Brown nano
        'gid://shopify/ProductVariant/45135050899565', // 100-JIS-Japanese / Ink Gray / Blush nano
        // NuPhy Kick75
        'gid://shopify/ProductVariant/43805710352493', // Low / NuPhyIO / Red
        'gid://shopify/ProductVariant/43805710385261', // Low / NuPhyIO / Brown
        'gid://shopify/ProductVariant/43805710418029', // Low / NuPhyIO / Silver
        'gid://shopify/ProductVariant/43805710450797', // Low / NuPhyIO / Blush
        'gid://shopify/ProductVariant/43805710483565', // Low / QMK & VIA / Red
        'gid://shopify/ProductVariant/43805710516333', // Low / QMK & VIA / Brown
        'gid://shopify/ProductVariant/43805710549101', // Low / QMK & VIA / Silver
        'gid://shopify/ProductVariant/43805710581869', // Low / QMK & VIA / Blush

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
        // NuPhy Air75 HE
        'gid://shopify/ProductVariant/41842485461101', // Low-Profile Magnetic Jade / None / None
        'gid://shopify/ProductVariant/41842485526637', // Low-Profile Magnetic Jade / None / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842485493869', // Low-Profile Magnetic Jade / Acrylic Frosted / None
        'gid://shopify/ProductVariant/41842485559405', // Low-Profile Magnetic Jade / Acrylic Frosted / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842486902893', // Low-Profile Magnetic Jade / Acrylic Noir / None
        'gid://shopify/ProductVariant/41842487033965', // Low-Profile Magnetic Jade / Acrylic Noir / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842486935661', // Low-Profile Magnetic Jade / Beech / None
        'gid://shopify/ProductVariant/41842487066733', // Low-Profile Magnetic Jade / Beech / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842486968429', // Low-Profile Magnetic Jade / Black Oak / None
        'gid://shopify/ProductVariant/41842487099501', // Low-Profile Magnetic Jade / Black Oak / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842487001197', // Low-Profile Magnetic Jade / Walnut / None
        'gid://shopify/ProductVariant/41842487132269', // Low-Profile Magnetic Jade / Walnut / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842485592173', // Low-Profile Magnetic Jade Pro / None / None
        'gid://shopify/ProductVariant/41842485657709', // Low-Profile Magnetic Jade Pro / None / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842485624941', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / None
        'gid://shopify/ProductVariant/41842485690477', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842487165037', // Low-Profile Magnetic Jade Pro / Acrylic Noir / None
        'gid://shopify/ProductVariant/41842487296109', // Low-Profile Magnetic Jade Pro / Acrylic Noir / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842487197805', // Low-Profile Magnetic Jade Pro / Beech / None
        'gid://shopify/ProductVariant/41842487328877', // Low-Profile Magnetic Jade Pro / Beech / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842487230573', // Low-Profile Magnetic Jade Pro / Black Oak / None
        'gid://shopify/ProductVariant/41842487361645', // Low-Profile Magnetic Jade Pro / Black Oak / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41842487263341', // Low-Profile Magnetic Jade Pro / Walnut / None
        'gid://shopify/ProductVariant/41842487394413', // Low-Profile Magnetic Jade Pro / Walnut / Canopus Shine-through nSA
        // NuPhy Air60 HE
        'gid://shopify/ProductVariant/41724980822125', // Low-Profile Magnetic Jade / None / None
        'gid://shopify/ProductVariant/41724992585837', // Low-Profile Magnetic Jade / None / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41724980854893', // Low-Profile Magnetic Jade / Acrylic Frosted / None
        'gid://shopify/ProductVariant/41724992651373', // Low-Profile Magnetic Jade / Acrylic Frosted / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41795205890157', // Low-Profile Magnetic Jade Pro / None / None
        'gid://shopify/ProductVariant/41795205955693', // Low-Profile Magnetic Jade Pro / None / Canopus Shine-through nSA
        'gid://shopify/ProductVariant/41795205922925', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / None
        'gid://shopify/ProductVariant/41795205988461', // Low-Profile Magnetic Jade Pro / Acrylic Frosted / Canopus Shine-through nSA
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
     'gid://shopify/ProductVariant/45378325839981',
    ]),
  },

  //手托  赠品🎁 Free Wrist Rest (Random Color) ───────────────
  {
    id: "bogo-Wrist-Rest-2026",
    triggerVariantIds: new Set([
        // NuPhy Halo IO Series
        'gid://shopify/ProductVariant/43464077508717', // 75 / Ionic White / Red Max
        'gid://shopify/ProductVariant/43464077541485', // 75 / Ionic White / Brown Max
        'gid://shopify/ProductVariant/43464077574253', // 75 / Ionic White / Blush Max
        'gid://shopify/ProductVariant/43463941455981', // 75 / Obsidian Black / Red Max
        'gid://shopify/ProductVariant/43463941488749', // 75 / Obsidian Black / Brown Max
        'gid://shopify/ProductVariant/43463941521517', // 75 / Obsidian Black / Blush Max
        'gid://shopify/ProductVariant/43464077607021', // 75 / Sakura Fizz / Red Max
        'gid://shopify/ProductVariant/43464077639789', // 75 / Sakura Fizz / Brown Max
        'gid://shopify/ProductVariant/43464077672557', // 75 / Sakura Fizz / Blush Max
        'gid://shopify/ProductVariant/43464077705325', // 96 / Ionic White / Red Max
        'gid://shopify/ProductVariant/43464077738093', // 96 / Ionic White / Brown Max
        'gid://shopify/ProductVariant/43464077770861', // 96 / Ionic White / Blush Max
        'gid://shopify/ProductVariant/43464055816301', // 96 / Obsidian Black / Red Max
        'gid://shopify/ProductVariant/43464055980141', // 96 / Obsidian Black / Brown Max
        'gid://shopify/ProductVariant/43464056143981', // 96 / Obsidian Black / Blush Max
        'gid://shopify/ProductVariant/43464077803629', // 96 / Sakura Fizz / Red Max
        'gid://shopify/ProductVariant/43464077836397', // 96 / Sakura Fizz / Brown Max
        'gid://shopify/ProductVariant/43464077869165', // 96 / Sakura Fizz / Blush Max
        'gid://shopify/ProductVariant/43464077312109', // 65 / Ionic White / Red Max
        'gid://shopify/ProductVariant/43464077344877', // 65 / Ionic White / Brown Max
        'gid://shopify/ProductVariant/43464077377645', // 65 / Ionic White / Blush Max
        'gid://shopify/ProductVariant/43463940964461', // 65 / Obsidian Black / Red Max
        'gid://shopify/ProductVariant/43463941128301', // 65 / Obsidian Black / Brown Max
        'gid://shopify/ProductVariant/43463941292141', // 65 / Obsidian Black / Blush Max
        'gid://shopify/ProductVariant/43464077410413', // 65 / Sakura Fizz / Red Max
        'gid://shopify/ProductVariant/43464077443181', // 65 / Sakura Fizz / Brown Max
        'gid://shopify/ProductVariant/43464077475949', // 65 / Sakura Fizz / Blush Max
        // NuPhy Gem80 (gem80-t)
        'gid://shopify/ProductVariant/40929293893741', // Mystic Indigo / Not Included / Not Included
        'gid://shopify/ProductVariant/40929293926509', // Mystic Indigo / Not Included / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929293959277', // Mystic Indigo / Mint (+$15) / Not Included
        'gid://shopify/ProductVariant/40929293992045', // Mystic Indigo / Mint (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294024813', // Mystic Indigo / Raspberry (+$15) / Not Included
        'gid://shopify/ProductVariant/40929294057581', // Mystic Indigo / Raspberry (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294090349', // Mystic Indigo / Lemon (+$15) / Not Included
        'gid://shopify/ProductVariant/40929294123117', // Mystic Indigo / Lemon (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294155885', // Mystic Indigo / Panda (+$20) / Not Included
        'gid://shopify/ProductVariant/40929294188653', // Mystic Indigo / Panda (+$20) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929293566061', // Obsidian Black / Not Included / Not Included
        'gid://shopify/ProductVariant/40929293598829', // Obsidian Black / Not Included / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929293631597', // Obsidian Black / Mint (+$15) / Not Included
        'gid://shopify/ProductVariant/40929293664365', // Obsidian Black / Mint (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929293697133', // Obsidian Black / Raspberry (+$15) / Not Included
        'gid://shopify/ProductVariant/40929293729901', // Obsidian Black / Raspberry (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929293762669', // Obsidian Black / Lemon (+$15) / Not Included
        'gid://shopify/ProductVariant/40929293795437', // Obsidian Black / Lemon (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929293828205', // Obsidian Black / Panda (+$20) / Not Included
        'gid://shopify/ProductVariant/40929293860973', // Obsidian Black / Panda (+$20) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294549101', // Inca Rose / Not Included / Not Included
        'gid://shopify/ProductVariant/40929294581869', // Inca Rose / Not Included / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294614637', // Inca Rose / Mint (+$15) / Not Included
        'gid://shopify/ProductVariant/40929294647405', // Inca Rose / Mint (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294680173', // Inca Rose / Raspberry (+$15) / Not Included
        'gid://shopify/ProductVariant/40929294712941', // Inca Rose / Raspberry (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294745709', // Inca Rose / Lemon (+$15) / Not Included
        'gid://shopify/ProductVariant/40929294778477', // Inca Rose / Lemon (+$15) / Themed Keycaps (+$15)
        'gid://shopify/ProductVariant/40929294811245', // Inca Rose / Panda (+$20) / Not Included
        'gid://shopify/ProductVariant/40929294844013', // Inca Rose / Panda (+$20) / Themed Keycaps (+$15)
        // NuPhy WH80 Gaming Keyboard (nuphy-wh80-gaming-keyboard)
        'gid://shopify/ProductVariant/43657239986285', // Nova White / Magnetic Jade Dragon-N
        'gid://shopify/ProductVariant/43661978796141', // Nebula Black / Magnetic Jade Dragon-N
        // NuPhyX BH65 Keyboard (bh65)
        'gid://shopify/ProductVariant/45219769319533', // Magnetic Jade Pro
        'gid://shopify/ProductVariant/42342288752749', // Magnetic Jade Gaming
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
        // NuPhy Field75 HE V2
        'gid://shopify/ProductVariant/44856176312429', // Magnetic Silver
        'gid://shopify/ProductVariant/44856176279661', // Magnetic Jade Dragon-N
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
        // NuPhy Node Series High-profile
        'gid://shopify/ProductVariant/43805139730541', // 75-ANSI-US English / Lunar White / Red Max
        'gid://shopify/ProductVariant/43805139763309', // 75-ANSI-US English / Lunar White / Brown Max
        'gid://shopify/ProductVariant/43813526700141', // 75-ANSI-US English / Lunar White / Blush Max
        'gid://shopify/ProductVariant/43805139828845', // 75-ANSI-US English / Ink Gray / Red Max
        'gid://shopify/ProductVariant/43805139861613', // 75-ANSI-US English / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/43813526732909', // 75-ANSI-US English / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/43805139927149', // 75-ANSI-US English / Light Pink / Red Max
        'gid://shopify/ProductVariant/43805139959917', // 75-ANSI-US English / Light Pink / Brown Max
        'gid://shopify/ProductVariant/43813526765677', // 75-ANSI-US English / Light Pink / Blush Max
        'gid://shopify/ProductVariant/43805140025453', // 100-ANSI-US English / Lunar White / Red Max
        'gid://shopify/ProductVariant/43805140058221', // 100-ANSI-US English / Lunar White / Brown Max
        'gid://shopify/ProductVariant/43813526798445', // 100-ANSI-US English / Lunar White / Blush Max
        'gid://shopify/ProductVariant/43805140123757', // 100-ANSI-US English / Ink Gray / Red Max
        'gid://shopify/ProductVariant/43805140156525', // 100-ANSI-US English / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/43813526831213', // 100-ANSI-US English / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/43805140222061', // 100-ANSI-US English / Light Pink / Red Max
        'gid://shopify/ProductVariant/43805140254829', // 100-ANSI-US English / Light Pink / Brown Max
        'gid://shopify/ProductVariant/43813526863981', // 100-ANSI-US English / Light Pink / Blush Max
        'gid://shopify/ProductVariant/45135131476077', // 75-ISO-German / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135131508845', // 75-ISO-German / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135131541613', // 75-ISO-German / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135131574381', // 75-ISO-German / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135131607149', // 75-ISO-German / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135131639917', // 75-ISO-German / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/45135132262509', // 100-ISO-German / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135132295277', // 100-ISO-German / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135132328045', // 100-ISO-German / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135132360813', // 100-ISO-German / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135132393581', // 100-ISO-German / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135132426349', // 100-ISO-German / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/45135131279469', // 75-ISO-British / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135131312237', // 75-ISO-British / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135131345005', // 75-ISO-British / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135131377773', // 75-ISO-British / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135131410541', // 75-ISO-British / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135131443309', // 75-ISO-British / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/45135132065901', // 100-ISO-British / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135132098669', // 100-ISO-British / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135132131437', // 100-ISO-British / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135132164205', // 100-ISO-British / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135132196973', // 100-ISO-British / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135132229741', // 100-ISO-British / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/45135131672685', // 75-lSO-French / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135131705453', // 75-lSO-French / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135131738221', // 75-lSO-French / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135131770989', // 75-lSO-French / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135131803757', // 75-lSO-French / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135131836525', // 75-lSO-French / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/45135132459117', // 100-lSO-French / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135132491885', // 100-lSO-French / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135132524653', // 100-lSO-French / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135132557421', // 100-lSO-French / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135132590189', // 100-lSO-French / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135132622957', // 100-lSO-French / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/45135131869293', // 75-JIS-Japanese / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135131902061', // 75-JIS-Japanese / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135131934829', // 75-JIS-Japanese / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135131967597', // 75-JIS-Japanese / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135132000365', // 75-JIS-Japanese / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135132033133', // 75-JIS-Japanese / Ink Gray / Blush Max
        'gid://shopify/ProductVariant/45135132655725', // 100-JIS-Japanese / Lunar White / Red Max
        'gid://shopify/ProductVariant/45135132688493', // 100-JIS-Japanese / Lunar White / Brown Max
        'gid://shopify/ProductVariant/45135132721261', // 100-JIS-Japanese / Lunar White / Blush Max
        'gid://shopify/ProductVariant/45135132754029', // 100-JIS-Japanese / Ink Gray / Red Max
        'gid://shopify/ProductVariant/45135132786797', // 100-JIS-Japanese / Ink Gray / Brown Max
        'gid://shopify/ProductVariant/45135132819565', // 100-JIS-Japanese / Ink Gray / Blush Max
        //Kick75 
        'gid://shopify/ProductVariant/43805710614637', // High / NuPhyIO / Red
        'gid://shopify/ProductVariant/43805710647405', // High / NuPhyIO / Brown
        'gid://shopify/ProductVariant/43805710680173', // High / NuPhyIO / Silver
        'gid://shopify/ProductVariant/43805710712941', // High / NuPhyIO / Blush
        'gid://shopify/ProductVariant/43805710745709', // High / QMK & VIA / Red
        'gid://shopify/ProductVariant/43805710778477', // High / QMK & VIA / Brown
        'gid://shopify/ProductVariant/43805710811245', // High / QMK & VIA / Silver
        'gid://shopify/ProductVariant/43805710844013', // High / QMK & VIA / Blush
      ]
    ),
    giftVariantIds: new Set([
     'gid://shopify/ProductVariant/45378334130285',
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
