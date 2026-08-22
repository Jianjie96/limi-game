import { describe, it, expect } from 'vitest';
import type { LogicalTile, TileGroup } from './types';
import { buildTurnLogEntry } from './log';

function makeTile(id: number, color: 'red' | 'blue' | 'black', number: number): LogicalTile {
  return { originalTile: { id, color, number }, logicalColor: color, logicalNumber: number };
}

function makeJoker(id: number): LogicalTile {
  return { originalTile: { id, color: 'joker', number: 0 }, logicalColor: 'joker', logicalNumber: 0 };
}

function group(id: string, tiles: LogicalTile[], type: 'run' | 'group' = 'run'): TileGroup {
  return { id, type, tiles };
}

describe('buildTurnLogEntry', () => {
  it('Pass 回合只有一行总述', () => {
    const e = buildTurnLogEntry([], [], 3, '小明', true);
    expect(e.lines).toEqual(['Pass，摸牌 1 张']);
    expect(e.turnNumber).toBe(3);
    expect(e.playerName).toBe('小明');
  });

  it('新建顺子：首行出牌张数 + 新组压缩区间', () => {
    const g = group('g1', [makeTile(1, 'red', 3), makeTile(2, 'red', 4), makeTile(3, 'red', 5), makeTile(4, 'red', 6)]);
    const e = buildTurnLogEntry([], [g], 1, '小明', false);
    expect(e.lines[0]).toBe('出牌 4 张');
    expect(e.lines[1]).toBe('新组：红 3-6');
  });

  it('向已有牌组加牌：列出加入的牌与牌组现状', () => {
    const before = [group('g1', [makeTile(1, 'red', 3), makeTile(2, 'red', 4), makeTile(3, 'red', 5)])];
    const after = [group('g1', [makeTile(1, 'red', 3), makeTile(2, 'red', 4), makeTile(3, 'red', 5), makeTile(9, 'red', 6)])];
    const e = buildTurnLogEntry(before, after, 2, '小红', false);
    expect(e.lines[0]).toBe('出牌 1 张');
    expect(e.lines[1]).toBe('加入 红 6 → 红 3-6');
  });

  it('换回百搭：识别原代表值并单独成行', () => {
    const before = [group('g1', [makeTile(1, 'red', 4), makeJoker(99), makeTile(3, 'red', 6)])];
    const after = [group('g1', [makeTile(1, 'red', 4), makeTile(8, 'red', 5), makeTile(3, 'red', 6)])];
    const e = buildTurnLogEntry(before, after, 4, '小明', false);
    expect(e.lines[0]).toBe('出牌 1 张');
    expect(e.lines.some((l) => l.includes('换回百搭（原代替 红 5）：红 5 替入'))).toBe(true);
  });

  it('无动作兜底', () => {
    const b = [group('g1', [makeTile(1, 'red', 3), makeTile(2, 'red', 4), makeTile(3, 'red', 5)])];
    const e = buildTurnLogEntry(b, b, 5, '小明', false);
    expect(e.lines).toEqual(['无动作']);
  });
});
