import { vi } from 'vitest';
vi.mock('@shopify/ui-extensions/preact', () => ({}));
import { validateEditor } from './AppHome';

it('保存校验覆盖不可读规格、全部排除、非法数量和时间，并保留原草稿', () => {
  const variant = { id: 'gid://shopify/ProductVariant/11' };
  const catalog = { products: { 1: { variants: [variant], variantsCount: 1 } }, variants: { 11: variant } };
  const draft = { id: 'test', name: '  活动  ', enabled: false, triggerVariantIds: [], triggerProducts: [{ productId: '1', excludedVariantIds: [] }], gifts: [{ variantId: '11' }] };
  const schedule = { start: 'now', hasEnd: false };
  const valid = validateEditor({ draft, schedule }, catalog, 'UTC');
  expect(valid.issues).toEqual({});
  expect(valid.campaign.name).toBe('活动');
  expect(draft.name).toBe('  活动  ');

  const invalid = { ...draft, name: '', triggerProducts: [{ productId: '1', excludedVariantIds: ['11'] }], gifts: [{ variantId: '99' }], triggerQuantity: 0 };
  const result = validateEditor({ draft: invalid, schedule: { ...schedule, hasEnd: true, endDate: '2026-09-10', endTime: '25:00' } }, catalog, 'UTC');
  expect(result.campaign).toBeUndefined();
  expect(Object.keys(result.issues).sort()).toEqual(['gift', 'name', 'quantity', 'schedule', 'trigger']);
  expect(result.issues.trigger).toContain('至少保留一个');
  expect(validateEditor({ draft, schedule }, { ...catalog, products: {} }, 'UTC').issues.trigger).toContain('完整读取');
});
