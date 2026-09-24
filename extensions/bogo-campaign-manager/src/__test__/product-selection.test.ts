import { expect, it } from 'vitest';
import { applyProductSelection, selectedVariantCount } from '../utils/selection';
import type { Product, Variant } from '../types/api';
import type { StoredCampaign } from '../types/campaign';

const variant = (id: string, productId: string): Variant => ({ id: `gid://shopify/ProductVariant/${id}`, title: id, product: { id: `gid://shopify/Product/${productId}`, title: productId } });
const a = [variant('11', '1'), variant('12', '1'), variant('13', '1')];
const b = [variant('21', '2')];
const products: Record<string, Product> = {
  1: { id: 'gid://shopify/Product/1', title: '1', featuredImage: null, variants: a, variantsCount: a.length },
  2: { id: 'gid://shopify/Product/2', title: '2', featuredImage: null, variants: b, variantsCount: b.length },
};
const known = Object.fromEntries([...a, ...b].map(item => [item.title, item]));
const campaign: StoredCampaign = { id: 'test', enabled: false, triggerVariantIds: [], gifts: [{ variantId: '11' }] };

it('主商品规格按整款规则与旧白名单去重，排除优先且不误减已不存在的规格', () => {
  const current = { ...campaign, triggerVariantIds: ['11', '12', '21', '21'],
    triggerProducts: [{ productId: '1', excludedVariantIds: ['12', '99'] }] };
  expect(selectedVariantCount(current, 'trigger', products)).toBe(3);
});

it('整款产品缺失或规格未读全时不返回确定数量', () => {
  const current = { ...campaign, triggerProducts: [{ productId: '1', excludedVariantIds: [] }] };
  expect(selectedVariantCount(current, 'trigger', {})).toBeUndefined();
  expect(selectedVariantCount(current, 'trigger', { 1: { ...products[1], variants: [a[0]] } })).toBeUndefined();
});

it('赠品直接按保存的规格 ID 去重计数，不依赖产品是否读回', () => {
  const current = { ...campaign, gifts: [{ variantId: '11' }, { variantId: '11' }, { variantId: '12' }, { variantId: '98' }] };
  expect(selectedVariantCount(current, 'gift', {})).toBe(3);
});

it('把原生勾选结果保存为逐产品排除项，并保留暂不可读的旧排除记录', () => {
  const current = { ...campaign, triggerVariantIds: ['13', '99'], triggerProducts: [{ productId: '1', excludedVariantIds: ['12', '99'] }] };
  expect(applyProductSelection(current, 'trigger', { ids: ['1', '2'], products, selection: { 1: ['11', '12'], 2: ['21'] } }, known)).toEqual({
    triggerVariantIds: ['11', '12', '21'], triggerProducts: [
      { productId: '1', excludedVariantIds: ['13', '99'] },
      { productId: '2', excludedVariantIds: [] },
    ],
  });
  expect(applyProductSelection(current, 'trigger', { ids: [], products: {}, selection: {} }, known)).toEqual({ triggerProducts: [], triggerVariantIds: [] });
});

it('旧活动重新确认所有现有规格时仍保留白名单语义', () => {
  const current = { ...campaign, triggerVariantIds: ['11', '98'] };
  expect(applyProductSelection(current, 'trigger', { ids: ['1'], products, selection: { 1: ['11', '12', '13'] } }, known)).toEqual({
    triggerProducts: [], triggerVariantIds: ['98', '11', '12', '13'],
  });
});

it('赠品保存全部勾选规格，取消的规格移除，新读回的规格不会重复添加', () => {
  const current = { ...campaign, gifts: [{ variantId: '11' }, { variantId: '12' }, { variantId: '98' }] };
  expect(applyProductSelection(current, 'gift', { ids: ['1', '2'], products, selection: { 1: ['12', '13'], 2: ['21'] } }, {})).toEqual({
    gifts: [{ variantId: '98' }, { variantId: '12' }, { variantId: '13' }, { variantId: '21' }],
  });
});
