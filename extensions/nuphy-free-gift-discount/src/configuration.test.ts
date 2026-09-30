import { describe, expect, it } from 'vitest';
import { configuredCampaigns, parseConfig } from './configuration';

function config() {
  return { version: 1, campaigns: [{
    id: 'kick75', enabled: true,
    triggerVariantIds: ['43805710352493'],
    gifts: [{ variantId: '45773792575597' }],
  }] };
}

describe('campaign configuration validation', () => {
  it('keeps the manager capacity limit for saved configurations', () => {
    const value = config();
    value.campaigns[0].triggerVariantIds = Array.from({ length: 800 }, (_, i) => String(43805710352493 + i));
    expect(() => parseConfig(value)).toThrow('活动配置超过容量');
  });

  it('keeps valid trigger and gift allowlists in the runtime', () => {
    const [campaign] = configuredCampaigns('managed', config());
    expect(campaign.triggerVariantIds.has('gid://shopify/ProductVariant/43805710352493')).toBe(true);
    expect(campaign.giftVariantIds.has('gid://shopify/ProductVariant/45773792575597')).toBe(true);
    expect(campaign.giftVariantIds.has('gid://shopify/ProductVariant/43805710352493')).toBe(false);
  });

  it('fails closed for malformed variant IDs', () => {
    const value = config();
    value.campaigns[0].triggerVariantIds = ['43805710352493', 'not-a-variant'];
    expect(configuredCampaigns('managed', value)).toEqual([]);
  });

  it('fails closed for duplicate campaign IDs', () => {
    const value = config();
    value.campaigns.push({ ...value.campaigns[0] });
    expect(configuredCampaigns('managed', value)).toEqual([]);
  });

  it('fails closed for duplicate gift variants', () => {
    const value = config();
    value.campaigns[0].gifts.push({ variantId: '45773792575597' });
    expect(configuredCampaigns('managed', value)).toEqual([]);
  });
});
