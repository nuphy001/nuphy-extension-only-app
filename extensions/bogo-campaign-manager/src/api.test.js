// pnpm --filter nuphy-free-gift-discount exec vitest run --root ../bogo-campaign-manager --globals
import { pickVariants, pickProducts, loadProducts, loadVariants } from './api';

const gid = id => `gid://shopify/ProductVariant/${id}`;
let resourcePicker;
let query;

beforeEach(() => {
  resourcePicker = vi.fn();
  query = vi.fn();
  vi.stubGlobal('shopify', { resourcePicker, query });
});
afterEach(() => vi.unstubAllGlobals());

it('回显已有变体，确认后去重并保留长 ID 的精度', async () => {
  const id = '9007199254740993';
  const variant = { id: gid(id), title: 'Lunar White', product: { title: 'Node 75' }, media: { nodes: [] } };
  resourcePicker.mockResolvedValue([{ id: gid(id) }, { id: gid(id) }]);
  query.mockResolvedValue({ data: { nodes: [variant] } });

  const { media, ...details } = variant;
  expect(await pickVariants(['42'])).toEqual({ ids: [id], products: { [id]: { ...details, image: null } } });
  expect(resourcePicker).toHaveBeenCalledWith({
    type: 'variant', action: 'select', multiple: true, selectionIds: [{ id: gid('42') }],
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1].variables).toEqual({ ids: [gid(id)] });
});

const productGid = id => `gid://shopify/Product/${id}`;
function productPage(id, variants, hasNextPage = false, endCursor = null, count = variants.length) {
  return { data: { product: {
    id: productGid(id), title: 'Node 75', featuredMedia: { image: { url: 'https://example.com/node.jpg', altText: null } },
    variantsCount: { count }, variants: { nodes: variants.map(id => ({ id: gid(id), title: `规格 ${id}`, sku: `SKU-${id}`, media: { nodes: [] } })), pageInfo: { hasNextPage, endCursor } },
  } } };
}

it('产品模式不展示规格选择，完整读取全部变体并恢复产品预选', async () => {
  const id = '9007199254740993';
  resourcePicker.mockResolvedValue([{ id: productGid(id) }]);
  query.mockResolvedValueOnce(productPage(id, ['1', '2'], true, 'page-2', 3));
  query.mockResolvedValueOnce(productPage(id, ['3'], false, null, 3));
  const result = await pickProducts(['42'], 'node');
  expect(resourcePicker).toHaveBeenCalledWith({
    type: 'product', action: 'select', multiple: true, filter: { variants: false },
    selectionIds: [{ id: productGid('42') }], query: 'node',
  });
  expect(result.ids).toEqual([id]);
  expect(result.products[id].variants.map(variant => variant.id)).toEqual(['1', '2', '3'].map(gid));
  expect(result.products[id].variants[2].product).toEqual({ id: productGid(id), title: 'Node 75' });
  expect(result.products[id].variantsCount).toBe(3);
  expect(query.mock.calls[1][1].variables.after).toBe('page-2');
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
  expect(await pickProducts(['42'])).toBeUndefined();
  expect(await pickProducts(['42'])).toEqual({ ids: [], products: {} });
  expect(query).not.toHaveBeenCalled();
});

it('不把消失的产品或变体 ID 当作成功的产品选择', async () => {
  resourcePicker.mockResolvedValueOnce([{ id: productGid('42') }]);
  query.mockResolvedValueOnce({ data: { product: null } });
  await expect(pickProducts([])).rejects.toThrow('已删除或不可访问');
  resourcePicker.mockResolvedValueOnce([{ id: gid('42') }]);
  await expect(pickProducts([])).rejects.toThrow('请重新选择');
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

it('取消返回 undefined，不读取商品或写入配置', async () => {
  resourcePicker.mockResolvedValue(undefined);
  expect(await pickVariants(['42'])).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
});

it('确认空选时返回空草稿，与取消区分', async () => {
  resourcePicker.mockResolvedValue([]);
  expect(await pickVariants(['42'])).toEqual({ ids: [], products: {} });
  expect(query).not.toHaveBeenCalled();
});

it('拒绝把商品 ID 当成变体 ID 写入活动', async () => {
  resourcePicker.mockResolvedValue([{ id: 'gid://shopify/Product/42' }]);
  await expect(pickVariants([])).rejects.toThrow('请重新选择');
  expect(query).not.toHaveBeenCalled();
});

it('详情读取失败时不返回可应用的选择', async () => {
  resourcePicker.mockResolvedValue([{ id: gid('42') }]);
  query.mockRejectedValue(new Error('读取失败'));
  await expect(pickVariants([])).rejects.toThrow('读取失败');
});

it('选择器不可用或打开失败时给出错误', async () => {
  resourcePicker.mockRejectedValue(new Error('打开失败'));
  await expect(pickVariants([])).rejects.toThrow('打开失败');
  vi.stubGlobal('shopify', { query });
  await expect(pickVariants([])).rejects.toThrow('商品选择器暂时不可用');
  expect(query).not.toHaveBeenCalled();
});
