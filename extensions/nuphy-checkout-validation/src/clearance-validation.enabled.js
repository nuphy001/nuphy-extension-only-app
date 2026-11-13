// @ts-check

/**
 * @param {import("../generated/api").CartValidationsGenerateRunInput} input
 * @returns {import("../generated/api").ValidationError[]}
 */
export function getClearanceValidationErrors(input) {
  const errors = [];
  // 集合成员由 Shopify 提供；赠品仍参与分类，只有 Seel 运费保障可随清仓商品下单。
  let hasClearance = false;
  let hasRegular = false;
  for (const line of input.cart.lines) {
    if (line.quantity <= 0 || line.merchandise?.__typename !== "ProductVariant") continue;
    const product = line.merchandise.product;
    if (!product) continue;
    const isSeelProtection = product.productType?.toUpperCase() === "SEEL-WFP"
      || (product.vendor?.toLowerCase() === "seel" && product.handle?.toLowerCase().includes("worry-free"));
    if (isSeelProtection) continue;
    // 查询契约为非空布尔值；缺失时不能静默归为普通商品。
    if (typeof product.isClearance !== "boolean") {
      errors.push({
        message: "We couldn't verify the products in your cart. Please return to your cart and try again.",
        target: "$.cart",
      });
      continue;
    }
    if (product.isClearance) hasClearance = true;
    else hasRegular = true;
  }
  if (hasClearance && hasRegular) {
    errors.push({
      message: "Refurbished items ship from a separate warehouse and must be ordered separately from other products. Please remove all non-refurbished items from your cart before proceeding to checkout.",
      target: "$.cart",
    });
  }
  return errors;
}
