import { expect, it } from 'vitest';
import { validateEditor, validateGiftSelection } from '../utils/validation';
import type { Variant } from '../types/api';
import type { Catalog, Editor, StoredCampaign } from '../types/campaign';

it('保存校验覆盖不可读规格、全部排除、非法数量和时间，并保留原草稿', () => {
  const variant: Variant = { id: 'gid://shopify/ProductVariant/11', title: 'Black', product: { id: 'gid://shopify/Product/1', title: 'Wrist Rest' } };
  const catalog: Catalog = { products: { 1: { id: variant.product.id, title: variant.product.title, featuredImage: null, variants: [variant], variantsCount: 1 } }, variants: { 11: variant } };
  const draft: StoredCampaign = { id: 'test', name: '  活动  ', enabled: false, triggerVariantIds: [], triggerProducts: [{ productId: '1', excludedVariantIds: [] }], gifts: [{ variantId: '11' }] };
  const editor: Editor = {
    draft, schedule: { start: 'now', startDate: '2026-09-15', startTime: '10:00', hasEnd: false, endDate: '', endTime: '' },
    initial: '', issues: {},
  };
  const original = JSON.stringify(editor);
  const valid = validateEditor(editor, catalog, 'UTC');
  expect(valid.issues).toEqual({});
  expect(valid.campaign?.name).toBe('活动');
  expect(draft.name).toBe('  活动  ');

  const invalid = { ...draft, name: '', triggerProducts: [{ productId: '1', excludedVariantIds: ['11'] }], gifts: [{ variantId: '99' }], triggerQuantity: 0 };
  const result = validateEditor({ ...editor, draft: invalid, schedule: { ...editor.schedule, hasEnd: true, endDate: '2026-09-10', endTime: '25:00' } }, catalog, 'UTC');
  expect(result.campaign).toBeUndefined();
  expect(Object.keys(result.issues).sort()).toEqual(['gift', 'name', 'quantity', 'schedule', 'trigger']);
  expect(result.issues.trigger).toContain('至少保留一个');
  expect(validateEditor(editor, { ...catalog, products: {} }, 'UTC').issues.trigger).toContain('完整读取');

  const multiple = { ...draft, gifts: [{ variantId: '11' }, { variantId: '12' }] };
  const giftCatalog = { ...catalog, variants: { ...catalog.variants, 12: { ...variant, id: 'gid://shopify/ProductVariant/12', title: 'White' } } };
  expect(validateEditor({ ...editor, draft: multiple }, giftCatalog, 'UTC').issues).toEqual({});
  expect(validateEditor({ ...editor, draft: multiple, giftPickerOptions: { singleVariantOnly: true } }, giftCatalog, 'UTC').issues.gift).toContain('单规格限制');
  expect(validateEditor({ ...editor, draft: { ...draft, triggerQuantity: 2 }, giftPickerOptions: { singleVariantOnly: true } }, catalog, 'UTC').issues).toEqual({});
  expect(() => validateGiftSelection(multiple, { singleVariantOnly: true })).toThrow('仍有无法读取的旧赠品');
  expect(() => validateGiftSelection(multiple, {})).not.toThrow();
  expect(() => validateGiftSelection(draft, { singleVariantOnly: true })).not.toThrow();
  expect(multiple.gifts).toHaveLength(2);

  const conflicting = { ...draft, triggerProducts: [{ productId: '99', excludedVariantIds: [] }, { productId: '1', excludedVariantIds: ['11'] }] };
  expect(validateEditor({ ...editor, draft: conflicting }, catalog, 'UTC').issues.trigger).toContain('至少保留一个');
  expect(validateEditor({ ...editor, draft: { ...conflicting, triggerProducts: [...conflicting.triggerProducts].reverse() } }, catalog, 'UTC').issues.trigger).toContain('完整读取');
  expect(validateEditor({ ...editor, draft: { ...conflicting, triggerVariantIds: ['99'] } }, catalog, 'UTC').issues.trigger).toContain('部分适用规格无法读取');
  expect(validateEditor({ ...editor, draft: { ...multiple, gifts: [{ variantId: '11' }, { variantId: '99' }] }, giftPickerOptions: { singleVariantOnly: true } }, catalog, 'UTC').issues.gift).toContain('单规格限制');
  expect(JSON.stringify(editor)).toBe(original);
});
