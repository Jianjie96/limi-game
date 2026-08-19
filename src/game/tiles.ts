// ============================================================================
// tiles.ts — 牌组创建、洗牌、牌面工具函数
// ============================================================================

import type { Tile, TileColor, LogicalTile, GroupType } from './types';
import { TILE_COLORS, NUMBER_MIN, NUMBER_MAX } from './types';

// ---------------------------------------------------------------------------
// 牌组创建
// ---------------------------------------------------------------------------

/**
 * 创建完整的 106 张牌。
 * - 4 色 × 13 数 × 2 副 = 104 张数字牌
 * - 2 张 Joker
 */
export function createFullSet(): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;

  // 两副牌
  for (let copy = 0; copy < 2; copy++) {
    for (const color of TILE_COLORS) {
      for (let num = NUMBER_MIN; num <= NUMBER_MAX; num++) {
        tiles.push({ id: id++, color, number: num });
      }
    }
  }

  // 2 张 Joker
  tiles.push({ id: id++, color: 'joker', number: 0 });
  tiles.push({ id: id++, color: 'joker', number: 0 });

  return tiles;
}

// ---------------------------------------------------------------------------
// 洗牌 (Fisher-Yates)
// ---------------------------------------------------------------------------

/**
 * 原地洗牌，返回同一引用（方便链式调用）。
 */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// 牌面工具函数
// ---------------------------------------------------------------------------

/** 判断是否为 Joker */
export function isJoker(tile: Tile): boolean {
  return tile.color === 'joker';
}

/** 判断逻辑牌是否为 Joker（在桌面上以 Joker 身份存在） */
export function isLogicalJoker(lt: LogicalTile): boolean {
  return lt.logicalColor === 'joker' && lt.logicalNumber === 0;
}

/** 获取牌的分值 (用于计分) */
export function getTileValue(tile: Tile | LogicalTile): number {
  if ('originalTile' in tile) {
    // LogicalTile
    if (tile.logicalColor === 'joker') return 30;
    return tile.logicalNumber;
  }
  // Tile
  if (tile.color === 'joker') return 30;
  return tile.number;
}

/** 创建逻辑牌 (数字牌直接使用物理信息) */
export function toLogical(tile: Tile): LogicalTile {
  return {
    originalTile: tile,
    logicalColor: tile.color as TileColor | 'joker',
    logicalNumber: tile.number,
  };
}

/** 创建 Joker 代表某张牌的逻辑牌 */
export function createJokerLogical(representColor: TileColor, representNumber: number): LogicalTile {
  // 注意: originalTile 需要在调用时绑定实际的 Joker 物理牌
  // 这里仅创建颜色/数字模板，调用方需要替换 originalTile
  return {
    originalTile: { id: -1, color: 'joker', number: 0 }, // placeholder
    logicalColor: representColor,
    logicalNumber: representNumber,
  };
}

/** 按 tile.id 查找牌 */
export function findTileById(tiles: Tile[], id: number): Tile | undefined {
  return tiles.find(t => t.id === id);
}

/** 按 originalTile.id 查找逻辑牌 */
export function findLogicalByOriginalId(tiles: readonly LogicalTile[], id: number): LogicalTile | undefined {
  return tiles.find(lt => lt.originalTile.id === id);
}

/**
 * 判断一组牌更适合组成「顺子」还是「刻子」。
 * - 非 Joker 全同数字 → 刻子 (group)
 * - 否则非 Joker 全同色   → 顺子 (run)
 * - 无法判断时默认刻子。
 */
export function detectGroupType(tiles: readonly Tile[]): GroupType {
  const nonJokers = tiles.filter(t => t.color !== 'joker');
  const numbers = new Set(nonJokers.map(t => t.number));
  if (numbers.size === 1) return 'group';

  const colors = new Set(nonJokers.map(t => t.color));
  if (colors.size === 1) return 'run';

  return 'group';
}

/**
 * 推断 Joker 在顺子中应该代表的牌。
 * 根据顺子中其他牌的颜色和 Joker 位置推断。
 * 返回 { color, number } 或 null。
 */
