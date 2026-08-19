// ============================================================================
// partition.ts — 牌集合 → 合法牌组的划分算法（回溯）
// ============================================================================

import type { LogicalTile, TileColor, GroupType } from './types';
import { TILE_COLORS, NUMBER_MIN, NUMBER_MAX } from './types';
import { isLogicalJoker } from './tiles';
import { isValidRun, isValidGroupTiles } from './validate';

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/** 划分结果 */
export interface PartitionResult {
  runs: LogicalTile[][];
  groups: LogicalTile[][];
}

/**
 * 判断一组牌能否被完全划分为合法牌组。
 * 使用回溯法搜索。
 *
 * @param tiles 待划分的牌集合
 * @returns 划分结果, 若无法划分返回 null
 */
export function canPartition(tiles: readonly LogicalTile[]): PartitionResult | null {
  if (tiles.length === 0) return { runs: [], groups: [] };
  if (tiles.length < 3) return null;

  const result: PartitionResult = { runs: [], groups: [] };
  if (backtrack([...tiles], result)) {
    return result;
  }
  return null;
}

/**
 * 仅判断是否能划分 (不返回具体划分方案, 更快)。
 */
export function isPartitionable(tiles: readonly LogicalTile[]): boolean {
  return canPartition(tiles) !== null;
}

// ---------------------------------------------------------------------------
// 回溯核心
// ---------------------------------------------------------------------------

function backtrack(remaining: LogicalTile[], result: PartitionResult): boolean {
  if (remaining.length === 0) return true;
  if (remaining.length < 3) return false;

  // 策略: 先尝试找刻子 (搜索空间更小), 再尝试顺子
  // 选 remaining 中第一张非 Joker 牌作为锚点

  const anchorIdx = remaining.findIndex(t => !isLogicalJoker(t));

  if (anchorIdx === -1) {
    // 全是 Joker: 无法构成任何牌组 (纯 Joker 不能独立成组)
    return false;
  }

  const anchor = remaining[anchorIdx];

  // --- 尝试刻子: 找同数字的其他牌 ---
  const sameNumber = remaining.filter(
    (t, i) => i !== anchorIdx && !isLogicalJoker(t) && t.logicalNumber === anchor.logicalNumber,
  );
  const jokers = remaining.filter(t => isLogicalJoker(t));

  // 收集可与 anchor 组成刻子的候选
  const colorSet = new Set(sameNumber.map(t => t.logicalColor));
  const groupCandidates: LogicalTile[] = [...sameNumber];

  // 添加 Joker 作为补充 (最多补到 3 张总数)
  const needed = Math.max(0, 3 - (groupCandidates.length + 1));
  const jokersForGroup = jokers.slice(0, Math.min(needed, 4 - (groupCandidates.length + 1)));
  const allGroupMembers = [...groupCandidates, ...jokersForGroup];

  // 尝试不同大小的刻子 (3 张, 4 张)
  for (let size = Math.min(4, allGroupMembers.length + 1); size >= 3; size--) {
    const members = pickForGroup(anchor, allGroupMembers, size - 1);
    if (members && isValidGroupTiles([anchor, ...members])) {
      const newRemaining = removeTiles(remaining, [anchor, ...members]);
      result.groups.push([anchor, ...members]);
      if (backtrack(newRemaining, result)) return true;
      result.groups.pop();
    }
  }

  // --- 尝试顺子: 找同色的连续牌 ---
  const color = anchor.logicalColor as TileColor;
  const sameColor = remaining.filter(
    (t, i) => i !== anchorIdx && !isLogicalJoker(t) && t.logicalColor === color,
  );
  const jokersForRun = remaining.filter(t => isLogicalJoker(t));

  // 枚举包含 anchor 的所有可能顺子
  const runCandidates = findPossibleRuns(anchor, sameColor, jokersForRun);
  for (const run of runCandidates) {
    if (isValidRun(run)) {
      const newRemaining = removeTiles(remaining, run);
      result.runs.push(run);
      if (backtrack(newRemaining, result)) return true;
      result.runs.pop();
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 从候选牌中挑选 size 张, 使得 [anchor, ...picked] 能构成合法刻子 */
function pickForGroup(
  anchor: LogicalTile,
  candidates: LogicalTile[],
  size: number,
): LogicalTile[] | null {
  if (candidates.length < size) return null;

  // 贪心: 优先选同数字的非 Joker 牌, 再用 Joker 补充
  const nonJokers = candidates.filter(t => !isLogicalJoker(t));
  const jokers = candidates.filter(t => isLogicalJoker(t));

  const picked: LogicalTile[] = [];

  // 先加非 Joker (同数字)
  for (const t of nonJokers) {
    if (picked.length >= size) break;
    // 检查颜色不重复
    const colors = new Set([anchor, ...picked].map(p => p.logicalColor));
    if (!colors.has(t.logicalColor)) {
      picked.push(t);
    }
  }

  // 再用 Joker 补充
  while (picked.length < size && jokers.length > 0) {
    const j = jokers.shift()!;
    picked.push(j);
  }

  if (picked.length !== size) return null;

  // 最终检查: 颜色互异 + 总数 ≤ 4
  const allTiles = [anchor, ...picked];
  if (allTiles.length > 4) return null;
  const nonJokerTiles = allTiles.filter(t => !isLogicalJoker(t));
  const colors = new Set(nonJokerTiles.map(t => t.logicalColor));
  if (colors.size !== nonJokerTiles.length) return null;

  return picked;
}

/** 枚举包含 anchor 的所有可能顺子 */
function findPossibleRuns(
  anchor: LogicalTile,
  sameColor: LogicalTile[],
  availableJokers: LogicalTile[],
): LogicalTile[][] {
  const color = anchor.logicalColor as TileColor;
  const anchorNum = anchor.logicalNumber;

  // 收集同色的所有数字
  const numSet = new Set(sameColor.map(t => t.logicalNumber));
  const results: LogicalTile[][] = [];

  // 枚举顺子的范围 [start, end], 必须包含 anchorNum
  for (let start = Math.max(NUMBER_MIN, anchorNum - 12); start <= anchorNum; start++) {
    for (let end = anchorNum; end <= Math.min(NUMBER_MAX, start + 12); end++) {
      const len = end - start + 1;
      if (len < 3) continue;

      // 计算这个范围内需要哪些牌
      const needed: LogicalTile[] = [];
      let jokerNeeded = 0;

      for (let n = start; n <= end; n++) {
        if (n === anchorNum) {
          needed.push(anchor);
        } else if (numSet.has(n)) {
          const tile = sameColor.find(t => t.logicalNumber === n)!;
          needed.push(tile);
        } else {
          jokerNeeded++;
        }
      }

      if (jokerNeeded <= availableJokers.length) {
        const jokers = availableJokers.slice(0, jokerNeeded);
        results.push([...needed, ...jokers]);
      }
    }
  }

  return results;
}

/** 从 remaining 中移除指定的牌 (按 originalTile.id 匹配) */
function removeTiles(remaining: LogicalTile[], toRemove: LogicalTile[]): LogicalTile[] {
  const removeIds = new Set(toRemove.map(t => t.originalTile.id));
  return remaining.filter(t => !removeIds.has(t.originalTile.id));
}
