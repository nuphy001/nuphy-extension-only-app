import { describe, expect, it } from 'vitest';
import { configuredCampaigns, parseConfig } from './configuration';
import { goboFreeGiftDiscountFunction as run } from './cart_lines_discounts_generate_run';

const gid = (type, id) => `gid://shopify/${type}/${id}`;
const token = 'f07b2fbe-a04c-4016-b35d-c5c2a20b9876';
const campaign = (patch = {}) => ({
  id: 'product-campaign', enabled: true, triggerVariantIds: [],
  triggerProducts: [{ productId: '1', excludedVariantIds: ['12'] }],
  gifts: [{ variantId: '31' }], ...patch,
});
const config = (...campaigns) => ({ version: 1, campaigns });
const binding = (patch = {}) => ({ jsonValue: { campaignId: 'product-campaign', bindingToken: token, ...patch } });
const owner = { id: gid('DiscountAutomaticNode', '100'), token };
const normal = (id, productId, quantity = 1) => ({
  id: `line-${id}`, quantity,
  merchandise: { __typename: 'ProductVariant', id: gid('ProductVariant', id), product: { id: gid('Product', productId) } },
});
const gift = (mainVariant = '11', quantity = 1) => ({
  ...normal('31', '3', quantity), attribute: { value: 'gift' },
  promoIdAttr: { value: 'product-campaign' }, mainVariantAttr: { value: gid('ProductVariant', mainVariant) },
});
const input = (value, lines, marker = null) => ({
  shop: { promotionMode: { value: 'managed' }, promotionConfig: { jsonValue: config(value) } },
  discount: { campaignBinding: marker }, cart: { lines },
});
const targets = result => result.operations[0]?.productDiscountsAdd.candidates[0].targets ?? [];

describe('活动配置兼容与校验', () => {
  it('保留旧规格白名单，不把旧活动扩大成整款产品', () => {
    const legacy = campaign({ triggerVariantIds: ['11'], triggerProducts: undefined });
    const parsed = parseConfig(config(legacy)).campaigns[0];
    expect(parsed.triggerVariantIds).toEqual(['11']);
    expect(parsed.triggerProducts).toBeUndefined();
  });

  it('保存整款产品、排除项及原有数量和赠品配置', () => {
    const value = campaign({ triggerQuantity: 2, showLabel: false });
    expect(parseConfig(config(value)).campaigns[0]).toMatchObject(value);
  });

  it.each([
    { triggerProducts: [] },
    { triggerProducts: [{ productId: gid('Product', '1'), excludedVariantIds: [] }] },
    { triggerProducts: [{ productId: '1', excludedVariantIds: ['12', '12'] }] },
    { triggerProducts: [{ productId: '1', excludedVariantIds: ['0'] }] },
    { triggerProducts: [{ productId: '1', excludedVariantIds: [] }, { productId: '1', excludedVariantIds: [] }] },
  ])('拒绝无触发条件、非数字 ID 或重复配置：%j', patch => {
    expect(() => parseConfig(config(campaign(patch)))).toThrow();
  });

  it('保留 UTC 排期和折扣绑定，不在 Function 内读取当前时间', () => {
    const schedule = { startsAt: '2026-09-10T01:00:00.000Z', endsAt: '2026-09-11T01:00:00.000Z', nativeDiscount: owner };
    expect(parseConfig(config(campaign(schedule))).campaigns[0]).toMatchObject(schedule);
  });

  it.each([
    { startsAt: '2026-02-29T01:00:00.000Z' },
    { startsAt: '2026-09-10T25:00:00.000Z' },
    { startsAt: '2026-09-10T01:00:00.000Z', endsAt: '2026-09-10T01:00:00.000Z' },
    { nativeDiscount: { ...owner, token: 'short' } },
    { nativeDiscount: { ...owner, id: gid('Product', '100') } },
  ])('拒绝无效排期或折扣绑定：%j', patch => {
    expect(() => parseConfig(config(campaign(patch)))).toThrow();
  });
});

