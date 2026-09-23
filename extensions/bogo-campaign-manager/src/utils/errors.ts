import type { UserError } from '../types/api';

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

// 明确拒绝和网络响应丢失走不同的恢复流程，不能合并成普通 Error。
export class MutationError extends Error {}

// 将 Shopify 的业务拒绝转成可识别的异常，并统一并发冲突提示。
export function checkErrors(errors: UserError[]) {
  if (!errors.length) return;
  const conflict = errors.some(error => error.code === 'INVALID_COMPARE_DIGEST' || error.code === 'STALE_OBJECT');
  throw new MutationError(conflict
    ? '活动已被其他人修改。请重新加载后再编辑，避免覆盖对方的修改。'
    : errors.map(error => error.message).join('；'));
}
