import { describe, it, expect } from 'vitest';
import { cartValidationsGenerateRun } from './cart_validations_generate_run';

const MYSTERY_BOX_ID = "gid://shopify/Product/8122230308973";
const PARTICIPATING_ID = "gid://shopify/Product/7070873976941";
const OTHER_PRODUCT_ID = "gid://shopify/Product/9999999999999";

function createCartLine(productId, quantity = 1) {
  return {
    quantity,
    merchandise: {
      __typename: "ProductVariant",
      product: { id: productId, isClearance: false }
    }
  };
}

function createInput(cartLines, step = "CHECKOUT_INTERACTION") {
  return {
    buyerJourney: { step },
    cart: { lines: cartLines }
  };
}

describe('阶段判断', () => {
  it('非结账阶段应跳过验证', () => {
    const input = createInput([createCartLine(MYSTERY_BOX_ID, 2)], "CART");
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors).toEqual([]);
  });

  it('CHECKOUT_INTERACTION 阶段应执行验证', () => {
    const input = createInput([createCartLine(MYSTERY_BOX_ID, 2)], "CHECKOUT_INTERACTION");
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBeGreaterThan(0);
  });

  it('CHECKOUT_COMPLETION 阶段应执行验证', () => {
    const input = createInput([createCartLine(MYSTERY_BOX_ID, 2)], "CHECKOUT_COMPLETION");
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBeGreaterThan(0);
  });

  it('buyerJourney 为 undefined 时应跳过验证', () => {
    const input = { cart: { lines: [createCartLine(MYSTERY_BOX_ID, 2)] } };
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors).toEqual([]);
  });
});

describe('规则1: 盲盒产品数量限制', () => {
  it('盲盒数量>1时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 2),
      createCartLine(PARTICIPATING_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "You can only purchase one Mystery Box per order."
    );
    expect(error).toBeDefined();
    expect(error.target).toBe("cart");
  });

  it('同一盲盒多次添加（总数量>1）时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(PARTICIPATING_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "You can only purchase one Mystery Box per order."
    );
    expect(error).toBeDefined();
  });

  it('盲盒数量为1且搭配参与活动产品时应不返回规则1错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(PARTICIPATING_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "You can only purchase one Mystery Box per order."
    );
    expect(error).toBeUndefined();
  });
});

describe('规则2: 盲盒产品不能单独购买', () => {
  it('只有盲盒产品时应返回错误', () => {
    const input = createInput([createCartLine(MYSTERY_BOX_ID, 1)]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "Mystery Box cannot be purchased alone. Please add something else to your cart."
    );
    expect(error).toBeDefined();
    expect(error.target).toBe("cart");
  });

  it('盲盒搭配参与活动产品时应不返回规则2错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(PARTICIPATING_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "Mystery Box cannot be purchased alone. Please add something else to your cart."
    );
    expect(error).toBeUndefined();
  });
});

describe('规则3: 盲盒必须搭配参与活动产品', () => {
  it('盲盒搭配非参与活动产品时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "Mystery Box must be purchased with a participating product."
    );
    expect(error).toBeDefined();
    expect(error.target).toBe("cart");
  });

  it('盲盒搭配参与活动产品时应不返回规则3错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(PARTICIPATING_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "Mystery Box must be purchased with a participating product."
    );
    expect(error).toBeUndefined();
  });

  it('多个非参与活动产品 + 盲盒时应返回规则3错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1),
      createCartLine("gid://shopify/Product/8888888888888", 2)
    ]);
    const result = cartValidationsGenerateRun(input);
    const error = result.operations[0].validationAdd.errors.find(
      e => e.message === "Mystery Box must be purchased with a participating product."
    );
    expect(error).toBeDefined();
  });
});

describe('组合场景', () => {
  it('盲盒数量>1且单独购买时应同时返回规则1和规则2错误', () => {
    const input = createInput([createCartLine(MYSTERY_BOX_ID, 2)]);
    const result = cartValidationsGenerateRun(input);
    const errors = result.operations[0].validationAdd.errors;
    expect(errors.find(
      e => e.message === "You can only purchase one Mystery Box per order."
    )).toBeDefined();
    expect(errors.find(
      e => e.message === "Mystery Box cannot be purchased alone. Please add something else to your cart."
    )).toBeDefined();
    expect(errors.length).toBe(2);
  });

  it('盲盒数量>1且搭配非参与活动产品时应返回规则1和规则3错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 2),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    const errors = result.operations[0].validationAdd.errors;
    expect(errors.find(
      e => e.message === "You can only purchase one Mystery Box per order."
    )).toBeDefined();
    expect(errors.find(
      e => e.message === "Mystery Box must be purchased with a participating product."
    )).toBeDefined();
    expect(errors.length).toBe(2);
  });
});

