import { parseConfig } from '../../nuphy-free-gift-discount/src/configuration';
import type { StoredConfig, StoredCampaign } from './types/campaign';
import type { Settings, Variant, Product, VariantNode, PickerProductSelection, PickerOptions, PickerResult, ResourcePickerApi, DiscountNode, DiscountPreparation, NativeDiscount } from './types/api';
import type * as Response from './types/responses';
import { resourceId, uniqueIds } from './utils/ids';
import { checkErrors, MutationError } from './utils/errors';
import { initialSelection, isHandleSearch, normalizeSelection, pickerRanges, validateSelection, variantSelection } from './utils/picker';
import { canonical, same, isBound, matchesPreparation, canReuseDiscount } from './utils/discount';
import { loadConfigQuery, defineConfigMutation, saveConfigMutation, variantsQuery, productQuery, findProductQuery, discountQuery, findDiscountsQuery, createDiscountMutation, deactivateDiscountMutation, discountDefinitionQuery } from './queries';
import legacy from './legacy-campaigns.json';

// 统一处理 Admin API 的 GraphQL 错误和空响应。
async function query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
  const result = await shopify.query<T>(document, { variables, version: '2026-04' });
  if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('；'));
  if (!result.data) throw new Error('未能读取 Shopify 数据，请重试');
  return result.data;
}
export const loadSettings = () => query<Settings>(loadConfigQuery);
// 已切换店铺读取页面管理配置，未切换店铺使用各自的旧活动配置。
export function initialConfig(settings: Settings): StoredConfig {
  if (settings.shop.mode) {
    if (settings.shop.mode.value !== 'managed' || !settings.shop.config) throw new Error('活动配置不可用，请检查店铺配置');
    return parseConfig(settings.shop.config.jsonValue);
  }
  if (settings.shop.config) throw new Error('店铺已有未完成切换的配置，请先确认，避免覆盖');
  const value = (legacy as Record<string, unknown>)[settings.shop.myshopifyDomain];
  return value ? parseConfig(value) : { version: 1, campaigns: [] };
}
// 将规格 ID 去重后分批读取，返回按规格 ID 索引的详情。
export async function loadVariants(ids: string[]): Promise<Record<string, Variant>> {
  const unique = uniqueIds(ids);
  const variants: Record<string, Variant> = {};
  for (let offset = 0; offset < unique.length; offset += 100) {
    const result = await query<Response.Variants>(variantsQuery, {
      ids: unique.slice(offset, offset + 100).map(id => `gid://shopify/ProductVariant/${id}`),
    });
    for (const node of result.nodes) if (node?.id) variants[resourceId(node.id, 'ProductVariant')] = variantImage(node);
  }
  return variants;
}
function variantImage(node: VariantNode): Variant {
  const { media, ...variant } = node;
  return { ...variant, image: media?.nodes.find(item => item.image)?.image ?? null };
}

