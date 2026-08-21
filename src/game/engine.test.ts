import { describe, it, expect, beforeEach } from 'vitest';
import { GamePhase, TurnPhase } from './types';
import type { Tile } from './types';
import { RummikubEngine, applyOps } from './engine';

function createEngine(): RummikubEngine {
  return new RummikubEngine({ playerCount: 2, initialHandSize: 5 });
}

describe('RummikubEngine', () => {
  let engine: RummikubEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  describe('startGame', () => {
    it('初始化2人游戏', () => {
      engine.startGame(['P1', 'P2']);
      const state = engine.getState();

      expect(state.phase).toBe(GamePhase.PLAYING);
      expect(state.players.length).toBe(2);
      expect(state.players[0].rack.length).toBe(5);
      expect(state.players[1].rack.length).toBe(5);
      expect(state.pool.length).toBe(106 - 10);
      expect(state.turnPhase).toBe(TurnPhase.PLAY);
    });

    it('初始化4人游戏', () => {
      engine.startGame(['P1', 'P2', 'P3', 'P4']);
      const state = engine.getState();

      expect(state.players.length).toBe(4);
      expect(state.pool.length).toBe(106 - 4 * 5);
    });

    it('玩家数量校验', () => {
      expect(() => engine.startGame(['P1'])).toThrow();
      expect(() => engine.startGame(['P1', 'P2', 'P3', 'P4', 'P5'])).toThrow();
    });
  });

  describe('drawTile', () => {
    it('摸牌加入牌架', () => {
      engine.startGame(['P1', 'P2']);
      const initialRackSize = engine.getCurrentPlayer().rack.length;
      const initialPoolSize = engine.getState().pool.length;

      const tile = engine.drawTile();

      expect(tile).not.toBeNull();
      expect(engine.getCurrentPlayer().rack.length).toBe(initialRackSize + 1);
      expect(engine.getState().pool.length).toBe(initialPoolSize - 1);
      expect(engine.getState().turnPhase).toBe(TurnPhase.PLAY);
    });

    it('牌池空时摸牌返回 null', () => {
      engine.startGame(['P1', 'P2']);
      const state = engine.getState();
      (state.pool as any).length = 0;

      const tile = engine.drawTile();
      expect(tile).toBeNull();
      expect(engine.getState().turnPhase).toBe(TurnPhase.PLAY);
    });
  });

  describe('pass', () => {
    it('Pass后摸1张牌并结束回合', () => {
      engine.startGame(['P1', 'P2']);
      const firstPlayer = engine.getState().players[0];
      const initialRackSize = firstPlayer.rack.length;

      engine.pass();

      expect(engine.getState().currentPlayerIndex).toBe(1);
      expect(firstPlayer.rack.length).toBe(initialRackSize + 1);
    });
  });

  describe('submitTurn', () => {
    it('返回合法校验结果结构（无需事先摸牌）', () => {
      engine.startGame(['P1', 'P2']);

      const result = engine.submitTurn();
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
    });

    it('首次出牌分数不足时返回错误', () => {
      engine.startGame(['P1', 'P2']);

      const result = engine.submitTurn();
      // 首次出牌需要30分, 空桌面 + 未放任何牌 → 肯定失败
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('出牌失败后不结束回合且牌架不变', () => {
      engine.startGame(['P1', 'P2']);
      const before = engine.getCurrentPlayer().rack.map((t) => t.id).sort((a, b) => a - b);

      const result = engine.submitTurn();

      expect(result.valid).toBe(false);
      // 失败后仍停留在当前玩家，而不是切到下家
      expect(engine.getState().currentPlayerIndex).toBe(0);
      const after = engine.getCurrentPlayer().rack.map((t) => t.id).sort((a, b) => a - b);
      expect(after).toEqual(before);
    });

    it('不摸牌直接创建新牌组并提交应成功', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      const deck: Tile[] = [
        { id: 9001, color: 'red', number: 13 },
        { id: 9002, color: 'blue', number: 13 },
        { id: 9003, color: 'joker', number: 0 },
        { id: 9004, color: 'black', number: 1 },
        { id: 9005, color: 'black', number: 2 },
        { id: 9006, color: 'yellow', number: 5 },
        { id: 9007, color: 'black', number: 9 },
        { id: 9008, color: 'yellow', number: 11 },
        { id: 9009, color: 'red', number: 4 },
        { id: 9010, color: 'blue', number: 8 },
        { id: 9011, color: 'red', number: 12 },
        { id: 9012, color: 'yellow', number: 9 },
        { id: 9013, color: 'blue', number: 3 },
        { id: 9014, color: 'black', number: 6 },
      ];
      p.rack = deck;
      const ctx = engine.getTurnContext();
      (ctx as unknown as { rackAtTurnStart: Tile[] }).rackAtTurnStart = deck.map((t) => ({ ...t }));

      // 无需摸牌，直接打出 13+13+Joker 组成的刻子。
      engine.createNewGroupOnBoard([deck[0], deck[1], deck[2]], 'group');
      const result = engine.submitTurn();

      expect(result.valid).toBe(true);
      expect(p.hasMadeInitialMeld).toBe(true);
    });

    it('破冰可同时打出多个牌组，总分≥ 30 即成功', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      // 同色顺子 1-2-3（6 分）+ 不同色刻子 8-8-8（24 分）= 30 分。
      const deck: Tile[] = [
        { id: 9101, color: 'red', number: 1 },
        { id: 9102, color: 'red', number: 2 },
        { id: 9103, color: 'red', number: 3 },
        { id: 9104, color: 'black', number: 8 },
        { id: 9105, color: 'blue', number: 8 },
        { id: 9106, color: 'yellow', number: 8 },
        { id: 9107, color: 'red', number: 5 }, // 余牌避免直接出完
      ];
      p.rack = deck;
      const ctx = engine.getTurnContext();
      (ctx as unknown as { rackAtTurnStart: Tile[] }).rackAtTurnStart = deck.map((t) => ({ ...t }));

      engine.createNewGroupOnBoard([deck[0], deck[1], deck[2]], 'run');
      engine.createNewGroupOnBoard([deck[3], deck[4], deck[5]], 'group');
      const result = engine.submitTurn();

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(p.hasMadeInitialMeld).toBe(true);
    });
  });

  describe('工作区（牌架暂存）', () => {
    it('牌架牌可移入工作区，也可放回牌架', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      const deck: Tile[] = [
        { id: 9201, color: 'red', number: 3 },
        { id: 9202, color: 'blue', number: 7 },
        { id: 9203, color: 'black', number: 9 },
      ];
      p.rack = deck;
      const ctx = engine.getTurnContext();
      (ctx as unknown as { rackAtTurnStart: Tile[] }).rackAtTurnStart = deck.map((t) => ({ ...t }));

      engine.moveRackTilesToWorkingArea([9201, 9202]);

      expect(p.rack.length).toBe(1);
      expect(engine.getTurnContext().workingArea.map((t) => t.id)).toEqual([9201, 9202]);

      engine.returnTilesToRack([9201, 9202]);
      expect(p.rack.length).toBe(3);
      expect(engine.getTurnContext().workingArea.length).toBe(0);
    });

    it('未破冰：牌架→工作区理牌后成组提交，两组总分 30 成功', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      const deck: Tile[] = [
        { id: 9301, color: 'red', number: 1 },
        { id: 9302, color: 'red', number: 2 },
        { id: 9303, color: 'red', number: 3 },
        { id: 9304, color: 'black', number: 8 },
        { id: 9305, color: 'blue', number: 8 },
        { id: 9306, color: 'yellow', number: 8 },
        { id: 9307, color: 'red', number: 5 }, // 余牌避免直接出完
      ];
      p.rack = deck;
      const ctx = engine.getTurnContext();
      (ctx as unknown as { rackAtTurnStart: Tile[] }).rackAtTurnStart = deck.map((t) => ({ ...t }));

      // 全部暂存到工作区，再拆成两组分别成组。
      engine.moveRackTilesToWorkingArea([9301, 9302, 9303, 9304, 9305, 9306]);
      engine.createNewGroupFromWorkingArea(
        engine.getTurnContext().workingArea.slice(0, 3), 'run'
      );
      engine.createNewGroupFromWorkingArea(
        engine.getTurnContext().workingArea.slice(0, 3), 'group'
      );

      const result = engine.submitTurn();
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(p.hasMadeInitialMeld).toBe(true);
    });

    it('RACK_TO_WA 操作可在另一引擎上回放得到相同结果', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      const deck: Tile[] = [
        { id: 9401, color: 'red', number: 11 },
        { id: 9402, color: 'blue', number: 11 },
        { id: 9403, color: 'yellow', number: 11 },
        { id: 9404, color: 'black', number: 2 },
      ];
      p.rack = deck;
      p.hasMadeInitialMeld = true;
      const ctx = engine.getTurnContext();
      (ctx as unknown as { rackAtTurnStart: Tile[] }).rackAtTurnStart = deck.map((t) => ({ ...t }));
      const baseline = engine.serializeState();

      engine.moveRackTilesToWorkingArea([9401, 9402, 9403]);
      engine.createNewGroupFromWorkingArea(
        engine.getTurnContext().workingArea.slice(0, 3), 'group'
      );
      const ops = [...engine.getTurnOps()];

      const clone = RummikubEngine.fromState(baseline);
      applyOps(clone, ops);

      expect(clone.getState().board).toEqual(engine.getState().board);
      expect(clone.getTurnContext().workingArea).toEqual(engine.getTurnContext().workingArea);
      expect(clone.getCurrentPlayer().rack.map((t) => t.id)).toEqual(
        engine.getCurrentPlayer().rack.map((t) => t.id)
      );
    });
  });

  describe('moveTileWithinGroup', () => {
    it('同组内重排：把 Joker 从尾部拖到最前', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      const red7: Tile = { id: 9001, color: 'red', number: 7 };
      const red8: Tile = { id: 9002, color: 'red', number: 8 };
      const joker: Tile = { id: 9003, color: 'joker', number: 0 };
      p.rack = [red7, red8, joker];

      const groupId = engine.createNewGroupOnBoard([red7, red8, joker], 'run');
      let group = engine.getState().board.find(g => g.id === groupId)!;
      expect(group.tiles.map(t => t.originalTile.id)).toEqual([9001, 9002, 9003]);

      engine.moveTileWithinGroup(groupId, joker.id, 0);
      group = engine.getState().board.find(g => g.id === groupId)!;
      expect(group.tiles.map(t => t.originalTile.id)).toEqual([9003, 9001, 9002]);
    });

    it('同组内重排：向前移动时修正下标', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      const a: Tile = { id: 9101, color: 'red', number: 4 };
      const b: Tile = { id: 9102, color: 'red', number: 5 };
      const c: Tile = { id: 9103, color: 'red', number: 6 };
      p.rack = [a, b, c];

      const groupId = engine.createNewGroupOnBoard([a, b, c], 'run');
      engine.moveTileWithinGroup(groupId, a.id, 2);
      const group = engine.getState().board.find(g => g.id === groupId)!;
      expect(group.tiles.map(t => t.originalTile.id)).toEqual([9102, 9103, 9101]);
    });
  });

  describe('reorderRackTile', () => {
    it('重排牌架顺序且不改变手牌内容', () => {
      engine.startGame(['P1', 'P2']);
      const p = engine.getCurrentPlayer();
      const before = p.rack.map(t => t.id);

      engine.reorderRackTile(before[0], before.length - 1);

      const after = p.rack.map(t => t.id);
      expect(after).toEqual([...before.slice(1), before[0]]);
      expect([...after].sort((a, b) => a - b)).toEqual([...before].sort((a, b) => a - b));
    });
  });

  describe('timeout', () => {
    it('超时后执行摸牌惩罚并结束回合', () => {
      engine.startGame(['P1', 'P2']);
      const timedOutPlayer = engine.getState().players[0];

      engine.handleTimeout();

      expect(engine.getState().currentPlayerIndex).toBe(1);
      expect(timedOutPlayer.rack.length).toBe(6);
    });
  });

  describe('getState', () => {
    it('返回状态', () => {
      engine.startGame(['P1', 'P2']);
      const state = engine.getState();
      expect(state.phase).toBe(GamePhase.PLAYING);
      expect(state.players).toHaveLength(2);
    });
  });

  describe('getTurnContext', () => {
    it('返回回合上下文', () => {
      engine.startGame(['P1', 'P2']);
      const ctx = engine.getTurnContext();
      expect(ctx).not.toBeNull();
      expect(ctx?.phase).toBe(TurnPhase.PLAY);
    });
  });
});