describe('正常场景', () => {
  it('盲盒（1个）+ 参与活动产品时应不返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(PARTICIPATING_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });

  it('只有参与活动产品时应不返回错误', () => {
    const input = createInput([createCartLine(PARTICIPATING_ID, 2)]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });

  it('只有其他产品时应不返回错误', () => {
    const input = createInput([createCartLine(OTHER_PRODUCT_ID, 2)]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });

  it('空购物车时应不返回错误', () => {
    const input = createInput([]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });
});

describe('边界情况和异常处理', () => {
  it('商品数量为0时应不触发规则', () => {
    const input = createInput([{
      quantity: 0,
      merchandise: { __typename: "ProductVariant", product: { id: MYSTERY_BOX_ID } }
    }]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });

  it('merchandise.__typename 不是 ProductVariant 时应跳过', () => {
    const input = createInput([{
      quantity: 1,
      merchandise: { __typename: "CustomProduct", product: { id: MYSTERY_BOX_ID } }
    }]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });

  it('product 为 null 时应跳过', () => {
    const input = createInput([{
      quantity: 1,
      merchandise: { __typename: "ProductVariant", product: null }
    }]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });

  it('参与活动产品 + 盲盒 + 其他非参与产品组合应通过', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_ID, 1),
      createCartLine(PARTICIPATING_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);
    const result = cartValidationsGenerateRun(input);
    expect(result.operations[0].validationAdd.errors.length).toBe(0);
  });
});

describe('清仓商品结账隔离', () => {
  it('允许混合加购，但在结账交互及最终提交时拦截混购和实体赠品', () => {
    const clearance = createCartLine("gid://shopify/Product/10207871140080", 2);
    clearance.merchandise.product.isClearance = true;
    const regular = createCartLine(OTHER_PRODUCT_ID);
    const gift = { ...regular, attributes: [{ key: "_promo_role", value: "gift" }] };
    expect(cartValidationsGenerateRun(createInput([clearance, regular], "CART_INTERACTION")).operations[0].validationAdd.errors).toEqual([]);
    for (const step of ["CHECKOUT_INTERACTION", "CHECKOUT_COMPLETION"]) {
      for (const other of [regular, gift]) {
        const errors = cartValidationsGenerateRun(createInput([clearance, other], step)).operations[0].validationAdd.errors;
        expect(errors).toEqual([{ message: expect.stringContaining("must be ordered separately"), target: "$.cart" }]);
      }
    }
  });

  it('允许单类与 Seel 运费保障，并保留原有盲盒校验', () => {
    const clearance = createCartLine("gid://shopify/Product/10207871140080", 3);
    clearance.merchandise.product.isClearance = true;
    const protection = createCartLine(OTHER_PRODUCT_ID);
    const regular = createCartLine(PARTICIPATING_ID);
    for (const identity of [{ productType: "SEEL-WFP" }, { vendor: "Seel", handle: "worry-free-delivery" }]) {
      protection.merchandise.product = { id: OTHER_PRODUCT_ID, isClearance: false, ...identity };
      for (const lines of [[clearance, clearance], [regular, regular], [clearance, protection]]) {
        expect(cartValidationsGenerateRun(createInput(lines, "CHECKOUT_COMPLETION")).operations[0].validationAdd.errors).toEqual([]);
      }
    }
    const unknown = createCartLine(OTHER_PRODUCT_ID);
    delete unknown.merchandise.product.isClearance;
    expect(cartValidationsGenerateRun(createInput([clearance, unknown])).operations[0].validationAdd.errors)
      .toEqual([{ message: expect.stringContaining("couldn't verify"), target: "$.cart" }]);
    const errors = cartValidationsGenerateRun(createInput([clearance, createCartLine(MYSTERY_BOX_ID, 2)])).operations[0].validationAdd.errors;
    expect(errors.map(error => error.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("must be ordered separately"),
      "You can only purchase one Mystery Box per order.",
      "Mystery Box must be purchased with a participating product.",
    ]));
  });
});
