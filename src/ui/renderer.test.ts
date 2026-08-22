import { describe, it, expect } from 'vitest';
import type { LogicalTile, TileColor } from '../game/types';
import { inferJokerDisplayValue, wrapTextLines } from './renderer';

function makeTile(id: number, color: TileColor, number: number): LogicalTile {
  return {
    originalTile: { id, color, number },
    logicalColor: color,
    logicalNumber: number,
  };
}

function makeJoker(id: number): LogicalTile {
  return {
    originalTile: { id, color: 'joker', number: 0 },
    logicalColor: 'joker',
    logicalNumber: 0,
  };
}

describe('inferJokerDisplayValue', () => {
  it('12-13-joker：Joker 显示 11（最大只有 13，不能显示 14）', () => {
    const tiles = [
      makeTile(0, 'red', 13),
      makeTile(1, 'red', 12),
      makeJoker(104),
    ];
    expect(inferJokerDisplayValue('run', tiles, 2)).toEqual({ color: 'red', number: 11 });
  });

  it('11-12-13-joker：Joker 显示 10（向下延伸）', () => {
    const tiles = [
      makeTile(0, 'red', 11),
      makeTile(1, 'red', 12),
      makeTile(2, 'red', 13),
      makeJoker(104),
    ];
    expect(inferJokerDisplayValue('run', tiles, 3)).toEqual({ color: 'red', number: 10 });
  });

  it('joker-1-2：Joker 显示 3（最小只有 1，不能显示 0）', () => {
    const tiles = [
      makeJoker(104),
      makeTile(0, 'red', 1),
      makeTile(1, 'red', 2),
    ];
    expect(inferJokerDisplayValue('run', tiles, 0)).toEqual({ color: 'red', number: 3 });
  });

  it('常规右端延伸不受影响：5-6-joker 显示 7', () => {
    const tiles = [
      makeTile(0, 'blue', 5),
      makeTile(1, 'blue', 6),
      makeJoker(104),
    ];
    expect(inferJokerDisplayValue('run', tiles, 2)).toEqual({ color: 'blue', number: 7 });
  });

  it('常规左端延伸不受影响：joker-5-6 显示 4', () => {
    const tiles = [
      makeJoker(104),
      makeTile(0, 'blue', 5),
      makeTile(1, 'blue', 6),
    ];
    expect(inferJokerDisplayValue('run', tiles, 0)).toEqual({ color: 'blue', number: 4 });
  });

  it('端位方向由位置决定：joker,3,4 → 2；3,4,joker → 5', () => {
    const head = [
      makeJoker(104),
      makeTile(0, 'red', 3),
      makeTile(1, 'red', 4),
    ];
    expect(inferJokerDisplayValue('run', head, 0)).toEqual({ color: 'red', number: 2 });
    const tail = [
      makeTile(0, 'red', 3),
      makeTile(1, 'red', 4),
      makeJoker(104),
    ];
    expect(inferJokerDisplayValue('run', tail, 2)).toEqual({ color: 'red', number: 5 });
  });

  it('双百搭两端包夹：joker,3,4,joker 显示 2、5', () => {
    const tiles = [
      makeJoker(104),
      makeTile(0, 'red', 3),
      makeTile(1, 'red', 4),
      makeJoker(105),
    ];
    expect(inferJokerDisplayValue('run', tiles, 0)).toEqual({ color: 'red', number: 2 });
    expect(inferJokerDisplayValue('run', tiles, 3)).toEqual({ color: 'red', number: 5 });
  });

  it('双百搭同侧头部：joker,joker,3,4 显示 1、2（向真实牌递增）', () => {
    const tiles = [
      makeJoker(104),
      makeJoker(105),
      makeTile(0, 'red', 3),
      makeTile(1, 'red', 4),
    ];
    expect(inferJokerDisplayValue('run', tiles, 0)).toEqual({ color: 'red', number: 1 });
    expect(inferJokerDisplayValue('run', tiles, 1)).toEqual({ color: 'red', number: 2 });
  });

  it('中间填充不受影响：5-joker-7 显示 6', () => {
    const tiles = [
      makeTile(0, 'blue', 5),
      makeJoker(104),
      makeTile(1, 'blue', 7),
    ];
    expect(inferJokerDisplayValue('run', tiles, 1)).toEqual({ color: 'blue', number: 6 });
  });

  it('唯一区间与存储顺序无关：同色 7,8,6,joker,3,5 任意拖拽顺序均显示 4', () => {
    const orders: Array<Array<() => LogicalTile>> = [
      [
        () => makeTile(1, 'red', 7), () => makeTile(2, 'red', 8), () => makeTile(3, 'red', 6),
        () => makeJoker(104), () => makeTile(4, 'red', 3), () => makeTile(5, 'red', 5),
      ],
      [
        () => makeJoker(104), () => makeTile(1, 'red', 7), () => makeTile(2, 'red', 8),
        () => makeTile(3, 'red', 6), () => makeTile(4, 'red', 3), () => makeTile(5, 'red', 5),
      ],
      [
        () => makeTile(1, 'red', 7), () => makeTile(2, 'red', 8), () => makeTile(3, 'red', 6),
        () => makeTile(4, 'red', 3), () => makeTile(5, 'red', 5), () => makeJoker(104),
      ],
      [
        () => makeTile(4, 'red', 3), () => makeJoker(104), () => makeTile(5, 'red', 5),
        () => makeTile(3, 'red', 6), () => makeTile(1, 'red', 7), () => makeTile(2, 'red', 8),
      ],
    ];
    for (const order of orders) {
      const tiles = order.map((f) => f());
      const jokerIndex = tiles.findIndex((t) => t.originalTile.color === 'joker');
      expect(inferJokerDisplayValue('run', tiles, jokerIndex)).toEqual({ color: 'red', number: 4 });
    }
  });

  it('多百搭唯一区间：同色 3,5,6,joker,joker,8 固定显示 4、7', () => {
    const tiles = [
      makeTile(1, 'red', 3),
      makeJoker(104),
      makeTile(2, 'red', 5),
      makeTile(3, 'red', 6),
      makeJoker(105),
      makeTile(4, 'red', 8),
    ];
    expect(inferJokerDisplayValue('run', tiles, 1)).toEqual({ color: 'red', number: 4 });
    expect(inferJokerDisplayValue('run', tiles, 4)).toEqual({ color: 'red', number: 7 });
  });

  it('中间填充防撞：9-joker-10 显示 11（不能与两侧的 9/10 重复）', () => {
    const tiles = [
      makeTile(0, 'red', 9),
      makeJoker(104),
      makeTile(1, 'red', 10),
    ];
    expect(inferJokerDisplayValue('run', tiles, 1)).toEqual({ color: 'red', number: 11 });
  });

  it('中间填充防撞：1-joker-2 显示 3（左右推算都重复，向上找不重复值）', () => {
    const tiles = [
      makeTile(0, 'red', 1),
      makeJoker(104),
      makeTile(1, 'red', 2),
    ];
    expect(inferJokerDisplayValue('run', tiles, 1)).toEqual({ color: 'red', number: 3 });
  });

  it('中间填充防撞连续分配：5-joker-joker-7 显示 6、8（互不重复）', () => {
    // 第一个左推 6 可用；第二个左推 7 与右邻重复、右推 6 与前者重复 → 向上取 8。
    const tiles = [
      makeTile(0, 'red', 5),
      makeJoker(104),
      makeJoker(105),
      makeTile(1, 'red', 7),
    ];
    expect(inferJokerDisplayValue('run', tiles, 1)).toEqual({ color: 'red', number: 6 });
    expect(inferJokerDisplayValue('run', tiles, 2)).toEqual({ color: 'red', number: 8 });
  });

  it('刻子中的 Joker 取缺失颜色与同数字', () => {
    const tiles = [
      makeTile(0, 'red', 8),
      makeTile(1, 'blue', 8),
      makeJoker(104),
    ];
    const d = inferJokerDisplayValue('group', tiles, 2);
    expect(d?.number).toBe(8);
    expect(['yellow', 'black']).toContain(d?.color);
  });
});

describe('wrapTextLines', () => {
  // 等宽 mock：每字符 10px，量宽结果确定可断言。
  const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D;

  it('短文案不换行', () => {
    expect(wrapTextLines(ctx, '出牌成功', 100)).toEqual(['出牌成功']);
  });

  it('长中文逐字断行', () => {
    expect(wrapTextLines(ctx, '首出牌必须凑够三十分', 50)).toEqual([
      '首出牌必须',
      '凑够三十分',
    ]);
  });

  it('ASCII 数字字母成整体单元不被拦腰截断', () => {
    // 宽度 25：「30」若被拆开会出「3」单行，实际保持整体。
    expect(wrapTextLines(ctx, '分数30不够', 25)).toEqual(['分数', '30', '不够']);
  });

  it('超过 maxLines 截断并补省略号', () => {
    const lines = wrapTextLines(ctx, '一二三四五六七八九十', 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });
});