// 读取单件商品的完整规格，分页异常或数量变化时拒绝返回部分结果。
async function loadProduct(id: string): Promise<Product | undefined> {
  let after: string | null = null;
  let product: Product | undefined;
  const seen = new Set<string>();
  do {
    const result: Response.ProductPage = await query(productQuery, { id: `gid://shopify/Product/${id}`, after });
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
  return product;
}

// 每批最多 4 件商品并发，单件商品的规格按游标依次读取。
export async function loadProducts(ids: string[]): Promise<Record<string, Product>> {
  const products: Record<string, Product> = {};
  const unique = uniqueIds(ids);
  for (let offset = 0; offset < unique.length; offset += 4) {
    await Promise.all(unique.slice(offset, offset + 4).map(async id => {
      const product = await loadProduct(id);
      if (product) products[id] = product;
    }));
  }
  return products;
}
function picker() {
  // 当前 RC 的 AppHomeApi 漏了声明，复用相同 SDK 的 Resource Picker 类型。
  const app = shopify as typeof shopify & ResourcePickerApi;
  if (typeof app.resourcePicker !== 'function') throw new Error('商品选择器暂时不可用，请刷新页面后重试。');
  return app;
}
// 将规格弹窗的 Handle 搜索转换为 product_id，其他搜索原样传递。
async function pickerSearch(search: string | undefined, variantPicker: boolean) {
  if (!variantPicker || !isHandleSearch(search)) return search;
  const result = await query<Response.ProductSearch>(findProductQuery, { query: search });
  const product = result.products.nodes[0];
  if (!product) throw new Error('未找到该 Handle 对应的产品，请检查后重新搜索。');
  return `product_id:${resourceId(product.id, 'Product')}`;
}

// 打开前校验原有选择，确认后读回最新规格和库存，再返回可应用的结果。
export async function pickProducts(initial: PickerProductSelection[], search?: string, options: PickerOptions = {}): Promise<PickerResult | undefined> {
  const app = picker();
  const variantPicker = Boolean(options.singleVariantOnly || options.inStockOnly);
  const initialIds = uniqueIds(initial.map(item => item.productId));
  const ranges = pickerRanges(initial);
  const selectionIds = initialSelection(ranges, await loadProducts(initialIds), options);
  const variantIds = variantSelection(selectionIds, options);
  const query = await pickerSearch(search, variantPicker);
  const picked = await app.resourcePicker({
    type: variantPicker ? 'variant' : 'product', action: 'select', multiple: !options.singleVariantOnly,
    filter: variantPicker ? (options.inStockOnly ? { query: 'inventory_quantity:>0' } : {}) : { variants: true },
    selectionIds: variantPicker ? variantIds : selectionIds,
    ...(query ? { query } : {}),
  });
  if (picked === undefined) return;
  const selection = normalizeSelection(picked, variantPicker, options);
  const result = { ...selection, products: await loadProducts(selection.ids) };
  validateSelection(result, options);
  return result;
}

// 检查或补齐商城与 App 共享的配置字段，保留 merchant-owned namespace。
async function ensureDefinitions(settings: Settings) {
  for (const [key, type, name] of [['mode', 'single_line_text_field', 'BOGO 配置来源'], ['campaigns', 'json', 'BOGO 买赠活动']]) {
    const existing = settings.metafieldDefinitions.nodes.find(definition => definition.key === key);
    if (existing) {
      if (existing.type.name !== type || existing.access.storefront !== 'PUBLIC_READ') throw new Error(`店铺 ${key} 字段类型或商城读取权限不正确，请修复后重试`);
      continue;
    }
    const result = await query<Response.DefinitionCreate>(defineConfigMutation, {
      definition: { name, namespace: 'nuphy_bogo', key, type, ownerType: 'SHOP', access: { storefront: 'PUBLIC_READ' } },
    });
    checkErrors(result.metafieldDefinitionCreate.userErrors);
  }
}
// 携带读取时的摘要同时保存模式与活动配置，防止覆盖并发修改。
async function publishSettings(settings: Settings, config: StoredConfig): Promise<Settings> {
  const result = await query<Response.SettingsSave>(saveConfigMutation, {
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
// 批量导入仅接受未绑定原生折扣、未设置排期的活动。
export async function saveSettings(settings: Settings, value: StoredConfig): Promise<Settings> {
  const config = parseConfig(value);
  const latest = await loadSettings();
  if ([...config.campaigns, ...initialConfig(latest).campaigns].some(campaign => campaign.nativeDiscount || campaign.startsAt || campaign.endsAt)) {
    throw new Error('已设置排期的活动请逐个保存，不能用批量导入覆盖。');
  }
  await ensureDefinitions(latest);
  return publishSettings(settings, config);
}
async function loadDiscount(id: string) {
  return (await query<Response.Discount>(discountQuery, { id })).discountNode;
}
// 分页查回仍符合本次准备条件的折扣，恢复结果不确定的创建请求。
async function findPrepared(campaign: StoredCampaign, preparation: DiscountPreparation): Promise<NativeDiscount | undefined> {
  let after: string | null = null;
  do {
    const result: Response.Discounts = await query<Response.Discounts>(findDiscountsQuery, { after });
    const found = result.discountNodes.nodes.find(node => matchesPreparation(node, campaign, preparation));
    if (found) return { id: found.id, token: preparation.token };
    const page = result.discountNodes.pageInfo;
    if (!page.hasNextPage) return;
    if (!page.endCursor || page.endCursor === after) throw new Error('未能确认折扣创建结果，请稍后重试。');
    after = page.endCursor;
  } while (true);
}
const preparations = new Map<string, DiscountPreparation>();
const uncertainPublications = new Map<string, StoredCampaign | null>();
const savingShops = new Set<string>();
function clearPreparations(shopId: string, campaignId: string) {
  for (const [key, preparation] of preparations) {
    if (preparation.shopId === shopId && preparation.campaignId === campaignId) preparations.delete(key);
  }
}
function newBindingToken() {
  const runtime = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  return runtime.crypto?.randomUUID?.() ?? `bogo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2).padEnd(16, '0')}-${Math.random().toString(36).slice(2).padEnd(16, '0')}`;
}
async function ensureDiscountDefinition() {
  const { metafieldDefinitions } = await query<Response.DiscountDefinition>(discountDefinitionQuery);
  const existing = metafieldDefinitions.nodes[0];
  if (existing) {
    if (existing.type.name !== 'json') throw new Error('折扣活动绑定字段类型不正确，请检查配置。');
    return;
  }
  const result = await query<Response.DefinitionCreate>(defineConfigMutation, {
    definition: { name: 'BOGO 活动绑定', namespace: 'nuphy_bogo', key: 'campaign', type: 'json', ownerType: 'DISCOUNT' },
  });
  checkErrors(result.metafieldDefinitionCreate.userErrors);
}

// 创建折扣时一并写入活动绑定，避免新 owner 暂时落入旧活动规则。
async function createDiscountOwner(campaign: StoredCampaign, preparation: DiscountPreparation, previous: DiscountNode | null): Promise<NativeDiscount> {
  const result = await query<Response.DiscountCreate>(createDiscountMutation, {
    discount: {
      title: campaign.name || 'BOGO 买赠活动', functionHandle: 'nuphy-free-gift-discount', discountClasses: ['PRODUCT'],
      startsAt: preparation.startsAt, endsAt: campaign.endsAt ?? null,
      combinesWith: { productDiscounts: true, orderDiscounts: previous?.discount.combinesWith?.orderDiscounts ?? false, shippingDiscounts: previous?.discount.combinesWith?.shippingDiscounts ?? false },
      metafields: [{ namespace: 'nuphy_bogo', key: 'campaign', type: 'json', value: JSON.stringify({ campaignId: campaign.id, bindingToken: preparation.token }) }],
    },
  });
  checkErrors(result.discountAutomaticAppCreate.userErrors);
  const id = result.discountAutomaticAppCreate.automaticAppDiscount?.discountId;
  if (!id) throw new Error('Shopify 未返回折扣 ID，请重试确认创建结果。');
  return { id, token: preparation.token };
}

// 为同一草稿复用有效的准备记录，必要时创建新的原生折扣。
async function prepareDiscount(shopId: string, campaign: StoredCampaign, base: StoredCampaign | undefined, previous: DiscountNode | null) {
  const key = canonical([shopId, base, campaign]);
  let preparation = preparations.get(key);
  if (!preparation) {
    // “立即开始”不保存显式时间；排期未改时沿用原 owner 的开始，避免历史结束时间早于新的 now。
    const historicalStart = same(base?.startsAt, campaign.startsAt) ? previous?.discount.startsAt : undefined;
    preparation = { shopId, campaignId: campaign.id, token: newBindingToken(), attempted: false, startsAt: campaign.startsAt ?? historicalStart ?? new Date().toISOString() };
    preparations.set(key, preparation);
  }
  if (preparation.owner) {
    const node = await loadDiscount(preparation.owner.id);
    if (matchesPreparation(node, campaign, preparation)) return { ...preparation.owner };
    // 准备后尚未发布的折扣也可能被删除、停用或改期，不能仅凭内存缓存复用。
    preparation.owner = undefined;
    preparation.attempted = false;
    preparation.token = newBindingToken();
  }
  // 请求超时不等于创建失败；同一草稿重试前按 token 查回已经准备的折扣。
  if (preparation.attempted) {
    const found = await findPrepared(campaign, preparation);
    if (found) { preparation.owner = found; return found; }
    // 搜索结果可能尚未包含上次创建。换 token 后再准备，避免两份 owner 共用有效绑定。
    preparation.token = newBindingToken();
  }
  await ensureDiscountDefinition();
  preparation.attempted = true;
  try {
    preparation.owner = await createDiscountOwner(campaign, preparation, previous);
    return { ...preparation.owner };
  } catch (error) {
    if (error instanceof MutationError) { preparations.delete(key); throw error; }
    const found = await findPrepared(campaign, preparation).catch(() => undefined);
    if (found) { preparation.owner = found; return found; }
    throw new Error(`未能确认折扣准备结果；活动配置未发布，请保留输入后重试。${error instanceof Error ? error.message : ''}`);
  }
}
// 停用前核对活动绑定，失败只返回警告，不把已保存的配置误报为失败。
async function retireDiscount(owner: NativeDiscount, campaignId: string): Promise<string | undefined> {
  try {
    const node = await loadDiscount(owner.id);
    if (!node) return;
    if (!isBound(node, campaignId, owner.token)) return '活动已保存，旧折扣绑定不匹配，未自动停用，请检查 Shopify 折扣。';
    if (node.discount.status === 'EXPIRED') return;
    const result = await query<Response.DiscountDeactivate>(deactivateDiscountMutation, { id: owner.id });
    checkErrors(result.discountAutomaticDeactivate.userErrors);
  } catch {
    return '活动已保存，旧折扣暂未停用；旧绑定已失效，不会重复发放，请稍后检查 Shopify 折扣。';
  }
}
// 检查旧绑定，为启用的草稿复用或准备对应的原生折扣。
async function prepareCampaignDiscount(shopId: string, current: StoredCampaign | undefined, draft: StoredCampaign | null) {
  const previous = current?.nativeDiscount ? await loadDiscount(current.nativeDiscount.id) : null;
  if (current?.nativeDiscount && previous && !isBound(previous, current.id, current.nativeDiscount.token)) {
    throw new Error('活动的 Shopify 折扣绑定已变化，请重新加载后检查。');
  }
  if (!draft?.enabled) return draft;
  const nativeDiscount = canReuseDiscount(current, draft, previous)
    ? current!.nativeDiscount!
    : await prepareDiscount(shopId, draft, current, previous);
  return { ...draft, nativeDiscount };
}

// 配置发布后，仅停用已不再被当前活动使用的旧折扣。
async function retirePreviousDiscount(settings: Settings, previous: StoredCampaign | undefined, current: StoredCampaign | null | undefined) {
  const owner = previous?.nativeDiscount;
  if (!owner || (current?.enabled && current.nativeDiscount?.id === owner.id)) return settings;
  const warning = await retireDiscount(owner, previous!.id);
  if (warning) settings.warnings = [warning];
  return settings;
}

// 逐个保存活动：校验最新配置、准备折扣、发布成功后处理旧折扣。
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
      clearPreparations(settings.shop.id, id);
      return await retirePreviousDiscount(latest, baseCampaign, current);
    }
    if (!same(current, baseCampaign)) throw new Error('这个活动已被其他人修改。请重新加载后再编辑；其他活动的修改已保留。');
    let draft = draftCampaign ? parseConfig({ version: 1, campaigns: [{ ...draftCampaign, nativeDiscount: current?.nativeDiscount }] }).campaigns[0] : null;
    await ensureDefinitions(latest);
    draft = await prepareCampaignDiscount(settings.shop.id, current, draft);
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
    clearPreparations(settings.shop.id, id);
    return await retirePreviousDiscount(saved, current, draft);
  } finally {
    // 等旧折扣处理结束后再释放锁，避免同店保存交错。
    savingShops.delete(settings.shop.id);
  }
}
