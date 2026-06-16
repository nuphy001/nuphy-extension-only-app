import { describe, it, expect } from 'vitest';
import { goboFreeGiftDiscountFunction } from './cart_lines_discounts_generate_run';

/**
 * 测试常量（与 cart_lines_discounts_generate_run.js 内 CAMPAIGNS 同步）
 */

// ─── Air V3 campaign ─────────────────────────────────────────────────────────
const CAMPAIGN_AIR_V3 = 'bogo-air-v3-wrist-rest-2026';
// Air75 V3 — Nova White / Blush nano / ANSI
const TRIGGER_AIR_V3_A = 'gid://shopify/ProductVariant/42579051315309';
// Air65 V3 — Nova White / Blush nano / ANSI
const TRIGGER_AIR_V3_B = 'gid://shopify/ProductVariant/43879425736813';
// Wrist Rest（Air V3 赠品）
const GIFT_AIR_V3 = 'gid://shopify/ProductVariant/45330731794541';

// ─── Node campaign ────────────────────────────────────────────────────────────
const CAMPAIGN_NODE = 'bogo-node-wrist-rest-2026';
// Node 75 Low-profile / ANSI / Lunar White / Red nano
const TRIGGER_NODE = 'gid://shopify/ProductVariant/43791048835181';
// Wrist Rest（Node 赠品）
const GIFT_NODE = 'gid://shopify/ProductVariant/45194508664941';

// ─── Kick75 campaign ──────────────────────────────────────────────────────────
const CAMPAIGN_KICK75 = 'bogo-kick75-3d-accessory-2026';
// Kick75 Low / NuPhyIO / Red
const TRIGGER_KICK75 = 'gid://shopify/ProductVariant/43805710352493';
// 3D Printed Accessory（Kick75 赠品）
const GIFT_KICK75 = 'gid://shopify/ProductVariant/45329023795309';

// ─── 兼容别名（给下方通用测试用） ────────────────────────────────────────────
const CAMPAIGN_ID = CAMPAIGN_AIR_V3;
const TRIGGER_A = TRIGGER_AIR_V3_A;
const TRIGGER_B = TRIGGER_AIR_V3_B;
const GIFT_VARIANT = GIFT_AIR_V3;
const RANDOM_VARIANT = 'gid://shopify/ProductVariant/99999999999999';

/**
 * 构造一行 cart line。
 *   role / promoId / mainVariant 任一传 null 即该 attribute 不存在（GraphQL key 不命中时返回 null）。
 */
function makeLine({
  id,
  variantId = RANDOM_VARIANT,
  quantity = 1,
  role = null,
  promoId = null,
  mainVariant = null,
}) {
  return {
    id,
    quantity,
    merchandise: { __typename: 'ProductVariant', id: variantId },
    attribute: role === null ? null : { value: role },
    mainVariantAttr: mainVariant === null ? null : { value: mainVariant },
    promoIdAttr: promoId === null ? null : { value: promoId },
  };
}

function makeInput(lines) {
  return { cart: { lines } };
}

/** 合法的赠品行（4 层校验全部通过） */
function legalGiftLine(id = 'G1') {
  return makeLine({
    id,
    variantId: GIFT_VARIANT,
    role: 'gift',
    promoId: CAMPAIGN_ID,
    mainVariant: TRIGGER_A,
  });
}

/** 合法的触发主品行 */
function triggerLine(id = 'T1', variantId = TRIGGER_A, quantity = 1) {
  return makeLine({ id, variantId, quantity });
}

function getTargets(result) {
  return result.operations[0]?.productDiscountsAdd?.candidates[0]?.targets ?? [];
}

describe('goboFreeGiftDiscountFunction — 基础场景', () => {
  it('空 cart → 不发折扣', () => {
    expect(goboFreeGiftDiscountFunction(makeInput([]))).toEqual({ operations: [] });
  });

  it('行无 _promo_role → 不发折扣', () => {
    const result = goboFreeGiftDiscountFunction(makeInput([triggerLine()]));
    expect(result).toEqual({ operations: [] });
  });

  it('行有非 gift role → 不发折扣', () => {
    const line = makeLine({ id: 'L1', role: 'trigger' });
    expect(goboFreeGiftDiscountFunction(makeInput([line]))).toEqual({ operations: [] });
  });
});

