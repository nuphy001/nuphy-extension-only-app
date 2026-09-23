import type { StandardRenderingExtensionApi } from '@shopify/ui-extensions/admin';
import type { StoredCampaign } from './campaign';

type Metafield = { compareDigest: string; value?: string; jsonValue?: unknown };
type Definition = { id: string; key: string; type: { name: string }; access: { storefront: string } };

export type Settings = {
  shop: { id: string; myshopifyDomain: string; ianaTimezone: string; mode: Metafield | null; config: Metafield | null };
  metafieldDefinitions: { nodes: Definition[] };
  warnings?: string[];
};

export type ProductImage = { url: string; altText: string | null };
export type Variant = {
  id: string;
  title: string;
  sku?: string | null;
  inventoryQuantity?: number | null;
  product: { id: string; title: string };
  image?: ProductImage | null;
};
export type Product = { id: string; title: string; featuredImage: ProductImage | null; variantsCount: number; variants: Variant[] };
export type ProductRole = 'trigger' | 'gift';
export type PickerProductSelection = { productId: string; variantIds?: string[]; excludedVariantIds?: string[] };
export type PickerOptions = { singleVariantOnly?: boolean; inStockOnly?: boolean };
export type PickerResult = { ids: string[]; products: Record<string, Product>; selection: Record<string, string[]> };
export type ResourcePickerApi = Pick<StandardRenderingExtensionApi<'admin.app.home.render'>, 'resourcePicker'>;
export type NativeSelection = NonNullable<Awaited<ReturnType<ResourcePickerApi['resourcePicker']>>>;
export type ProductSelectionId = { id: string; variants: { id: string }[] };

export type UserError = { message: string; code?: string };
export type PageInfo = { hasNextPage: boolean; endCursor: string | null };
export type VariantNode = Omit<Variant, 'image'> & { media: { nodes: { image?: ProductImage }[] } };
export type NativeDiscount = NonNullable<StoredCampaign['nativeDiscount']>;
export type DiscountNode = {
  id: string;
  campaignBinding: { jsonValue: { campaignId?: string; bindingToken?: string } } | null;
  discount: {
    startsAt?: string;
    endsAt?: string | null;
    status?: string;
    combinesWith?: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
  };
};
export type DiscountPreparation = {
  shopId: string;
  campaignId: string;
  token: string;
  attempted: boolean;
  owner?: NativeDiscount;
  startsAt: string;
};
