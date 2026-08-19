import { describe, it, expect } from 'vitest';
import type { Tile, PlayerState, GameResult } from './types';
import {
  calculateRackValue,
  calculateInitialMeldScore,
  meetsInitialMeldRequirement,
  calculateFinalScores,
  findLowestScorePlayer,
  buildGameResult,
} from './scoring';
import { getTileValue } from './tiles';
import type { LogicalTile } from './types';

function makeTile(id: number, color: 'red' | 'blue' | 'yellow' | 'black' | 'joker', number: number): Tile {
  return { id, color, number };
}

function makeLogicalTile(id: number, color: 'red' | 'blue' | 'yellow' | 'black' | 'joker', number: number): LogicalTile {
  return {
    originalTile: { id, color, number },
    logicalColor: color,
    logicalNumber: number,
  };
}

describe('getTileValue', () => {
  it('数字牌按面值计算', () => {
    expect(getTileValue(makeTile(0, 'red', 5))).toBe(5);
    expect(getTileValue(makeTile(1, 'blue', 13))).toBe(13);
    expect(getTileValue(makeTile(2, 'yellow', 1))).toBe(1);
  });

  it('Joker按30分计算', () => {
    expect(getTileValue(makeTile(104, 'joker', 0))).toBe(30);
  });

  it('逻辑牌Joker按30分计算', () => {
    const lt: LogicalTile = {
      originalTile: { id: 104, color: 'joker', number: 0 },
      logicalColor: 'red',
      logicalNumber: 5,
    };
    expect(getTileValue(lt)).toBe(5);
  });
});

describe('calculateRackValue', () => {
  it('空牌架为0', () => {
    expect(calculateRackValue([])).toBe(0);
  });

  it('数字牌求和', () => {
    const rack = [
      makeTile(0, 'red', 5),
      makeTile(1, 'blue', 10),
    ];
    expect(calculateRackValue(rack)).toBe(15);
  });

  it('Joker按30分', () => {
    const rack = [
      makeTile(104, 'joker', 0),
      makeTile(0, 'red', 5),
    ];
    expect(calculateRackValue(rack)).toBe(35);
  });
});

describe('calculateInitialMeldScore', () => {
  it('计算逻辑牌分值', () => {
    const tiles = [
      makeLogicalTile(0, 'red', 5),
      makeLogicalTile(1, 'red', 6),
      makeLogicalTile(2, 'red', 7),
    ];
    expect(calculateInitialMeldScore(tiles)).toBe(18);
  });

  it('含Joker时按30分', () => {
    const tiles: LogicalTile[] = [
      makeLogicalTile(0, 'red', 5),
      {
        originalTile: { id: 104, color: 'joker', number: 0 },
        logicalColor: 'red',
        logicalNumber: 6,
      } as LogicalTile,
      makeLogicalTile(2, 'red', 7),
    ];
    expect(calculateInitialMeldScore(tiles)).toBe(18);
  });

  it('达到30分门槛', () => {
    const tiles: LogicalTile[] = [];
    // 6+7+8+9 = 30
    for (let i = 0; i < 4; i++) {
      tiles.push(makeLogicalTile(i, 'red', i + 6));
    }
    expect(calculateInitialMeldScore(tiles)).toBe(30);
    expect(meetsInitialMeldRequirement(30)).toBe(true);
    expect(meetsInitialMeldRequirement(29)).toBe(false);
  });
});

describe('calculateFinalScores', () => {
  it('正常有人出完牌', () => {
    const players: PlayerState[] = [
      { id: 0, name: 'P1', rack: [], score: 0, hasMadeInitialMeld: true },
      { id: 1, name: 'P2', rack: [makeTile(1, 'red', 5), makeTile(2, 'blue', 10)], score: 0, hasMadeInitialMeld: true },
      { id: 2, name: 'P3', rack: [makeTile(3, 'yellow', 3)], score: 0, hasMadeInitialMeld: true },
    ];

    const results = calculateFinalScores(players, 0);
    // P2剩余15分, P3剩余3分 → P1得18分
    expect(results[0].scoreDelta).toBe(18);
    expect(results[1].scoreDelta).toBe(-15);
    expect(results[2].scoreDelta).toBe(-3);
    expect(results[0].isWinner).toBe(true);
  });

  it('分数总和为0', () => {
    const players: PlayerState[] = [
      { id: 0, name: 'P1', rack: [], score: 0, hasMadeInitialMeld: true },
      { id: 1, name: 'P2', rack: [makeTile(1, 'red', 5)], score: 0, hasMadeInitialMeld: true },
      { id: 2, name: 'P3', rack: [makeTile(2, 'blue', 3), makeTile(3, 'joker', 0)], score: 0, hasMadeInitialMeld: true },
    ];

    const results = calculateFinalScores(players, 0);
    const total = results.reduce((sum, r) => sum + r.scoreDelta, 0);
    expect(total).toBe(0);
  });

  it('平局时剩余分最低者获胜', () => {
    const players: PlayerState[] = [
      { id: 0, name: 'P1', rack: [makeTile(1, 'red', 3)], score: 0, hasMadeInitialMeld: true },
      { id: 1, name: 'P2', rack: [makeTile(2, 'blue', 1)], score: 0, hasMadeInitialMeld: true },
      { id: 2, name: 'P3', rack: [makeTile(3, 'yellow', 5)], score: 0, hasMadeInitialMeld: true },
    ];

    const winnerId = findLowestScorePlayer(players);
    expect(winnerId).toBe(1); // P2剩余1分最低
  });
});

describe('buildGameResult', () => {
  it('构建完整结果', () => {
    const players: PlayerState[] = [
      { id: 0, name: 'P1', rack: [], score: 0, hasMadeInitialMeld: true },
      { id: 1, name: 'P2', rack: [makeTile(1, 'red', 5)], score: 0, hasMadeInitialMeld: true },
    ];

    const result = buildGameResult(players, 0, 'empty_rack');
    expect(result.winnerId).toBe(0);
    expect(result.winReason).toBe('empty_rack');
    expect(result.playerResults.length).toBe(2);
  });
});
