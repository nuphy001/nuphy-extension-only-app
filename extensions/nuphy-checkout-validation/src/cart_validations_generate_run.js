// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 * @typedef {import("../generated/api").ValidationError} ValidationError
 */

const MYSTERY_BOX_ID = "gid://shopify/Product/8122230308973";

const PARTICIPATING_PRODUCT_IDS = new Set([
  "gid://shopify/Product/7070873976941",
  "gid://shopify/Product/7006605148269",
  "gid://shopify/Product/7092124516461",
  "gid://shopify/Product/7351299604589",
  "gid://shopify/Product/7193319899245",
  "gid://shopify/Product/7296925237357",
  "gid://shopify/Product/7952283861101",
  "gid://shopify/Product/7645026746477",
  "gid://shopify/Product/8030986764397",
  "gid://shopify/Product/7883010736237",
  "gid://shopify/Product/8024452825197",
  "gid://shopify/Product/7930955038829",
  "gid://shopify/Product/7930916569197",
  "gid://shopify/Product/7926857203821",
  "gid://shopify/Product/7637823291501",
  "gid://shopify/Product/7493576720493",
  "gid://shopify/Product/7544399757421",
  "gid://shopify/Product/7169059356781",
  "gid://shopify/Product/7090027626605",
  "gid://shopify/Product/7831710236781",
]);

export function cartValidationsGenerateRun(input) {
  const errors = [];

  const step = input?.buyerJourney?.step;
  if (step !== "CHECKOUT_INTERACTION" && step !== "CHECKOUT_COMPLETION") {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // 快速检查：购物车中是否有盲盒产品
  const hasMysteryBox = input.cart.lines.some(
    (line) => line.merchandise?.product?.id === MYSTERY_BOX_ID
  );

  if (!hasMysteryBox) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  let mysteryBoxQuantity = 0;
  let hasOtherProducts = false;
  let hasParticipatingProduct = false;

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    const productId =
      merchandise?.__typename === "ProductVariant" && merchandise.product
        ? merchandise.product.id
        : null;

    if (!productId) continue;

    if (productId === MYSTERY_BOX_ID) {
      mysteryBoxQuantity += line.quantity;
    } else {
      hasOtherProducts = true;
      if (PARTICIPATING_PRODUCT_IDS.has(productId)) {
        hasParticipatingProduct = true;
      }
    }
  }

  if (mysteryBoxQuantity > 0) {
    if (mysteryBoxQuantity > 1) {
      errors.push({
        message: "You can only purchase one Mystery Box per order.",
        target: "cart",
      });
    }

    if (!hasOtherProducts) {
      errors.push({
        message:
          "Mystery Box cannot be purchased alone. Please add something else to your cart.",
        target: "cart",
      });
    } else if (!hasParticipatingProduct) {
      errors.push({
        message:
          "Mystery Box must be purchased with a participating product.",
        target: "cart",
      });
    }
  }

  return {
    operations: [{ validationAdd: { errors } }],
  };
}
