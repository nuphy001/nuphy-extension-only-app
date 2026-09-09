import { initialConfig, saveCampaign, saveSettings } from './api';

const copy = value => JSON.parse(JSON.stringify(value));
const ownerId = id => `gid://shopify/DiscountAutomaticNode/${id}`;
const campaign = (id, extra = {}) => ({ id, name: `活动 ${id}`, enabled: true, triggerVariantIds: ['1'], gifts: [{ variantId: '2' }], ...extra });
const startsAt = '2030-01-01T00:00:00.000Z';
const endsAt = '2030-02-01T00:00:00.000Z';
let shopSequence = 0;
function backend(campaigns) {
  const state = {
    settings: { shop: { id: `gid://shopify/Shop/${++shopSequence}`, myshopifyDomain: 'example.myshopify.com', ianaTimezone: 'America/New_York', mode: { value: 'managed', compareDigest: 'mode-0' }, config: { jsonValue: { version: 1, campaigns: copy(campaigns) }, compareDigest: 'config-0' } }, metafieldDefinitions: { nodes: [
      { id: 'mode', key: 'mode', type: { name: 'single_line_text_field' }, access: { storefront: 'PUBLIC_READ' } },
      { id: 'config', key: 'campaigns', type: { name: 'json' }, access: { storefront: 'PUBLIC_READ' } },
    ] } }, owners: new Map(), calls: [], created: 0, commits: 0, retired: [], failCreate: false, failCas: false, loseCreateResponse: false, loseCasResponse: false, failRetire: false,
  };
  for (const item of campaigns) if (item.nativeDiscount) state.owners.set(item.nativeDiscount.id, {
    id: item.nativeDiscount.id, campaignBinding: { jsonValue: { campaignId: item.id, bindingToken: item.nativeDiscount.token } },
    discount: { startsAt: item.startsAt ?? startsAt, endsAt: item.endsAt ?? null, status: item.enabled ? 'SCHEDULED' : 'EXPIRED', combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: false } },
  });
  const query = vi.fn(async (document, { variables }) => {
    const operation = /(?:query|mutation) (\w+)/.exec(document)[1];
    state.calls.push(operation);
    if (operation === 'BogoSettings') {
      if (state.failSettingsReads > 0) { state.failSettingsReads--; throw new Error('读取响应丢失'); }
      return { data: copy(state.settings) };
    }
    if (operation === 'BogoDiscountDefinition') return { data: { metafieldDefinitions: { nodes: [{ type: { name: 'json' } }] } } };
    if (operation === 'BogoDiscount') return { data: { discountNode: copy(state.owners.get(variables.id) ?? null) } };
    if (operation === 'BogoDiscounts') {
      const hidden = state.hiddenDiscountSearches > 0;
      if (hidden) state.hiddenDiscountSearches--;
      return { data: { discountNodes: { nodes: hidden ? [] : copy([...state.owners.values()]), pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    if (operation === 'BogoCreateDiscount') {
      if (state.failCreate) return { data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [{ message: '已达到折扣数量上限' }] } } };
      if (variables.discount.endsAt && Date.parse(variables.discount.endsAt) <= Date.parse(variables.discount.startsAt)) {
        return { data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [{ message: '结束时间必须晚于开始时间' }] } } };
      }
      const id = ownerId(1000 + ++state.created);
      state.owners.set(id, { id, campaignBinding: { jsonValue: JSON.parse(variables.discount.metafields[0].value) }, discount: { startsAt: variables.discount.startsAt, endsAt: variables.discount.endsAt, status: 'SCHEDULED', combinesWith: variables.discount.combinesWith } });
      if (state.loseCreateResponse) { state.loseCreateResponse = false; throw new Error('创建响应丢失'); }
      return { data: { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: id }, userErrors: [] } } };
    }
    if (operation === 'BogoSave') {
      const config = variables.metafields.find(field => field.key === 'campaigns');
      if (state.failCas || config.compareDigest !== state.settings.shop.config.compareDigest) return { data: { metafieldsSet: { userErrors: [{ code: 'INVALID_COMPARE_DIGEST', message: '配置冲突' }], metafields: [] } } };
      state.settings.shop.config = { jsonValue: JSON.parse(config.value), compareDigest: `config-${++state.commits}` };
      state.settings.shop.mode = { value: 'managed', compareDigest: `mode-${state.commits}` };
      if (state.loseCasResponse) { state.loseCasResponse = false; state.failSettingsReads = state.failReadAfterLostCas ? 1 : 0; throw new Error('保存响应丢失'); }
      return { data: { metafieldsSet: { userErrors: [], metafields: [{ key: 'mode', compareDigest: state.settings.shop.mode.compareDigest }, { key: 'campaigns', compareDigest: state.settings.shop.config.compareDigest }] } } };
    }
    if (operation === 'BogoDeactivateDiscount') {
      if (state.failRetire) throw new Error('停用失败');
      state.retired.push(variables.id);
      state.owners.get(variables.id).discount.status = 'EXPIRED';
      return { data: { discountAutomaticDeactivate: { automaticDiscountNode: { id: variables.id }, userErrors: [] } } };
    }
    throw new Error(`未处理的操作 ${operation}`);
  });
  vi.stubGlobal('shopify', { query });
  return state;
}
afterEach(() => vi.unstubAllGlobals());

