// @ts-check

/**
 * 赠品自动 100% off 折扣函数
 * ----------------------------------------
 * 触发链路：
 *   1. 前端 Next.js 端的 BOGO 引擎（src/lib/promotion/engine.ts）将赠品加入购物车时，
 *      会在该行 cart line attribute 上打三类便利贴：
 *        _promo_role  = "gift"       ← 本函数唯一判据
 *        _promo_id    = <campaign id>
 *        _promo_main  = <main variant id>
 *   2. 用户进入 Shopify 结账阶段时，Shopify 引擎自动调用本 Function，
 *      把所有 _promo_role === "gift" 的行打 100% off。
 *
 * 为什么不读 _promo_id / _promo_main？
 *   - 本 MVP 的策略是「所有标记为 gift 的行都归零」，校验主品/活动归属由前端引擎负责。
 *   - GraphQL 查询只取必要字段可降低 Function input payload 体积、规避 Function 执行配额。
 *
 * 为什么不区分 production / test 环境？
 *   - 本函数不依赖任何产品 ID 硬编码（与 nuphy-checkout-validation 不同），
 *     判据完全来自运行时 line attribute，无需环境分支。
 */

/**
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} RunResult
 */

// 空操作返回值：购物车里没有任何赠品行时直接返回，避免生成无效折扣 candidate。
const EMPTY_RESULT = /** @type {RunResult} */ ({ operations: [] });

// 赠品行的 _promo_role 取值。如果未来前端改名（例如改成 "free_gift"），
// 这里也要同步更新；这是本函数与前端引擎之间唯一的「契约字段」。
const GIFT_ROLE = "gift";

// 折扣面值百分比。100 = 完全免费。
const FREE_PERCENTAGE = 100;

// 折扣在结账页面 line item 旁显示的名称（用户可见）。
const DISCOUNT_MESSAGE = "Free Gift";

/**
 * Shopify Function 入口
 * @param {RunInput} input - 由 src/*.graphql 声明字段，Shopify 在结账阶段注入
 * @returns {RunResult}
 */
export function goboFreeGiftDiscountFunction(input) {
  // 步骤 1：过滤出所有带 _promo_role=gift 属性的行。
  //   - line.attribute 为 null（行未挂任何属性 / 未挂该 key）时短路为 undefined。
  //   - line.attribute.value 为其它字符串（如 "main"、"trigger"）时也不命中。
  // 步骤 2：把命中的行映射成 Shopify 2025-07 折扣 target 格式。
  //   - quantity: null = 「整行所有数量都折扣」（赠品行 quantity 恒为 1，写 null 是规范写法）
  const targets = input.cart.lines
    .filter((line) => line.attribute?.value === GIFT_ROLE)
    .map((line) => ({ cartLineTarget: { id: line.id, quantity: null } }));

  // 没有赠品行 → 不产出任何 operation，结账流程正常走。
  if (targets.length === 0) {
    return EMPTY_RESULT;
  }

  // 有赠品行 → 产出 productDiscountsAdd operation，把所有 targets 一次性打 100% off。
  // Shopify 2025-07+ Cart Discount Function 格式要求：
  //   - targets 里是 cartLine 对象数组（含 id）
  //   - selectionStrategy 必须显式指定（如 "FIRST"）
  const cartLineTargets = targets.map((target) => ({
    cartLine: {
      id: target.cartLineTarget.id,
    },
  }));

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
