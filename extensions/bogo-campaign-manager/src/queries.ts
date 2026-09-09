export const loadConfigQuery = `query BogoSettings {
  shop {
    id myshopifyDomain ianaTimezone
    mode: metafield(namespace: "nuphy_bogo", key: "mode") { value compareDigest }
    config: metafield(namespace: "nuphy_bogo", key: "campaigns") { jsonValue compareDigest }
  }
  metafieldDefinitions(first: 10, ownerType: SHOP, namespace: "nuphy_bogo") {
    nodes { id key type { name } access { storefront } }
  }
}`;
export const defineConfigMutation = `mutation BogoDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id }
    userErrors { field message }
  }
}`;
export const saveConfigMutation = `mutation BogoSave($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key compareDigest }
    userErrors { field message code }
  }
}`;
export const variantsQuery = `query BogoVariants($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on ProductVariant { id title sku product { id title } media(first: 1) { nodes { ... on MediaImage { image { url altText } } } } }
  }
}`;
export const productQuery = `query BogoProduct($id: ID!, $after: String) {
  product(id: $id) {
    id title featuredMedia { ... on MediaImage { image { url altText } } } variantsCount { count }
    variants(first: 100, after: $after) {
      nodes { id title sku media(first: 1) { nodes { ... on MediaImage { image { url altText } } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
export const discountQuery = `query BogoDiscount($id: ID!) {
  discountNode(id: $id) {
    id
    campaignBinding: metafield(namespace: "nuphy_bogo", key: "campaign") { jsonValue }
    discount {
      ... on DiscountAutomaticApp {
        startsAt endsAt status
        combinesWith { productDiscounts orderDiscounts shippingDiscounts }
      }
    }
  }
}`;
export const findDiscountsQuery = `query BogoDiscounts($after: String) {
  discountNodes(first: 100, after: $after, query: "method:automatic") {
    nodes {
      id
      campaignBinding: metafield(namespace: "nuphy_bogo", key: "campaign") { jsonValue }
      discount { ... on DiscountAutomaticApp { startsAt endsAt status } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const createDiscountMutation = `mutation BogoCreateDiscount($discount: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticAppDiscount: $discount) {
    automaticAppDiscount { discountId }
    userErrors { field message code }
  }
}`;
export const deactivateDiscountMutation = `mutation BogoDeactivateDiscount($id: ID!) {
  discountAutomaticDeactivate(id: $id) {
    automaticDiscountNode { id }
    userErrors { field message code }
  }
}`;
export const discountDefinitionQuery = `query BogoDiscountDefinition {
  metafieldDefinitions(first: 10, ownerType: DISCOUNT, namespace: "nuphy_bogo", key: "campaign") {
    nodes { id key type { name } }
  }
}`;
