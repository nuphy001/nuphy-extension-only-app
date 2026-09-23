export interface StoredTriggerProduct {
  productId: string;
  excludedVariantIds: string[];
}
export interface StoredCampaign {
  id: string;
  name?: string;
  enabled: boolean;
  showLabel?: boolean;
  triggerQuantity?: number;
  triggerVariantIds: string[];
  triggerProducts?: StoredTriggerProduct[];
  gifts: { variantId: string }[];
  startsAt?: string;
  endsAt?: string;
  nativeDiscount?: { id: string; token: string };
}
export interface StoredConfig { version: 1; campaigns: StoredCampaign[] }

export const MAX_CONFIG_BYTES = 10000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function variant(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}
function identifiers(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(variant) && new Set(value).size === value.length;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60;
}
function bindingToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 128;
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
  if (configBytes(JSON.stringify(value)) > MAX_CONFIG_BYTES) throw new Error('活动配置超过容量，请减少不再使用的活动或商品变体');
  const ids = new Set<string>();
  const campaigns = value.campaigns.map((campaign: unknown): StoredCampaign => {
    if (!record(campaign)
      || typeof campaign.id !== 'string' || !campaign.id.length || campaign.id.length > 100 || ids.has(campaign.id)
      || (campaign.name !== undefined && (typeof campaign.name !== 'string' || campaign.name.length > 100))
      || typeof campaign.enabled !== 'boolean'
      || (campaign.showLabel !== undefined && typeof campaign.showLabel !== 'boolean')
      || (campaign.triggerQuantity !== undefined && (typeof campaign.triggerQuantity !== 'number'
        || !Number.isInteger(campaign.triggerQuantity) || campaign.triggerQuantity < 1 || campaign.triggerQuantity > 2147483647))
      || !identifiers(campaign.triggerVariantIds)
      || (campaign.triggerProducts !== undefined && (!Array.isArray(campaign.triggerProducts)
        || !campaign.triggerProducts.every(product => record(product) && variant(product.productId)
          && identifiers(product.excludedVariantIds))))
      || !Array.isArray(campaign.gifts) || !campaign.gifts.length
      || !campaign.gifts.every((gift: unknown) => record(gift) && variant(gift.variantId))) {
      throw new Error('请检查活动名称、主商品、赠品和赠送数量');
    }
    ids.add(campaign.id);
    const triggerProducts = campaign.triggerProducts as StoredTriggerProduct[] | undefined;
    if (!campaign.triggerVariantIds.length && !triggerProducts?.length) throw new Error('请至少选择一个适用产品或商品规格');
    if (triggerProducts && new Set(triggerProducts.map(product => product.productId)).size !== triggerProducts.length) {
      throw new Error('同一活动的适用产品不能重复');
    }
    if ((campaign.startsAt !== undefined && !timestamp(campaign.startsAt))
      || (campaign.endsAt !== undefined && !timestamp(campaign.endsAt))
      || (typeof campaign.startsAt === 'string' && typeof campaign.endsAt === 'string' && campaign.endsAt <= campaign.startsAt)) {
      throw new Error('请检查活动开始和结束时间，结束时间必须晚于开始时间');
    }
    if (campaign.nativeDiscount !== undefined && (!record(campaign.nativeDiscount)
      || typeof campaign.nativeDiscount.id !== 'string'
      || !/^gid:\/\/shopify\/DiscountAutomaticNode\/[1-9]\d*$/.test(campaign.nativeDiscount.id)
      || !bindingToken(campaign.nativeDiscount.token))) {
      throw new Error('活动折扣绑定格式不正确');
    }
    const gifts = campaign.gifts.map((gift: { variantId: string }) => ({ variantId: gift.variantId }));
    if (new Set(gifts.map(gift => gift.variantId)).size !== gifts.length) throw new Error('同一活动的赠品不能重复');
    return {
      id: campaign.id, name: campaign.name as string | undefined, enabled: campaign.enabled,
      showLabel: campaign.showLabel as boolean | undefined,
      triggerQuantity: campaign.triggerQuantity as number | undefined,
      triggerVariantIds: campaign.triggerVariantIds,
      triggerProducts: triggerProducts?.map(product => ({ productId: product.productId, excludedVariantIds: product.excludedVariantIds })),
      gifts,
      startsAt: campaign.startsAt as string | undefined,
      endsAt: campaign.endsAt as string | undefined,
      nativeDiscount: campaign.nativeDiscount === undefined ? undefined : {
        id: (campaign.nativeDiscount as StoredCampaign['nativeDiscount'])!.id,
        token: (campaign.nativeDiscount as StoredCampaign['nativeDiscount'])!.token,
      },
    };
  });
  return { version: 1, campaigns };
}

export function matchesTrigger(campaign: {
  triggerVariantIds: ReadonlySet<string>;
  triggerProducts?: ReadonlyMap<string, ReadonlySet<string>>;
}, variantId: string, productId?: string): boolean {
  const excluded = productId ? campaign.triggerProducts?.get(productId) : undefined;
  // 整款产品已明确排除的规格，不能再从旧规格白名单绕回活动。
  return excluded ? !excluded.has(variantId) : campaign.triggerVariantIds.has(variantId);
}

export function configuredCampaigns(mode: string | undefined, value: unknown, binding?: { jsonValue?: unknown } | null) {
  if (mode !== 'managed') return [];
  try {
    const campaigns = parseConfig(value).campaigns;
    let selected: StoredCampaign[];
    if (binding != null) {
      const marker = binding.jsonValue;
      if (!record(marker) || typeof marker.campaignId !== 'string' || !bindingToken(marker.bindingToken)) return [];
      selected = campaigns.filter(campaign => campaign.id === marker.campaignId && campaign.nativeDiscount?.token === marker.bindingToken);
    } else {
      // 原折扣只承接未迁移活动，不能绕过新折扣的 Shopify 原生排期。
      selected = campaigns.filter(campaign => !campaign.nativeDiscount && !campaign.startsAt && !campaign.endsAt);
    }
    return selected.filter(campaign => campaign.enabled).map(campaign => ({
      id: campaign.id,
      triggerVariantIds: new Set(campaign.triggerVariantIds.map(id => `gid://shopify/ProductVariant/${id}`)),
      triggerProducts: new Map(campaign.triggerProducts?.map(product => [
        `gid://shopify/Product/${product.productId}`,
        new Set(product.excludedVariantIds.map(id => `gid://shopify/ProductVariant/${id}`)),
      ])),
      giftVariantIds: new Set(campaign.gifts.map(gift => `gid://shopify/ProductVariant/${gift.variantId}`)),
    }));
  } catch {
    // 页面管理启用后，坏配置只会停止发放折扣，不能恢复旧白名单。
    return [];
  }
}
