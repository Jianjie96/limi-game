// ============================================================================
// engine.online.test.ts — 在线对战引擎能力测试
// ----------------------------------------------------------------------------
// 覆盖：状态序列化往返、操作日志、云端回放一致性、日志清空时机。
// ============================================================================

import { describe, it, expect } from 'vitest';
import { RummikubEngine, applyOps } from './engine';
import type { Tile, TileColor } from './types';

function tile(id: number, color: TileColor, number: number): Tile {
  return { id, color, number };
}

/**
 * 确定性开局：P1 牌架固定为红 1-4、蓝 10-12（首出 6+33=39 分 ≥30）。
 * 同时把这些牌从牌池与 P2 牌架中剔除，避免 ID 冲突。
 */
function seededEngine(): RummikubEngine {
  const e = new RummikubEngine({ playerCount: 2, initialHandSize: 14 });
  e.startGame(['P1', 'P2']);
  const st: any = e.getState();

  const rack = [
    tile(0, 'red', 1),
    tile(1, 'red', 2),
    tile(2, 'red', 3),
    tile(3, 'red', 4),
    tile(4, 'blue', 10),
    tile(5, 'blue', 11),
    tile(6, 'blue', 12),
    // 两张垫底牌：保证出完可打的牌后牌架仍有剩余，不会直接获胜
    tile(7, 'red', 13),
    tile(8, 'black', 13),
  ];
  const ids = new Set(rack.map(t => t.id));

  st.players[0].rack = [...rack];
  st.turnContext.rackAtTurnStart = rack.map((t: Tile) => ({ ...t }));
  st.players[1].rack = st.players[1].rack.filter((t: Tile) => !ids.has(t.id));
  st.pool = st.pool.filter((t: Tile) => !ids.has(t.id));
  return e;
}

function stateJson(e: RummikubEngine): any {
  return JSON.parse(e.serializeState());
}

describe('在线对战：序列化与操作回放', () => {
  it('serializeState / fromState 往返后状态完全等价', () => {
    const engine = seededEngine();
    engine.createNewGroupOnBoard(
      [tile(0, 'red', 1), tile(1, 'red', 2), tile(2, 'red', 3)].map(t =>
        engine.getCurrentPlayer().rack.find(r => r.id === t.id)!,
      ),
      'run',
    );

    const json = engine.serializeState();
    const restored = RummikubEngine.fromState(json);

    expect(stateJson(restored)).toEqual(stateJson(engine));
    // 回合上下文同样恢复（可访问且不抛错）
    expect(restored.getTurnContext().replacedJokers.length).toBe(0);
  });

  it('fromState 后新建牌组的 groupId 与客户端草稿一致（计数器同步）', () => {
    const engine = seededEngine();
    const rack = engine.getCurrentPlayer().rack;
    const gid = engine.createNewGroupOnBoard(
      rack.filter(t => t.color === 'red').slice(0, 3),
      'run',
    );

    const restored = RummikubEngine.fromState(engine.serializeState());
    const restRack = restored.getCurrentPlayer().rack;
    const gid2 = restored.createNewGroupOnBoard(
      restRack.filter(t => t.color === 'blue'),
      'run',
    );

    // engine 继续建组应得到与 restored 相同的下一个编号
    const gidNext = engine.createNewGroupOnBoard(
      engine.getCurrentPlayer().rack.filter(t => t.color === 'blue'),
      'run',
    );
    expect(gid2).toBe(gidNext);
    expect(Number(gid2.slice(1))).toBe(Number(gid.slice(1)) + 1);
  });

  it('回放一致性：同一 ops 在两个引擎上回放后状态一致，提交结果一致', () => {
    // 客户端草稿引擎 A：回合开始时快照，随后做一串混合操作
    const a = seededEngine();
    const turnStartJson = a.serializeState();
    const rackA = a.getCurrentPlayer().rack;
    const byIdA = (id: number) => rackA.find(t => t.id === id)!;

    const gRed = a.createNewGroupOnBoard([byIdA(0), byIdA(1), byIdA(2)], 'run');
    const gBlue = a.createNewGroupOnBoard([byIdA(4), byIdA(5), byIdA(6)], 'run');
    a.placeTilesOnBoard([3], gRed, -1);                 // 红 run 扩展到 1-4
    a.returnTilesToRack([6]);                            // 蓝12 拆回牌架
    a.placeTilesOnBoard([6], gBlue, -1);                 // 重新放上
    a.moveTileWithinGroup(gBlue, 6, 0);                  // 重排打乱
    a.moveTileWithinGroup(gBlue, 6, 2);                  // 重排恢复

    const ops = a.getTurnOps();
    expect(ops.length).toBe(7);

    // 服务端引擎 B：从回合开始状态重建并回放
    const b = RummikubEngine.fromState(turnStartJson);
    applyOps(b, ops);
    expect(stateJson(b)).toEqual(stateJson(a));

    // 双方提交：结果与提交后状态都必须一致
    const resA = a.submitTurn();
    const resB = b.submitTurn();
    expect(resA.valid).toBe(true);
    expect(resB.valid).toBe(true);
    expect(stateJson(b)).toEqual(stateJson(a));
    // 回合已移交给 P2
    expect(a.getState().currentPlayerIndex).toBe(1);
  });

  it('提交成功 / 回滚后操作日志被清空', () => {
    const engine = seededEngine();
    const rack = engine.getCurrentPlayer().rack;
    engine.createNewGroupOnBoard(rack.filter(t => t.color === 'red'), 'run');
    expect(engine.getTurnOps().length).toBeGreaterThan(0);

    // 红 1-4 只有 10 分 → 破冰失败 → 回滚
    const res = engine.submitTurn();
    expect(res.valid).toBe(false);
    expect(engine.getTurnOps().length).toBe(0);
  });

  it('applyOps 遇到无法回放的 op 时抛错（云端拒绝非法提交）', () => {
    const engine = seededEngine();
    expect(() =>
      applyOps(engine, [{ op: 'PLACE_ON_BOARD', tileIds: [0], groupId: 'g999', position: -1 }]),
    ).toThrow();
  });
});
