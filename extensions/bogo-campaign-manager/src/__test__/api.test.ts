import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';
import type { StandardRenderingExtensionApi } from '@shopify/ui-extensions/admin';
import { pickProducts, loadProducts, loadVariants } from '../api';
import type { PickerOptions, Variant } from '../types/api';

type PickerRequest = Parameters<StandardRenderingExtensionApi<'admin.app.home.render'>['resourcePicker']>[0];
type QueryOptions = { variables: { id?: string; ids?: string[]; after?: string | null; query?: string }; version: string };
type VariantNode = Pick<Variant, 'id' | 'title' | 'sku' | 'inventoryQuantity'> & { media: { nodes: [] } };
const gid = (id: string) => `gid://shopify/ProductVariant/${id}`;
const resourcePicker = vi.fn<(options: PickerRequest) => Promise<unknown[] | undefined>>();
const query = vi.fn<(document: string, options: QueryOptions) => Promise<{ data: unknown }>>();

beforeEach(() => {
  resourcePicker.mockReset();
  query.mockReset();
  vi.stubGlobal('shopify', { resourcePicker, query });
});
afterEach(() => vi.unstubAllGlobals());

const productGid = (id: string) => `gid://shopify/Product/${id}`;
const pickedProduct = (id: string, variants: string[]) => ({ id: productGid(id), variants: variants.map(id => ({ id: gid(id) })) });
const pickedVariant = (productId: string, variantId: string) => ({ id: gid(variantId), product: { id: productGid(productId) } });
function productPage(id: string, variants: string[], hasNextPage = false, endCursor: string | null = null, count = variants.length) {
  return { data: { product: {
    id: productGid(id), title: 'Node 75', featuredMedia: { image: { url: 'https://example.com/node.jpg', altText: null } },
    variantsCount: { count }, variants: { nodes: variants.map((id): VariantNode => ({ id: gid(id), title: `规格 ${id}`, sku: `SKU-${id}`, media: { nodes: [] } })), pageInfo: { hasNextPage, endCursor } },
  } } };
}
function stockPage(id: string, inventory: Record<string, number | null | undefined>) {
  const page = productPage(id, Object.keys(inventory));
  for (const variant of page.data.product.variants.nodes) variant.inventoryQuantity = inventory[variant.id.split('/').pop()!];
  return page;
}

it('产品弹窗显示规格层级，结果仅保留勾选规格且完整读取产品详情', async () => {
  const id = '9007199254740993';
  resourcePicker.mockResolvedValue([pickedProduct(id, [id, id]), pickedProduct(id, ['3'])]);
  query.mockResolvedValueOnce(productPage('42', ['1', '2']));
  query.mockResolvedValueOnce(productPage(id, [id, '2'], true, 'page-2', 3));
  query.mockResolvedValueOnce(productPage(id, ['3'], false, null, 3));
  const result = await pickProducts([{ productId: '42', variantIds: ['1', '1'] }], 'node');
  assert(result);
  expect(resourcePicker).toHaveBeenCalledWith({
    type: 'product', action: 'select', multiple: true, filter: { variants: true },
    selectionIds: [pickedProduct('42', ['1'])], query: 'node',
  });
  expect(result.ids).toEqual([id]);
  expect(result.selection).toEqual({ [id]: [id, '3'] });
  expect(result.products[id].variants.map(variant => variant.id)).toEqual([id, '2', '3'].map(gid));
  expect(result.products[id].variants[2].product).toEqual({ id: productGid(id), title: 'Node 75' });
  expect(result.products[id].variantsCount).toBe(3);
  expect(query.mock.calls[2][1].variables.after).toBe('page-2');
});

it('整款排除范围按最新完整规格预选，新规格默认参与', async () => {
  const initial = [{ productId: '42', excludedVariantIds: ['2'] }];
  query.mockResolvedValueOnce(productPage('42', ['1', '2'], true, 'page-2', 3));
  query.mockResolvedValueOnce(productPage('42', ['3'], false, null, 3));
  resourcePicker.mockResolvedValue(undefined);
  expect(await pickProducts(initial)).toBeUndefined();
  expect(resourcePicker.mock.calls[0][0].selectionIds).toEqual([pickedProduct('42', ['1', '3'])]);

  query.mockResolvedValueOnce(productPage('42', ['1', '2', '3', '4']));
  expect(await pickProducts(initial)).toBeUndefined();
  expect(resourcePicker.mock.calls[1][0].selectionIds).toEqual([pickedProduct('42', ['1', '3', '4'])]);
  expect(initial).toEqual([{ productId: '42', excludedVariantIds: ['2'] }]);
});

