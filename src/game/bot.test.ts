// ============================================================================
// bot.test.ts — 机器人出牌 AI 单元测试
// ============================================================================

import { describe, it, expect } from 'vitest';
import { GamePhase } from './types';
import type { Tile, TileColor, TileGroup, GroupType } from './types';
import { RummikubEngine } from './engine';
import { planBotTurn, enumerateMelds } from './bot';
import { toLogical } from './tiles';
import { snapshotBoard } from './snapshot';

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

function tile(id: number, color: TileColor, number: number): Tile {
  return { id, color, number };
}

function joker(id: number): Tile {
  return { id, color: 'joker', number: 0 };
}

/** 构造桌面顺子牌组（物理牌 ID 从 startId 起编号） */
function makeRun(groupId: string, color: TileColor, from: number, to: number, startId: number): TileGroup {
  const tiles = [];
  for (let n = from, i = 0; n <= to; n++, i++) {
    tiles.push(toLogical(tile(startId + i, color, n)));
  }
  return { id: groupId, type: 'run', tiles };
}

/** 构造桌面刻子牌组 */
function makeGroup(groupId: string, number: number, colors: TileColor[], startId: number): TileGroup {
  return {
    id: groupId,
    type: 'group',
    tiles: colors.map((c, i) => toLogical(tile(startId + i, c, number))),
  };
}

/**
 * 构造一个「机器人回合」状态的引擎：
 * startGame 后强行替换 0 号玩家（Bot）的牌架/桌面，并同步回合上下文快照。
 */
function setup(opts: { rack: Tile[]; board?: TileGroup[]; melded?: boolean }): RummikubEngine {
  const engine = new RummikubEngine({ playerCount: 2, initialHandSize: 14 });
  engine.startGame(['Bot', 'Human']);
  const state = engine.getState() as any;
  const player = state.players[0];
  player.rack = [...opts.rack];
  if (opts.melded) player.hasMadeInitialMeld = true;
  if (opts.board) state.board = [...opts.board];
  const ctx = engine.getTurnContext() as any;
  ctx.rackAtTurnStart = [...opts.rack];
  ctx.boardSnapshot = snapshotBoard(state.board);
  return engine;
}

// ---------------------------------------------------------------------------
// 牌组枚举
// ---------------------------------------------------------------------------

