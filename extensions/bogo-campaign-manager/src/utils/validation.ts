import type { PickerOptions, Product } from '../types/api';
import type { Catalog, Editor, Issues, StoredCampaign, StoredTriggerProduct, ValidationResult } from '../types/campaign';
import { numericId } from './selection';
import { readSchedule } from './schedule';
import { errorMessage } from './errors';

// 产品规格必须读全且至少保留一个参与项，才能保存排除规则。
function triggerProductIssue(rule: StoredTriggerProduct, product?: Product) {
  if (!product || product.variants.length !== product.variantsCount) return '产品规格尚未完整读取，请重试后再保存';
  const excluded = new Set(rule.excludedVariantIds);
  if (product.variants.every(variant => excluded.has(numericId(variant.id)))) {
    return '至少保留一个参与规格，或移除不参与的产品';
  }
}

// 汇总旧规格白名单与整款产品规则的适用范围问题。
function triggerIssue(draft: StoredCampaign, { products, variants }: Catalog) {
  if (draft.triggerVariantIds.some(id => !variants[id])) return '部分适用规格无法读取，请重试或移除';
  // 保持原有提示顺序：后面的产品错误覆盖前面的，正常产品不清除已有错误。
  const productIssue = draft.triggerProducts?.reduce<string | undefined>(
    (previous, rule) => triggerProductIssue(rule, products[rule.productId]) ?? previous, undefined,
  );
  if (productIssue) return productIssue;
  if (!draft.triggerProducts?.length && !draft.triggerVariantIds.length) return '请选择至少一个适用产品';
}

// 检查赠品是否可读取，并应用本次编辑的单规格限制。
function giftIssue({ draft, giftPickerOptions }: Editor, { variants }: Catalog) {
  if (giftPickerOptions?.singleVariantOnly && draft.gifts.length > 1) return '已开启单规格限制，请移除多余赠品或关闭开关';
  if (draft.gifts.some(gift => !variants[gift.variantId])) return '部分赠品规格无法读取，请重试或移除';
  if (!draft.gifts.length) return '请在浏览弹窗中选择至少一个赠品规格';
}

function quantityIssue(quantity: StoredCampaign['triggerQuantity']) {
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647)) {
    return '请填写大于 0 的整数';
  }
}

// 合并旧赠品后再次检查规格数，防止不可读规格绕过单规格限制。
export function validateGiftSelection(patch: Partial<StoredCampaign>, options: PickerOptions) {
  if (options.singleVariantOnly && (patch.gifts?.length ?? 0) > 1) {
    throw new Error('仍有无法读取的旧赠品，请先移除后重新选择。');
  }
}

// 汇总字段错误；全部通过后返回整理好的活动草稿。
export function validateEditor(current: Editor, catalog: Catalog, timeZone: string, now = Date.now()): ValidationResult {
  const draft = { ...current.draft, name: current.draft.name?.trim() };
  const issues: Issues = Object.fromEntries(Object.entries({
    name: draft.name ? undefined : '请填写活动名称',
    trigger: triggerIssue(draft, catalog),
    gift: giftIssue(current, catalog),
    quantity: quantityIssue(draft.triggerQuantity),
  }).filter(([, issue]) => issue));
  try { Object.assign(draft, readSchedule(current.schedule, timeZone, now, current.base)); }
  catch (cause) { issues.schedule = errorMessage(cause); }
  return Object.values(issues).some(Boolean) ? { issues } : { campaign: draft, issues: {} };
}
