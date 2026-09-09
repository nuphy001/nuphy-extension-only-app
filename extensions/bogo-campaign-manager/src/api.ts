import { parseConfig, type StoredConfig } from '../../nuphy-free-gift-discount/src/configuration';
import { loadConfigQuery, defineConfigMutation, saveConfigMutation, variantsQuery, searchVariantsQuery, productByHandleQuery } from './queries';
import legacy from './legacy-campaigns.json';

type Metafield = { compareDigest: string; value?: string; jsonValue?: unknown };
type Definition = { id: string; key: string; type: { name: string }; access: { storefront: string } };
export type Settings = {
  shop: { id: string; myshopifyDomain: string; mode: Metafield | null; config: Metafield | null };
  metafieldDefinitions: { nodes: Definition[] };
};
export type Variant = {
  id: string; title: string;
  product: { id: string; title: string };
  media: { nodes: { image?: { url: string; altText: string | null } | null }[] };
};
type UserError = { message: string; code?: string };

async function query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
  const result = await shopify.query<T>(document, { variables, version: '2026-04' });
  if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('；'));
  if (!result.data) throw new Error('未能读取 Shopify 数据，请重试');
  return result.data;
}
function checkErrors(errors: UserError[]) {
  if (errors.length) {
    if (errors.some(error => error.code === 'INVALID_COMPARE_DIGEST' || error.code === 'STALE_OBJECT')) {
      throw new Error('活动已被其他人修改。请重新加载后再编辑，避免覆盖对方的修改。');
    }
    throw new Error(errors.map(error => error.message).join('；'));
  }
}
export const loadSettings = () => query<Settings>(loadConfigQuery);
export function initialConfig(settings: Settings): StoredConfig {
  if (settings.shop.mode) {
    if (settings.shop.mode.value !== 'managed' || !settings.shop.config) throw new Error('活动配置不可用，请检查店铺配置');
    return parseConfig(settings.shop.config.jsonValue);
  }
  if (settings.shop.config) throw new Error('店铺已有未完成切换的配置，请先确认，避免覆盖');
  const value = (legacy as Record<string, unknown>)[settings.shop.myshopifyDomain];
  return value ? parseConfig(value) : { version: 1, campaigns: [] };
}
export async function loadVariants(ids: string[]): Promise<Record<string, Variant>> {
  const unique = [...new Set(ids)];
  const variants: Record<string, Variant> = {};
  // nodes 的输入列表上限为 250，已有活动可能包含更多变体。
  for (let offset = 0; offset < unique.length; offset += 100) {
    const result = await query<{ nodes: (Variant | null)[] }>(variantsQuery, {
      ids: unique.slice(offset, offset + 100).map(id => `gid://shopify/ProductVariant/${id}`),
    });
    for (const node of result.nodes) if (node?.id) variants[node.id.split('/').pop()!] = node;
  }
  return variants;
}
export async function saveSettings(settings: Settings, value: StoredConfig): Promise<Settings> {
  const config = parseConfig(value);
  const latest = await loadSettings();
  // 两个项目共享店铺级数据，使用 merchant-owned 定义而非 app 私有命名空间。
  for (const [key, type, name] of [
    ['mode', 'single_line_text_field', 'BOGO 配置来源'],
    ['campaigns', 'json', 'BOGO 买赠活动'],
  ]) {
    const existing = latest.metafieldDefinitions.nodes.find(definition => definition.key === key);
    if (existing) {
      if (existing.type.name !== type || existing.access.storefront !== 'PUBLIC_READ') {
        throw new Error(`店铺 ${key} 字段类型或商城读取权限不正确，请修复后重试`);
      }
    } else {
      const result = await query<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(defineConfigMutation, {
        definition: { name, namespace: 'nuphy_bogo', key, type, ownerType: 'SHOP', access: { storefront: 'PUBLIC_READ' } },
      });
      checkErrors(result.metafieldDefinitionCreate.userErrors);
    }
  }
  // mode 与 campaigns 原子写入；首次写入也通过 null digest 防止并发覆盖。
  const result = await query<{ metafieldsSet: { userErrors: UserError[]; metafields: { key: string; compareDigest: string }[] } }>(saveConfigMutation, {
    metafields: [
      { ownerId: settings.shop.id, namespace: 'nuphy_bogo', key: 'mode', type: 'single_line_text_field', value: 'managed', compareDigest: settings.shop.mode?.compareDigest ?? null },
      { ownerId: settings.shop.id, namespace: 'nuphy_bogo', key: 'campaigns', type: 'json', value: JSON.stringify(config), compareDigest: settings.shop.config?.compareDigest ?? null },
    ],
  });
  checkErrors(result.metafieldsSet.userErrors);
  const fields = result.metafieldsSet.metafields;
  const mode = fields.find(field => field.key === 'mode');
  const campaigns = fields.find(field => field.key === 'campaigns');
  if (!mode || !campaigns) throw new Error('保存结果不完整，请重新加载确认');
  return {
    ...settings,
    shop: { ...settings.shop, mode: { ...mode, value: 'managed' }, config: { ...campaigns, jsonValue: config } },
  };
}
export async function searchVariants(search: string, after: string | null, availableOnly = false) {
  // 选赠品时用 available:true 在服务端过滤掉无库存变体（开启“售罄继续卖”的变体仍会被视为可售）。
  const result = await query<{ productVariants: { nodes: Variant[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(
    searchVariantsQuery,
    { search: availableOnly ? `available:true ${search}`.trim() : search, after },
  );
  return result.productVariants;
}
export async function loadProductByHandle(handle: string): Promise<Variant[] | null> {
  const result = await query<{ products: { nodes: Array<{
    id: string; title: string;
    variants: { nodes: Omit<Variant, 'product'>[] } | null;
  }> } }>(productByHandleQuery, { handle: `handle:${handle}` });
  const product = result.products.nodes[0] ?? null;
  if (!product) return null;
  return (product.variants?.nodes ?? []).map(variant => ({ ...variant, product: { id: product.id, title: product.title } }));
}
