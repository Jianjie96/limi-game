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

/** 按 tile.id 查找牌 */
export function findTileById(tiles: Tile[], id: number): Tile | undefined {
  return tiles.find(t => t.id === id);
}

/** 按 originalTile.id 查找逻辑牌 */
export function findLogicalByOriginalId(tiles: readonly LogicalTile[], id: number): LogicalTile | undefined {
  return tiles.find(lt => lt.originalTile.id === id);
}

// ---------------------------------------------------------------------------
// 人读描述（错误提示用，避免暴露内部 ID）
// ---------------------------------------------------------------------------

const COLOR_NAMES: Record<string, string> = {
  red: '红',
  blue: '蓝',
  yellow: '黄',
  black: '黑',
};

/** 单张牌的人读描述：红 4 / 百搭。 */
export function describeTile(lt: LogicalTile | Tile): string {
  const color = 'logicalColor' in lt ? lt.logicalColor : lt.color;
  const number = 'logicalNumber' in lt ? lt.logicalNumber : lt.number;
  if (color === 'joker') return '百搭';
  return `${COLOR_NAMES[color] ?? color} ${number}`;
}

/** 牌组的人读描述：[红 3, 百搭, 红 5]。 */
export function describeGroup(tiles: readonly (LogicalTile | Tile)[]): string {
  return `[${tiles.map(describeTile).join(', ')}]`;
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
