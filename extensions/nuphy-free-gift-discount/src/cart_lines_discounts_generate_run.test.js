import { describe, it, expect } from 'vitest';
import { goboFreeGiftDiscountFunction } from './cart_lines_discounts_generate_run.production';

/**
 * 测试常量（与 cart_lines_discounts_generate_run.js 内 CAMPAIGNS 同步）
 *
 * 当前线上共两条活动：
 *   1) 键帽 bogo-Summer-Keycaps-2026  —— Kick75 矮轴(Low) 在此触发
 *   2) 手托 bogo-Wrist-Rest-2026      —— Kick75 高轴(High) 在此触发
 * 业务规则：全站商品按规则归属——命中键帽规则送键帽，命中手托规则送手托。
 */

// ─── 键帽 campaign（Summer Keycaps） ──────────────────────────────────────────
const CAMPAIGN_KEYCAPS = 'bogo-Summer-Keycaps-2026';
// Air75 V3 — Nova White / Blush nano / ANSI
const TRIGGER_KEYCAPS_AIR = 'gid://shopify/ProductVariant/42579051315309';
// Kick75 矮轴 — Low / NuPhyIO / Red
const TRIGGER_KEYCAPS_KICK_LOW = 'gid://shopify/ProductVariant/43805710352493';
// 键帽赠品
const GIFT_KEYCAPS = 'gid://shopify/ProductVariant/45378325839981';

// ─── 手托 campaign（Wrist Rest） ──────────────────────────────────────────────
const CAMPAIGN_WRISTREST = 'bogo-Wrist-Rest-2026';
// Halo IO 75 — Ionic White / Red Max
const TRIGGER_WRISTREST_HALO = 'gid://shopify/ProductVariant/43464077508717';
// Kick75 高轴 — High / NuPhyIO / Red
const TRIGGER_WRISTREST_KICK_HIGH = 'gid://shopify/ProductVariant/43805710614637';
// 手托赠品
const GIFT_WRISTREST = 'gid://shopify/ProductVariant/45378334130285';

// ─── 兼容别名（给通用/基础测试用，默认走键帽活动） ──────────────────────────
const CAMPAIGN_ID = CAMPAIGN_KEYCAPS;
const TRIGGER_A = TRIGGER_KEYCAPS_AIR;
const GIFT_VARIANT = GIFT_KEYCAPS;
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

/** 合法触发主品行（默认键帽活动 Air75 V3） */
function triggerLine(id = 'T1', variantId = TRIGGER_A, quantity = 1) {
  return makeLine({ id, variantId, quantity });
}

/** 合法赠品行（4 层校验全部通过；默认键帽活动） */
function giftLine({
  id = 'G1',
  variantId = GIFT_VARIANT,
  promoId = CAMPAIGN_ID,
  mainVariant = TRIGGER_A,
  quantity = 1,
} = {}) {
  return makeLine({ id, variantId, role: 'gift', promoId, mainVariant, quantity });
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

  it('赠品行 _promo_role 非 gift（其它值）→ 不发折扣', () => {
    const line = makeLine({
      id: 'X',
      variantId: GIFT_VARIANT,
      role: 'main',
      promoId: CAMPAIGN_ID,
      mainVariant: TRIGGER_A,
    });
    const result = goboFreeGiftDiscountFunction(makeInput([triggerLine(), line]));
    expect(result).toEqual({ operations: [] });
  });
});

describe('goboFreeGiftDiscountFunction — 服务端 4 层校验', () => {
  it('校验2：_promo_id 缺失 → 不发折扣', () => {
    const line = makeLine({
      id: 'G',
      variantId: GIFT_VARIANT,
      role: 'gift',
      promoId: null,
      mainVariant: TRIGGER_A,
    });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([triggerLine(), line])))).toEqual([]);
  });

  it('校验2：_promo_id 指向不存在的活动 → 不发折扣', () => {
    const line = giftLine({ promoId: 'bogo-does-not-exist' });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([triggerLine(), line])))).toEqual([]);
  });

  it('校验3：merchandise 不是该活动赠品 variant → 不发折扣', () => {
    const line = giftLine({ variantId: RANDOM_VARIANT });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([triggerLine(), line])))).toEqual([]);
  });

  it('校验3：拿手托赠品冒充键帽活动赠品 → 不发折扣', () => {
    const line = giftLine({ variantId: GIFT_WRISTREST }); // 键帽活动里塞手托赠品
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([triggerLine(), line])))).toEqual([]);
  });

  it('校验4a：_promo_main_variant 不是该活动 trigger → 不发折扣', () => {
    const line = giftLine({ mainVariant: RANDOM_VARIANT });
    const trigger = makeLine({ id: 'T', variantId: RANDOM_VARIANT });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([trigger, line])))).toEqual([]);
  });

  it('校验4b：声明的主品是合法 trigger，但 cart 内无该主品行 → 不发折扣', () => {
    const line = giftLine(); // mainVariant=Air75 V3，但购物车没有这一行
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([line])))).toEqual([]);
  });
});

describe('goboFreeGiftDiscountFunction — 键帽活动正向', () => {
  it('买 Air75 V3 + 合法键帽赠品行 → 送 1 键帽', () => {
    const result = goboFreeGiftDiscountFunction(makeInput([triggerLine('T'), giftLine({ id: 'G' })]));
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G', quantity: 1 } }]);
  });

  it('买 Kick75 矮轴 + 键帽赠品 → 送键帽（锁死：矮轴归键帽）', () => {
    const trigger = makeLine({ id: 'T', variantId: TRIGGER_KEYCAPS_KICK_LOW });
    const gift = giftLine({ id: 'G', mainVariant: TRIGGER_KEYCAPS_KICK_LOW });
    const result = goboFreeGiftDiscountFunction(makeInput([trigger, gift]));
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G', quantity: 1 } }]);
  });
});