export function inferJokerInRun(
  tiles: readonly LogicalTile[],
  jokerIndex: number,
): { color: TileColor; number: number } | null {
  const joker = tiles[jokerIndex];
  if (!isLogicalJoker(joker)) return null;

  const nonJokers = tiles.filter(t => !isLogicalJoker(t));
  if (nonJokers.length === 0) return null;

  const color = nonJokers[0].logicalColor as TileColor;
  const sorted = tiles.map((t, i) => ({ t, i })).sort((a, b) => {
    const na = isLogicalJoker(a.t) ? -1 : a.t.logicalNumber;
    const nb = isLogicalJoker(b.t) ? -1 : b.t.logicalNumber;
    return na - nb;
  });

  // 找到 joker 在排序中的位置
  let jokerPos = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].i === jokerIndex) {
      jokerPos = i;
      break;
    }
  }

  // 计算 joker 应该代表的数字
  const nonJokerNumbers = nonJokers.map(t => t.logicalNumber).sort((a, b) => a - b);
  const min = nonJokerNumbers[0];
  const max = nonJokerNumbers[nonJokerNumbers.length - 1];

  // 如果 joker 在最前端
  if (jokerPos === 0) {
    return { color, number: Math.max(NUMBER_MIN, min - 1) };
  }
  // 如果 joker 在最后端
  if (jokerPos === tiles.length - 1) {
    return { color, number: Math.min(NUMBER_MAX, max + 1) };
  }

  // joker 在中间: 找到前后牌的数字
  const prev = tiles[jokerPos - 1];
  const next = tiles[jokerPos + 1];
  if (!isLogicalJoker(prev) && !isLogicalJoker(next)) {
    const expected = prev.logicalNumber + 1;
    if (expected === next.logicalNumber) {
      return { color, number: expected };
    }
  }

  // 兜底: 返回同色, 数字为最小可用
  return { color, number: min - 1 >= NUMBER_MIN ? min - 1 : min + 1 };
}

/**
 * 推断 Joker 在刻子中应该代表的牌。
 * 根据刻子中其他牌的数字和缺失颜色推断。
 */
export function inferJokerInGroup(
  tiles: readonly LogicalTile[],
  jokerIndex: number,
): { color: TileColor; number: number } | null {
  const joker = tiles[jokerIndex];
  if (!isLogicalJoker(joker)) return null;

  const nonJokers = tiles.filter(t => !isLogicalJoker(t));
  if (nonJokers.length === 0) return null;

  const number = nonJokers[0].logicalNumber;
  const existingColors = new Set(nonJokers.map(t => t.logicalColor as TileColor));

  // 找到缺失的颜色
  for (const c of TILE_COLORS) {
    if (!existingColors.has(c)) {
      return { color: c, number };
    }
  }

  return { color: TILE_COLORS[0], number };
}

/**
 * 更新 Joker 逻辑牌的逻辑表示。
 * 返回新的 LogicalTile (不可变更新)。
 */
export function updateJokerLogical(
  joker: LogicalTile,
  color: TileColor,
  number: number,
): LogicalTile {
  return {
    originalTile: joker.originalTile,
    logicalColor: color,
    logicalNumber: number,
  };
}

/**
 * 根据牌组类型推断 Joker 的逻辑表示并更新牌组中所有 Joker。
 * 返回更新后的牌组。
 */
export function inferAndUpdateJokers(
  tiles: readonly LogicalTile[],
  groupType: GroupType,
): LogicalTile[] {
  const result = [...tiles];
  for (let i = 0; i < result.length; i++) {
    if (isLogicalJoker(result[i])) {
      if (groupType === 'run') {
        const inferred = inferJokerInRun(result, i);
        if (inferred) {
          result[i] = updateJokerLogical(result[i], inferred.color, inferred.number);
        }
      } else {
        const inferred = inferJokerInGroup(result, i);
        if (inferred) {
          result[i] = updateJokerLogical(result[i], inferred.color, inferred.number);
        }
      }
    }
  }
  return result;
}
