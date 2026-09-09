import type { StandardRenderingExtensionApi } from '@shopify/ui-extensions/admin';
import { parseConfig, type StoredConfig, type StoredCampaign } from '../../nuphy-free-gift-discount/src/configuration';
import { loadConfigQuery, defineConfigMutation, saveConfigMutation, variantsQuery, productQuery, discountQuery, findDiscountsQuery, createDiscountMutation, deactivateDiscountMutation, discountDefinitionQuery } from './queries';
import legacy from './legacy-campaigns.json';

type Metafield = { compareDigest: string; value?: string; jsonValue?: unknown };
type Definition = { id: string; key: string; type: { name: string }; access: { storefront: string } };
export type Settings = {
  shop: { id: string; myshopifyDomain: string; ianaTimezone: string; mode: Metafield | null; config: Metafield | null };
  metafieldDefinitions: { nodes: Definition[] };
  warnings?: string[];
};
export type ProductImage = { url: string; altText: string | null };
export type Variant = { id: string; title: string; sku?: string | null; product: { id: string; title: string }; image?: ProductImage | null };
export type Product = { id: string; title: string; featuredImage: ProductImage | null; variantsCount: number; variants: Variant[] };
type UserError = { message: string; code?: string };
type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type VariantNode = Omit<Variant, 'image'> & { media: { nodes: { image?: ProductImage }[] } };
function variantImage(node: VariantNode): Variant {
  const { media, ...variant } = node;
  return { ...variant, image: media?.nodes.find(item => item.image)?.image ?? null };
}
type NativeDiscount = NonNullable<StoredCampaign['nativeDiscount']>;
type DiscountNode = {
  id: string;
  campaignBinding: { jsonValue: { campaignId?: string; bindingToken?: string } } | null;
  discount: { startsAt?: string; endsAt?: string | null; status?: string; combinesWith?: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean } };
};
class MutationError extends Error {}

async function query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
  const result = await shopify.query<T>(document, { variables, version: '2026-04' });
  if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('；'));
  if (!result.data) throw new Error('未能读取 Shopify 数据，请重试');
  return result.data;
}
function checkErrors(errors: UserError[]) {
  if (!errors.length) return;
  if (errors.some(error => error.code === 'INVALID_COMPARE_DIGEST' || error.code === 'STALE_OBJECT')) {
    throw new MutationError('活动已被其他人修改。请重新加载后再编辑，避免覆盖对方的修改。');
  }
  throw new MutationError(errors.map(error => error.message).join('；'));
}
function numericId(id: string, resource: 'Product' | 'ProductVariant') {
  const match = new RegExp(`^gid://shopify/${resource}/([1-9]\\d*)$`).exec(id);
  if (!match) throw new Error('未能读取所选商品，请重新选择。');
  return match[1];
}
function uniqueIds(ids: string[]) {
  if (ids.some(id => !/^[1-9]\d*$/.test(id))) throw new Error('商品 ID 格式不正确，请重新选择。');
  return [...new Set(ids)];
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
  const unique = uniqueIds(ids);
  const variants: Record<string, Variant> = {};
  for (let offset = 0; offset < unique.length; offset += 100) {
    const result = await query<{ nodes: (VariantNode | null)[] }>(variantsQuery, {
      ids: unique.slice(offset, offset + 100).map(id => `gid://shopify/ProductVariant/${id}`),
    });
    for (const node of result.nodes) if (node?.id) variants[numericId(node.id, 'ProductVariant')] = variantImage(node);
  }
  return variants;
}
export async function loadProducts(ids: string[]): Promise<Record<string, Product>> {
  const products: Record<string, Product> = {};
  const unique = uniqueIds(ids);
  // 分批并发读取；每件商品的变体独立分页，不能把前 100 个误当作全部规格。
  for (let offset = 0; offset < unique.length; offset += 4) {
    await Promise.all(unique.slice(offset, offset + 4).map(async id => {
      let after: string | null = null;
      let product: Product | undefined;
      const seen = new Set<string>();
      do {
        const result: { product: { id: string; title: string; featuredMedia: { image?: ProductImage } | null; variantsCount: { count: number }; variants: { nodes: Omit<VariantNode, 'product'>[]; pageInfo: PageInfo } } | null } = await query(productQuery, { id: `gid://shopify/Product/${id}`, after });
        const node = result.product;
        if (!node) return;
        product ??= { id: node.id, title: node.title, featuredImage: node.featuredMedia?.image ?? null, variantsCount: node.variantsCount.count, variants: [] };
        for (const variant of node.variants.nodes) {
          if (!seen.has(variant.id)) product.variants.push(variantImage({ ...variant, product: { id: node.id, title: node.title } }));
          seen.add(variant.id);
        }
        const page = node.variants.pageInfo;
        if (!page.hasNextPage) break;
        if (!page.endCursor || page.endCursor === after) throw new Error(`读取「${node.title}」的完整规格失败，请重试。`);
        after = page.endCursor;
      } while (true);
      if (product.variants.length !== product.variantsCount) throw new Error(`「${product.title}」的规格在读取时发生变化，请重新加载。`);
      products[id] = product;
    }));
  }
  return products;
}
function picker() {
  // 当前 RC 的 AppHomeApi 漏了声明，复用相同 SDK 的 Resource Picker 类型。
  const app = shopify as typeof shopify & Pick<StandardRenderingExtensionApi<'admin.app.home.render'>, 'resourcePicker'>;
  if (typeof app.resourcePicker !== 'function') throw new Error('商品选择器暂时不可用，请刷新页面后重试。');
  return app;
}
export async function pickProducts(initialProductIds: string[], search?: string) {
  const selection = await picker().resourcePicker({
    type: 'product', action: 'select', multiple: true, filter: { variants: false },
    selectionIds: uniqueIds(initialProductIds).map(id => ({ id: `gid://shopify/Product/${id}` })),
    ...(search ? { query: search } : {}),
  });
  if (selection === undefined) return;
  const ids = [...new Set(selection.map(item => numericId(item.id, 'Product')))];
  const products = await loadProducts(ids);
  if (ids.some(id => !products[id])) throw new Error('部分商品已删除或不可访问，请重新选择。');
  return { ids, products };
}
export async function pickVariants(initial: string[]) {
  const selection = await picker().resourcePicker({
    type: 'variant', action: 'select', multiple: true,
    selectionIds: uniqueIds(initial).map(id => ({ id: `gid://shopify/ProductVariant/${id}` })),
  });
  if (selection === undefined) return;
  const ids = [...new Set(selection.map(item => numericId(item.id, 'ProductVariant')))];
  return { ids, products: await loadVariants(ids) };
}