it('新活动先准备带绑定的原生排期，再发布 shop 配置', async () => {
  const state = backend([]);
  const draft = campaign('new', { startsAt, endsAt });
  const result = await saveCampaign(copy(state.settings), undefined, draft);
  const saved = initialConfig(result).campaigns[0];
  expect(state.calls.indexOf('BogoCreateDiscount')).toBeLessThan(state.calls.indexOf('BogoSave'));
  expect(saved.nativeDiscount.id).toBe(ownerId(1001));
  expect(saved.nativeDiscount.token.length).toBeGreaterThanOrEqual(32);
  expect(state.owners.get(saved.nativeDiscount.id).campaignBinding.jsonValue).toEqual({ campaignId: 'new', bindingToken: saved.nativeDiscount.token });
  expect(saved.startsAt).toBe(startsAt);
  expect(draft.nativeDiscount).toBeUndefined();
});

it('新 owner 创建失败不发布活动，输入保持原样', async () => {
  const state = backend([]); state.failCreate = true;
  const draft = campaign('new', { startsAt });
  await expect(saveCampaign(copy(state.settings), undefined, draft)).rejects.toThrow('折扣数量上限');
  expect(state.commits).toBe(0);
  expect(draft.nativeDiscount).toBeUndefined();
});

it('合并其他活动的并发修改，只保存当前活动', async () => {
  const original = campaign('a', { enabled: false });
  const state = backend([original, campaign('b')]);
  const settings = copy(state.settings);
  state.settings.shop.config.jsonValue.campaigns[1].name = '别人刚修改的活动';
  state.settings.shop.config.compareDigest = 'config-other';
  const saved = await saveCampaign(settings, original, { ...original, name: '我的修改' });
  expect(initialConfig(saved).campaigns.map(item => item.name)).toEqual(['我的修改', '别人刚修改的活动']);
});

it('当前活动冲突在任何写入之前拒绝', async () => {
  const original = campaign('a'); const state = backend([original]);
  const settings = copy(state.settings);
  state.settings.shop.config.jsonValue.campaigns[0].name = '别人先改';
  await expect(saveCampaign(settings, original, { ...original, name: '我的修改' })).rejects.toThrow('这个活动已被其他人修改');
  expect(state.calls).toEqual(['BogoSettings']);
});

it('CAS 冲突保留旧配置，重试复用已准备 owner', async () => {
  const original = campaign('a'); const state = backend([original]);
  const settings = copy(state.settings); const draft = { ...original, startsAt, endsAt };
  state.failCas = true;
  await expect(saveCampaign(settings, original, draft)).rejects.toThrow('其他人修改');
  expect(state.settings.shop.config.jsonValue.campaigns[0].nativeDiscount).toBeUndefined();
  expect(state.retired).toEqual([]);
  state.failCas = false;
  const result = await saveCampaign(settings, original, draft);
  expect(initialConfig(result).campaigns[0].nativeDiscount.id).toBe(ownerId(1001));
  expect(state.created).toBe(1);
});

it('创建响应丢失时通过绑定 token 读回，不重复创建', async () => {
  const state = backend([]); state.loseCreateResponse = true;
  const saved = await saveCampaign(copy(state.settings), undefined, campaign('a', { startsAt }));
  expect(initialConfig(saved).campaigns[0].nativeDiscount.id).toBe(ownerId(1001));
  expect(state.created).toBe(1);
  expect(state.calls).toContain('BogoDiscounts');
});

it('CAS 响应丢失时读回成功状态', async () => {
  const state = backend([]); state.loseCasResponse = true;
  const saved = await saveCampaign(copy(state.settings), undefined, campaign('a', { startsAt }));
  expect(initialConfig(saved).campaigns[0].nativeDiscount.id).toBe(ownerId(1001));
  expect(state.commits).toBe(1);
});

it('创建暂时不可检索时重试使用新 token，不让两个 owner 同时获得有效绑定', async () => {
  const state = backend([]); state.loseCreateResponse = true; state.hiddenDiscountSearches = 2;
  const settings = copy(state.settings); const draft = campaign('a', { startsAt });
  await expect(saveCampaign(settings, undefined, draft)).rejects.toThrow('未能确认折扣准备结果');
  expect(state.commits).toBe(0);
  const saved = await saveCampaign(settings, undefined, draft);
  const token = initialConfig(saved).campaigns[0].nativeDiscount.token;
  expect([...state.owners.values()].filter(node => node.campaignBinding.jsonValue.bindingToken === token)).toHaveLength(1);
  expect(state.created).toBe(2);
});

