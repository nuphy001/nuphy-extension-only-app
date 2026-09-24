import type { PickerResult, Product, ProductRole, Variant } from '../types/api';
import type { StoredCampaign } from '../types/campaign';

export const numericId = (id: string) => id.slice(id.lastIndexOf('/') + 1);

// 合并整款规则和规格所属产品，供列表回显与浏览弹窗使用。
export function selectedProductIds(campaign: StoredCampaign, variants: Record<string, Variant>, role: ProductRole) {
  const ids = new Set(role === 'trigger' ? campaign.triggerProducts?.map(item => item.productId) : []);
  const variantIds = role === 'trigger' ? campaign.triggerVariantIds : campaign.gifts.map(gift => gift.variantId);
  for (const id of variantIds) {
    const productId = variants[id]?.product.id;
    if (productId) ids.add(numericId(productId));
  }
  return [...ids];
}

// 统计去重后的参与规格；整款产品未读全时不显示确定数量。
export function selectedVariantCount(campaign: StoredCampaign, role: ProductRole, products: Record<string, Product>): number | undefined {
  if (role === 'gift') return new Set(campaign.gifts.map(gift => gift.variantId)).size;
  const ids = new Set(campaign.triggerVariantIds);
  for (const rule of campaign.triggerProducts ?? []) {
    const product = products[rule.productId];
    if (!product || product.variants.length !== product.variantsCount) return;
    const excluded = new Set(rule.excludedVariantIds);
    for (const variant of product.variants) {
      const id = numericId(variant.id);
      if (excluded.has(id)) ids.delete(id);
      else ids.add(id);
    }
  }
  return ids.size;
}

// 用本次勾选更新赠品，保留暂时读不到的旧规格。
function selectGifts(campaign: StoredCampaign, result: PickerResult, variants: Record<string, Variant>) {
  const ids = new Set([
    ...campaign.gifts.filter(gift => !variants[gift.variantId]).map(gift => gift.variantId),
    ...result.ids.flatMap(id => result.selection[id]),
  ]);
  return { gifts: [...ids].map(variantId => ({ variantId })) };
}

// 把主商品勾选结果转成保存规则，同时保留无法读取的旧配置。
function selectTriggers(campaign: StoredCampaign, result: PickerResult, variants: Record<string, Variant>) {
  const previouslyExcluded = new Set(campaign.triggerProducts?.flatMap(rule => rule.excludedVariantIds));
  const triggerVariantIds = campaign.triggerVariantIds.filter(id => !variants[id] && !previouslyExcluded.has(id));
  const triggerProducts: NonNullable<StoredCampaign['triggerProducts']> = [];
  for (const productId of result.ids) {
    const current = campaign.triggerProducts?.find(rule => rule.productId === productId);
    const selected = new Set(result.selection[productId]);
    // 当前勾选规格同步给旧商城白名单，产品规则仍由 Function 处理未来新增规格。
    triggerVariantIds.push(...selected);
    // 旧白名单保持原语义，不因在弹窗中确认而纳入未来新增规格。
    const legacyProduct = !current && campaign.triggerVariantIds.some(id => numericId(variants[id]?.product.id ?? '') === productId);
    if (legacyProduct) continue;
    const allIds = new Set(result.products[productId].variants.map(variant => numericId(variant.id)));
    const excluded = new Set([
      ...[...allIds].filter(id => !selected.has(id)),
      ...(current?.excludedVariantIds ?? []).filter(id => !allIds.has(id)),
    ]);
    triggerProducts.push({ productId, excludedVariantIds: [...excluded] });
  }
  const excluded = new Set(triggerProducts.flatMap(rule => rule.excludedVariantIds));
  return { triggerProducts, triggerVariantIds: triggerVariantIds.filter(id => !excluded.has(id)) };
}

// 将商品里的规格按数字 ID 索引，供选择与校验复用。
export function productVariants(products: Record<string, Product>): Record<string, Variant> {
  return Object.fromEntries(Object.values(products).flatMap(product =>
    product.variants.map(variant => [numericId(variant.id), variant]),
  ));
}

// 合并最新规格数据，再按主商品或赠品规则生成草稿补丁。
export function applyProductSelection(campaign: StoredCampaign, role: ProductRole, result: PickerResult, knownVariants: Record<string, Variant>): Partial<StoredCampaign> {
  const variants = { ...knownVariants, ...productVariants(result.products) };
  return role === 'gift' ? selectGifts(campaign, result, variants) : selectTriggers(campaign, result, variants);
}

// 根据整款规则或旧规格白名单，生成当前产品的参与范围说明。
export function triggerSummary(campaign: StoredCampaign, productId: string, product?: Product) {
  if (!product) return '请重试读取产品';
  const rule = campaign.triggerProducts?.find(item => item.productId === productId);
  if (!rule) return '仅部分规格 · 已选 ' + product.variants.filter(variant => campaign.triggerVariantIds.includes(numericId(variant.id))).length + ' 个';
  if (!rule.excludedVariantIds.length) return '全部 ' + product.variantsCount + ' 个规格参与';
  const count = product.variants.filter(variant => !rule.excludedVariantIds.includes(numericId(variant.id))).length;
  return count + ' / ' + product.variantsCount + ' 个规格参与 · 已排除 ' + rule.excludedVariantIds.length + ' 个';
}
