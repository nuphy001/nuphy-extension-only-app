import { describe, it, expect } from 'vitest';
import { goboFreeGiftDiscountFunction } from './cart_lines_discounts_generate_run';

/**
 * 测试常量（与 cart_lines_discounts_generate_run.js 内 CAMPAIGNS 同步）
 */
const CAMPAIGN_ID = 'bogo-product-accessory-2026';
const TRIGGER_A = 'gid://shopify/ProductVariant/45206179905645';
const TRIGGER_B = 'gid://shopify/ProductVariant/45206186459245';
const GIFT_VARIANT = 'gid://shopify/ProductVariant/45206179774573';
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

  it('赠品 quantity=5 → 仍只对 1 件打折（防数量放大）', () => {
    const gift = { ...legalGiftLine('G1'), quantity: 5 };
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1'), gift])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } }, // 仅 1 件免单，其余原价
    ]);
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
});

describe('goboFreeGiftDiscountFunction — 多 line 组合', () => {
  it('多个合法赠品 → 都打折', () => {
    const gift1 = legalGiftLine('G1');
    const gift2 = { ...legalGiftLine('G2') };
    const result = goboFreeGiftDiscountFunction(
      makeInput([triggerLine('T1'), gift1, gift2])
    );
    expect(getTargets(result)).toEqual([
      { cartLine: { id: 'G1', quantity: 1 } },
      { cartLine: { id: 'G2', quantity: 1 } },
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
