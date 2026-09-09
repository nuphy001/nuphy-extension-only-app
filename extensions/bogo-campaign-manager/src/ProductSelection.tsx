import { useState } from 'preact/hooks';
import type { StoredCampaign } from '../../nuphy-free-gift-discount/src/configuration';
import type { pickProducts, PickerProductSelection, Product, Variant } from './api';

export const numericId = (id: string) => id.split('/').pop()!;
export function selectedProductIds(campaign: StoredCampaign, variants: Record<string, Variant>, role: 'trigger' | 'gift') {
  const ids = role === 'trigger' ? campaign.triggerVariantIds : campaign.gifts.map(gift => gift.variantId);
  return [...new Set([
    ...(role === 'trigger' ? (campaign.triggerProducts ?? []).map(item => item.productId) : []),
    ...ids.flatMap(id => variants[id]?.product.id ? [numericId(variants[id].product.id)] : []),
  ])];
}

type PickerResult = NonNullable<Awaited<ReturnType<typeof pickProducts>>>;
export function applyProductSelection(campaign: StoredCampaign, role: 'trigger' | 'gift', result: PickerResult, knownVariants: Record<string, Variant>): Partial<StoredCampaign> {
  const variants = { ...knownVariants, ...Object.fromEntries(Object.values(result.products)
    .flatMap(product => product.variants.map(variant => [numericId(variant.id), variant]))) };
  if (role === 'gift') return { gifts: [...new Set([
    ...campaign.gifts.filter(gift => !variants[gift.variantId]).map(gift => gift.variantId),
    ...result.ids.flatMap(id => result.selection[id]),
  ])].map(variantId => ({ variantId })) };

  const triggerVariantIds = campaign.triggerVariantIds.filter(id => !variants[id]);
  const triggerProducts = result.ids.flatMap(productId => {
    const current = campaign.triggerProducts?.find(rule => rule.productId === productId);
    const selected = new Set(result.selection[productId]);
    // 旧白名单保持原语义，不因在弹窗中确认而纳入未来新增规格。
    if (!current && campaign.triggerVariantIds.some(id => numericId(variants[id]?.product.id ?? '') === productId)) {
      triggerVariantIds.push(...selected);
      return [];
    }
    const allIds = result.products[productId].variants.map(variant => numericId(variant.id));
    return [{ productId, excludedVariantIds: [...new Set([
      ...allIds.filter(id => !selected.has(id)),
      ...(current?.excludedVariantIds ?? []).filter(id => !allIds.includes(id)),
    ])] }];
  });
  return { triggerProducts, triggerVariantIds };
}

function triggerSummary(campaign: StoredCampaign, productId: string, product?: Product) {
  if (!product) return '请重试读取产品';
  const rule = campaign.triggerProducts?.find(item => item.productId === productId);
  if (!rule) return '仅部分规格 · 已选 ' + product.variants.filter(variant => campaign.triggerVariantIds.includes(numericId(variant.id))).length + ' 个';
  if (!rule.excludedVariantIds.length) return '全部 ' + product.variantsCount + ' 个规格参与';
  const count = product.variants.filter(variant => !rule.excludedVariantIds.includes(numericId(variant.id))).length;
  return count + ' / ' + product.variantsCount + ' 个规格参与 · 已排除 ' + rule.excludedVariantIds.length + ' 个';
}

type Props = {
  role: 'trigger' | 'gift';
  campaign: StoredCampaign;
  products: Record<string, Product>;
  variants: Record<string, Variant>;
  disabled: boolean;
  error?: string;
  onChange: (patch: Partial<StoredCampaign>) => void;
  onBrowse: (initial: PickerProductSelection[], search: string) => void;
  onRetry: (productId: string) => void;
};

