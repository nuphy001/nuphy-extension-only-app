import { describe, expect, it } from 'vitest';
import { cartLinesDiscountsGenerateRun } from './cart_lines_discounts_generate_run';

const run = (enteredDiscountCodes, isoCode = 'EN') => cartLinesDiscountsGenerateRun({
  enteredDiscountCodes,
  localization: { language: { isoCode } },
});
const rejected = result => result.operations[0].enteredDiscountCodesReject;

describe('cartLinesDiscountsGenerateRun', () => {
  it('没有输入折扣码时不输出操作', () => {
    expect(run([])).toEqual({ operations: [] });
  });

  it('拒绝所有可拒绝的折扣码', () => {
    const result = run([{ code: 'A', rejectable: true }, { code: 'B', rejectable: true }]);
    expect(rejected(result).codes).toEqual([{ code: 'A' }, { code: 'B' }]);
  });

  it('跳过不可拒绝的折扣码，避免结果无效', () => {
    const result = run([{ code: 'A', rejectable: false }, { code: 'B', rejectable: true }]);
    expect(rejected(result).codes).toEqual([{ code: 'B' }]);
  });

  it('全部不可拒绝时不输出操作', () => {
    expect(run([{ code: 'A', rejectable: false }])).toEqual({ operations: [] });
  });

  it('按结账语言显示提示', () => {
    const codes = [{ code: 'A', rejectable: true }];
    expect(rejected(run(codes, 'JA')).message).toContain('クーポンコード');
    expect(rejected(run(codes, 'EN')).message).toContain('Discount codes');
    expect(rejected(run(codes, 'FR')).message).toContain('Discount codes');
  });
});