async function ensureDefinitions(settings: Settings) {
  // 商城与 App 共享这些字段，因此保留 merchant-owned namespace。
  for (const [key, type, name] of [['mode', 'single_line_text_field', 'BOGO 配置来源'], ['campaigns', 'json', 'BOGO 买赠活动']]) {
    const existing = settings.metafieldDefinitions.nodes.find(definition => definition.key === key);
    if (existing) {
      if (existing.type.name !== type || existing.access.storefront !== 'PUBLIC_READ') throw new Error(`店铺 ${key} 字段类型或商城读取权限不正确，请修复后重试`);
    } else {
      const result = await query<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(defineConfigMutation, {
        definition: { name, namespace: 'nuphy_bogo', key, type, ownerType: 'SHOP', access: { storefront: 'PUBLIC_READ' } },
      });
      checkErrors(result.metafieldDefinitionCreate.userErrors);
    }
  }
}
async function publishSettings(settings: Settings, config: StoredConfig): Promise<Settings> {
  const result = await query<{ metafieldsSet: { userErrors: UserError[]; metafields: { key: string; compareDigest: string }[] } }>(saveConfigMutation, {
    metafields: [
      { ownerId: settings.shop.id, namespace: 'nuphy_bogo', key: 'mode', type: 'single_line_text_field', value: 'managed', compareDigest: settings.shop.mode?.compareDigest ?? null },
      { ownerId: settings.shop.id, namespace: 'nuphy_bogo', key: 'campaigns', type: 'json', value: JSON.stringify(config), compareDigest: settings.shop.config?.compareDigest ?? null },
    ],
  });
  checkErrors(result.metafieldsSet.userErrors);
  const mode = result.metafieldsSet.metafields.find(field => field.key === 'mode');
  const campaigns = result.metafieldsSet.metafields.find(field => field.key === 'campaigns');
  if (!mode || !campaigns) throw new Error('保存结果不完整，请重新加载确认');
  return { ...settings, warnings: undefined, shop: { ...settings.shop, mode: { ...mode, value: 'managed' }, config: { ...campaigns, jsonValue: config } } };
}
export async function saveSettings(settings: Settings, value: StoredConfig): Promise<Settings> {
  const config = parseConfig(value);
  const latest = await loadSettings();
  if ([...config.campaigns, ...initialConfig(latest).campaigns].some(campaign => campaign.nativeDiscount || campaign.startsAt || campaign.endsAt)) {
    throw new Error('已设置排期的活动请逐个保存，不能用批量导入覆盖。');
  }
  await ensureDefinitions(latest);
  return publishSettings(settings, config);
}
function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function same(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
async function loadDiscount(id: string) {
  return (await query<{ discountNode: DiscountNode | null }>(discountQuery, { id })).discountNode;
}
function isBound(node: DiscountNode | null, campaignId: string, token: string) {
  return node?.campaignBinding?.jsonValue?.campaignId === campaignId && node.campaignBinding.jsonValue.bindingToken === token && !!node.discount.startsAt;
}
async function findPrepared(campaignId: string, token: string): Promise<NativeDiscount | undefined> {
  let after: string | null = null;
  do {
    const result: { discountNodes: { nodes: DiscountNode[]; pageInfo: PageInfo } } = await query(findDiscountsQuery, { after });
    const found = result.discountNodes.nodes.find(node => isBound(node, campaignId, token));
    if (found) return { id: found.id, token };
    const page = result.discountNodes.pageInfo;
    if (!page.hasNextPage) return;
    if (!page.endCursor || page.endCursor === after) throw new Error('未能确认折扣创建结果，请稍后重试。');
    after = page.endCursor;
  } while (true);
}
const preparations = new Map<string, { token: string; attempted: boolean; owner?: NativeDiscount; startsAt: string }>();
const uncertainPublications = new Map<string, StoredCampaign | null>();
const savingShops = new Set<string>();
function newBindingToken() {
  const runtime = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  return runtime.crypto?.randomUUID?.() ?? `bogo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2).padEnd(16, '0')}-${Math.random().toString(36).slice(2).padEnd(16, '0')}`;
}
async function prepareDiscount(shopId: string, campaign: StoredCampaign, base: StoredCampaign | undefined, previous: DiscountNode | null) {
  const key = canonical([shopId, base, campaign]);
  let preparation = preparations.get(key);
  if (!preparation) {
    // “立即开始”不保存显式时间；排期未改时沿用原 owner 的开始，避免历史结束时间早于新的 now。
    const historicalStart = same(base?.startsAt, campaign.startsAt) ? previous?.discount.startsAt : undefined;
    preparation = { token: newBindingToken(), attempted: false, startsAt: campaign.startsAt ?? historicalStart ?? new Date().toISOString() };
    preparations.set(key, preparation);
  }
  if (preparation.owner) return { ...preparation.owner };
  // 请求超时不等于创建失败；同一草稿重试前按 token 查回已经准备的折扣。
  if (preparation.attempted) {
    const found = await findPrepared(campaign.id, preparation.token);
    if (found) { preparation.owner = found; return found; }
    // 搜索结果可能尚未包含上次创建。换 token 后再准备，避免两份 owner 共用有效绑定。
    preparation.token = newBindingToken();
  }
  const definitions = await query<{ metafieldDefinitions: { nodes: { type: { name: string } }[] } }>(discountDefinitionQuery);
  if (!definitions.metafieldDefinitions.nodes.length) {
    const result = await query<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(defineConfigMutation, {
      definition: { name: 'BOGO 活动绑定', namespace: 'nuphy_bogo', key: 'campaign', type: 'json', ownerType: 'DISCOUNT' },
    });
    checkErrors(result.metafieldDefinitionCreate.userErrors);
  } else if (definitions.metafieldDefinitions.nodes[0].type.name !== 'json') throw new Error('折扣活动绑定字段类型不正确，请检查配置。');
  preparation.attempted = true;
  try {
    const result = await query<{ discountAutomaticAppCreate: { automaticAppDiscount: { discountId: string } | null; userErrors: UserError[] } }>(createDiscountMutation, {
      discount: {
        title: campaign.name || 'BOGO 买赠活动', functionHandle: 'nuphy-free-gift-discount', discountClasses: ['PRODUCT'],
        startsAt: preparation.startsAt, endsAt: campaign.endsAt ?? null,
        combinesWith: { productDiscounts: true, orderDiscounts: previous?.discount.combinesWith?.orderDiscounts ?? false, shippingDiscounts: previous?.discount.combinesWith?.shippingDiscounts ?? false },
        // 必须随 owner 一起创建，避免新折扣在尚无绑定时走旧活动分支。
        metafields: [{ namespace: 'nuphy_bogo', key: 'campaign', type: 'json', value: JSON.stringify({ campaignId: campaign.id, bindingToken: preparation.token }) }],
      },
    });
    checkErrors(result.discountAutomaticAppCreate.userErrors);
    const id = result.discountAutomaticAppCreate.automaticAppDiscount?.discountId;
    if (!id) throw new Error('Shopify 未返回折扣 ID，请重试确认创建结果。');
    preparation.owner = { id, token: preparation.token };
    return { ...preparation.owner };
  } catch (error) {
    if (error instanceof MutationError) { preparations.delete(key); throw error; }
    const found = await findPrepared(campaign.id, preparation.token).catch(() => undefined);
    if (found) { preparation.owner = found; return found; }
    throw new Error(`未能确认折扣准备结果；活动配置未发布，请保留输入后重试。${error instanceof Error ? error.message : ''}`);
  }
}
async function retireDiscount(owner: NativeDiscount, campaignId: string): Promise<string | undefined> {
  try {
    const node = await loadDiscount(owner.id);
    if (!node) return;
    if (!isBound(node, campaignId, owner.token)) return '活动已保存，旧折扣绑定不匹配，未自动停用，请检查 Shopify 折扣。';
    if (node.discount.status === 'EXPIRED') return;
    const result = await query<{ discountAutomaticDeactivate: { userErrors: UserError[] } }>(deactivateDiscountMutation, { id: owner.id });
    checkErrors(result.discountAutomaticDeactivate.userErrors);
  } catch {
    return '活动已保存，旧折扣暂未停用；旧绑定已失效，不会重复发放，请稍后检查 Shopify 折扣。';
  }
}
export async function saveCampaign(settings: Settings, baseCampaign: StoredCampaign | undefined, draftCampaign: StoredCampaign | null): Promise<Settings> {
  if (!baseCampaign && !draftCampaign) throw new Error('没有可以保存的活动。');
  if (baseCampaign && draftCampaign && baseCampaign.id !== draftCampaign.id) throw new Error('不能修改活动 ID。');
  if (savingShops.has(settings.shop.id)) throw new Error('活动正在保存，请稍候。');
  savingShops.add(settings.shop.id);
  const publicationKey = canonical([settings.shop.id, baseCampaign, draftCampaign]);
  try {
    const latest = await loadSettings();
    if (latest.shop.id !== settings.shop.id) throw new Error('当前店铺已变化，请重新加载。');
    const config = initialConfig(latest);
    const id = (baseCampaign ?? draftCampaign)!.id;
    const current = config.campaigns.find(campaign => campaign.id === id);
    if (uncertainPublications.has(publicationKey) && same(current, uncertainPublications.get(publicationKey) ?? undefined)) {
      uncertainPublications.delete(publicationKey);
      if (baseCampaign?.nativeDiscount && (!current?.enabled || current.nativeDiscount?.id !== baseCampaign.nativeDiscount.id)) {
        const warning = await retireDiscount(baseCampaign.nativeDiscount, id);
        if (warning) latest.warnings = [warning];
      }
      return latest;
    }
    if (!same(current, baseCampaign)) throw new Error('这个活动已被其他人修改。请重新加载后再编辑；其他活动的修改已保留。');
    let draft = draftCampaign ? parseConfig({ version: 1, campaigns: [{ ...draftCampaign, nativeDiscount: current?.nativeDiscount }] }).campaigns[0] : null;
    await ensureDefinitions(latest);
    const previous = current?.nativeDiscount ? await loadDiscount(current.nativeDiscount.id) : null;
    if (current?.nativeDiscount && previous && !isBound(previous, id, current.nativeDiscount.token)) throw new Error('活动的 Shopify 折扣绑定已变化，请重新加载后检查。');
    if (draft?.enabled) {
      const endedOnSchedule = previous?.discount.endsAt && Date.parse(previous.discount.endsAt) <= Date.now();
      const reusable = current?.enabled && current.nativeDiscount && previous && (previous.discount.status !== 'EXPIRED' || endedOnSchedule)
        && same(current.name, draft.name)
        && same(current.startsAt, draft.startsAt) && same(current.endsAt, draft.endsAt)
        && (!draft.startsAt || Date.parse(previous.discount.startsAt!) === Date.parse(draft.startsAt))
        && (previous.discount.endsAt ? Date.parse(previous.discount.endsAt) : null) === (draft.endsAt ? Date.parse(draft.endsAt) : null);
      draft = { ...draft, nativeDiscount: reusable ? current.nativeDiscount : await prepareDiscount(settings.shop.id, draft, current, previous) };
    }
    const next = parseConfig({ version: 1, campaigns: current
      ? config.campaigns.flatMap(campaign => campaign.id === id ? (draft ? [draft] : []) : [campaign])
      : [...config.campaigns, draft!] });
    let saved: Settings;
    uncertainPublications.set(publicationKey, draft);
    try {
      saved = await publishSettings(latest, next);
    } catch (error) {
      // CAS 响应丢失时读回；确实成功就结束，不把相同活动再创建一次。
      if (error instanceof MutationError) { uncertainPublications.delete(publicationKey); throw error; }
      const verified = await loadSettings().catch(() => null);
      if (!verified || !same(initialConfig(verified).campaigns.find(campaign => campaign.id === id), draft ?? undefined)) throw error;
      saved = verified;
    }
    uncertainPublications.delete(publicationKey);
    if (current?.nativeDiscount && (!draft?.enabled || draft.nativeDiscount?.id !== current.nativeDiscount.id)) {
      const warning = await retireDiscount(current.nativeDiscount, id);
      if (warning) saved.warnings = [warning];
    }
    return saved;
  } finally {
    savingShops.delete(settings.shop.id);
  }
}
