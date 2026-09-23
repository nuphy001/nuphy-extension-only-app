import { describe, expect, it } from 'vitest';
import { campaignStatus, localDateTime, readSchedule, scheduleFields, toInstant } from '../utils/schedule';
import type { ScheduleFields } from '../types/campaign';

describe('活动时间使用店铺时区', () => {
  it('在 UTC 与店铺时间间往返，不采用电脑时区', () => {
    expect(toInstant('2026-09-15', '10:30', 'Asia/Shanghai')).toBe('2026-09-15T02:30:00.000Z');
    expect(localDateTime('2026-09-15T02:30:00.000Z', 'Asia/Shanghai')).toEqual({ date: '2026-09-15', time: '10:30' });
    expect(toInstant('2026-01-01', '00:15', 'America/Los_Angeles')).toBe('2026-01-01T08:15:00.000Z');
  });
  it('拒绝无效日期以及夏令时不存在和重复的时刻', () => {
    expect(() => toInstant('2026-02-30', '10:00', 'Asia/Shanghai')).toThrow('无效');
    expect(() => toInstant('2026-03-08', '02:30', 'America/New_York')).toThrow('不存在');
    expect(() => toInstant('2026-11-01', '01:30', 'America/New_York')).toThrow('重复');
  });
  it('结束时刻不再进行，停用优先于排期', () => {
    const campaign = { id: 'a', enabled: true, triggerVariantIds: ['1'], gifts: [{ variantId: '2' }],
      startsAt: '2026-09-15T02:00:00.000Z', endsAt: '2026-09-15T03:00:00.000Z' };
    expect(campaignStatus(campaign, Date.parse(campaign.startsAt) - 1).label).toBe('未开始');
    expect(campaignStatus(campaign, Date.parse(campaign.startsAt)).label).toBe('进行中');
    expect(campaignStatus(campaign, Date.parse(campaign.endsAt)).label).toBe('已结束');
    expect(campaignStatus({ ...campaign, enabled: false }, Date.parse(campaign.startsAt)).label).toBe('已停用');
  });
  it('拒绝结束不晚于开始，支持无结束时间', () => {
    const fields = { start: 'scheduled', startDate: '2026-09-15', startTime: '10:00',
      hasEnd: true, endDate: '2026-09-15', endTime: '09:00' } satisfies ScheduleFields;
    expect(() => readSchedule(fields, 'Asia/Shanghai')).toThrow('晚于');
    expect(readSchedule({ ...fields, hasEnd: false }, 'Asia/Shanghai').endsAt).toBeUndefined();
  });
  it('无关编辑保留原始 UTC 精度，允许编辑历史立即开始活动但拒绝无效的新排期', () => {
    const original = { id: 'a', enabled: true, triggerVariantIds: ['1'], gifts: [{ variantId: '2' }],
      startsAt: '2026-09-15T02:00:37.123Z', endsAt: '2026-09-15T03:00:49.456Z' };
    const now = Date.parse('2026-09-16T00:00:00.000Z');
    const fields = scheduleFields(original, 'Asia/Shanghai');
    expect(readSchedule(fields, 'Asia/Shanghai', now, original)).toEqual({ startsAt: original.startsAt, endsAt: original.endsAt });
    expect(readSchedule({ ...fields, endTime: '12:00' }, 'Asia/Shanghai', now, original))
      .toEqual({ startsAt: original.startsAt, endsAt: '2026-09-15T04:00:00.000Z' });

    const immediate = { ...original, startsAt: undefined };
    const immediateFields = scheduleFields(immediate, 'Asia/Shanghai');
    expect(readSchedule(immediateFields, 'Asia/Shanghai', now, immediate))
      .toEqual({ startsAt: undefined, endsAt: original.endsAt });
    expect(() => readSchedule({ ...immediateFields, endTime: '12:00' }, 'Asia/Shanghai', now, immediate)).toThrow('晚于');
    expect(() => readSchedule({ ...fields, start: 'now' }, 'Asia/Shanghai', now, original)).toThrow('晚于');
  });
});
