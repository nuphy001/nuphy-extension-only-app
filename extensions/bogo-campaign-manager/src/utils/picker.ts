import type { NativeSelection, PickerOptions, PickerProductSelection, PickerResult, Product, ProductSelectionId, Variant } from '../types/api';
import { resourceId, uniqueIds } from './ids';

const inStock = (variant: Variant) => typeof variant.inventoryQuantity === 'number' && variant.inventoryQuantity > 0;
// 只识别单个完整 Handle 条件，其他搜索语句交给原生选择器处理。
export const isHandleSearch = (search?: string) => Boolean(search && /^handle:(?:[a-z0-9-]+|"[a-z0-9-]+"|'[a-z0-9-]+')$/i.test(search));

// 校验并去重回显范围中的规格 ID，保留整款与白名单的区别。
export function pickerRanges(initial: PickerProductSelection[]) {
  return initial.map(item => ({
    productId: item.productId,
    variantIds: item.variantIds === undefined ? undefined : uniqueIds(item.variantIds),
    excludedVariantIds: item.excludedVariantIds === undefined ? undefined : uniqueIds(item.excludedVariantIds),
  }));
}

// 用最新商品数据构造原生勾选项，并检查已选规格的存在性和库存。
export function initialSelection(ranges: PickerProductSelection[], products: Record<string, Product>, options: PickerOptions): ProductSelectionId[] {
  if (ranges.some(item => !products[item.productId])) throw new Error('部分商品已删除或不可访问，请先移除对应商品后重新选择。');
  return ranges.map(item => {
    const variants = products[item.productId].variants;
    const allIds = variants.map(variant => resourceId(variant.id, 'ProductVariant'));
    const available = new Set(allIds);
    const excluded = new Set(item.excludedVariantIds);
    // 整款范围包含新规格；旧白名单与赠品仅回显明确选择的规格。
    const variantIds = item.excludedVariantIds !== undefined ? allIds.filter(id => !excluded.has(id)) : item.variantIds ?? allIds;
    if (variantIds.some(id => !available.has(id))) throw new Error('部分规格已删除或不可访问，请先移除对应规格后重新选择。');
    const selected = new Set(variantIds);
    if (options.inStockOnly && variants.some(variant => selected.has(resourceId(variant.id, 'ProductVariant')) && !inStock(variant))) {
      throw new Error('已选赠品中有库存不足或库存未知的规格，请先移除对应赠品，或关闭「仅选择有库存的赠品」。');
    }
    return { id: `gid://shopify/Product/${item.productId}`, variants: variantIds.map(id => ({ id: `gid://shopify/ProductVariant/${id}` })) };
  });
}

// 将产品勾选项转成规格勾选项，同时检查单规格限制。
export function variantSelection(products: ProductSelectionId[], options: PickerOptions) {
  const ids = [...new Set(products.flatMap(item => item.variants.map(variant => variant.id)))];
  if (options.singleVariantOnly && ids.length > 1) throw new Error('当前已选择多个赠品规格，请先移除多余赠品，或关闭「仅允许一个赠品规格」。');
  return ids.map(id => ({ id }));
}

// 统一两种原生选择器的返回格式，并按产品合并去重后的规格。
export function normalizeSelection(picked: NativeSelection, variantPicker: boolean, options: PickerOptions) {
  const normalized = variantPicker ? picked.map(item => {
    if (!('product' in item) || !item.product?.id) throw new Error('未能读取所选规格的所属产品，请重新选择。');
    return { id: item.product.id, variants: [{ id: item.id }] };
  }) : picked;
  const selected = new Map<string, Set<string>>();
  for (const item of normalized) {
    const id = resourceId(item.id, 'Product');
    if (!('variants' in item) || !Array.isArray(item.variants) || !item.variants.length) throw new Error('未能读取所选规格，请重新选择。');
    const ids = item.variants.map(variant => resourceId(variant.id ?? '', 'ProductVariant'));
    const variants = selected.get(id) ?? new Set<string>();
    ids.forEach(id => variants.add(id));
    selected.set(id, variants);
  }
  const selection = Object.fromEntries([...selected].map(([id, variants]) => [id, [...variants]]));
  if (options.singleVariantOnly && Object.values(selection).flat().length > 1) throw new Error('只能选择一个赠品规格，请重新选择。');
  return { ids: [...selected.keys()], selection };
}

// 确认选择后再核对最新数据，防止弹窗期间规格删除或库存变化。
export function validateSelection({ ids, products, selection }: PickerResult, options: PickerOptions) {
  if (ids.some(id => !products[id])) throw new Error('部分商品已删除或不可访问，请重新选择。');
  for (const id of ids) {
    const available = new Map(products[id].variants.map(variant => [resourceId(variant.id, 'ProductVariant'), variant]));
    if (selection[id].some(variantId => !available.has(variantId))) throw new Error('部分所选规格已删除或不可访问，请重新选择。');
    if (options.inStockOnly && selection[id].some(variantId => !inStock(available.get(variantId)!))) throw new Error('部分所选赠品规格库存不足或库存未知，请重新选择。');
  }
}