it('空排除数组表示整款，优先于显式规格且包含新规格', async () => {
  query.mockResolvedValue(productPage('42', ['1', '2', '3']));
  resourcePicker.mockResolvedValue(undefined);
  await pickProducts([{ productId: '42', excludedVariantIds: [], variantIds: ['1'] }]);
  expect(resourcePicker.mock.calls[0][0].selectionIds).toEqual([pickedProduct('42', ['1', '2', '3'])]);
});

it('legacy 和赠品显式范围不因产品出现新规格而扩大预选', async () => {
  query.mockResolvedValue(productPage('42', ['1', '2', '3']));
  resourcePicker.mockResolvedValue(undefined);
  await pickProducts([{ productId: '42', variantIds: ['1'] }]);
  expect(resourcePicker.mock.calls[0][0].selectionIds).toEqual([pickedProduct('42', ['1'])]);
});

it('分页失败不返回部分规格列表', async () => {
  query.mockResolvedValueOnce(productPage('42', ['1'], true, 'page-2', 2)).mockRejectedValueOnce(new Error('断网'));
  await expect(loadProducts(['42'])).rejects.toThrow('断网');
});

it('分页游标异常或读取数量变化时拒绝不完整结果', async () => {
  query.mockResolvedValueOnce(productPage('42', ['1'], true, null, 2));
  await expect(loadProducts(['42'])).rejects.toThrow('完整规格');
  query.mockResolvedValueOnce(productPage('42', ['1'], false, null, 2));
  await expect(loadProducts(['42'])).rejects.toThrow('发生变化');
});

it.each<PickerOptions>([{}, { singleVariantOnly: true, inStockOnly: true }])('选择器选项 %j 下取消保留原值，清空返回空选择', async options => {
  resourcePicker.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
  query.mockResolvedValue(stockPage('42', { 1: 2 }));
  const initial = [{ productId: '42', variantIds: ['1'] }];
  expect(await pickProducts(initial, undefined, options)).toBeUndefined();
  expect(await pickProducts(initial, undefined, options)).toEqual({ ids: [], products: {}, selection: {} });
  expect(initial).toEqual([{ productId: '42', variantIds: ['1'] }]);
});

it('不把消失的产品或变体 ID 当作成功的产品选择', async () => {
  resourcePicker.mockResolvedValueOnce([pickedProduct('42', ['1'])]);
  query.mockResolvedValueOnce({ data: { product: null } });
  await expect(pickProducts([])).rejects.toThrow('已删除或不可访问');
  resourcePicker.mockResolvedValueOnce([{ id: gid('42') }]);
  await expect(pickProducts([])).rejects.toThrow('请重新选择');
});

it('初始商品或显式规格已删除时拒绝打开，避免静默丢失原范围', async () => {
  query.mockResolvedValueOnce({ data: { product: null } });
  await expect(pickProducts([{ productId: '42', excludedVariantIds: [] }])).rejects.toThrow('已删除或不可访问');
  query.mockResolvedValueOnce(productPage('42', ['1', '2']));
  await expect(pickProducts([{ productId: '42', variantIds: ['3'] }])).rejects.toThrow('规格已删除或不可访问');
  expect(resourcePicker).not.toHaveBeenCalled();
});

it('返回规格缺失或为空时拒绝猜测整款范围', async () => {
  resourcePicker.mockResolvedValueOnce([{ id: productGid('42') }]);
  await expect(pickProducts([])).rejects.toThrow('未能读取所选规格');
  resourcePicker.mockResolvedValueOnce([pickedProduct('42', [])]);
  await expect(pickProducts([])).rejects.toThrow('未能读取所选规格');
  resourcePicker.mockResolvedValueOnce([{ id: productGid('42'), variants: [{}] }]);
  await expect(pickProducts([])).rejects.toThrow('请重新选择');
  expect(query).not.toHaveBeenCalled();
});

