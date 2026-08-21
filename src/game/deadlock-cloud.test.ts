import { describe, it, expect } from 'vitest';
import { RummikubEngine } from './engine';
import { planBotTurn } from './bot';

// 复现云端 doPass + advanceBots 完整链路：
// 3 人测试房（1 真人 + 2 机器人），真人一路 Pass 摸到最后一张，
// 机器人接管后连续 Pass 触发死局结算。全程不应抛异常。
describe('云端 Pass 死局链路复现', () => {
  /** 与云函数 botPlayOneTurn 完全一致的逻辑。 */
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

  /** 与云函数 advanceBots 完全一致的逻辑。 */
  function advanceBots(engine: RummikubEngine, botIndexFrom: number): number {
    let turns = 0;
    while (turns < 100) {
      const st = engine.getState();
      if (st.phase !== 'PLAYING') break;
      if (st.currentPlayerIndex < botIndexFrom) break; // 回到真人
      botPlayOneTurn(engine);
      turns++;
    }
    return turns;
  }

  it('真人 Pass 摸完最后一张 → 机器人连打 → 死局结算，不抛异常', () => {
    for (let seed = 0; seed < 8; seed++) {
      const engine = new RummikubEngine({ playerCount: 3, initialHandSize: 14 });
      engine.startGame(['Human', 'BotA', 'BotB']);
      const state = engine.getState() as any;

      // 全员跳过破冰（模拟后期只能 Pass 的局面），随机打乱牌池增加覆盖面。
      for (const p of state.players) p.hasMadeInitialMeld = true;
      for (let i = state.pool.length - 1; i > 0; i--) {
        const j = Math.floor(((seed + 1) * 7919 * i) % (i + 1));
        [state.pool[i], state.pool[j]] = [state.pool[j], state.pool[i]];
      }

      let guard = 0;
      while (engine.getState().phase === 'PLAYING' && guard++ < 500) {
        const st = engine.getState() as any;
        if (st.currentPlayerIndex !== 0) {
          advanceBots(engine, 1);
          continue;
        }
        // 真人 doPass 主链路：pass → （死局可能在 pass 内触发）→ advanceBots。
        engine.pass();
        advanceBots(engine, 1);
      }

      const final = engine.getState() as any;
      expect(final.phase).toBe('GAME_OVER');
      expect(final.result).toBeTruthy();
      expect(final.result.playerResults.some((r: any) => r.isWinner)).toBe(true);
    }
  });
});
