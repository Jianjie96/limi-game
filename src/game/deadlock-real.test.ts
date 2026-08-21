import { describe, it, expect } from 'vitest';
import { RummikubEngine } from './engine';
import { planBotTurn } from './bot';
import type { Tile, TileGroup } from './types';

// 用真机最后一次成功 pass 的返回值（version 89、poolCount 1、人手 54 张）
// 精确还原对局状态，再走一次 pass → 应当死局结算（机器人赢）且不抛异常。
describe('真机死局现场复现', () => {
  const BOARD: Array<{ id: string; type: 'run' | 'group'; tiles: Array<[number, string, number]> }> = [
    { id: 'g1', type: 'run', tiles: [[97, 'black', 7], [46, 'black', 8], [47, 'black', 9], [100, 'black', 10]] },
    { id: 'g2', type: 'run', tiles: [[56, 'red', 5], [5, 'red', 6], [58, 'red', 7], [7, 'red', 8]] },
    { id: 'g3', type: 'group', tiles: [[9, 'red', 10], [35, 'yellow', 10], [48, 'black', 10]] },
    { id: 'g4', type: 'group', tiles: [[62, 'red', 11], [23, 'blue', 11], [36, 'yellow', 11]] },
    { id: 'g5', type: 'group', tiles: [[59, 'red', 8], [20, 'blue', 8], [33, 'yellow', 8], [98, 'black', 8]] },
    { id: 'g6', type: 'run', tiles: [[101, 'black', 11], [102, 'black', 12], [103, 'black', 13]] },
    { id: 'g7', type: 'group', tiles: [[74, 'blue', 10], [105, 'joker', 0], [104, 'joker', 0]] },
    { id: 'g8', type: 'group', tiles: [[3, 'red', 4], [68, 'blue', 4], [29, 'yellow', 4]] },
    { id: 'g9', type: 'group', tiles: [[53, 'red', 2], [66, 'blue', 2], [27, 'yellow', 2]] },
    { id: 'g10', type: 'run', tiles: [[81, 'yellow', 4], [30, 'yellow', 5], [83, 'yellow', 6]] },
    { id: 'g11', type: 'group', tiles: [[1, 'red', 2], [14, 'blue', 2], [79, 'yellow', 2]] },
  ];

  const HUMAN_HAND: Array<[number, string, number]> = [
    [80, 'yellow', 3], [40, 'black', 2], [25, 'blue', 13], [24, 'blue', 12], [37, 'yellow', 12],
    [70, 'blue', 6], [12, 'red', 13], [87, 'yellow', 10], [94, 'black', 4], [0, 'red', 1],
    [84, 'yellow', 7], [8, 'red', 9], [22, 'blue', 10], [61, 'red', 10], [31, 'yellow', 6],
    [73, 'blue', 9], [18, 'blue', 6], [63, 'red', 12], [64, 'red', 13], [4, 'red', 5],
    [86, 'yellow', 9], [42, 'black', 4], [39, 'black', 1], [44, 'black', 6], [67, 'blue', 3],
    [51, 'black', 13], [41, 'black', 3], [34, 'yellow', 9], [69, 'blue', 5], [49, 'black', 11],
    [15, 'blue', 3], [89, 'yellow', 12], [75, 'blue', 11], [91, 'black', 1], [92, 'black', 2],
    [55, 'red', 4], [6, 'red', 7], [77, 'blue', 13], [38, 'yellow', 13], [71, 'blue', 7],
    [28, 'yellow', 3], [32, 'yellow', 7], [60, 'red', 9], [17, 'blue', 5], [13, 'blue', 1],
    [16, 'blue', 4], [90, 'yellow', 13], [2, 'red', 3], [99, 'black', 9], [82, 'yellow', 5],
    [72, 'blue', 8], [96, 'black', 6], [52, 'red', 1], [45, 'black', 7],
  ];

  function makeTile([id, color, number]: [number, string, number]): Tile {
    return { id, color: color as Tile['color'], number };
  }

  /** 按真机状态构造引擎；consecutivePasses 三种可能值都覆盖。 */
  function buildEngine(consecutivePasses: number): RummikubEngine {
    const engine = new RummikubEngine({ playerCount: 2, initialHandSize: 14 });
    engine.startGame(['顾建杰哈哈', '测试机器人1']);
    const state = engine.getState() as any;

    const used = new Set<number>();
    const board: TileGroup[] = BOARD.map((g) => {
      const tiles = g.tiles.map((t) => {
        used.add(t[0]);
        return { originalTile: makeTile(t), logicalColor: t[1], logicalNumber: t[2] } as any;
      });
      return { id: g.id, type: g.type, tiles } as any;
    });
    const human = HUMAN_HAND.map((t) => {
      used.add(t[0]);
      return makeTile(t);
    });
    // 剩余 16 张 = 机器人 15 + 牌池最后一张（具体分配未知，任意分配不影响死局链路验证）。
    const remaining: Tile[] = [];
    for (let copy = 0; copy < 2; copy++) {
      for (const [color, base] of [['red', 0], ['blue', 13], ['yellow', 26], ['black', 39]] as const) {
        for (let n = 1; n <= 13; n++) {
          const id = base + (n - 1) + copy * 52;
          if (!used.has(id)) remaining.push({ id, color, number: n });
        }
      }
    }
    [104, 105].forEach((id) => {
      if (!used.has(id)) remaining.push({ id, color: 'joker', number: 0 });
    });
    expect(remaining.length).toBe(16);

    state.board = board;
    state.players[0].rack = human;
    state.players[1].rack = remaining.slice(0, 15);
    state.pool = remaining.slice(15); // 真机现场：牌池仅剩 1 张
    state.players.forEach((p: any) => { p.hasMadeInitialMeld = true; });
    state.turnNumber = 88;

    // 还原「轮到真人、尚未摸牌」的回合起点：下一次 pass 才摸最后一张。
    // 通过 nextPlayer 真实构造 turnContext（含 rackAtTurnStart 快照，
    // rollbackTurn 会用它恢复牌架，手工伪造会导致复现失真）。
    state.currentPlayerIndex = 1;
    (engine as any).nextPlayer();
    state.turnContext.consecutivePasses = consecutivePasses;

    const scene = engine.getState() as any;
    expect(scene.pool.length).toBe(1);
    expect(scene.players[0].rack.length).toBe(54);
    expect(scene.currentPlayerIndex).toBe(0);

    // 与云端一致：序列化 → 反序列化（fromState）后再操作。
    return RummikubEngine.fromState(engine.serializeState());
  }

  function botPlayOneTurn(engine: RummikubEngine): void {
    const snapshot = engine.serializeState();
    try {
      if (planBotTurn(engine)) {
        const res = engine.submitTurn();
        if (res.valid) return;
      }
      engine.pass();
    } catch (e) {
      try {
        engine.loadState(snapshot);
        engine.pass();
      } catch (e2) { /* 兜底 */ }
    }
  }

  it('最后一次 pass 摸掉牌池最后一张 → 死局结算机器人赢，全程不抛异常', () => {
    for (const passes of [0, 1, 5]) {
      const engine = buildEngine(passes);
      const before = engine.getState() as any;
      expect(before.pool.length).toBe(1);

      // 真机 doPass 主链路：engine.pass() 摸掉最后一张（rack 54 → 55）。
      engine.pass();
      let st = engine.getState() as any;
      expect(st.players[0].rack.length).toBe(55);
      expect(st.pool.length).toBe(0);

      // 若未立即死局（passes=0），走 advanceBots：机器人空池 Pass/出牌直到终局。
      let guard = 0;
      while (st.phase === 'PLAYING' && st.currentPlayerIndex === 1 && guard++ < 50) {
        botPlayOneTurn(engine);
        st = engine.getState() as any;
      }
      while (st.phase === 'PLAYING' && guard++ < 200) {
        if (st.currentPlayerIndex === 0) engine.pass();
        else botPlayOneTurn(engine);
        st = engine.getState() as any;
      }

      st = engine.getState() as any;
      expect(st.phase).toBe('GAME_OVER');
      // passes≥1 时死局在真人最后一次 pass 内直接触发，必为最低分结算；
      // passes=0 时机器人还有机会出牌（可能出完直接赢），两种方式都合法。
      if (passes >= 1) expect(st.result.winReason).toBe('lowest_score');
      // 人手 55 张剩余分必为全场最高 → 真人不可能获胜。
      const winner = st.result.playerResults.find((r: any) => r.isWinner);
      expect(winner.playerName).toBe('测试机器人1');
    }
  });
});
