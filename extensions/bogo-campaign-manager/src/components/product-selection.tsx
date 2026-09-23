import { useState } from 'preact/hooks';
import type { Variant } from '../types/api';
import type { ProductSelectionProps } from '../types/selection';
import { numericId, selectedProductIds, triggerSummary } from '../utils/selection';
import { HelpTip } from './help-tip';

// 共用产品选择区域：主商品按产品展示，赠品按具体规格展示。
export function ProductSelection(props: ProductSelectionProps) {
  const { role, campaign, products, variants, disabled, onChange, onBrowse, onRetry, options = {} } = props;
  const [search, setSearch] = useState('');
  const isTrigger = role === 'trigger';
  const ids = selectedProductIds(campaign, variants, role);
  const ownedBy = (variantId: string, productId: string) => numericId(variants[variantId]?.product.id ?? '') === productId;

  // 将已选配置转换成弹窗预选范围，保留旧白名单和产品排除规则。
  function browse() {
    if (disabled) return;
    const initial = ids.map(productId => {
      const rule = isTrigger && campaign.triggerProducts?.find(item => item.productId === productId);
      return rule ? { productId, excludedVariantIds: rule.excludedVariantIds }
        : { productId, variantIds: (isTrigger ? campaign.triggerVariantIds : campaign.gifts.map(gift => gift.variantId)).filter(id => ownedBy(id, productId)) };
    });
    onBrowse(initial, search.trim(), isTrigger ? undefined : options);
  }

  // 移除主商品时清除该产品的适用规则，移除赠品时只删当前规格。
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
      {!isTrigger && <s-stack gap="small">
        <s-stack direction="inline" gap="small-400" alignItems="center">
          <s-switch label="仅允许一个赠品规格" checked={options.singleVariantOnly ?? false} disabled={disabled}
            onChange={event => props.onOptionsChange?.({ ...options, singleVariantOnly: event.currentTarget.checked })} />
          <HelpTip id="gift-single-help" label="单赠品规格说明">只限制规格种类，赠送件数由数量规则决定。仅本次编辑有效，重新打开活动后恢复关闭。</HelpTip>
        </s-stack>
        <s-stack direction="inline" gap="small-400" alignItems="center">
          <s-switch label="仅选择有库存的赠品" checked={options.inStockOnly ?? false} disabled={disabled}
            onChange={event => props.onOptionsChange?.({ ...options, inStockOnly: event.currentTarget.checked })} />
          <HelpTip id="gift-stock-help" label="赠品库存筛选说明">仅显示库存大于 0 的规格，确认选择时再次核对。仅本次编辑有效，重新打开活动后恢复关闭。</HelpTip>
        </s-stack>
        {options.singleVariantOnly && campaign.gifts.length > 1 && <s-banner tone="warning">已选多个赠品规格，请先移除多余规格，或关闭单规格限制。</s-banner>}
      </s-stack>}
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