describe('enumerateMelds', () => {
  it('识别同色连续顺子', () => {
    const melds = enumerateMelds([tile(1, 'red', 3), tile(2, 'red', 4), tile(3, 'red', 5)]);
    const run = melds.find((m) => m.type === 'run');
    expect(run).toBeDefined();
    expect(run!.tiles.map((t) => t.number)).toEqual([3, 4, 5]);
    expect(run!.score).toBe(12);
  });

  it('识别同数字不同色刻子', () => {
    const melds = enumerateMelds([tile(1, 'red', 7), tile(2, 'blue', 7), tile(3, 'yellow', 7)]);
    const group = melds.find((m) => m.type === 'group');
    expect(group).toBeDefined();
    expect(group!.tiles.length).toBe(3);
    expect(group!.score).toBe(21);
  });

  it('用 Joker 补齐单洞顺子', () => {
    const melds = enumerateMelds([tile(1, 'red', 4), tile(2, 'red', 6), joker(104)]);
    const run = melds.find((m) => m.type === 'run');
    expect(run).toBeDefined();
    expect(run!.tiles.some((t) => t.color === 'joker')).toBe(true);
  });

  it('用 Joker 补齐两色刻子', () => {
    const melds = enumerateMelds([tile(1, 'red', 9), tile(2, 'blue', 9), joker(104)]);
    const group = melds.find((m) => m.type === 'group');
    expect(group).toBeDefined();
    expect(group!.tiles.length).toBe(3);
  });

  it('两张散牌无法成组', () => {
    const melds = enumerateMelds([tile(1, 'red', 3), tile(2, 'blue', 9)]);
    expect(melds.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 破冰（首次出牌）
// ---------------------------------------------------------------------------

describe('planBotTurn — 破冰', () => {
  it('分数够 30 时破冰成功并可提交', () => {
    const engine = setup({
      rack: [tile(1, 'red', 10), tile(2, 'red', 11), tile(3, 'red', 12), tile(4, 'blue', 1)],
    });
    expect(planBotTurn(engine)).toBe(true);

    const res = engine.submitTurn();
    expect(res.valid).toBe(true);
    expect(engine.getState().board.length).toBe(1);
    expect(engine.getState().players[0].hasMadeInitialMeld).toBe(true);
    expect(engine.getState().currentPlayerIndex).toBe(1);
  });

  it('分数不足 30 时不出牌', () => {
    const engine = setup({
      rack: [tile(1, 'red', 1), tile(2, 'red', 2), tile(3, 'red', 3)],
    });
    expect(planBotTurn(engine)).toBe(false);
    expect(engine.getState().board.length).toBe(0);
  });

  it('多个小牌组合计够 30 也破冰', () => {
    // 刻子 9×3=27 不够，但加上顺子 1+2+3=6 → 33 ≥ 30
    const engine = setup({
      rack: [
        tile(1, 'red', 9), tile(2, 'blue', 9), tile(3, 'yellow', 9),
        tile(4, 'black', 1), tile(5, 'black', 2), tile(6, 'black', 3),
      ],
    });
    expect(planBotTurn(engine)).toBe(true);
    const res = engine.submitTurn();
    expect(res.valid).toBe(true);
    expect(engine.getState().board.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 自由出牌（已破冰）
// ---------------------------------------------------------------------------

describe('planBotTurn — 自由出牌', () => {
  it('打出牌架内的新牌组', () => {
    const engine = setup({
      melded: true,
      rack: [tile(1, 'red', 5), tile(2, 'red', 6), tile(3, 'red', 7)],
    });
    expect(planBotTurn(engine)).toBe(true);
    const res = engine.submitTurn();
    expect(res.valid).toBe(true);
    expect(engine.getState().board.length).toBe(1);
  });

  it('把散牌挂到桌面顺子的两端', () => {
    const engine = setup({
      melded: true,
      board: [makeRun('g1', 'blue', 3, 5, 20)],
      rack: [tile(1, 'blue', 2), tile(2, 'blue', 6)],
    });
    expect(planBotTurn(engine)).toBe(true);
    const res = engine.submitTurn();
    expect(res.valid).toBe(true);
    const run = engine.getState().board.find((g) => g.id === 'g1')!;
    expect(run.tiles.length).toBe(5);
    expect(run.tiles.map((t) => t.logicalNumber)).toEqual([2, 3, 4, 5, 6]);
  });

  it('把散牌挂到桌面刻子', () => {
    const engine = setup({
      melded: true,
      board: [makeGroup('g1', 8, ['red', 'blue', 'yellow'], 20)],
      rack: [tile(1, 'black', 8)],
    });
    expect(planBotTurn(engine)).toBe(true);
    const res = engine.submitTurn();
    expect(res.valid).toBe(true);
    expect(engine.getState().board[0].tiles.length).toBe(4);
  });

  it('甩出 Joker 到桌面牌组', () => {
    const engine = setup({
      melded: true,
      board: [makeRun('g1', 'red', 3, 5, 20)],
      rack: [joker(104)],
    });
    expect(planBotTurn(engine)).toBe(true);
    const res = engine.submitTurn();
    expect(res.valid).toBe(true);
    expect(engine.getState().players[0].rack.length).toBe(0);
  });

  it('无可出之牌时返回 false（调用方 pass）', () => {
    const engine = setup({
      melded: true,
      rack: [tile(1, 'red', 13)],
      board: [makeRun('g1', 'blue', 1, 3, 20)],
    });
    expect(planBotTurn(engine)).toBe(false);
  });

  it('出光手牌即获胜', () => {
    const engine = setup({
      melded: true,
      board: [makeRun('g1', 'blue', 3, 5, 20)],
      rack: [tile(1, 'blue', 6)],
    });
    expect(planBotTurn(engine)).toBe(true);
    const res = engine.submitTurn();
    expect(res.valid).toBe(true);
    expect(engine.getState().phase).toBe(GamePhase.GAME_OVER);
    expect(engine.getState().result?.winnerId).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 冒烟：机器人互战整局
// ---------------------------------------------------------------------------

describe('机器人互战', () => {
  it('两个机器人能打完整局不报错', () => {
    const engine = new RummikubEngine({ playerCount: 2, initialHandSize: 14 });
    engine.startGame(['BotA', 'BotB']);

    let guard = 0;
    while (engine.getState().phase !== GamePhase.GAME_OVER && guard < 1000) {
      guard++;
      if (planBotTurn(engine)) {
        const res = engine.submitTurn();
        if (!res.valid) engine.pass();
      } else {
        engine.pass();
      }
    }

    expect(engine.getState().phase).toBe(GamePhase.GAME_OVER);
    expect(engine.getState().result).not.toBeNull();
  });
});
