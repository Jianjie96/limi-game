// ============================================================================
// bot.ts — 机器人出牌规划（云端托管出牌 AI）
// ----------------------------------------------------------------------------
// 设计原则：
// - 纯策略层：只读「自己的牌架 + 公开桌面」，不看牌池顺序、他人手牌（不作弊）；
// - 通过引擎公开方法落子（createNewGroupOnBoard / placeTilesOnBoard），
//   规则校验与人类玩家完全同源，不做第二套规则实现；
// - 本模块只规划与落子、不提交；调用方负责 submitTurn（失败改 pass）。
//
// 策略 v1（贪心）：
// 1. 未破冰：枚举牌架内可成的新牌组（顺子/刻子，含 Joker 补位），
//    取互不冲突的候选直至总分 ≥ 30，一次性破冰；凑不够则 pass。
// 2. 已破冰：先把牌架内所有可成的新牌组全部打出，再循环把剩余牌
//    加到桌面已有牌组（顺子两端延长 / 刻子追加），直到无可加为止。
// ============================================================================

import type { Tile, TileColor, TileGroup, GroupType } from './types';
import type { RummikubEngine } from './engine';
import { TILE_COLORS } from './types';
import { toLogical, getTileValue } from './tiles';
import { isValidGroupTiles } from './validate';

/** 破冰候选牌组：一组牌架内的牌 + 类型 + 牌面总分 */
interface MeldCandidate {
  tiles: Tile[];
  type: GroupType;
  score: number;
}

/**
 * 规划并执行机器人一个回合的出牌（不含提交）。
 * @returns true = 已在桌面落子（调用方应 submitTurn）；false = 无牌可出（调用方应 pass）
 */
export function planBotTurn(engine: RummikubEngine): boolean {
  const state = engine.getState();
  if (state.phase !== 'PLAYING') return false;
  const player = engine.getCurrentPlayer();

  if (!player.hasMadeInitialMeld) {
    return planInitialMeld(engine, player.rack, state.config.initialMeldMinScore);
  }
  return planFreePlay(engine);
}

// ---------------------------------------------------------------------------
// 破冰（首次出牌 ≥ 30 分，全部来自牌架，只能创建新牌组）
// ---------------------------------------------------------------------------

function planInitialMeld(engine: RummikubEngine, rack: Tile[], minScore: number): boolean {
  const chosen = selectDisjointMelds(enumerateMelds(rack));
  const total = chosen.reduce((sum, c) => sum + c.score, 0);
  if (total < minScore) return false;

  for (const meld of chosen) {
    engine.createNewGroupOnBoard(meld.tiles, meld.type);
  }
  return true;
}

// ---------------------------------------------------------------------------
// 自由出牌（已破冰）：先打新牌组，再把散牌挂到桌面已有牌组
// ---------------------------------------------------------------------------

function planFreePlay(engine: RummikubEngine): boolean {
  let placedAny = false;

  // 1. 牌架内所有可成的新牌组全部打出（甩牌优先，降低手牌分）
  const chosen = selectDisjointMelds(enumerateMelds(engine.getCurrentPlayer().rack));
  for (const meld of chosen) {
    engine.createNewGroupOnBoard(meld.tiles, meld.type);
    placedAny = true;
  }

  // 2. 剩余牌挂桌面：高分先出；每次落一张后桌面变化，重新全量扫描直到无进展
  let progress = true;
  while (progress) {
    progress = false;
    const player = engine.getCurrentPlayer();
    const board = engine.getState().board;
    const rack = [...player.rack].sort((a, b) => getTileValue(b) - getTileValue(a));
    for (const tile of rack) {
      const target = findAttachTarget(tile, board);
      if (target) {
        engine.placeTilesOnBoard([tile.id], target.groupId, target.position);
        placedAny = true;
        progress = true;
        break; // 桌面已变化，重新扫描
      }
    }
  }

  return placedAny;
}

/**
 * 为一张牌寻找可挂靠的桌面牌组与插入位置（顺子两端 / 刻子追加）。
 * 顺子保持升序不变量：用显式数字判定而非顺序无关的验证器，
 * 避免把 2 追加到 [3,4,5,6] 末尾产出乱序顺子；含 Joker 的顺子 v1 跳过。
 */
