import type { DiscountNode, PageInfo, ProductImage, UserError, VariantNode } from './api';

export type Variants = { nodes: (VariantNode | null)[] };
export type ProductPage = {
  product: {
    id: string;
    title: string;
    featuredMedia: { image?: ProductImage } | null;
    variantsCount: { count: number };
    variants: { nodes: Omit<VariantNode, 'product'>[]; pageInfo: PageInfo };
  } | null;
};
export type ProductSearch = { products: { nodes: { id: string }[] } };
export type DefinitionCreate = { metafieldDefinitionCreate: { userErrors: UserError[] } };
export type SettingsSave = {
  metafieldsSet: { userErrors: UserError[]; metafields: { key: string; compareDigest: string }[] };
};
export type Discount = { discountNode: DiscountNode | null };
export type Discounts = { discountNodes: { nodes: DiscountNode[]; pageInfo: PageInfo } };
export type DiscountDefinition = { metafieldDefinitions: { nodes: { type: { name: string } }[] } };
export type DiscountCreate = {
  discountAutomaticAppCreate: { automaticAppDiscount: { discountId: string } | null; userErrors: UserError[] };
};
export type DiscountDeactivate = { discountAutomaticDeactivate: { userErrors: UserError[] } };
