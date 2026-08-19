// ============================================================================
// scoring.ts — 计分：单牌/牌组/牌架分值，胜负结算
// ============================================================================

import type { Tile, LogicalTile, PlayerState, GameResult, PlayerResult } from './types';
import { getTileValue } from './tiles';

// ---------------------------------------------------------------------------
// 单牌 / 集合分值
// ---------------------------------------------------------------------------

/** 计算一组牌的分值总和 */
export function sumTileValues(tiles: readonly (Tile | LogicalTile)[]): number {
  return tiles.reduce((sum, t) => sum + getTileValue(t), 0);
}

/** 计算玩家牌架剩余牌总分 */
export function calculateRackValue(rack: readonly Tile[]): number {
  return sumTileValues(rack);
}

// ---------------------------------------------------------------------------
// 首次出牌 30 分校验
// ---------------------------------------------------------------------------

/**
 * 计算首次出牌的总分。
 * 仅计算从牌架新放到桌面的牌。
 * Joker 按 30 分计算。
 */
export function calculateInitialMeldScore(tiles: readonly LogicalTile[]): number {
  return sumTileValues(tiles);
}

/**
 * 校验首次出牌是否达到 30 分门槛。
 */
export function meetsInitialMeldRequirement(score: number, minScore: number = 30): boolean {
  return score >= minScore;
}

// ---------------------------------------------------------------------------
// 胜负结算
// ---------------------------------------------------------------------------

/**
 * 计算最终得分。
 *
 * 正常出完 (有人清空牌架):
 *   winner_score = +Σ(其他玩家剩余牌面值)
 *   loser_i_score = -(自己的剩余牌面值)
 *   保证: Σ所有玩家分数变化 = 0
 *
 * 死局 (牌池耗尽 + 全员无法操作):
 *   剩余牌面值最低者获胜
 *   计分同上
 */
export function calculateFinalScores(
  players: readonly PlayerState[],
  winnerId: number,
): PlayerResult[] {
  let othersTotal = 0;

  // 先计算每个玩家的剩余分值
  const intermediate: { player: PlayerState; remainingScore: number }[] = [];
  for (const player of players) {
    const remainingScore = calculateRackValue(player.rack);
    if (player.id !== winnerId) {
      othersTotal += remainingScore;
    }
    intermediate.push({ player, remainingScore });
  }

  // 构建最终结果
  return intermediate.map(({ player, remainingScore }) => ({
    playerId: player.id,
    playerName: player.name,
    remainingTiles: [...player.rack],
    remainingScore,
    scoreDelta: player.id === winnerId ? othersTotal : -remainingScore,
    isWinner: player.id === winnerId,
  }));
}

/**
 * 死局判定: 找出剩余分值最低的玩家作为获胜者。
 * 如果平局, 取 id 较小者 (或可扩展为共享胜利)。
 */
export function findLowestScorePlayer(players: readonly PlayerState[]): number {
  let lowest = Infinity;
  let winnerId = 0;

  for (const p of players) {
    const val = calculateRackValue(p.rack);
    if (val < lowest) {
      lowest = val;
      winnerId = p.id;
    }
  }

  return winnerId;
}

/**
 * 构建完整的游戏结果。
 */
export function buildGameResult(
  players: readonly PlayerState[],
  winnerId: number,
  winReason: 'empty_rack' | 'lowest_score',
): GameResult {
  const playerResults = calculateFinalScores(players, winnerId);
  return {
    winnerId,
    winReason,
    playerResults,
  };
}
