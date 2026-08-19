import { describe, it, expect } from 'vitest';
import type { LogicalTile, TileColor, Tile } from './types';
import { TILE_COLORS } from './types';
import { isValidRun, isValidGroupTiles, isValidGroup, validateBoard, canFormMelds } from './validate';
import { toLogical, detectGroupType } from './tiles';

function phys(id: number, color: TileColor | 'joker', number: number): Tile {
  return { id, color, number };
}

function makeTile(id: number, color: TileColor | 'joker', number: number): LogicalTile {
  return {
    originalTile: { id, color, number },
    logicalColor: color,
    logicalNumber: number,
  };
}

function makeJoker(id: number, repColor: TileColor, repNumber: number): LogicalTile {
  return {
    originalTile: { id, color: 'joker', number: 0 },
    logicalColor: repColor,
    logicalNumber: repNumber,
  };
}

describe('isValidRun', () => {
  it('顺子至少3张牌', () => {
    const tiles = [
      makeTile(0, 'red', 1),
      makeTile(1, 'red', 2),
    ];
    expect(isValidRun(tiles)).toBe(false);
  });

  it('同色连续3张合法', () => {
    const tiles = [
      makeTile(0, 'red', 1),
      makeTile(1, 'red', 2),
      makeTile(2, 'red', 3),
    ];
    expect(isValidRun(tiles)).toBe(true);
  });

  it('同色连续5张合法', () => {
    const tiles: LogicalTile[] = [];
    for (let i = 0; i < 5; i++) {
      tiles.push(makeTile(i, 'blue', i + 1));
    }
    expect(isValidRun(tiles)).toBe(true);
  });

  it('不同色不合法', () => {
    const tiles = [
      makeTile(0, 'red', 1),
      makeTile(1, 'blue', 2),
      makeTile(2, 'red', 3),
    ];
    expect(isValidRun(tiles)).toBe(false);
  });

  it('数字不连续不合法', () => {
    const tiles = [
      makeTile(0, 'red', 1),
      makeTile(1, 'red', 3),
      makeTile(2, 'red', 4),
    ];
    expect(isValidRun(tiles)).toBe(false);
  });

  it('允许12-13但不允许12-13-1循环', () => {
    const tiles = [
      makeTile(0, 'red', 12),
      makeTile(1, 'red', 13),
      makeTile(2, 'red', 1),
    ];
    expect(isValidRun(tiles)).toBe(false);
  });

  it('Joker可以填补中间空缺', () => {
    const tiles = [
      makeTile(0, 'red', 1),
      makeJoker(104, 'red', 2),
      makeTile(2, 'red', 3),
    ];
    expect(isValidRun(tiles)).toBe(true);
  });

  it('Joker可以延伸两端', () => {
    const tiles = [
      makeJoker(104, 'red', 1),
      makeTile(0, 'red', 2),
      makeTile(1, 'red', 3),
    ];
    expect(isValidRun(tiles)).toBe(true);
  });

  it('多个Joker填补+延伸', () => {
    const tiles = [
      makeJoker(104, 'red', 4),
      makeJoker(105, 'red', 5),
      makeTile(0, 'red', 6),
      makeTile(1, 'red', 7),
      makeTile(2, 'red', 8),
    ];
    expect(isValidRun(tiles)).toBe(true);
  });

  it('纯Joker不能构成顺子', () => {
    const tiles = [
      makeJoker(104, 'red', 5),
      makeJoker(105, 'red', 6),
    ];
    expect(isValidRun(tiles)).toBe(false);
  });

  it('数字重复不合法', () => {
    const tiles = [
      makeTile(0, 'red', 2),
      makeTile(1, 'red', 2),
      makeTile(2, 'red', 3),
    ];
    expect(isValidRun(tiles)).toBe(false);
  });
});

describe('isValidGroupTiles', () => {
  it('刻子3张合法', () => {
    const tiles = [
      makeTile(0, 'red', 5),
      makeTile(1, 'blue', 5),
      makeTile(2, 'yellow', 5),
    ];
    expect(isValidGroupTiles(tiles)).toBe(true);
  });

  it('刻子4张合法', () => {
    const tiles = [
      makeTile(0, 'red', 7),
      makeTile(1, 'blue', 7),
      makeTile(2, 'yellow', 7),
      makeTile(3, 'black', 7),
    ];
    expect(isValidGroupTiles(tiles)).toBe(true);
  });

  it('刻子必须3-4张', () => {
    const tiles = [
      makeTile(0, 'red', 5),
      makeTile(1, 'blue', 5),
    ];
    expect(isValidGroupTiles(tiles)).toBe(false);
  });

  it('刻子超过4张不合法', () => {
    const tiles: LogicalTile[] = [];
    for (let i = 0; i < 5; i++) {
      tiles.push(makeTile(i, TILE_COLORS[i % 4], 5));
    }
    expect(isValidGroupTiles(tiles)).toBe(false);
  });

  it('数字不同不合法', () => {
    const tiles = [
      makeTile(0, 'red', 5),
      makeTile(1, 'blue', 6),
      makeTile(2, 'yellow', 5),
    ];
    expect(isValidGroupTiles(tiles)).toBe(false);
  });

  it('颜色重复不合法', () => {
    const tiles = [
      makeTile(0, 'red', 5),
      makeTile(1, 'red', 5),
      makeTile(2, 'blue', 5),
    ];
    expect(isValidGroupTiles(tiles)).toBe(false);
  });

  it('Joker可代替缺失颜色', () => {
    const tiles = [
      makeTile(0, 'red', 5),
      makeTile(1, 'blue', 5),
      makeJoker(104, 'yellow', 5),
    ];
    expect(isValidGroupTiles(tiles)).toBe(true);
  });

  it('Joker数量不能超过缺失颜色数', () => {
    const tiles = [
      makeTile(0, 'red', 5),
      makeJoker(104, 'blue', 5),
      makeJoker(105, 'yellow', 5),
    ];
    expect(isValidGroupTiles(tiles)).toBe(true);
  });
});

