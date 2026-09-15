import type { ScheduleFields, StoredCampaign } from '../types/campaign';

// 按店铺时区拆出时间各部分，避免使用电脑本地时区。
function localParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

// 转成日期与分钟字段，供排期表单回显。
export function localDateTime(value: string | Date, timeZone: string) {
  const p = localParts(new Date(value), timeZone);
  return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
}

// 校验输入，先把本地日期时间按 UTC 数值表示，供后续时区换算。
function parseLocalTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('请填写完整日期和时间，时间格式为 HH:mm');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (hour > 23 || minute > 59 || new Date(wall).toISOString().slice(0, 16) !== date + 'T' + time) {
    throw new Error('日期或时间无效');
  }
  return wall;
}

// 把店铺本地时间转换为唯一对应的 UTC 时刻。
export function toInstant(date: string, time: string, timeZone: string): string {
  const wall = parseLocalTime(date, time);
  // 比较切换前后的时区偏移，拒绝夏令时产生的不存在或重复时间。
  const candidates = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = wall + delta * 3_600_000;
    const p = localParts(new Date(sample), timeZone);
    const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - sample;
    const instant = wall - offset;
    const local = localDateTime(new Date(instant), timeZone);
    if (local.date === date && local.time === time) candidates.add(instant);
  }
  if (!candidates.size) throw new Error('这个时间因夏令时切换而不存在，请选择其他时间');
  if (candidates.size > 1) throw new Error('这个时间处于夏令时重复时段，请选择其他时间');
  return new Date([...candidates][0]).toISOString();
}

// 从活动排期生成表单值，并为未设置的时间提供编辑默认值。
export function scheduleFields(campaign: StoredCampaign, timeZone: string, now = new Date()): ScheduleFields {
  const start = localDateTime(campaign.startsAt ?? now, timeZone);
  const end = localDateTime(campaign.endsAt ?? new Date(now.getTime() + 86_400_000), timeZone);
  return {
    start: campaign.startsAt ? 'scheduled' : 'now',
    startDate: start.date, startTime: start.time,
    hasEnd: Boolean(campaign.endsAt), endDate: end.date, endTime: end.time,
  };
}

// 将排期表单转换为可保存的开始、结束时间。
export function readSchedule(fields: ScheduleFields, timeZone: string, now = Date.now(), original?: StoredCampaign) {
  const previous = original && scheduleFields(original, timeZone, new Date(now));
  const sameStart = previous && fields.start === previous.start
    && (fields.start === 'now' || (fields.startDate === previous.startDate && fields.startTime === previous.startTime));
  const sameEnd = previous && fields.hasEnd === previous.hasEnd
    && (!fields.hasEnd || (fields.endDate === previous.endDate && fields.endTime === previous.endTime));
  // 输入只显示到分钟，未改动的时间必须保留原来的秒和毫秒。
  const startsAt = sameStart ? original?.startsAt
    : fields.start === 'scheduled' ? toInstant(fields.startDate, fields.startTime, timeZone) : undefined;
  const endsAt = sameEnd ? original?.endsAt
    : fields.hasEnd ? toInstant(fields.endDate, fields.endTime, timeZone) : undefined;
  // 历史“立即开始”活动没有保存开始时刻，改名或停用时不能拿现在当原开始时间。
  const unchangedImmediate = !startsAt && sameStart && sameEnd;
  const startTime = startsAt ? Date.parse(startsAt) : now;
  if (endsAt && !unchangedImmediate && Date.parse(endsAt) <= startTime) {
    throw new Error('结束时间必须晚于开始时间');
  }
  return { startsAt, endsAt };
}

// 按启用开关和排期确定活动状态，停用优先。
export function campaignStatus(campaign: StoredCampaign, now = Date.now()) {
  if (!campaign.enabled) return { label: '已停用', tone: 'neutral' as const };
  if (campaign.startsAt && Date.parse(campaign.startsAt) > now) return { label: '未开始', tone: 'info' as const };
  if (campaign.endsAt && Date.parse(campaign.endsAt) <= now) return { label: '已结束', tone: 'neutral' as const };
  return { label: '进行中', tone: 'success' as const };
}

// 按店铺时区显示时间，空值使用调用方提供的提示。
export function formatTime(value: string | undefined, timeZone: string, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}
