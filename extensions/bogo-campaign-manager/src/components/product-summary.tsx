import { useId } from 'preact/hooks';
import type { ProductSummaryProps } from '../types/selection';
import { selectedProductIds, selectedVariantCount } from '../utils/selection';

// 限制列表内的名称宽度，完整产品范围通过原生提示查看。
export function ProductSummary({ campaign, role, products, variants }: ProductSummaryProps) {
  const tooltipId = useId();
  const ids = selectedProductIds(campaign, variants, role);
  if (!ids.length) return <s-text>产品信息暂不可用</s-text>;

  const names = ids.map(id => products[id]?.title ?? '产品信息暂不可用');
  const count = selectedVariantCount(campaign, role, products);
  const excluded = role === 'trigger'
    ? (campaign.triggerProducts ?? []).reduce((count, product) => count + product.excludedVariantIds.length, 0) : 0;
  const quantity = count === undefined ? '规格待确认' : count + ' 个规格';
  const suffix = ' · ' + quantity + (excluded ? ' · 排除 ' + excluded + ' 个规格' : '');
  const summary = names.slice(0, 2).join('、') + (ids.length > 2 ? '… 等 ' + ids.length + ' 款' : '');
  const fullText = names.join('、') + suffix;

  return <>
    <s-stack gap="small-400">
      <s-grid gridTemplateColumns={role === 'gift' ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)'} gap="small-400" alignItems="center">
        {role === 'gift' && <s-text accessibilityVisibility="hidden">🎁</s-text>}
        <s-clickable maxInlineSize="360px" interestFor={tooltipId} accessibilityLabel={fullText}>
          <s-paragraph lineClamp={2}>{summary}</s-paragraph>
        </s-clickable>
      </s-grid>
      <s-text color="subdued">{quantity}{excluded ? ' · 排除 ' + excluded + ' 个规格' : ''}</s-text>
    </s-stack>
    <s-tooltip id={tooltipId}>{fullText}</s-tooltip>
  </>;
}
