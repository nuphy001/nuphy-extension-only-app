import { parseConfig, type StoredConfig } from '../../nuphy-free-gift-discount/src/configuration';
import {
  loadConfigQuery,
  defineConfigMutation,
  saveConfigMutation,
  variantsQuery,
  searchVariantsQuery,
  productByHandleQuery,
  freeGiftDiscountStatusQuery,
  createFreeGiftDiscountMutation,
  codeBlockDiscountStatusQuery,
} from './queries';
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
export type FreeGiftDiscountStatus = {
  exists: boolean;
  active: boolean;
  discountId?: string;
  status?: string;
};

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

type FunctionNode = { id: string; title: string; apiType: string };
type AutomaticAppDiscount = {
  __typename: 'DiscountAutomaticApp';
  title: string;
  status: string;
  appDiscountType: { functionId: string; title: string };
  combinesWith: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
};
type DiscountNode = { id: string; discount: AutomaticAppDiscount | { __typename: string } };

export async function loadFreeGiftDiscount(): Promise<FreeGiftDiscountStatus> {
  const result = await query<{
    shopifyFunctions: { nodes: FunctionNode[] };
    discountNodes: { nodes: DiscountNode[] };
  }>(freeGiftDiscountStatusQuery);
  const fn = result.shopifyFunctions.nodes.find(node => node.apiType === 'discount' && node.title === 'nuphy-free-gift-discount');
  if (!fn) throw new Error('App 中没有找到 nuphy-free-gift-discount，请先发布 Function');
  const node = result.discountNodes.nodes.find(item => item.discount.__typename === 'DiscountAutomaticApp'
    && (item.discount as AutomaticAppDiscount).appDiscountType.functionId === fn.id);
  if (!node) return { exists: false, active: false };
  const discount = node.discount as AutomaticAppDiscount;
  return { exists: true, active: discount.status === 'ACTIVE', discountId: node.id, status: discount.status };
}

export async function createFreeGiftDiscount(): Promise<FreeGiftDiscountStatus> {
  const current = await loadFreeGiftDiscount();
  if (current.exists) return current;
  const result = await query<{
    discountAutomaticAppCreate: {
      automaticAppDiscount: { discountId: string; title: string; status: string } | null;
      userErrors: UserError[];
    };
  }>(createFreeGiftDiscountMutation, {
    discount: {
      title: 'Free Gift',
      functionHandle: 'nuphy-free-gift-discount',
      discountClasses: ['PRODUCT'],
      startsAt: new Date().toISOString(),
      combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
    },
  });
  checkErrors(result.discountAutomaticAppCreate.userErrors);
  const created = result.discountAutomaticAppCreate.automaticAppDiscount;
  if (!created) throw new Error('Shopify 没有返回新折扣，请刷新后确认');
  return { exists: true, active: created.status === 'ACTIVE', discountId: created.discountId, status: created.status };
}

// 黑五拒券的活动时间只在这里配置：北京时间 2026-11-09 16:00 至 2026-12-02 15:59。
const CODE_BLOCK_TITLE = 'Black Friday Code Block';
const CODE_BLOCK_STARTS_AT = '2026-11-09T08:00:00Z';
const CODE_BLOCK_ENDS_AT = '2026-12-02T07:59:00Z';
const CODE_BLOCK_REHEARSAL_TITLE = 'Code Block Rehearsal';
const CODE_BLOCK_REHEARSAL_MINUTES = 30;

type CodeBlockNode = {
  id: string;
  discount: { __typename: string; title?: string; status?: string; startsAt?: string; endsAt?: string | null; appDiscountType?: { functionId: string } };
};
export type CodeBlockDiscount = { id: string; title: string; status: string; startsAt: string; endsAt: string | null };
export type CodeBlockDiscountStatus = {
  sale: CodeBlockDiscount | null;
  rehearsal: CodeBlockDiscount | null;
};

export async function loadCodeBlockDiscount(): Promise<CodeBlockDiscountStatus> {
  const result = await query<{
    shopifyFunctions: { nodes: FunctionNode[] };
    discountNodes: { nodes: CodeBlockNode[] };
  }>(codeBlockDiscountStatusQuery);
  const fn = result.shopifyFunctions.nodes.find(node => node.apiType === 'discount' && node.title === 'nuphy-code-block-discount');
  if (!fn) throw new Error('App 中没有找到 nuphy-code-block-discount，请先发布 Function');
  const discounts = result.discountNodes.nodes
    .filter(node => node.discount.__typename === 'DiscountAutomaticApp' && node.discount.appDiscountType?.functionId === fn.id)
    .map(({ id, discount }): CodeBlockDiscount => ({
      id,
      title: discount.title ?? '',
      status: discount.status ?? '',
      startsAt: discount.startsAt ?? '',
      endsAt: discount.endsAt ?? null,
    }));
  return {
    sale: discounts.find(discount => discount.title === CODE_BLOCK_TITLE) ?? null,
    rehearsal: discounts.find(discount => discount.title.startsWith(CODE_BLOCK_REHEARSAL_TITLE) && discount.status === 'ACTIVE') ?? null,
  };
}

// 折扣搜索有索引延迟，刚创建时查不到，所以直接用创建结果，避免页面误判后重复创建。
async function createCodeBlockDiscount(input: { title: string; startsAt: string; endsAt: string; context?: unknown }): Promise<CodeBlockDiscount> {
  const result = await query<{
    discountAutomaticAppCreate: {
      automaticAppDiscount: { discountId: string; title: string; status: string } | null;
      userErrors: UserError[];
    };
  }>(createFreeGiftDiscountMutation, {
    discount: {
      functionHandle: 'nuphy-code-block-discount',
      discountClasses: ['PRODUCT'],
      combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
      ...input,
    },
  });
  checkErrors(result.discountAutomaticAppCreate.userErrors);
  const created = result.discountAutomaticAppCreate.automaticAppDiscount;
  if (!created) throw new Error('Shopify 没有返回新折扣，请刷新后确认');
  return { id: created.discountId, title: created.title, status: created.status, startsAt: input.startsAt, endsAt: input.endsAt };
}

export async function createCodeBlockSaleDiscount(): Promise<CodeBlockDiscountStatus> {
  const current = await loadCodeBlockDiscount();
  if (current.sale) return current;
  const sale = await createCodeBlockDiscount({ title: CODE_BLOCK_TITLE, startsAt: CODE_BLOCK_STARTS_AT, endsAt: CODE_BLOCK_ENDS_AT });
  return { ...current, sale };
}

/**
 * 演练折扣立即生效并自动过期；填了客户就只影响该客户。
 * 开始时间往前推一天，避免操作电脑的时钟偏快时折扣变成“已安排”而没有生效。
 */
export async function createCodeBlockRehearsal(customerId: string): Promise<CodeBlockDiscountStatus> {
  const current = await loadCodeBlockDiscount();
  if (current.rehearsal) return current;
  const now = Date.now();
  const rehearsal = await createCodeBlockDiscount({
    // 自动折扣标题必须唯一，带上时间才能重复演练。
    title: `${CODE_BLOCK_REHEARSAL_TITLE} ${new Date(now).toISOString().slice(0, 16)}`,
    startsAt: new Date(now - 24 * 60 * 60_000).toISOString(),
    endsAt: new Date(now + CODE_BLOCK_REHEARSAL_MINUTES * 60_000).toISOString(),
    ...(customerId ? { context: { customers: { add: [customerId] } } } : {}),
  });
  return { ...current, rehearsal };
}
