// ============================================================================
// validate.ts — 牌组合法性校验（Run / Group / Joker）
// ============================================================================

import type { TileGroup, LogicalTile, Tile, ValidationError as VError } from './types';
import { isLogicalJoker, toLogical } from './tiles';

// ---------------------------------------------------------------------------
// 顺子 (Run) 校验
// ---------------------------------------------------------------------------

/**
 * 校验一组逻辑牌是否构成合法顺子。
 *
 * 规则:
 * - ≥3 张牌
 * - 所有非 Joker 牌必须同色
 * - 数字连续 (1 仅作最小, 不允许 12-13-1 环绕)
 * - Joker 可填补中间空缺或向两端延伸
 * - 不允许非 Joker 数字重复
 *
 * 算法:
 * 1. 分离 nonJokers / jokers
 * 2. 同色检查 + 去重 + 排序
 * 3. span = max - min + 1, 空位数 = span - nonJokers.length
 * 4. 剩余 Joker 可向两端延伸，但整个顺子必须落在 1..13 内：
 *    可用延伸位 = (min-1) + (13-max)，不够则不合法；totalLen = span + remainingJokers
 * 5. tiles.length === totalLen → 合法
 */
export function isValidRun(tiles: readonly LogicalTile[]): boolean {
  if (tiles.length < 3) return false;

  const nonJokers: LogicalTile[] = [];
  let jokerCount = 0;

  for (const t of tiles) {
    if (isLogicalJoker(t)) {
      jokerCount++;
    } else {
      nonJokers.push(t);
    }
  }

  // 纯 Joker 不能构成顺子 (至少需要 1 张真实牌确定颜色)
  if (nonJokers.length === 0) return false;

  // 所有非 Joker 必须同色
  const color = nonJokers[0].logicalColor;
  if (nonJokers.some(t => t.logicalColor !== color)) return false;

  // 按数字排序
  const sorted = nonJokers.map(t => t.logicalNumber).sort((a, b) => a - b);

  // 不允许重复数字
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) return false;
  }

  // 计算 span 和需要的填充
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const span = max - min + 1;
  const gaps = span - nonJokers.length; // 中间需要填补的空位数

  if (jokerCount < gaps) return false; // Joker 不够填补中间

  // 剩余 Joker 可以向两端延伸，但拉密牌最大只有 13：
  // 向下最多延到 1，向上最多延到 13，延伸位不够则不合法。
  const remainingJokers = jokerCount - gaps;
  const roomBelow = min - 1;
  const roomAbove = 13 - max;
  if (remainingJokers > roomBelow + roomAbove) return false;

  const totalLen = span + remainingJokers;

  return tiles.length === totalLen;
}

// ---------------------------------------------------------------------------
// 刻子 (Group) 校验
// ---------------------------------------------------------------------------

/**
 * 校验一组逻辑牌是否构成合法刻子。
 *
 * 规则:
 * - 3-4 张牌
 * - 所有非 Joker 牌必须同数字
 * - 颜色互异 (同一刻子不能出现重复颜色)
 * - Joker 可代替缺失颜色
 */
export function isValidGroupTiles(tiles: readonly LogicalTile[]): boolean {
  if (tiles.length < 3 || tiles.length > 4) return false;

  const nonJokers: LogicalTile[] = [];
  let jokerCount = 0;

  for (const t of tiles) {
    if (isLogicalJoker(t)) {
      jokerCount++;
    } else {
      nonJokers.push(t);
    }
  }

  // 所有非 Joker 必须同数字
  if (nonJokers.length > 0) {
    const num = nonJokers[0].logicalNumber;
    if (nonJokers.some(t => t.logicalNumber !== num)) return false;
  }

  // 非 Joker 颜色必须互异
  const colors = new Set(nonJokers.map(t => t.logicalColor));
  if (colors.size !== nonJokers.length) return false;

  // Joker 数量不能超过缺失颜色数 (4 - nonJokers.length)
  const missingColors = 4 - nonJokers.length;
  if (jokerCount > missingColors) return false;

  // 总数必须在 3-4 之间 (已由首行检查)
  return true;
}

// ---------------------------------------------------------------------------
// 牌组校验 (带类型检查)
// ---------------------------------------------------------------------------

/**
 * 校验一个 TileGroup 是否合法。
 * 同时检查 type 字段与实际牌内容是否匹配。
 */
export function isValidGroup(group: TileGroup): boolean {
  if (group.tiles.length < 3) return false;

  if (group.type === 'run') {
    return isValidRun(group.tiles);
  } else {
    return isValidGroupTiles(group.tiles);
  }
}

// ---------------------------------------------------------------------------
// 整桌校验
// ---------------------------------------------------------------------------

/**
 * 校验桌面上所有牌组是否合法。
 * 返回 { valid, errors }。
 */
