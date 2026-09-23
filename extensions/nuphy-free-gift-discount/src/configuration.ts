export interface StoredCampaign {
  id: string;
  name?: string;
  enabled: boolean;
  showLabel?: boolean;
  triggerQuantity?: number;
  triggerVariantIds: string[];
  gifts: { variantId: string }[];
}
export interface StoredConfig { version: 1; campaigns: StoredCampaign[] }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function variant(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}
export function configBytes(value: string): number {
  // Function 运行时不依赖浏览器的 TextEncoder。
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
export function parseConfig(value: unknown): StoredConfig {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.campaigns)) {
    throw new Error('活动配置格式或版本不正确');
  }
  if (configBytes(JSON.stringify(value)) > 10000) throw new Error('活动配置超过容量，请减少不再使用的活动或商品变体');
  const ids = new Set<string>();
  const campaigns = value.campaigns.map((campaign: unknown): StoredCampaign => {
    if (!record(campaign)
      || typeof campaign.id !== 'string' || !campaign.id.length || campaign.id.length > 100 || ids.has(campaign.id)
      || (campaign.name !== undefined && (typeof campaign.name !== 'string' || campaign.name.length > 100))
      || typeof campaign.enabled !== 'boolean'
      || (campaign.showLabel !== undefined && typeof campaign.showLabel !== 'boolean')
      || (campaign.triggerQuantity !== undefined && (typeof campaign.triggerQuantity !== 'number'
        || !Number.isInteger(campaign.triggerQuantity) || campaign.triggerQuantity < 1 || campaign.triggerQuantity > 2147483647))
      || !Array.isArray(campaign.triggerVariantIds) || !campaign.triggerVariantIds.length
      || !campaign.triggerVariantIds.every(variant)
      || new Set(campaign.triggerVariantIds).size !== campaign.triggerVariantIds.length
      || !Array.isArray(campaign.gifts) || !campaign.gifts.length
      || !campaign.gifts.every((gift: unknown) => record(gift) && variant(gift.variantId))) {
      throw new Error('请检查活动名称、主商品、赠品和赠送数量');
    }
    ids.add(campaign.id);
    const gifts = campaign.gifts.map((gift: { variantId: string }) => ({ variantId: gift.variantId }));
    if (new Set(gifts.map(gift => gift.variantId)).size !== gifts.length) throw new Error('同一活动的赠品不能重复');
    return {
      id: campaign.id, name: campaign.name as string | undefined, enabled: campaign.enabled,
      showLabel: campaign.showLabel as boolean | undefined,
      triggerQuantity: campaign.triggerQuantity as number | undefined,
      triggerVariantIds: campaign.triggerVariantIds, gifts,
    };
  });
  return { version: 1, campaigns };
}

export function configuredCampaigns(mode: string | undefined, value: unknown) {
  if (mode !== 'managed') return [];
  try {
    return parseConfig(value).campaigns.filter(campaign => campaign.enabled).map(campaign => ({
      id: campaign.id,
      triggerVariantIds: new Set(campaign.triggerVariantIds.map(id => `gid://shopify/ProductVariant/${id}`)),
      giftVariantIds: new Set(campaign.gifts.map(gift => `gid://shopify/ProductVariant/${gift.variantId}`)),
    }));
  } catch {
    // 页面管理启用后，坏配置只会停止发放折扣，不能恢复旧白名单。
    return [];
  }
}