describe('goboFreeGiftDiscountFunction — 合法 BOGO 流程', () => {
  it('主品 + 合法赠品 → gift 行打折 quantity=1', () => {
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1'), legalGiftLine('G1')])
    );
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0].productDiscountsAdd;
    expect(op.selectionStrategy).toBe('FIRST');
    expect(op.candidates[0].message).toBe('Free Gift');
    expect(op.candidates[0].value).toEqual({ percentage: { value: 100 } });
    expect(op.candidates[0].targets).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } },
    ]);
  });

  it('主品 B + 合法赠品（声明 main=B） → 仍打折', () => {
    const gift = makeLine({
      id: 'G1', variantId: GIFT_VARIANT, role: 'gift',
      promoId: CAMPAIGN_ID, mainVariant: TRIGGER_B,
    });
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1', TRIGGER_B), gift])
    );
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G1', quantity: 1 } }]);
  });

  it('1 主品 + 赠品 quantity=5 → 仅免 1 件（按主品数量封顶，防放大）', () => {
    const gift = { ...legalGiftLine('G1'), quantity: 5 };
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1'), gift]) // 主品 qty 默认 1 → 配额 1
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } }, // 仅 1 件免单，其余原价
    ]);
  });

  it('买 N 送 N：主品 qty3 + 赠品 qty3 → 免 3 件', () => {
    const gift = { ...legalGiftLine('G1'), quantity: 3 };
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1', TRIGGER_A, 3), gift])
    );
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G1', quantity: 3 } }]);
  });

  it('封顶：主品 qty2 + 赠品 qty5 → 只免 2 件（其余原价）', () => {
    const gift = { ...legalGiftLine('G1'), quantity: 5 };
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1', TRIGGER_A, 2), gift])
    );
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G1', quantity: 2 } }]);
  });

  it('多触发行数量求和：2×A + 1×B + 赠品 qty3 → 免 3 件', () => {
    const gift = { ...legalGiftLine('G1'), quantity: 3 };
    const result = goboFreeGiftDiscountFunction(
      makeInput([
        triggerLine('T1', TRIGGER_A, 2),
        triggerLine('T2', TRIGGER_B, 1),
        gift,
      ])
    );
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G1', quantity: 3 } }]);
  });
});

describe('goboFreeGiftDiscountFunction — 攻击场景（必须 FAIL，即不发折扣）', () => {
  it('risk 1：任意 variant 伪装成 gift（白名单外）→ 不发折扣', () => {
    const fake = makeLine({
      id: 'F1',
      variantId: TRIGGER_A, // 用主品 variant 当 gift
      role: 'gift',
      promoId: CAMPAIGN_ID,
      mainVariant: TRIGGER_A,
    });
    expect(goboFreeGiftDiscountFunction(makeInput([fake]))).toEqual({ operations: [] });
  });

  it('risk 1 (b)：完全无关 variant 伪装 gift → 不发折扣', () => {
    const fake = makeLine({
      id: 'F1',
      variantId: RANDOM_VARIANT,
      role: 'gift',
      promoId: CAMPAIGN_ID,
      mainVariant: TRIGGER_A,
    });
    expect(goboFreeGiftDiscountFunction(makeInput([fake]))).toEqual({ operations: [] });
  });

  it('risk 2：只有赠品行、无主品在 cart → 不发折扣', () => {
    const gift = legalGiftLine('G1');
    expect(goboFreeGiftDiscountFunction(makeInput([gift]))).toEqual({ operations: [] });
  });

  it('risk 2 (b)：声明的 mainVariant 不在 cart 内 → 不发折扣', () => {
    const gift = { ...legalGiftLine('G1') }; // 声明 main=TRIGGER_A
    const otherLine = triggerLine('T1', TRIGGER_B); // 但 cart 里是 TRIGGER_B
    // gift.mainVariant=TRIGGER_A 但 cart 非赠品行仅有 TRIGGER_B
    expect(goboFreeGiftDiscountFunction(makeInput([otherLine, gift]))).toEqual({ operations: [] });
    // 注意：本用例里 TRIGGER_B 本身也是合法 trigger，但 gift 声明的是 TRIGGER_A，校验 4b 应失败
  });

  it('攻击：篡改 _promo_main_variant 指向非合法 trigger → 不发折扣', () => {
    const gift = makeLine({
      id: 'G1', variantId: GIFT_VARIANT, role: 'gift',
      promoId: CAMPAIGN_ID, mainVariant: RANDOM_VARIANT,
    });
    expect(goboFreeGiftDiscountFunction(makeInput([gift]))).toEqual({ operations: [] });
  });

  it('攻击：未声明 _promo_id → 不发折扣', () => {
    const gift = makeLine({
      id: 'G1', variantId: GIFT_VARIANT, role: 'gift',
      promoId: null, mainVariant: TRIGGER_A,
    });
    expect(goboFreeGiftDiscountFunction(makeInput([triggerLine(), gift]))).toEqual({ operations: [] });
  });

  it('攻击：声明不存在的 _promo_id → 不发折扣', () => {
    const gift = makeLine({
      id: 'G1', variantId: GIFT_VARIANT, role: 'gift',
      promoId: 'bogo-fake-campaign', mainVariant: TRIGGER_A,
    });
    expect(goboFreeGiftDiscountFunction(makeInput([triggerLine(), gift]))).toEqual({ operations: [] });
  });

  it('攻击：未声明 _promo_main_variant → 不发折扣', () => {
    const gift = makeLine({
      id: 'G1', variantId: GIFT_VARIANT, role: 'gift',
      promoId: CAMPAIGN_ID, mainVariant: null,
    });
    expect(goboFreeGiftDiscountFunction(makeInput([triggerLine(), gift]))).toEqual({ operations: [] });
  });

  it('赠品行 quantity=0 → 不发折扣（allowed<1 截断）', () => {
    const gift = { ...legalGiftLine('G1'), quantity: 0 };
    expect(
      goboFreeGiftDiscountFunction(makeInput([triggerLine('T1'), gift]))
    ).toEqual({ operations: [] });
  });
});