it.each<PickerOptions>([{}, { singleVariantOnly: true }])('选择器选项 %j 下确认后规格消失或归属不符时拒绝应用', async options => {
  resourcePicker.mockResolvedValue(options.singleVariantOnly ? [pickedVariant('42', '3')] : [pickedProduct('42', ['3'])]);
  query.mockResolvedValue(productPage('42', ['1', '2']));
  await expect(pickProducts([], undefined, options)).rejects.toThrow('所选规格已删除或不可访问');
});

it('变体详情按 100 个分批，保持字符串 ID 和图片信息', async () => {
  const image = { url: 'https://example.com/variant.jpg', altText: '白色' };
  query.mockImplementation(async (_, { variables }) => ({ data: { nodes: variables.ids?.map(id => ({ id, title: '规格', sku: 'sku', product: { id: productGid('4'), title: 'Node' }, media: { nodes: [{ image }] } })) ?? [] } }));
  const ids = Array.from({ length: 101 }, (_, index) => String(index + 1));
  const result = await loadVariants(ids);
  expect(query).toHaveBeenCalledTimes(2);
  expect(result['101'].image).toEqual(image);
  expect(Object.keys(result)).toHaveLength(101);
});

it('详情读取失败时不返回可应用的选择', async () => {
  resourcePicker.mockResolvedValue([pickedProduct('42', ['1'])]);
  query.mockRejectedValue(new Error('读取失败'));
  await expect(pickProducts([])).rejects.toThrow('读取失败');
});

it('预选读取失败时不打开选择器', async () => {
  query.mockRejectedValue(new Error('读取失败'));
  await expect(pickProducts([{ productId: '42', excludedVariantIds: [] }])).rejects.toThrow('读取失败');
  expect(resourcePicker).not.toHaveBeenCalled();
});

it('选择器不可用或打开失败时给出错误', async () => {
  resourcePicker.mockRejectedValue(new Error('打开失败'));
  await expect(pickProducts([])).rejects.toThrow('打开失败');
  vi.stubGlobal('shopify', { query });
  await expect(pickProducts([])).rejects.toThrow('商品选择器暂时不可用');
  expect(query).not.toHaveBeenCalled();
});

it.each<[PickerOptions, boolean, { query?: string }, number]>([
  [{ singleVariantOnly: true }, false, {}, 0],
  [{ inStockOnly: true }, true, { query: 'inventory_quantity:>0' }, 2],
  [{ singleVariantOnly: true, inStockOnly: true }, false, { query: 'inventory_quantity:>0' }, 2],
])('赠品选项 %j 使用规格弹窗并保留搜索和预选', async (options, multiple, filter, inventoryQuantity) => {
  query.mockResolvedValue(stockPage('42', { 1: inventoryQuantity, 2: 0 }));
  resourcePicker.mockResolvedValue([pickedVariant('42', '1')]);
  const result = await pickProducts([{ productId: '42', variantIds: ['1'] }], 'node', options);
  assert(result);
  expect(resourcePicker).toHaveBeenCalledWith({ type: 'variant', action: 'select', multiple, filter, selectionIds: [{ id: gid('1') }], query: 'node' });
  expect(result.selection).toEqual({ 42: ['1'] });
  expect(result.products['42'].variants[0].inventoryQuantity).toBe(inventoryQuantity);
  expect(query.mock.calls[0][0]).toContain('inventoryQuantity');
});

it('两个开关关闭时保留产品弹窗和多选行为', async () => {
  resourcePicker.mockResolvedValue([pickedProduct('42', ['1', '2'])]);
  query.mockResolvedValue(stockPage('42', { 1: 0, 2: null }));
  const result = await pickProducts([], undefined, { singleVariantOnly: false, inStockOnly: false });
  assert(result);
  expect(resourcePicker).toHaveBeenCalledWith({ type: 'product', action: 'select', multiple: true, filter: { variants: true }, selectionIds: [] });
  expect(result.selection).toEqual({ 42: ['1', '2'] });
});

it('只开库存筛选允许多选，不受同产品未选中缺货规格影响', async () => {
  resourcePicker.mockResolvedValue([pickedVariant('42', '1'), pickedVariant('42', '2'), pickedVariant('42', '1')]);
  query.mockResolvedValue(stockPage('42', { 1: 2, 2: 3, 3: 0 }));
  const result = await pickProducts([], undefined, { inStockOnly: true });
  assert(result);
  expect(result.selection).toEqual({ 42: ['1', '2'] });
});

