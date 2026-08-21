import { describe, it, expect } from 'vitest';
import { RummikubEngine } from './engine';
import { planBotTurn } from './bot';

// 回归：牌池耗尽后的死局结算——摸掉最后一张后连续 Pass 达到玩家数，
// 应自动按「剩余牌面值最低者获胜」结算，不得抛异常。
describe('牌池耗尽死局结算', () => {
  it('摸掉最后一张后连续 Pass → 最低分获胜', () => {
    const engine = new RummikubEngine({ playerCount: 2, initialHandSize: 5 });
    engine.startGame(['Bot', 'Human']);
    const state = engine.getState() as any;

    // 双方都已破冰，避免首次出牌校验干扰。
    for (const p of state.players) p.hasMadeInitialMeld = true;
    // 双方手牌都无法成组（互不搭边的散牌），只能 Pass。
    state.players[0].rack = [
      { id: 8001, color: 'red', number: 1 },
      { id: 8002, color: 'blue', number: 3 },
      { id: 8003, color: 'yellow', number: 5 },
      { id: 8004, color: 'black', number: 7 },
      { id: 8005, color: 'red', number: 9 },
    ];
    state.players[1].rack = [
      { id: 8006, color: 'blue', number: 2 },
      { id: 8007, color: 'yellow', number: 4 },
      { id: 8008, color: 'black', number: 6 },
      { id: 8009, color: 'red', number: 8 },
      { id: 8010, color: 'blue', number: 10 },
    ];

    // 把牌池削到只剩 1 张，当前行动方为 Human(1)。
    state.pool = [state.pool[0]];
    state.currentPlayerIndex = 1;

    // Human Pass：摸掉最后一张。
    engine.pass();
    expect(engine.getState().pool.length).toBe(0);
    expect(engine.getState().phase).toBe('PLAYING');

    // Bot 回合：无牌可出则 Pass → 连续 Pass 达到玩家数 → 死局结算。
    if (!planBotTurn(engine)) {
      engine.pass();
    } else {
      engine.submitTurn();
    }

    expect(engine.getState().phase).toBe('GAME_OVER');
    expect(engine.getState().result).not.toBeNull();
  });
});