describe('goboFreeGiftDiscountFunction — 手托活动正向', () => {
  it('买 Halo IO + 合法手托赠品行 → 送 1 手托', () => {
    const trigger = makeLine({ id: 'T', variantId: TRIGGER_WRISTREST_HALO });
    const gift = giftLine({
      id: 'G',
      variantId: GIFT_WRISTREST,
      promoId: CAMPAIGN_WRISTREST,
      mainVariant: TRIGGER_WRISTREST_HALO,
    });
    const result = goboFreeGiftDiscountFunction(makeInput([trigger, gift]));
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G', quantity: 1 } }]);
  });

  it('买 Kick75 高轴 + 手托赠品 → 送手托（锁死本次改动：高轴归手托）', () => {
    const trigger = makeLine({ id: 'T', variantId: TRIGGER_WRISTREST_KICK_HIGH });
    const gift = giftLine({
      id: 'G',
      variantId: GIFT_WRISTREST,
      promoId: CAMPAIGN_WRISTREST,
      mainVariant: TRIGGER_WRISTREST_KICK_HIGH,
    });
    const result = goboFreeGiftDiscountFunction(makeInput([trigger, gift]));
    expect(getTargets(result)).toEqual([{ cartLine: { id: 'G', quantity: 1 } }]);
  });
});

describe('goboFreeGiftDiscountFunction — Kick 高轴/矮轴 串活动防滥用', () => {
  it('Kick75 高轴 想用键帽活动骗键帽 → 不发（高轴不是键帽 trigger，校验4a 拦截）', () => {
    const trigger = makeLine({ id: 'T', variantId: TRIGGER_WRISTREST_KICK_HIGH });
    const gift = giftLine({ id: 'G', mainVariant: TRIGGER_WRISTREST_KICK_HIGH }); // 键帽活动 + 高轴主品
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([trigger, gift])))).toEqual([]);
  });

  it('Kick75 矮轴 想用手托活动骗手托 → 不发（矮轴不是手托 trigger，校验4a 拦截）', () => {
    const trigger = makeLine({ id: 'T', variantId: TRIGGER_KEYCAPS_KICK_LOW });
    const gift = giftLine({
      id: 'G',
      variantId: GIFT_WRISTREST,
      promoId: CAMPAIGN_WRISTREST,
      mainVariant: TRIGGER_KEYCAPS_KICK_LOW,
    });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([trigger, gift])))).toEqual([]);
  });
});

describe('goboFreeGiftDiscountFunction — 数量截断（1:1 封顶）', () => {
  it('买 2 个主品 + 赠品行 qty=1 → 免 1', () => {
    const trigger = triggerLine('T', TRIGGER_A, 2);
    const gift = giftLine({ id: 'G', quantity: 1 });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([trigger, gift])))).toEqual([
      { cartLine: { id: 'G', quantity: 1 } },
    ]);
  });

  it('买 2 个主品 + 赠品行 qty=2 → 免 2', () => {
    const trigger = triggerLine('T', TRIGGER_A, 2);
    const gift = giftLine({ id: 'G', quantity: 2 });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([trigger, gift])))).toEqual([
      { cartLine: { id: 'G', quantity: 2 } },
    ]);
  });

  it('买 1 个主品 + 赠品行被改大 qty=3 → 只免 1（防数量放大）', () => {
    const trigger = triggerLine('T', TRIGGER_A, 1);
    const gift = giftLine({ id: 'G', quantity: 3 });
    expect(getTargets(goboFreeGiftDiscountFunction(makeInput([trigger, gift])))).toEqual([
      { cartLine: { id: 'G', quantity: 1 } },
    ]);
  });
});

describe('goboFreeGiftDiscountFunction — 跨活动混买（配额独立）', () => {
  it('Air(键帽) + Kick高轴(手托) 各带赠品 → 各送各的', () => {
    const airTrigger = triggerLine('T_AIR', TRIGGER_KEYCAPS_AIR, 1);
    const kickHighTrigger = makeLine({ id: 'T_KICK', variantId: TRIGGER_WRISTREST_KICK_HIGH });
    const keycapGift = giftLine({ id: 'G_KC' });
    const wristGift = giftLine({
      id: 'G_WR',
      variantId: GIFT_WRISTREST,
      promoId: CAMPAIGN_WRISTREST,
      mainVariant: TRIGGER_WRISTREST_KICK_HIGH,
    });
    const result = goboFreeGiftDiscountFunction(
      makeInput([airTrigger, kickHighTrigger, keycapGift, wristGift]),
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G_KC', quantity: 1 } },
      { cartLine: { id: 'G_WR', quantity: 1 } },
    ]);
  });

  it('键帽买 2 → 送 2；手托买 1 → 送 1（两活动配额互不干扰）', () => {
    const airTrigger = triggerLine('T_AIR', TRIGGER_KEYCAPS_AIR, 2);
    const haloTrigger = triggerLine('T_HALO', TRIGGER_WRISTREST_HALO, 1);
    const keycapGift = giftLine({ id: 'G_KC', quantity: 2 });
    const wristGift = giftLine({
      id: 'G_WR',
      variantId: GIFT_WRISTREST,
      promoId: CAMPAIGN_WRISTREST,
      mainVariant: TRIGGER_WRISTREST_HALO,
      quantity: 1,
    });
    const result = goboFreeGiftDiscountFunction(
      makeInput([airTrigger, haloTrigger, keycapGift, wristGift]),
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G_KC', quantity: 2 } },
      { cartLine: { id: 'G_WR', quantity: 1 } },
    ]);
  });
});