describe('goboFreeGiftDiscountFunction — 多 line 组合', () => {
  it('多个赠品行共享 campaign 配额：主品 qty2 → 两行各免 1', () => {
    const gift1 = legalGiftLine('G1');
    const gift2 = { ...legalGiftLine('G2') };
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1', TRIGGER_A, 2), gift1, gift2])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } },
      { cartLine: { id: 'G2', quantity: 1 } },
    ]);
  });

  it('配额封顶跨行：主品 qty1 + 两个赠品行 → 只免第一行 1 件', () => {
    const gift1 = legalGiftLine('G1');
    const gift2 = { ...legalGiftLine('G2') };
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1', TRIGGER_A, 1), gift1, gift2])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } }, // 配额 1 被 G1 用完，G2 不免单
    ]);
  });

  it('合法赠品 + 非法赠品混合 → 只对合法的打折', () => {
    const legal = legalGiftLine('G1');
    const fake = makeLine({
      id: 'F1', variantId: RANDOM_VARIANT, role: 'gift',
      promoId: CAMPAIGN_ID, mainVariant: TRIGGER_A,
    });
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1'), legal, fake])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } },
    ]);
  });

  it('赠品 variant 出现在非赠品行（无 _promo_role）+ 真实合法 gift → 只对合法 gift 打折', () => {
    // 攻击思路：把赠品 variant 加进购物车不打 _promo_role → 这样它就在 nonGiftVariantIds 里
    // 但因为 GIFT_VARIANT 不在 triggerVariantIds 白名单里，校验 4a 仍然挡得住
    const giftAsNonGift = makeLine({ id: 'X1', variantId: GIFT_VARIANT });
    const legal = legalGiftLine('G1');
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1'), giftAsNonGift, legal])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } },
    ]);
  });
});

