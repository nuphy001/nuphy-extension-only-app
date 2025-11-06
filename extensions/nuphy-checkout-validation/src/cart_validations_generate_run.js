// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 * @typedef {import("../generated/api").ValidationError} ValidationError
 */

// Environment configuration - set to 'production' or 'test'
const ENVIRONMENT = "test"; // Change to 'production' for production environment
// const ENVIRONMENT = "production"; // Change to 'test' for production environment

// Configuration objects for different environments
const CONFIG = {
  test: {
    MYSTERY_BOX_IDS: new Set([
      "gid://shopify/Product/8953675907329", // 盲盒产品一
      "gid://shopify/Product/8953675940097", // 盲盒产品二
    ]),
    DOLLAR_PRODUCT_IDS: new Set([
      "gid://shopify/Product/8953676398849", // WH80 1 Dollar Deposit
      "gid://shopify/Product/8953676103937", // Node75 1 Dollar Deposit
    ]),
  },
  production: {
    MYSTERY_BOX_IDS: new Set([
      "gid://shopify/Product/7867011006573", // Black Friday Mystery Box - $4.99
      "gid://shopify/Product/7867007238253", // Black Friday Mystery Box - $0.99
    ]),
    DOLLAR_PRODUCT_IDS: new Set([
      "gid://shopify/Product/7824752115821", // WH80 1 Dollar Deposit
      "gid://shopify/Product/7843318890605", // Node75 1 Dollar Deposit
    ]),
  },
};

// Get the current configuration based on environment
const { MYSTERY_BOX_IDS, DOLLAR_PRODUCT_IDS } = CONFIG[ENVIRONMENT];

export function cartValidationsGenerateRun(input) {
  const errors = [];

  // 阶段判断：仅在结账阶段执行（CHECKOUT_INTERACTION 或 CHECKOUT_COMPLETION）
  const step = input?.buyerJourney?.step;
  const isCheckoutPhase =
      step === "CHECKOUT_INTERACTION" || step === "CHECKOUT_COMPLETION";
  if (!isCheckoutPhase) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // 统计盲盒产品和1美元产品的数量
  let mysteryBoxQuantity = 0; // 盲盒产品总数量（盲盒产品一 + 盲盒产品二）
  let dollarProductExists = false; // 是否存在1美元产品（任意一个）
  let hasOtherProducts = false; // 是否存在其他产品

  // 性能优化：使用 for...of 替代 forEach，支持提前退出（虽然当前业务逻辑需要完整遍历）
  // 性能优化：减少重复的属性访问
  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    const productId =
        merchandise?.__typename === "ProductVariant" && merchandise.product
            ? merchandise.product.id
            : null;

    if (!productId) continue;

    // 性能优化：使用 Set.has() 实现 O(1) 查找，替代多次字符串比较
    if (MYSTERY_BOX_IDS.has(productId)) {
      mysteryBoxQuantity += line.quantity;
    } else if (DOLLAR_PRODUCT_IDS.has(productId)) {
      dollarProductExists = true;
    } else {
      hasOtherProducts = true;
    }
  }

  // 性能优化：合并条件判断，减少重复检查
  if (mysteryBoxQuantity > 0) {
    // 规则1: 盲盒产品数量不能超过1个（盲盒产品一和盲盒产品二的总数量）
    if (mysteryBoxQuantity > 1) {
      errors.push({
        // message: "盲盒产品数量不能超过1个",
        message: "You can only purchase one Mystery Box per order.",
        target: "cart",
      });
    }

    // 规则2: 盲盒产品和1美元产品不能同时出现
    if (dollarProductExists) {
      errors.push({
        // message: "盲盒产品和定金不能同时出现",
        message: "Mystery Box and deposit products can’t be bought together. ",
        target: "cart",
      });
    }

    // 规则3: 盲盒产品不能单独购买
    if (!hasOtherProducts && !dollarProductExists) {
      errors.push({
        // message: "盲盒产品不能单独购买,请添加其他产品到购物车",
        message:
            "Mystery Box cannot be purchased alone. Please add something else to your cart.",
        target: "cart",
      });
    }
  }

  const operations = [
    {
      validationAdd: {
        errors,
      },
    },
  ];

  return { operations };
}
