import { useRef, useState } from 'preact/hooks';
import type { StoredCampaign } from '../../nuphy-free-gift-discount/src/configuration';
import { loadProducts, pickProducts, type Product, type Variant } from './api';

export const numericId = (id: string) => id.split('/').pop()!;
export function selectedProductIds(campaign: StoredCampaign, variants: Record<string, Variant>, role: 'trigger' | 'gift') {
  const ids = role === 'trigger' ? campaign.triggerVariantIds : campaign.gifts.map(gift => gift.variantId);
  return [...new Set([
    ...(role === 'trigger' ? (campaign.triggerProducts ?? []).map(item => item.productId) : []),
    ...ids.flatMap(id => variants[id]?.product.id ? [numericId(variants[id].product.id)] : []),
  ])];
}

type Props = {
  role: 'trigger' | 'gift';
  campaign: StoredCampaign;
  giftProductIds: string[];
  products: Record<string, Product>;
  variants: Record<string, Variant>;
  disabled: boolean;
  error?: string;
  onChange: (patch: Partial<StoredCampaign>, giftProductIds?: string[]) => void;
  onProducts: (products: Record<string, Product>) => void;
  onBusy: (busy: boolean) => void;
};

export function ProductSelection(props: Props) {
  const { role, campaign, products, variants, disabled, onChange, onProducts, onBusy } = props;
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const isTrigger = role === 'trigger';
  const ids = isTrigger ? selectedProductIds(campaign, variants, role) : props.giftProductIds;
  const ownedBy = (variantId: string, productId: string) => numericId(variants[variantId]?.product.id ?? '') === productId;

  async function browse() {
    if (disabled || pending.current) return;
    pending.current = true; onBusy(true); setError('');
    try {
      const result = await pickProducts(ids, search.trim());
      if (!result) return;
      onProducts(result.products);
      if (isTrigger) {
        const legacyProducts = new Set(campaign.triggerVariantIds.flatMap(id => variants[id] ? [numericId(variants[id].product.id)] : []));
        onChange({
          triggerProducts: result.ids.flatMap(productId => {
            const current = campaign.triggerProducts?.find(item => item.productId === productId);
            return current ? [current] : legacyProducts.has(productId) ? [] : [{ productId, excludedVariantIds: [] }];
          }),
          triggerVariantIds: campaign.triggerVariantIds.filter(id => !variants[id] || result.ids.includes(numericId(variants[id].product.id))),
        });
      } else {
        const gifts = campaign.gifts.filter(gift => !variants[gift.variantId] || result.ids.includes(numericId(variants[gift.variantId].product.id)));
        for (const id of result.ids) {
          const product = result.products[id];
          if (product?.variants.length === 1 && !gifts.some(gift => gift.variantId === numericId(product.variants[0].id))) {
            gifts.push({ variantId: numericId(product.variants[0].id) });
          }
        }
        onChange({ gifts }, result.ids);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取产品，请重试');
    } finally { pending.current = false; onBusy(false); }
  }

  async function retry(productId: string) {
    if (disabled || pending.current) return;
    pending.current = true; onBusy(true); setError('');
    try { onProducts(await loadProducts([productId])); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '产品信息仍无法读取'); }
    finally { pending.current = false; onBusy(false); }
  }

  function remove(productId: string) {
    if (isTrigger) onChange({
      triggerProducts: campaign.triggerProducts?.filter(item => item.productId !== productId),
      triggerVariantIds: campaign.triggerVariantIds.filter(id => !ownedBy(id, productId)),
    });
    else onChange({ gifts: campaign.gifts.filter(gift => !ownedBy(gift.variantId, productId)) }, ids.filter(id => id !== productId));
    if (expanded === productId) setExpanded(null);
  }

  function toggleVariant(productId: string, variantId: string, checked: boolean) {
    const rule = campaign.triggerProducts?.find(item => item.productId === productId);
    if (rule) {
      const excluded = new Set(rule.excludedVariantIds);
      if (checked) excluded.delete(variantId); else excluded.add(variantId);
      onChange({ triggerProducts: campaign.triggerProducts!.map(item => item.productId === productId
        ? { ...item, excludedVariantIds: [...excluded] } : item) });
    } else {
      if (!checked && campaign.triggerVariantIds.filter(id => ownedBy(id, productId)).length === 1) {
        setError('至少保留一个参与规格；不再参与的产品请用右侧移除按钮删除。');
        return;
      }
      setError('');
      const included = new Set(campaign.triggerVariantIds);
      if (checked) included.add(variantId); else included.delete(variantId);
      onChange({ triggerVariantIds: [...included] });
    }
  }

  function allVariants(productId: string) {
    onChange({
      triggerVariantIds: campaign.triggerVariantIds.filter(id => !ownedBy(id, productId)),
      triggerProducts: [...(campaign.triggerProducts ?? []).filter(item => item.productId !== productId), { productId, excludedVariantIds: [] }],
    });
  }

  const unknown = (isTrigger ? campaign.triggerVariantIds : campaign.gifts.map(gift => gift.variantId)).filter(id => !variants[id]);
  return <s-section heading={isTrigger ? '适用产品' : '赠品'}>
    <s-stack gap="base">
      <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
        <s-search-field label={isTrigger ? '搜索适用产品' : '搜索赠品产品'} labelAccessibilityVisibility="exclusive"
          placeholder="搜索产品" value={search} disabled={disabled}
          onInput={event => setSearch(event.currentTarget.value)} />
        <s-button disabled={disabled} onClick={() => void browse()}>浏览</s-button>
      </s-grid>
      <s-text color="subdued">{ids.length ? '已选 ' + ids.length + ' 款产品' : isTrigger ? '选择产品后，默认全部规格参与。' : '选择赠品产品，再确定实际赠送规格。'}</s-text>
      {(props.error || error) && <s-banner tone="critical">{props.error || error}</s-banner>}
      {ids.length > 0 && <s-box border="base" borderRadius="large" overflow="hidden" accessibilityRole="unordered-list">
        {ids.map((id, index) => {
          const product = products[id];
          const rule = campaign.triggerProducts?.find(item => item.productId === id);
          const giftVariants = campaign.gifts.filter(gift => ownedBy(gift.variantId, id));
          const count = product ? product.variants.filter(variant => rule
            ? !rule.excludedVariantIds.includes(numericId(variant.id))
            : campaign.triggerVariantIds.includes(numericId(variant.id))).length : 0;
          const excluded = rule?.excludedVariantIds.length ?? 0;
          const title = product?.title ?? '产品信息暂不可用';
          const isExpanded = expanded === id;
          return <s-box key={id} accessibilityRole="list-item">
            {index > 0 && <s-divider />}
            <s-box padding="base">
              <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
                <s-thumbnail size="large" src={product?.featuredImage?.url ?? undefined} alt={product?.featuredImage?.altText ?? title} />
                <s-stack gap="small-400">
                  <s-text type="strong">{title}</s-text>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-text color="subdued">{!product ? '请重试读取产品' : isTrigger
                      ? (rule ? excluded ? count + ' / ' + product.variantsCount + ' 个规格参与 · 已排除 ' + excluded + ' 个' : '全部 ' + product.variantsCount + ' 个规格参与'
                        : '仅部分规格 · 已选 ' + count + ' 个')
                      : !giftVariants.length ? '请选择赠送规格' : giftVariants.length > 1
                        ? '已配置 ' + giftVariants.length + ' 个规格，将分别加入购物车'
                        : (variants[giftVariants[0].variantId]?.title === 'Default Title' ? '' : variants[giftVariants[0].variantId]?.title + ' · ')
                          + (campaign.triggerQuantity === undefined ? '随主商品数量' : '× ' + campaign.triggerQuantity)}</s-text>
                    {product
                      ? <s-button variant="tertiary" disabled={disabled} accessibilityLabel={(isTrigger ? '调整规格：' : '更改赠送规格：') + title}
                        onClick={() => setExpanded(isExpanded ? null : id)}>{isExpanded ? '收起规格' : isTrigger ? '调整规格' : '更改规格'}</s-button>
                      : <s-button variant="tertiary" disabled={disabled} onClick={() => void retry(id)}>重试</s-button>}
                  </s-stack>
                </s-stack>
                <s-button icon="x" variant="tertiary" disabled={disabled} accessibilityLabel={'移除产品：' + title} onClick={() => remove(id)} />
              </s-grid>
            </s-box>
            {product && (isExpanded || (!isTrigger && !giftVariants.length)) && <s-box padding="base" background="subdued">
              {isTrigger ? <s-stack gap="small">
                <s-text color="subdued">勾选表示参与，取消勾选即可排除。</s-text>
                {!rule && <s-banner tone="info">旧活动只覆盖已选规格。改为整款参与后，后续新增规格也会参与。</s-banner>}
                <s-button variant="tertiary" disabled={disabled} onClick={() => allVariants(id)}>{rule ? '恢复全部参与' : '改为整款参与'}</s-button>
                {product.variants.map(variant => {
                  const variantId = numericId(variant.id);
                  return <s-checkbox key={variant.id} disabled={disabled}
                    label={variant.title + (variant.sku ? ' · ' + variant.sku : '')}
                    checked={rule ? !rule.excludedVariantIds.includes(variantId) : campaign.triggerVariantIds.includes(variantId)}
                    onChange={event => toggleVariant(id, variantId, event.currentTarget.checked)} />;
                })}
                {count === 0 && <s-text tone="critical">至少保留一个参与规格，或移除此产品。</s-text>}
              </s-stack> : <s-stack gap="small">
                {giftVariants.length > 1 && <s-text color="subdued">当前保留旧活动的多个赠品规格。选择新规格会替换这一组。</s-text>}
                <s-select label="实际赠送规格" placeholder="请选择规格" disabled={disabled}
                  value={giftVariants.length === 1 ? giftVariants[0].variantId : ''}
                  onChange={event => onChange({ gifts: [
                    ...campaign.gifts.filter(gift => !ownedBy(gift.variantId, id)), { variantId: event.currentTarget.value },
                  ] })}>
                  {product.variants.map(variant => <s-option key={variant.id} value={numericId(variant.id)}>{variant.title + (variant.sku ? ' · ' + variant.sku : '')}</s-option>)}
                </s-select>
              </s-stack>}
            </s-box>}
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