export function ProductSelection(props: Props) {
  const { role, campaign, products, variants, disabled, onChange, onBrowse, onRetry } = props;
  const [search, setSearch] = useState('');
  const isTrigger = role === 'trigger';
  const ids = selectedProductIds(campaign, variants, role);
  const ownedBy = (variantId: string, productId: string) => numericId(variants[variantId]?.product.id ?? '') === productId;

  function browse() {
    if (disabled) return;
    const initial = ids.map(productId => {
      const rule = isTrigger && campaign.triggerProducts?.find(item => item.productId === productId);
      return rule ? { productId, excludedVariantIds: rule.excludedVariantIds }
        : { productId, variantIds: (isTrigger ? campaign.triggerVariantIds : campaign.gifts.map(gift => gift.variantId)).filter(id => ownedBy(id, productId)) };
    });
    onBrowse(initial, search.trim());
  }

  function remove(productId: string, variantId?: string) {
    onChange(isTrigger ? {
      triggerProducts: campaign.triggerProducts?.filter(item => item.productId !== productId),
      triggerVariantIds: campaign.triggerVariantIds.filter(id => !ownedBy(id, productId)),
    } : { gifts: campaign.gifts.filter(gift => gift.variantId !== variantId) });
  }

  const unknown = (isTrigger ? campaign.triggerVariantIds : campaign.gifts.map(gift => gift.variantId)).filter(id => !variants[id]);
  const rows = isTrigger ? ids.map(id => ({ productId: id, variant: undefined as Variant | undefined }))
    : campaign.gifts.flatMap(gift => variants[gift.variantId] ? [{ productId: numericId(variants[gift.variantId].product.id), variant: variants[gift.variantId] }] : []);
  return <s-section heading={isTrigger ? '适用产品' : '赠品'}>
    <s-stack gap="base">
      <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
        <s-search-field label={isTrigger ? '搜索适用产品变体' : '搜索赠品产品变体'} labelAccessibilityVisibility="exclusive"
          placeholder="搜索产品变体" value={search} disabled={disabled}
          onInput={event => setSearch(event.currentTarget.value)} />
        <s-button disabled={disabled} onClick={browse}>浏览</s-button>
      </s-grid>
      {props.error && <s-banner tone="critical">{props.error}</s-banner>}
      {rows.length > 0 && <s-box border="base" borderRadius="large" overflow="hidden" accessibilityRole="unordered-list">
        {rows.map(({ productId, variant }, index) => {
          const product = products[productId];
          const productTitle = product?.title ?? variant?.product.title ?? '产品信息暂不可用';
          const title = productTitle + (variant && variant.title !== 'Default Title' ? ' - ' + variant.title : '');
          const thumbnail = variant?.image ?? product?.featuredImage;
          return <s-box key={variant?.id ?? productId} accessibilityRole="list-item">
            {index > 0 && <s-divider />}
            <s-box padding="base">
              <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
                <s-thumbnail size="large" src={thumbnail?.url ?? undefined} alt={thumbnail?.altText ?? title} />
                <s-stack gap="small-400">
                  <s-text type="strong">{title}</s-text>
                  <s-text color="subdued">{isTrigger ? triggerSummary(campaign, productId, product)
                    : campaign.triggerQuantity === undefined ? '随主商品数量' : '× ' + campaign.triggerQuantity}</s-text>
                  {!product && <s-button variant="tertiary" disabled={disabled} onClick={() => onRetry(productId)}>重试</s-button>}
                </s-stack>
                <s-button icon="x" variant="tertiary" disabled={disabled} accessibilityLabel={'移除' + (isTrigger ? '产品：' : '赠品：') + title}
                  onClick={() => remove(productId, variant && numericId(variant.id))} />
              </s-grid>
            </s-box>
          </s-box>;
        })}
      </s-box>}
      {unknown.map(id => <s-banner key={id} tone="warning">
        <s-paragraph>规格 {id} 暂时无法读取。原配置已保留，请重试加载或移除此规格。</s-paragraph>
        <s-button variant="tertiary" disabled={disabled} onClick={() => onChange(isTrigger
          ? { triggerVariantIds: campaign.triggerVariantIds.filter(value => value !== id) }
          : { gifts: campaign.gifts.filter(gift => gift.variantId !== id) })}>移除此规格</s-button>
      </s-banner>)}
    </s-stack>
  </s-section>;
}
