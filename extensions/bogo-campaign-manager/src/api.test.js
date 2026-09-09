// pnpm --filter nuphy-free-gift-discount exec vitest run --root ../bogo-campaign-manager --globals
import { pickVariants } from './api';

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

  expect(await pickVariants(['42'])).toEqual({ ids: [id], products: { [id]: variant } });
  expect(resourcePicker).toHaveBeenCalledWith({
    type: 'variant', action: 'select', multiple: true, selectionIds: [{ id: gid('42') }],
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1].variables).toEqual({ ids: [gid(id)] });
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