describe('isValidGroup', () => {
  it('校验run类型', () => {
    const group = {
      id: 'g1',
      type: 'run' as const,
      tiles: [
        makeTile(0, 'red', 1),
        makeTile(1, 'red', 2),
        makeTile(2, 'red', 3),
      ],
    };
    expect(isValidGroup(group)).toBe(true);
  });

  it('校验group类型', () => {
    const group = {
      id: 'g1',
      type: 'group' as const,
      tiles: [
        makeTile(0, 'red', 5),
        makeTile(1, 'blue', 5),
        makeTile(2, 'yellow', 5),
      ],
    };
    expect(isValidGroup(group)).toBe(true);
  });

  it('类型与内容不匹配', () => {
    const group = {
      id: 'g1',
      type: 'run' as const,
      tiles: [
        makeTile(0, 'red', 5),
        makeTile(1, 'blue', 5),
        makeTile(2, 'yellow', 5),
      ],
    };
    expect(isValidGroup(group)).toBe(false);
  });
});

describe('validateBoard', () => {
  it('空桌面合法', () => {
    expect(validateBoard([]).valid).toBe(true);
  });

  it('多个合法牌组', () => {
    const board = [
      {
        id: 'g1',
        type: 'run' as const,
        tiles: [
          makeTile(0, 'red', 1),
          makeTile(1, 'red', 2),
          makeTile(2, 'red', 3),
        ],
      },
      {
        id: 'g2',
        type: 'group' as const,
        tiles: [
          makeTile(3, 'blue', 5),
          makeTile(4, 'yellow', 5),
          makeTile(5, 'black', 5),
        ],
      },
    ];
    const result = validateBoard(board);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('含非法牌组', () => {
    const board = [
      {
        id: 'g1',
        type: 'run' as const,
        tiles: [
          makeTile(0, 'red', 1),
          makeTile(1, 'red', 3),
          makeTile(2, 'red', 5),
        ],
      },
    ];
    const result = validateBoard(board);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe('INVALID_GROUP');
  });
});

describe('canFormMelds', () => {
  it('少于3张允许凑牌', () => {
    expect(canFormMelds([phys(0, 'red', 1)])).toBe(true);
    expect(canFormMelds([phys(0, 'red', 1), phys(1, 'red', 2)])).toBe(true);
  });

  it('完整顺子允许', () => {
    expect(canFormMelds([phys(0, 'red', 1), phys(1, 'red', 2), phys(2, 'red', 3)])).toBe(true);
  });

  it('完整刻子允许', () => {
    expect(canFormMelds([phys(0, 'red', 5), phys(1, 'blue', 5), phys(2, 'yellow', 5)])).toBe(true);
  });

  it('完整牌组 + 残留凑牌允许', () => {
    expect(
      canFormMelds([phys(0, 'red', 1), phys(1, 'red', 2), phys(2, 'red', 3), phys(3, 'blue', 5)]),
    ).toBe(true);
  });

  it('3张互相冲突的牌被拦截', () => {
    expect(canFormMelds([phys(0, 'red', 1), phys(1, 'red', 2), phys(2, 'blue', 5)])).toBe(false);
  });

  it('Joker 可凑成牌组', () => {
    expect(canFormMelds([phys(0, 'red', 5), phys(1, 'blue', 5), phys(2, 'joker', 0)])).toBe(true);
  });
});

describe('detectGroupType', () => {
  it('同数字(含Joker)判定为刻子', () => {
    expect(detectGroupType([phys(0, 'red', 12), phys(1, 'blue', 12), phys(2, 'joker', 0)])).toBe('group');
  });

  it('同色连续判定为顺子', () => {
    expect(detectGroupType([phys(0, 'red', 5), phys(1, 'red', 6), phys(2, 'red', 7)])).toBe('run');
  });
});
