import { describe, it, expect } from 'vitest';
import { cartLinesDiscountsGenerateRun } from './cart_lines_discounts_generate_run';

/**
 * 测试构造约定：
 *   - line.id 用 "L1" / "L2" 等占位（真实运行时是 gid://shopify/CartLine/...，但函数不关心格式）
 *   - attribute 为 null 表示「该行没有 _promo_role 这个 key」（GraphQL 当 key 不存在时返回 null）
 *   - attribute.value 是字符串，匹配前端 BOGO 引擎写入的常量（"gift" / "trigger" / "main" 等）
 */

/** 构造一个购物车行。attributeValue 传 null 表示无属性，否则即为 _promo_role 的值。 */
function makeLine(id, attributeValue) {
  return {
    id,
    attribute: attributeValue === null ? null : { value: attributeValue },
  };
}

/** 构造完整 input 对象。 */
function makeInput(lines) {
  return { cart: { lines } };
}

describe('cartLinesDiscountsGenerateRun', () => {
  describe('无赠品行场景（应返回空 operations）', () => {
    it('用例 1：购物车为空 → 不产生任何折扣', () => {
      const result = cartLinesDiscountsGenerateRun(makeInput([]));
      expect(result).toEqual({ operations: [] });
    });

    it('用例 2：行未挂 _promo_role 属性（attribute = null） → 不产生任何折扣', () => {
      const result = cartLinesDiscountsGenerateRun(
        makeInput([makeLine('L1', null)])
      );
      expect(result).toEqual({ operations: [] });
    });

    it('用例 3：行属性是其它值（不是 "gift"） → 不产生任何折扣', () => {
      const result = cartLinesDiscountsGenerateRun(
        makeInput([makeLine('L1', 'main')])
      );
      expect(result).toEqual({ operations: [] });
    });
  });

  describe('有赠品行场景（应产生 100% off 折扣）', () => {
    it('用例 4：单行 gift → 1 个 discount operation，targets 指向该行，percentage = 100', () => {
      const result = cartLinesDiscountsGenerateRun(
        makeInput([makeLine('L1', 'gift')])
      );

      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.discount).toBeDefined();
      expect(op.discount.message).toBe('Free Gift');
      expect(op.discount.targets).toEqual([
        { cartLineTarget: { id: 'L1', quantity: null } },
      ]);
      expect(op.discount.value).toEqual({ percentage: { value: 100 } });
    });

    it('用例 5：主品（无属性） + 1 件赠品 → 只对赠品行打折', () => {
      const result = cartLinesDiscountsGenerateRun(
        makeInput([
          makeLine('L1', null),    // 主品行
          makeLine('L2', 'gift'),  // 赠品行
        ])
      );

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].discount.targets).toEqual([
        { cartLineTarget: { id: 'L2', quantity: null } },
      ]);
    });

    it('用例 6：多件赠品 → 产出多个 discount operation，每个 operation 对应一个赠品行', () => {
      const result = cartLinesDiscountsGenerateRun(
        makeInput([
          makeLine('L1', 'gift'),
          makeLine('L2', 'gift'),
        ])
      );

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].discount.targets).toEqual([
        { cartLineTarget: { id: 'L1', quantity: null } },
      ]);
      expect(result.operations[1].discount.targets).toEqual([
        { cartLineTarget: { id: 'L2', quantity: null } },
      ]);
    });

    it('用例 7：gift 与其它未知属性混入 → 只 gift 产出 discount operation', () => {
      const result = cartLinesDiscountsGenerateRun(
        makeInput([
          makeLine('L1', 'gift'),
          makeLine('L2', 'trigger'),
          makeLine('L3', 'gift'),
          makeLine('L4', null),
        ])
      );

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].discount.targets).toEqual([
        { cartLineTarget: { id: 'L1', quantity: null } },
      ]);
      expect(result.operations[1].discount.targets).toEqual([
        { cartLineTarget: { id: 'L3', quantity: null } },
      ]);
    });
  });
});
