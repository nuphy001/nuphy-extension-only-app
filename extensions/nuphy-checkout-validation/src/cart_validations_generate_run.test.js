import { describe, it, expect } from 'vitest';
import { cartValidationsGenerateRun } from './cart_validations_generate_run';

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

// 测试用的产品ID常量（与主函数保持一致 - 测试环境）
const MYSTERY_BOX_1_ID = "gid://shopify/Product/8953675907329"; // 盲盒产品一
const MYSTERY_BOX_2_ID = "gid://shopify/Product/8953675940097"; // 盲盒产品二
const DOLLAR_PRODUCT_1_ID = "gid://shopify/Product/8953676398849"; // WH80 1 Dollar Deposit
const DOLLAR_PRODUCT_2_ID = "gid://shopify/Product/8953676103937"; // Node75 1 Dollar Deposit
const OTHER_PRODUCT_ID = "gid://shopify/Product/9999999999999"; // 其他产品

// 辅助函数：创建购物车商品行
function createCartLine(productId, quantity = 1) {
  return {
    quantity,
    merchandise: {
      __typename: "ProductVariant",
      product: {
        id: productId
      }
    }
  };
}

// 辅助函数：创建带阶段的输入
function createInput(cartLines, step = "CHECKOUT_INTERACTION") {
  return {
    buyerJourney: { step },
    cart: {
      lines: cartLines
    }
  };
}

describe('cartValidationsGenerateRun - 阶段判断', () => {
  it('非结账阶段（购物车阶段）应跳过验证并返回空错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 2)
    ], "CART");

    const result = cartValidationsGenerateRun(input);

    expect(result.operations[0].validationAdd.errors).toEqual([]);
  });

  it('CHECKOUT_INTERACTION 阶段应执行验证', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 2)
    ], "CHECKOUT_INTERACTION");

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBeGreaterThan(0);
  });

  it('CHECKOUT_COMPLETION 阶段应执行验证', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 2)
    ], "CHECKOUT_COMPLETION");

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBeGreaterThan(0);
  });

  it('buyerJourney 为 undefined 时应跳过验证', () => {
    const input = {
      cart: {
        lines: [createCartLine(MYSTERY_BOX_1_ID, 2)]
      }
    };

    const result = cartValidationsGenerateRun(input);

    expect(result.operations[0].validationAdd.errors).toEqual([]);
  });
});

describe('cartValidationsGenerateRun - 规则1: 盲盒产品数量限制', () => {
  it('盲盒产品一数量超过1个时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 2),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    expect(rule1Error).toBeDefined();
    expect(rule1Error.target).toBe("cart");
  });

  it('盲盒产品二数量超过1个时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_2_ID, 3),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    expect(rule1Error).toBeDefined();
  });

  it('盲盒产品一和盲盒产品二同时存在时应返回错误（总数量>1）', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    expect(rule1Error).toBeDefined();
  });

  it('盲盒产品一数量为1个时应不返回规则1错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    expect(rule1Error).toBeUndefined();
  });

  it('盲盒产品二数量为1个时应不返回规则1错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    expect(rule1Error).toBeUndefined();
  });
});

describe('cartValidationsGenerateRun - 规则2: 盲盒产品和1美元产品不能同时购买', () => {
  it('盲盒产品一和1美元产品一同时存在时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(DOLLAR_PRODUCT_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule2Error).toBeDefined();
    expect(rule2Error.target).toBe("cart");
  });

  it('盲盒产品一和1美元产品二同时存在时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(DOLLAR_PRODUCT_2_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule2Error).toBeDefined();
  });

  it('盲盒产品二和1美元产品一同时存在时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(DOLLAR_PRODUCT_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule2Error).toBeDefined();
  });

  it('盲盒产品二和1美元产品二同时存在时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(DOLLAR_PRODUCT_2_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule2Error).toBeDefined();
  });

  it('只有1美元产品时应不返回规则2错误', () => {
    const input = createInput([
      createCartLine(DOLLAR_PRODUCT_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule2Error).toBeUndefined();
  });

  it('只有盲盒产品和其他产品时应不返回规则2错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule2Error).toBeUndefined();
  });

  it('1美元产品一和1美元产品二可以同时存在', () => {
    const input = createInput([
      createCartLine(DOLLAR_PRODUCT_1_ID, 1),
      createCartLine(DOLLAR_PRODUCT_2_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule2Error).toBeUndefined();
  });
});

describe('cartValidationsGenerateRun - 规则3: 盲盒产品不能单独购买', () => {
  it('只有盲盒产品一时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule3Error = errors.find(e =>
        e.message === "盲盒产品不能单独购买,请添加其他产品到购物车"
    );
    expect(rule3Error).toBeDefined();
    expect(rule3Error.target).toBe("cart");
  });

  it('只有盲盒产品二时应返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_2_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule3Error = errors.find(e =>
        e.message === "盲盒产品不能单独购买,请添加其他产品到购物车"
    );
    expect(rule3Error).toBeDefined();
  });

  it('盲盒产品一和其他产品一起时应不返回规则3错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule3Error = errors.find(e =>
        e.message === "盲盒产品不能单独购买,请添加其他产品到购物车"
    );
    expect(rule3Error).toBeUndefined();
  });

  it('盲盒产品二和其他产品一起时应不返回规则3错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule3Error = errors.find(e =>
        e.message === "盲盒产品不能单独购买,请添加其他产品到购物车"
    );
    expect(rule3Error).toBeUndefined();
  });

  it('盲盒产品一和1美元产品一起时应触发规则2而不是规则3', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(DOLLAR_PRODUCT_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    const rule3Error = errors.find(e =>
        e.message === "盲盒产品不能单独购买,请添加其他产品到购物车"
    );
    expect(rule2Error).toBeDefined();
    expect(rule3Error).toBeUndefined(); // 规则3不应该触发，因为有1美元产品
  });
});

