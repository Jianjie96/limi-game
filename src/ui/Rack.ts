// ============================================================================
// Rack.ts — 牌架布局 + 命中检测（纯计算，与渲染解耦）
// ----------------------------------------------------------------------------
// 牌架支持自动换行：当一行放不下时折到下一行，每行在安全区内水平居中。
// ============================================================================

import type { Tile } from '../game/types';
import { TILE_WIDTH, TILE_HEIGHT, TILE_GAP, RACK_PADDING, SELECTED_LIFT } from './constants';
import { hitTestTile, type TileRenderOptions } from './renderer';

/** 牌架渲染配置 */
export interface RackConfig {
  screenW: number;
  screenH: number;
  y: number; // 牌架顶部 Y 坐标
  left: number; // 左侧安全区宽度
  right: number; // 右侧安全区宽度
}

/** 牌架中每张牌的位置信息 */
export interface RackTileSlot {
  tile: Tile;
  opts: TileRenderOptions;
  index: number;
}

/** 单张牌占用的水平步长（牌宽 + 间距） */
const STEP_X = TILE_WIDTH + TILE_GAP;
/** 行与行之间的垂直间距 */
const ROW_GAP_Y = 4;

/** 牌架内部可用于铺牌的水平宽度（去掉左右安全区与留白）。 */
function contentWidth(c: RackConfig): number {
  return c.screenW - c.left - c.right - RACK_PADDING * 2;
}

/** 每行最多能放多少张牌 */
export function rackTilesPerRow(config: RackConfig): number {
  const availableW = contentWidth(config);
  return Math.max(1, Math.floor((availableW + TILE_GAP) / STEP_X));
}

/** 铺满这些牌需要的行数 */
export function rackRowCount(tileCount: number, config: RackConfig): number {
  if (tileCount <= 0) return 0;
  return Math.ceil(tileCount / rackTilesPerRow(config));
}

/** 牌架背景所需高度（含上下留白） */
export function rackHeight(tileCount: number, config: RackConfig): number {
  const rows = rackRowCount(tileCount, config);
  if (rows <= 0) return RACK_PADDING * 2;
  return RACK_PADDING * 2 + rows * TILE_HEIGHT + (rows - 1) * ROW_GAP_Y;
}

/** 计算牌架布局（自动换行，逐行在安全区内居中） */
export function layoutRack(
  tiles: Tile[],
  config: RackConfig,
  selectedIds: Set<number>,
): RackTileSlot[] {
  const perRow = rackTilesPerRow(config);
  const leftEdge = config.left + RACK_PADDING;
  const width = contentWidth(config);

  return tiles.map((tile, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowTileCount = Math.min(perRow, tiles.length - row * perRow);
    const rowW = rowTileCount * TILE_WIDTH + (rowTileCount - 1) * TILE_GAP;
    const startX = leftEdge + (width - rowW) / 2;
    const selected = selectedIds.has(tile.id);

    return {
      tile,
      index: i,
      opts: {
        x: startX + col * STEP_X,
        y: config.y + RACK_PADDING + row * (TILE_HEIGHT + ROW_GAP_Y) - (selected ? SELECTED_LIFT : 0),
        selected,
      },
    };
  });
}

/** 命中检测：点击位置对应牌架中哪张牌 */
export function hitTestRack(
  px: number,
  py: number,
  slots: RackTileSlot[],
): RackTileSlot | null {
  for (let i = slots.length - 1; i >= 0; i--) {
    if (hitTestTile(px, py, slots[i].opts)) {
      return slots[i];
    }
  }
  return null;
}