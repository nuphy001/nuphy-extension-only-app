// @ts-check

/**
 * 活动期拒绝所有用户输入的折扣码。
 * 活动时间只由驱动本 Function 的自动折扣的 startsAt / endsAt 决定，这里不判断时间。
 * Shopify 规定拒绝 rejectable=false 的券会让结果无效，所以必须先过滤。
 *
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} RunResult
 */

const EMPTY_RESULT = /** @type {RunResult} */ ({ operations: [] });
const MESSAGE_EN = "Discount codes can't be used during our Black Friday sale. Sale prices apply automatically.";
const MESSAGE_JA = 'ブラックフライデーセール期間中はクーポンコードをご利用いただけません。セール価格は自動で適用されます。';

/**
 * @param {RunInput} input
 * @returns {RunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const codes = input.enteredDiscountCodes
    .filter(entered => entered.rejectable)
    .map(({ code }) => ({ code }));
  if (codes.length === 0) return EMPTY_RESULT;

  const message = input.localization?.language?.isoCode === 'JA' ? MESSAGE_JA : MESSAGE_EN;
  return { operations: [{ enteredDiscountCodesReject: { codes, message } }] };
}