describe('cartValidationsGenerateRun - 正常场景', () => {
  it('盲盒产品一（1个）和其他产品一起时应不返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('盲盒产品二（1个）和其他产品一起时应不返回错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('只有1美元产品时应不返回错误', () => {
    const input = createInput([
      createCartLine(DOLLAR_PRODUCT_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('只有其他产品时应不返回错误', () => {
    const input = createInput([
      createCartLine(OTHER_PRODUCT_ID, 2)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('空购物车时应不返回错误', () => {
    const input = createInput([]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('多个其他产品时应不返回错误', () => {
    const input = createInput([
      createCartLine(OTHER_PRODUCT_ID, 1),
      createCartLine("gid://shopify/Product/8888888888888", 2),
      createCartLine("gid://shopify/Product/7777777777777", 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });
});

describe('cartValidationsGenerateRun - 组合场景（多个规则同时触发）', () => {
  it('盲盒产品数量>1且与1美元产品同时存在时应返回规则1和规则2的错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 2),
      createCartLine(DOLLAR_PRODUCT_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule1Error).toBeDefined();
    expect(rule2Error).toBeDefined();
    expect(errors.length).toBe(2);
  });

  it('盲盒产品数量>1且单独购买时应返回规则1和规则3的错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 2)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    const rule3Error = errors.find(e =>
        e.message === "盲盒产品不能单独购买,请添加其他产品到购物车"
    );
    expect(rule1Error).toBeDefined();
    expect(rule3Error).toBeDefined();
    expect(errors.length).toBe(2);
  });

  it('盲盒产品一和盲盒产品二同时存在且与1美元产品一起时应返回规则1和规则2的错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(DOLLAR_PRODUCT_1_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    const rule2Error = errors.find(e =>
        e.message === "盲盒产品和1美元产品不能同时购买,请移除其中一个"
    );
    expect(rule1Error).toBeDefined();
    expect(rule2Error).toBeDefined();
    expect(errors.length).toBe(2);
  });
});

describe('cartValidationsGenerateRun - 边界情况和异常处理', () => {
  it('商品数量为0时应正确处理', () => {
    const input = createInput([
      {
        quantity: 0,
        merchandise: {
          __typename: "ProductVariant",
          product: {
            id: MYSTERY_BOX_1_ID
          }
        }
      }
    ]);

    const result = cartValidationsGenerateRun(input);

    // 数量为0的盲盒产品不应触发规则
    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('merchandise.__typename 不是 ProductVariant 时应跳过', () => {
    const input = createInput([
      {
        quantity: 1,
        merchandise: {
          __typename: "CustomProduct",
          product: {
            id: MYSTERY_BOX_1_ID
          }
        }
      }
    ]);

    const result = cartValidationsGenerateRun(input);

    // 非 ProductVariant 类型应被跳过，不触发规则
    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('productId 为 null 时应跳过', () => {
    const input = createInput([
      {
        quantity: 1,
        merchandise: {
          __typename: "ProductVariant",
          product: null
        }
      }
    ]);

    const result = cartValidationsGenerateRun(input);

    // productId 为 null 应被跳过
    const errors = result.operations[0].validationAdd.errors;
    expect(errors.length).toBe(0);
  });

  it('多个盲盒产品一（数量总和>1）时应返回规则1错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(MYSTERY_BOX_1_ID, 1), // 同一个产品添加两次
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    expect(rule1Error).toBeDefined();
  });

  it('盲盒产品一（1个）+ 盲盒产品二（1个）+ 其他产品时应返回规则1错误', () => {
    const input = createInput([
      createCartLine(MYSTERY_BOX_1_ID, 1),
      createCartLine(MYSTERY_BOX_2_ID, 1),
      createCartLine(OTHER_PRODUCT_ID, 1)
    ]);

    const result = cartValidationsGenerateRun(input);

    const errors = result.operations[0].validationAdd.errors;
    const rule1Error = errors.find(e =>
        e.message === "盲盒产品每次只能购买1个,请调整数量"
    );
    expect(rule1Error).toBeDefined();
  });
});
