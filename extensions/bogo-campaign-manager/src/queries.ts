export const loadConfigQuery = `query BogoSettings {
  shop {
    id myshopifyDomain
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
    ... on ProductVariant { id title product { title } media(first: 1) { nodes { __typename ... on MediaImage { image { url altText } } } } }
  }
}`;
export const searchVariantsQuery = `query BogoSearchVariants($search: String!, $after: String) {
  productVariants(first: 50, query: $search, after: $after) {
    nodes { id title product { title } media(first: 1) { nodes { __typename ... on MediaImage { image { url altText } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