export function validateBoard(board: readonly TileGroup[]): { valid: boolean; errors: VError[] } {
  const errors: VError[] = [];

  for (const group of board) {
    if (!isValidGroup(group)) {
      errors.push({
        code: 'INVALID_GROUP',
        message: `牌组 ${group.id} (${group.type}) 不合法`,
        groupId: group.id,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 辅助: 判断一张逻辑牌能否加入某个牌组
// ---------------------------------------------------------------------------

/**
 * 判断一张逻辑牌能否加入 Run 的头部或尾部 (扩展用)。
 * 返回 'head' | 'tail' | null。
 */
export function canExtendRun(
  run: readonly LogicalTile[],
  tile: LogicalTile,
): 'head' | 'tail' | null {
  if (run.length === 0) return null;

  // 确定 run 的颜色
  const nonJokers = run.filter(t => !isLogicalJoker(t));
  if (nonJokers.length === 0) return null; // 纯 Joker run 无法判断颜色
  const color = nonJokers[0].logicalColor;

  // 新牌必须同色 (除非它是 Joker)
  if (!isLogicalJoker(tile) && tile.logicalColor !== color) return null;

  const sorted = [...run].sort((a, b) => a.logicalNumber - b.logicalNumber);
  const minTile = sorted[0];
  const maxTile = sorted[sorted.length - 1];

  // 尝试加到头部
  if (isLogicalJoker(tile) || tile.logicalNumber === minTile.logicalNumber - 1) {
    const testTiles = [tile, ...run];
    if (isValidRun(testTiles)) return 'head';
  }

  // 尝试加到尾部
  if (isLogicalJoker(tile) || tile.logicalNumber === maxTile.logicalNumber + 1) {
    const testTiles = [...run, tile];
    if (isValidRun(testTiles)) return 'tail';
  }

  return null;
}

/**
 * 判断一张逻辑牌能否加入 Group。
 */
export function canAddToGroup(group: readonly LogicalTile[], tile: LogicalTile): boolean {
  const testTiles = [...group, tile];
  return isValidGroupTiles(testTiles);
}

// ---------------------------------------------------------------------------
// 选中牌实时校验：允许凑牌，只拦明显冲突
// ---------------------------------------------------------------------------

/**
 * 判断选中的一组牌是否可以凑成合法顺子/刻子。
 *
 * 策略（宽松，只拦「明显冲突」）:
 * - 少于 3 张时视为仍在凑牌，始终允许。
 * - ≥3 张时，尝试把它们拆分成若干合法顺子/刻子；允许残留不足 3 张的牌
 *   （这些牌后续可继续和新选中的牌 / 桌面牌组合）。
 * - 仅当至少 3 张牌互相冲突、无论如何都无法组成任何合法牌组时返回 false。
 */
export function canFormMelds(tiles: readonly Tile[]): boolean {
  const logicals = tiles.map(toLogical);
  if (logicals.length < 3) return true;
  return canSplitIntoMelds(logicals, new Map());
}

/**
 * 回溯拆分：尝试把 remaining 中的牌拆成合法顺子/刻子。
 * 残留少于 3 张即视为可接受（后续可继续凑牌）。
 */
function canSplitIntoMelds(
  remaining: readonly LogicalTile[],
  memo: Map<string, boolean>,
): boolean {
  if (remaining.length < 3) return true;

  const key = remaining
    .map(t => t.originalTile.id)
    .sort((a, b) => a - b)
    .join(',');
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const n = remaining.length;
  const total = 1 << n;
  // 收集所有可取出的合法牌组（顺子或刻子），优先尝试较长的以减少分支。
  const melds: LogicalTile[][] = [];

  for (let mask = 0; mask < total; mask++) {
    const bits = popcount(mask);
    if (bits < 3) continue;
    const subset = selectByMask(remaining, mask);
    if (isValidRun(subset) || isValidGroupTiles(subset)) {
      melds.push(subset);
    }
  }

  melds.sort((a, b) => b.length - a.length);

  let result = false;
  for (const meld of melds) {
    const used = new Set(meld.map(t => t.originalTile.id));
    const rest = remaining.filter(t => !used.has(t.originalTile.id));
    if (canSplitIntoMelds(rest, memo)) {
      result = true;
      break;
    }
  }

  memo.set(key, result);
  return result;
}

/** 计算整数二进制表示中 1 的个数 */
function popcount(x: number): number {
  let count = 0;
  while (x > 0) {
    x &= x - 1;
    count++;
  }
  return count;
}

/** 按位掩码从数组中取出子集 */
function selectByMask<T>(arr: readonly T[], mask: number): T[] {
  const result: T[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (mask & (1 << i)) result.push(arr[i]);
  }
  return result;
}
