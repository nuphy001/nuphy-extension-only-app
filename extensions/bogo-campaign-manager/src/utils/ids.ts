// 校验 Shopify ID 的资源类型，再取出数字部分。
export function resourceId(id: string, resource: 'Product' | 'ProductVariant') {
  const match = new RegExp(`^gid://shopify/${resource}/([1-9]\\d*)$`).exec(id);
  if (!match) throw new Error('未能读取所选商品，请重新选择。');
  return match[1];
}

// 先拒绝非法数字 ID，再按原顺序去重。
export function uniqueIds(ids: string[]) {
  if (ids.some(id => !/^[1-9]\d*$/.test(id))) throw new Error('商品 ID 格式不正确，请重新选择。');
  return [...new Set(ids)];
}