describe('goboFreeGiftDiscountFunction — 跨 campaign 混买场景', () => {
  /**
   * 辅助：构造指定 campaign 的合法赠品行
   */
  function giftLine({ id, variantId, mainVariant, campaignId, qty = 1 }) {
    return {
      ...makeLine({ id, variantId, role: 'gift', promoId: campaignId, mainVariant }),
      quantity: qty,
    };
  }

  it('Air V3 + Node 各买 1 → 各送 1 个 Wrist Rest（两个 campaign 独立结算）', () => {
    const airTrigger = makeLine({ id: 'T_AIR', variantId: TRIGGER_AIR_V3_A });
    const nodeTrigger = makeLine({ id: 'T_NODE', variantId: TRIGGER_NODE });
    const airGift = giftLine({
      id: 'G_AIR', variantId: GIFT_AIR_V3,
      mainVariant: TRIGGER_AIR_V3_A, campaignId: CAMPAIGN_AIR_V3,
    });
    const nodeGift = giftLine({
      id: 'G_NODE', variantId: GIFT_NODE,
      mainVariant: TRIGGER_NODE, campaignId: CAMPAIGN_NODE,
    });

    const result = goboFreeGiftDiscountFunction(
      makeInput([airTrigger, nodeTrigger, airGift, nodeGift])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G_AIR', quantity: 1 } },
      { cartLine: { id: 'G_NODE', quantity: 1 } },
    ]);
  });

  it('Air V3 + Node + Kick75 各买 1 → 送 Air 手托 + Node 手托 + Kick75 3D 配件', () => {
    const airTrigger = makeLine({ id: 'T_AIR', variantId: TRIGGER_AIR_V3_A });
    const nodeTrigger = makeLine({ id: 'T_NODE', variantId: TRIGGER_NODE });
    const kickTrigger = makeLine({ id: 'T_KICK', variantId: TRIGGER_KICK75 });
    const airGift = giftLine({
      id: 'G_AIR', variantId: GIFT_AIR_V3,
      mainVariant: TRIGGER_AIR_V3_A, campaignId: CAMPAIGN_AIR_V3,
    });
    const nodeGift = giftLine({
      id: 'G_NODE', variantId: GIFT_NODE,
      mainVariant: TRIGGER_NODE, campaignId: CAMPAIGN_NODE,
    });
    const kickGift = giftLine({
      id: 'G_KICK', variantId: GIFT_KICK75,
      mainVariant: TRIGGER_KICK75, campaignId: CAMPAIGN_KICK75,
    });

    const result = goboFreeGiftDiscountFunction(
      makeInput([airTrigger, nodeTrigger, kickTrigger, airGift, nodeGift, kickGift])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G_AIR', quantity: 1 } },
      { cartLine: { id: 'G_NODE', quantity: 1 } },
      { cartLine: { id: 'G_KICK', quantity: 1 } },
    ]);
  });

  it('Air V3 买 2 → 送 2 个手托；Node 买 1 → 送 1 个手托（各 campaign 配额独立）', () => {
    const airTrigger = { ...makeLine({ id: 'T_AIR', variantId: TRIGGER_AIR_V3_A }), quantity: 2 };
    const nodeTrigger = makeLine({ id: 'T_NODE', variantId: TRIGGER_NODE });
    const airGift = giftLine({
      id: 'G_AIR', variantId: GIFT_AIR_V3,
      mainVariant: TRIGGER_AIR_V3_A, campaignId: CAMPAIGN_AIR_V3, qty: 2,
    });
    const nodeGift = giftLine({
      id: 'G_NODE', variantId: GIFT_NODE,
      mainVariant: TRIGGER_NODE, campaignId: CAMPAIGN_NODE,
    });

    const result = goboFreeGiftDiscountFunction(
      makeInput([airTrigger, nodeTrigger, airGift, nodeGift])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G_AIR', quantity: 2 } },
      { cartLine: { id: 'G_NODE', quantity: 1 } },
    ]);
  });

  it('用 Air V3 赠品行声明 Node campaign → 校验 3 失败，不发折扣', () => {
    // 攻击：把 Node 的赠品 variant 挂到 Air V3 trigger，伪装成 Node campaign 的赠品
    const airTrigger = makeLine({ id: 'T_AIR', variantId: TRIGGER_AIR_V3_A });
    const fakeGift = giftLine({
      id: 'G_FAKE',
      variantId: GIFT_NODE,         // Node 的赠品 variant
      mainVariant: TRIGGER_AIR_V3_A,
      campaignId: CAMPAIGN_NODE,    // 声明 Node campaign
    });
    // Air V3 trigger 不在 Node campaign 的 triggerVariantIds 里 → 校验 4a 失败
    const result = goboFreeGiftDiscountFunction(
      makeInput([airTrigger, fakeGift])
    );
    expect(result).toEqual({ operations: [] });
  });

  it('跨 campaign 伪造：声明 Air V3 campaign 但赠品 variant 是 Kick75 赠品 → 校验 3 失败', () => {
    const airTrigger = makeLine({ id: 'T_AIR', variantId: TRIGGER_AIR_V3_A });
    const fakeGift = giftLine({
      id: 'G_FAKE',
      variantId: GIFT_KICK75,       // Kick75 的赠品 variant
      mainVariant: TRIGGER_AIR_V3_A,
      campaignId: CAMPAIGN_AIR_V3, // 声明 Air V3 campaign
    });
    // GIFT_KICK75 不在 Air V3 campaign 的 giftVariantIds 里 → 校验 3 失败
    const result = goboFreeGiftDiscountFunction(
      makeInput([airTrigger, fakeGift])
    );
    expect(result).toEqual({ operations: [] });
  });
});