describe('Shopify 原生折扣与活动绑定', () => {
  const value = config(
    campaign({ id: 'legacy' }),
    campaign({ nativeDiscount: owner }),
    campaign({ id: 'unbound-schedule', startsAt: '2026-09-10T01:00:00.000Z' }),
  );
  it('旧 owner 只处理未绑定且未排期的活动', () => {
    expect(configuredCampaigns('managed', value).map(item => item.id)).toEqual(['legacy']);
  });
  it('有 marker 的 owner 只处理 token 匹配的一条活动', () => {
    expect(configuredCampaigns('managed', value, binding()).map(item => item.id)).toEqual(['product-campaign']);
  });
  it.each([
    {}, { jsonValue: null }, { jsonValue: {} },
    binding({ campaignId: 'missing' }), binding({ bindingToken: '7999ba21-d6a3-4f5f-b9a2-710ea7057879' }),
  ])('损坏或不匹配的 marker 不回退处理其他活动：%j', marker => {
    expect(configuredCampaigns('managed', value, marker)).toEqual([]);
  });
  it('绑定不能绕过停用或缺失的配置', () => {
    expect(configuredCampaigns('managed', config(campaign({ enabled: false, nativeDiscount: owner })), binding())).toEqual([]);
    expect(configuredCampaigns(undefined, value, binding())).toEqual([]);
  });
});

describe('产品匹配与排除', () => {
  it('缺少该店 managed 配置时不回退旧店铺的硬编码白名单', () => {
    const oldTrigger = '49965619839216';
    const oldGift = {
      ...normal('49956279877872', '3'), attribute: { value: 'gift' },
      promoIdAttr: { value: 'bogo-nuphyx-test' },
      mainVariantAttr: { value: gid('ProductVariant', oldTrigger) },
    };
    expect(run({ shop: {}, discount: { campaignBinding: null }, cart: { lines: [normal(oldTrigger, '1'), oldGift] } }))
      .toEqual({ operations: [] });
  });
  it('未枚举的新规格属于整款产品，照常获得折扣', () => {
    expect(targets(run(input(campaign(), [normal('199', '1', 2), gift('199', 2)]))))
      .toEqual([{ cartLine: { id: 'line-31', quantity: 2 } }]);
  });
  it('排除规格不触发，也不能由旧规格白名单绕回', () => {
    expect(targets(run(input(campaign({ triggerVariantIds: ['12'] }), [normal('12', '1', 8), gift('12', 8)])))).toEqual([]);
  });
  it('只累计未排除的产品规格及旧白名单，保持共享免费额度', () => {
    const value = campaign({
      triggerVariantIds: ['99'],
      triggerProducts: [{ productId: '1', excludedVariantIds: ['12'] }, { productId: '2', excludedVariantIds: [] }],
    });
    expect(targets(run(input(value, [normal('11', '1', 2), normal('12', '1', 7), normal('21', '2'), normal('99', '9'), gift('11', 9)]))))
      .toEqual([{ cartLine: { id: 'line-31', quantity: 4 } }]);
  });
  it('即使存在其他有效主商品，赠品也不能关联被排除的规格', () => {
    expect(targets(run(input(campaign(), [normal('11', '1'), normal('12', '1'), gift('12')])))).toEqual([]);
  });
  it('同名但不同产品不触发，旧活动也不会自动包含新规格', () => {
    expect(targets(run(input(campaign(), [normal('91', '9'), gift('91')])))).toEqual([]);
    const legacy = campaign({ triggerVariantIds: ['11'], triggerProducts: undefined });
    expect(targets(run(input(legacy, [normal('199', '1'), gift('199')])))).toEqual([]);
  });
  it('带排期的活动只在对应 Shopify owner 调用中生效', () => {
    const value = campaign({ nativeDiscount: owner, startsAt: '2026-09-10T01:00:00.000Z' });
    const lines = [normal('11', '1'), gift()];
    expect(targets(run(input(value, lines)))).toEqual([]);
    expect(targets(run(input(value, lines, binding())))).toEqual([{ cartLine: { id: 'line-31', quantity: 1 } }]);
    expect(targets(run(input(value, lines, { jsonValue: null })))).toEqual([]);
  });
});