it('保存和读回都断网后，再次保存能识别上次已成功而不报并发冲突', async () => {
  const state = backend([]); state.loseCasResponse = true; state.failReadAfterLostCas = true;
  const settings = copy(state.settings); const draft = campaign('a', { startsAt });
  await expect(saveCampaign(settings, undefined, draft)).rejects.toThrow('保存响应丢失');
  const saved = await saveCampaign(settings, undefined, draft);
  expect(initialConfig(saved).campaigns[0].nativeDiscount.id).toBe(ownerId(1001));
  expect(state.created).toBe(1);
  expect(state.commits).toBe(1);
});

const ownedCampaign = () => campaign('a', { startsAt, endsAt, nativeDiscount: { id: ownerId(10), token: '0123456789abcdef0123456789abcdef' } });
it('排期变化新建 owner，CAS 成功后才停用旧 owner', async () => {
  const original = ownedCampaign(); const state = backend([original]);
  const saved = await saveCampaign(copy(state.settings), original, { ...original, endsAt: '2030-03-01T00:00:00.000Z' });
  expect(initialConfig(saved).campaigns[0].nativeDiscount.id).toBe(ownerId(1001));
  expect(state.calls.indexOf('BogoSave')).toBeLessThan(state.calls.indexOf('BogoDeactivateDiscount'));
  expect(state.retired).toEqual([ownerId(10)]);
  expect(state.owners.get(ownerId(1001)).discount.combinesWith).toEqual({ productDiscounts: true, orderDiscounts: true, shippingDiscounts: false });
});

it('只改活动规则复用 owner，不改 Shopify 排期', async () => {
  const original = ownedCampaign(); const state = backend([original]);
  const saved = await saveCampaign(copy(state.settings), original, { ...original, gifts: [{ variantId: '3' }] });
  expect(initialConfig(saved).campaigns[0].nativeDiscount).toEqual(original.nativeDiscount);
  expect(state.created).toBe(0);
  expect(state.retired).toEqual([]);
});

it.each(['名称', '产品'])('编辑已结束的立即开始活动%s，保持合法的历史排期', async field => {
  const historicalStart = '2020-01-01T00:00:00.000Z';
  const historicalEnd = '2020-02-01T00:00:00.000Z';
  const original = { ...ownedCampaign(), startsAt: undefined, endsAt: historicalEnd };
  const state = backend([original]);
  Object.assign(state.owners.get(original.nativeDiscount.id).discount, { startsAt: historicalStart, status: 'EXPIRED' });
  const draft = field === '名称' ? { ...original, name: '历史活动改名' }
    : { ...original, triggerVariantIds: [], triggerProducts: [{ productId: '30', excludedVariantIds: [] }] };
  const saved = initialConfig(await saveCampaign(copy(state.settings), original, draft)).campaigns[0];
  const owner = state.owners.get(saved.nativeDiscount.id);
  expect(owner.discount.startsAt).toBe(historicalStart);
  expect(owner.discount.endsAt).toBe(historicalEnd);
  expect(Date.parse(owner.discount.startsAt)).toBeLessThan(Date.parse(owner.discount.endsAt));
  expect(saved.startsAt).toBeUndefined();
  expect(saved.endsAt).toBe(historicalEnd);
  expect(state.created).toBe(field === '名称' ? 1 : 0);
});

it('停用失败仍返回已保存结果及警告，不能误报保存失败', async () => {
  const original = ownedCampaign(); const state = backend([original]); state.failRetire = true;
  const saved = await saveCampaign(copy(state.settings), original, { ...original, enabled: false });
  expect(initialConfig(saved).campaigns[0].enabled).toBe(false);
  expect(saved.warnings[0]).toContain('活动已保存');
  expect(state.created).toBe(0);
});

it('删除先从 shop 配置移除，再停用 owner', async () => {
  const original = ownedCampaign(); const state = backend([original, campaign('b')]);
  const saved = await saveCampaign(copy(state.settings), original, null);
  expect(initialConfig(saved).campaigns.map(item => item.id)).toEqual(['b']);
  expect(state.retired).toEqual([ownerId(10)]);
});

it('旧批量保存不能写入未绑定的排期，也不能覆盖已绑定活动', async () => {
  const state = backend([]);
  await expect(saveSettings(copy(state.settings), { version: 1, campaigns: [campaign('a', { startsAt })] })).rejects.toThrow('逐个保存');
  const owned = backend([ownedCampaign()]);
  await expect(saveSettings(copy(owned.settings), { version: 1, campaigns: [] })).rejects.toThrow('逐个保存');
  expect(state.commits + owned.commits).toBe(0);
});

it('owner 标识不匹配时不修改未知折扣', async () => {
  const original = ownedCampaign(); const state = backend([original]);
  state.owners.get(ownerId(10)).campaignBinding.jsonValue.bindingToken = 'somebody-elses-owner-token';
  await expect(saveCampaign(copy(state.settings), original, null)).rejects.toThrow('折扣绑定已变化');
  expect(state.commits).toBe(0);
  expect(state.retired).toEqual([]);
});