it.each([0, -1, null, undefined])('库存为 %s 时预选和确认均拒绝，不静默移除原赠品', async inventoryQuantity => {
  const initial = [{ productId: '42', variantIds: ['1'] }];
  query.mockResolvedValue(stockPage('42', { 1: inventoryQuantity }));
  await expect(pickProducts(initial, undefined, { inStockOnly: true })).rejects.toThrow('请先移除对应赠品，或关闭');
  expect(resourcePicker).not.toHaveBeenCalled();
  expect(initial).toEqual([{ productId: '42', variantIds: ['1'] }]);
  resourcePicker.mockResolvedValue([pickedVariant('42', '1')]);
  await expect(pickProducts([], undefined, { inStockOnly: true })).rejects.toThrow('库存不足或库存未知');
});

it('弹窗确认后重新检查库存，拒绝已从有货变为缺货的规格', async () => {
  const initial = [{ productId: '42', variantIds: ['1'] }];
  query.mockResolvedValueOnce(stockPage('42', { 1: 5 })).mockResolvedValueOnce(stockPage('42', { 1: 0 }));
  resourcePicker.mockResolvedValue([{ ...pickedVariant('42', '1'), inventoryQuantity: 5 }]);
  await expect(pickProducts(initial, undefined, { inStockOnly: true })).rejects.toThrow('库存不足或库存未知');
  expect(query).toHaveBeenCalledTimes(2);
  expect(initial).toEqual([{ productId: '42', variantIds: ['1'] }]);
});

it('单选与已有多个赠品冲突时拒绝打开，返回多个规格时也拒绝应用', async () => {
  const initial = [{ productId: '42', variantIds: ['1', '2'] }];
  query.mockResolvedValue(productPage('42', ['1', '2']));
  await expect(pickProducts(initial, undefined, { singleVariantOnly: true })).rejects.toThrow('请先移除多余赠品，或关闭');
  expect(resourcePicker).not.toHaveBeenCalled();
  expect(initial).toEqual([{ productId: '42', variantIds: ['1', '2'] }]);
  resourcePicker.mockResolvedValue([pickedVariant('42', '1'), pickedVariant('42', '2')]);
  await expect(pickProducts([], undefined, { singleVariantOnly: true })).rejects.toThrow('只能选择一个赠品规格');
});

it.each([undefined, null, {}, { id: gid('42') }])('规格返回的 product 为 %j 时拒绝猜测归属', async product => {
  resourcePicker.mockResolvedValue([{ id: gid('1'), product }]);
  await expect(pickProducts([], undefined, { singleVariantOnly: true })).rejects.toThrow('请重新选择');
  expect(query).not.toHaveBeenCalled();
});

it.each(['handle:add-wrist-rest-1', 'handle:"add-wrist-rest-1"', "handle:'add-wrist-rest-1'"])('规格弹窗将 %s 转为产品 ID，并保留库存筛选', async search => {
  const id = '9007199254740993';
  query.mockResolvedValue({ data: { products: { nodes: [{ id: productGid(id) }] } } });
  await pickProducts([], search, { inStockOnly: true });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1].variables).toEqual({ query: search });
  expect(resourcePicker.mock.calls[0][0]).toMatchObject({ type: 'variant', query: `product_id:${id}`, filter: { query: 'inventory_quantity:>0' } });
});

it('产品弹窗原样使用 Handle 搜索，不额外查询产品', async () => {
  await pickProducts([], 'handle:add-wrist-rest-1');
  expect(query).not.toHaveBeenCalled();
  expect(resourcePicker.mock.calls[0][0]).toMatchObject({ type: 'product', query: 'handle:add-wrist-rest-1' });
});

it('Handle 无匹配或返回错误类型 ID 时拒绝打开规格弹窗', async () => {
  query.mockResolvedValueOnce({ data: { products: { nodes: [] } } });
  await expect(pickProducts([], 'handle:missing', { singleVariantOnly: true })).rejects.toThrow('未找到该 Handle');
  query.mockResolvedValueOnce({ data: { products: { nodes: [{ id: gid('42') }] } } });
  await expect(pickProducts([], 'handle:invalid', { singleVariantOnly: true })).rejects.toThrow('请重新选择');
  expect(resourcePicker).not.toHaveBeenCalled();
});
