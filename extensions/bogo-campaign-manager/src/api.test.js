// pnpm --filter nuphy-free-gift-discount exec vitest run --root ../bogo-campaign-manager --globals
import { pickProducts, loadProducts, loadVariants } from './api';

const gid = id => `gid://shopify/ProductVariant/${id}`;
let resourcePicker;
let query;

beforeEach(() => {
  resourcePicker = vi.fn();
  query = vi.fn();
  vi.stubGlobal('shopify', { resourcePicker, query });
});
afterEach(() => vi.unstubAllGlobals());

const productGid = id => `gid://shopify/Product/${id}`;
const pickedProduct = (id, variants) => ({ id: productGid(id), variants: variants.map(id => ({ id: gid(id) })) });
function productPage(id, variants, hasNextPage = false, endCursor = null, count = variants.length) {
  return { data: { product: {
    id: productGid(id), title: 'Node 75', featuredMedia: { image: { url: 'https://example.com/node.jpg', altText: null } },
    variantsCount: { count }, variants: { nodes: variants.map(id => ({ id: gid(id), title: `规格 ${id}`, sku: `SKU-${id}`, media: { nodes: [] } })), pageInfo: { hasNextPage, endCursor } },
  } } };
}

it('产品弹窗显示规格层级，结果仅保留勾选规格且完整读取产品详情', async () => {
  const id = '9007199254740993';
  resourcePicker.mockResolvedValue([pickedProduct(id, [id, id]), pickedProduct(id, ['3'])]);
  query.mockResolvedValueOnce(productPage('42', ['1', '2']));
  query.mockResolvedValueOnce(productPage(id, [id, '2'], true, 'page-2', 3));
  query.mockResolvedValueOnce(productPage(id, ['3'], false, null, 3));
  const result = await pickProducts([{ productId: '42', variantIds: ['1', '1'] }], 'node');
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

it('产品取消与清空选择保持不同语义', async () => {
  resourcePicker.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
  query.mockResolvedValue(productPage('42', ['1', '2']));
  const initial = [{ productId: '42', variantIds: ['1'] }];
  expect(await pickProducts(initial)).toBeUndefined();
  expect(await pickProducts(initial)).toEqual({ ids: [], products: {}, selection: {} });
  expect(query).toHaveBeenCalledTimes(2);
  expect(initial).toEqual([{ productId: '42', variantIds: ['1'] }]);
});

it('空初始范围取消或清空不读取商品', async () => {
  resourcePicker.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
  expect(await pickProducts([])).toBeUndefined();
  expect(await pickProducts([])).toEqual({ ids: [], products: {}, selection: {} });
  expect(query).not.toHaveBeenCalled();
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

it('确认后规格消失或归属不符时不返回可应用的选择', async () => {
  resourcePicker.mockResolvedValue([pickedProduct('42', ['3'])]);
  query.mockResolvedValue(productPage('42', ['1', '2']));
  await expect(pickProducts([])).rejects.toThrow('所选规格已删除或不可访问');
});

it('变体详情按 100 个分批，保持字符串 ID 和图片信息', async () => {
  const image = { url: 'https://example.com/variant.jpg', altText: '白色' };
  query.mockImplementation(async (_, { variables }) => ({ data: { nodes: variables.ids.map(id => ({ id, title: '规格', sku: 'sku', product: { id: productGid('4'), title: 'Node' }, media: { nodes: [{ image }] } })) } }));
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
