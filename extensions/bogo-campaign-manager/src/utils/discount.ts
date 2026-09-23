import type { DiscountNode, DiscountPreparation } from '../types/api';
import type { StoredCampaign } from '../types/campaign';

// 固定对象键顺序并忽略未赋值字段，让配置比较不受序列化差异影响。
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function same(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
// 核对活动 ID 和绑定 token，并要求折扣具备开始时间。
export function isBound(node: DiscountNode | null, campaignId: string, token: string) {
  return node?.campaignBinding?.jsonValue?.campaignId === campaignId && node.campaignBinding.jsonValue.bindingToken === token && !!node.discount.startsAt;
}
// 重试前确认已准备的折扣仍匹配当前绑定与排期。
export function matchesPreparation(node: DiscountNode | null, campaign: StoredCampaign, preparation: DiscountPreparation) {
  if (!node || !node.discount.startsAt || !isBound(node, campaign.id, preparation.token)) return false;
  return Date.parse(node.discount.startsAt) === Date.parse(preparation.startsAt)
    && (node.discount.endsAt ? Date.parse(node.discount.endsAt) : null) === (campaign.endsAt ? Date.parse(campaign.endsAt) : null)
    && (node.discount.status !== 'EXPIRED' || Boolean(node.discount.endsAt && Date.parse(node.discount.endsAt) <= Date.now()));
}

// 名称与排期未变时复用原折扣；自然结束的活动也可保留原绑定。
export function canReuseDiscount(current: StoredCampaign | undefined, draft: StoredCampaign, previous: DiscountNode | null) {
  if (!current?.enabled || !current.nativeDiscount || !previous) return false;
  const endedOnSchedule = previous.discount.endsAt && Date.parse(previous.discount.endsAt) <= Date.now();
  return (previous.discount.status !== 'EXPIRED' || Boolean(endedOnSchedule))
    && same(current.name, draft.name)
    && same(current.startsAt, draft.startsAt) && same(current.endsAt, draft.endsAt)
    && (!draft.startsAt || Date.parse(previous.discount.startsAt!) === Date.parse(draft.startsAt))
    && (previous.discount.endsAt ? Date.parse(previous.discount.endsAt) : null) === (draft.endsAt ? Date.parse(draft.endsAt) : null);
}
