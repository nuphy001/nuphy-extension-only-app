import type { CampaignTableProps } from '../types/components';
import { campaignStatus } from '../utils/schedule';
import { ProductSummary } from './product-summary';

// 统一列表的商品摘要、实时活动状态和编辑入口。
export function CampaignTable({ campaigns, products, variants, disabled, now, onEdit }: CampaignTableProps) {
  return <s-section heading={'活动列表（' + campaigns.length + '）'}>
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">活动名称</s-table-header>
        <s-table-header>主商品</s-table-header>
        <s-table-header>赠品</s-table-header>
        <s-table-header>状态</s-table-header>
        <s-table-header>操作</s-table-header>
      </s-table-header-row>
      <s-table-body>{campaigns.map(campaign => {
        const status = campaignStatus(campaign, now);
        return <s-table-row key={campaign.id}>
          <s-table-cell><s-paragraph>{campaign.name || campaign.id}</s-paragraph></s-table-cell>
          <s-table-cell><ProductSummary campaign={campaign} role="trigger" products={products} variants={variants} /></s-table-cell>
          <s-table-cell><ProductSummary campaign={campaign} role="gift" products={products} variants={variants} /></s-table-cell>
          <s-table-cell><s-badge tone={status.tone}>{status.label}</s-badge></s-table-cell>
          <s-table-cell><s-button disabled={disabled} onClick={() => onEdit(campaign)}>编辑</s-button></s-table-cell>
        </s-table-row>;
      })}</s-table-body>
    </s-table>
  </s-section>;
}