function findAttachTarget(
  tile: Tile,
  board: readonly TileGroup[]
): { groupId: string; position: number } | null {
  const lt = toLogical(tile);
  for (const group of board) {
    if (group.type === 'run') {
      if (group.tiles.some((g) => g.logicalColor === 'joker')) continue; // 含 Joker 顺子：代表值需推断，v1 不碰
      const low = group.tiles[0].logicalNumber;
      const high = group.tiles[group.tiles.length - 1].logicalNumber;
      const runColor = group.tiles[0].logicalColor;
      if (tile.color === 'joker') {
        // Joker 优先向高端延长，已满 13 则向低端
        if (high < 13) return { groupId: group.id, position: group.tiles.length };
        if (low > 1) return { groupId: group.id, position: 0 };
        continue;
      }
      if (tile.color !== runColor) continue;
      if (tile.number === high + 1 && high + 1 <= 13) {
        return { groupId: group.id, position: group.tiles.length };
      }
      if (tile.number === low - 1 && low - 1 >= 1) {
        return { groupId: group.id, position: 0 };
      }
    } else if (isValidGroupTiles([...group.tiles, lt])) {
      return { groupId: group.id, position: group.tiles.length };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 牌架内牌组枚举
// ---------------------------------------------------------------------------

/** 枚举牌架内所有可成的新牌组候选（纯牌优先，Joker 补位候选排后）。 */
export function enumerateMelds(rack: readonly Tile[]): MeldCandidate[] {
  const pure: MeldCandidate[] = [];
  const withJoker: MeldCandidate[] = [];
  const jokers = rack.filter((t) => t.color === 'joker');

  for (const color of TILE_COLORS) {
    pure.push(...findRunCandidates(rack, color, null));
  }
  for (const color of TILE_COLORS) {
    let ji = 0;
    const jokerFor = () => (jokers.length > 0 ? jokers[ji % jokers.length] : null);
    for (const candidate of findRunCandidates(rack, color, jokerFor())) {
      withJoker.push(candidate);
      ji++;
    }
  }
  pure.push(...findGroupCandidates(rack, null));
  {
    let ji = 0;
    const jokerFor = () => (jokers.length > 0 ? jokers[ji % jokers.length] : null);
    for (const candidate of findGroupCandidates(rack, jokerFor())) {
      withJoker.push(candidate);
      ji++;
    }
  }

  const byScoreDesc = (a: MeldCandidate, b: MeldCandidate) => b.score - a.score;
  pure.sort(byScoreDesc);
  withJoker.sort(byScoreDesc);
  return [...pure, ...withJoker];
}

/**
 * 指定颜色的顺子候选。
 * - joker 为 null：只枚举 ≥3 张的最长连续段；
 * - joker 非 null：额外枚举用 Joker 补齐的 3 张顺子（两端延长 / 单洞补齐）。
 */
function findRunCandidates(rack: readonly Tile[], color: TileColor, joker: Tile | null): MeldCandidate[] {
  // 每个数字取一张（重复数字留一张即可）
  const byNumber = new Map<number, Tile>();
  for (const tile of rack) {
    if (tile.color === color && !byNumber.has(tile.number)) {
      byNumber.set(tile.number, tile);
    }
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);

  const candidates: MeldCandidate[] = [];
  const makeRun = (tiles: Tile[]): MeldCandidate => ({
    tiles,
    type: 'run',
    score: tiles.reduce((sum, t) => sum + getTileValue(t), 0),
  });

  // 最长连续段 ≥ 3 → 候选
  let i = 0;
  while (i < numbers.length) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    if (j - i + 1 >= 3) {
      candidates.push(makeRun(numbers.slice(i, j + 1).map((n) => byNumber.get(n)!)));
    }
    i = j + 1;
  }

  // Joker 补位：只在「凑出 3 张」时值得（避免把 Joker 浪费在已成立的顺子上）
  if (joker) {
    for (let k = 0; k < numbers.length; k++) {
      const a = numbers[k];
      const b = numbers[k + 1];
      if (b === undefined) break;
      if (b === a + 1) {
        // 相邻两张：向两端延长（边界内）
        if (a - 1 >= 1) candidates.push(makeRun([joker, byNumber.get(a)!, byNumber.get(b)!]));
        if (b + 1 <= 13) candidates.push(makeRun([byNumber.get(a)!, byNumber.get(b)!, joker]));
      } else if (b === a + 2) {
        // 单洞：n, n+2 → Joker 填中间
        candidates.push(makeRun([byNumber.get(a)!, joker, byNumber.get(b)!]));
      }
    }
  }

  return candidates;
}

/**
 * 刻子候选：同数字不同色。
 * - joker 为 null：≥3 个不同颜色 → 候选（最多 4 张）；
 * - joker 非 null：恰好 2 个不同颜色 → Joker 补第 3 张。
 */
function findGroupCandidates(rack: readonly Tile[], joker: Tile | null): MeldCandidate[] {
  const candidates: MeldCandidate[] = [];
  const makeGroup = (tiles: Tile[]): MeldCandidate => ({
    tiles,
    type: 'group',
    score: tiles.reduce((sum, t) => sum + getTileValue(t), 0),
  });

  for (let n = 1; n <= 13; n++) {
    // 每个颜色只取一张（刻子颜色不可重复）
    const perColor = new Map<string, Tile>();
    for (const tile of rack) {
      if (tile.number === n && tile.color !== 'joker' && !perColor.has(tile.color)) {
        perColor.set(tile.color, tile);
      }
    }
    const distinct = [...perColor.values()];
    if (joker) {
      if (distinct.length === 2) {
        candidates.push(makeGroup([...distinct, joker]));
      }
    } else if (distinct.length >= 3) {
      candidates.push(makeGroup(distinct));
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// 候选挑选
// ---------------------------------------------------------------------------

/** 贪心挑选互不冲突的候选（高分优先；Joker 候选整体排在纯牌之后，避免浪费）。 */
function selectDisjointMelds(candidates: MeldCandidate[]): MeldCandidate[] {
  const used = new Set<number>();
  const chosen: MeldCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.tiles.some((t) => used.has(t.id))) continue;
    chosen.push(candidate);
    for (const t of candidate.tiles) used.add(t.id);
  }
  return chosen;
}
