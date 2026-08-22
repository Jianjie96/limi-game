// ============================================================================
// src/game/log.ts — 回合操作日志（客户端 / 云端同源）
// ----------------------------------------------------------------------------
// 云端在每个回合完成时（出牌 / Pass / 机器人代打）调用 buildTurnLogEntry
// 生成一条日志追加到 lami_rooms.game.log，房间内所有成员可读，
// 对局结束时清空。生成逻辑与渲染文案同源，避免双份描述漂移。
// ============================================================================

import type { LogicalTile, TileGroup } from './types';
import { describeTile, isLogicalJoker } from './tiles';

/** 回合操作日志条目：lines[0] 为动作总述，其后为逐组完整牌面明细。 */
export interface TurnLogEntry {
  turnNumber: number;
  playerName: string;
  lines: string[];
}

/** 牌组牌面描述：顺子压缩成区间（红 3-6），刻子逐张列出，百搭按位置推断代表值。 */
function describeMeldTiles(tiles: readonly LogicalTile[]): string {
  const reals = tiles.filter((t) => !isLogicalJoker(t));
  const isRunGroup =
    reals.length > 0 && new Set(reals.map((t) => t.logicalColor)).size === 1;

  if (isRunGroup) {
    const nums = reals.map((t) => t.logicalNumber);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const colorName = describeTile(reals[0]).split(' ')[0];
    return min === max ? `${colorName} ${min}` : `${colorName} ${min}-${max}`;
  }

  const parts = tiles.map((t, i) => {
    if (isLogicalJoker(t)) {
      const v = inferJokerValueAt(tiles, i);
      return v ? `${v}（百搭）` : '百搭';
    }
    return describeTile(t);
  });
  return parts.join('、');
}

/** 推断组内某位置百搭的代表值：相邻真实牌按距离外推；两侧都有时取左侧链；刻子同数字。 */
function inferJokerValueAt(tiles: readonly LogicalTile[], jokerIndex: number): string | null {
  const reals = tiles.filter((t) => !isLogicalJoker(t));
  if (reals.length === 0) return null;
  const isRun = new Set(reals.map((t) => t.logicalColor)).size === 1;
  if (!isRun) return describeTile(reals[0]);

  let left: { t: LogicalTile; i: number } | null = null;
  let right: { t: LogicalTile; i: number } | null = null;
  for (let i = jokerIndex - 1; i >= 0; i--) {
    if (!isLogicalJoker(tiles[i])) {
      left = { t: tiles[i], i };
      break;
    }
  }
  for (let i = jokerIndex + 1; i < tiles.length; i++) {
    if (!isLogicalJoker(tiles[i])) {
      right = { t: tiles[i], i };
      break;
    }
  }
  let n: number | null = null;
  if (left) n = left.t.logicalNumber + (jokerIndex - left.i);
  else if (right) n = right.t.logicalNumber - (right.i - jokerIndex);
  if (n === null || n < 1 || n > 13) return null;
  return `${describeTile(reals[0]).split(' ')[0]} ${n}`;
}

/**
 * 生成一条回合操作日志：对比回合前后的桌面状态。
 *
 * @param prevBoard 回合开始时的桌面
 * @param nextBoard 回合结束时的桌面（Pass 时与 prevBoard 相同）
 * @param turnNumber 回合号
 * @param playerName 行棋玩家名
 * @param isPass true = 该回合以 Pass 结束（摸牌 1 张）
 */
export function buildTurnLogEntry(
  prevBoard: readonly TileGroup[],
  nextBoard: readonly TileGroup[],
  turnNumber: number,
  playerName: string,
  isPass: boolean
): TurnLogEntry {
  if (isPass) {
    return { turnNumber, playerName, lines: ['Pass，摸牌 1 张'] };
  }
  const prevIds = new Set<number>();
  for (const g of prevBoard) for (const t of g.tiles) prevIds.add(t.originalTile.id);
  const prevGroups = new Map(prevBoard.map((g) => [g.id, g]));
  const lines: string[] = [];
  let placedCount = 0;
  let swapped = false;
  for (const g of nextBoard) {
    const prevG = prevGroups.get(g.id);
    const added = g.tiles.filter((t) => !prevIds.has(t.originalTile.id));
    const jokerBefore = prevG ? prevG.tiles.filter(isLogicalJoker).length : 0;
    const jokerAfter = g.tiles.filter(isLogicalJoker).length;
    if (!prevG) {
      // 新建牌组：整组都是本回合放上的。
      lines.push(`新组：${describeMeldTiles(g.tiles)}`);
      placedCount += g.tiles.length;
    } else if (added.length > 0) {
      lines.push(`加入 ${added.map(describeTile).join('、')} → ${describeMeldTiles(g.tiles)}`);
      placedCount += added.length;
    }
    // 百搭被换回：组内 Joker 减少且有新牌放入（放真牌替回百搭，手牌数不变）。
    if (prevG && jokerAfter < jokerBefore && added.length > 0) {
      const beforeJokerIdx = prevG.tiles.findIndex(isLogicalJoker);
      const val = beforeJokerIdx >= 0 ? inferJokerValueAt(prevG.tiles, beforeJokerIdx) : null;
      lines.push(`换回百搭${val ? `（原代替 ${val}）` : ''}：${added.map(describeTile).join('、')} 替入`);
      swapped = true;
    }
  }
  if (placedCount > 0) lines.unshift(`出牌 ${placedCount} 张`);
  else if (swapped) lines.unshift('换回百搭');
  else lines.unshift('无动作');
  return { turnNumber, playerName, lines };
}
