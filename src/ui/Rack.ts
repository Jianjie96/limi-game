// ============================================================================
// Rack.ts — 牌架布局 + 命中检测（纯计算，与渲染解耦）
// ----------------------------------------------------------------------------
// 牌架支持自动换行：当一行放不下时折到下一行，每行在安全区内水平居中。
// ============================================================================

import type { Tile } from '../game/types';
import { TILE_WIDTH, TILE_HEIGHT, TILE_GAP, RACK_PADDING, RACK_MIN_HEIGHT, SELECTED_LIFT } from './constants';
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

/** 牌架区域所需高度（含上下留白）：不低于最小高度，避免牌少时退化成细条。 */
export function rackHeight(tileCount: number, config: RackConfig): number {
  const rows = rackRowCount(tileCount, config);
  const content = rows <= 0 ? 0 : rows * TILE_HEIGHT + (rows - 1) * ROW_GAP_Y;
  return Math.max(RACK_MIN_HEIGHT, RACK_PADDING * 2 + content);
}

/** 计算牌架布局（自动换行，逐行在安全区内居中）。
 *  fromBoardIds：本回合从桌面拿回的牌，渲染时加琥珀色标记。 */
export function layoutRack(
  tiles: Tile[],
  config: RackConfig,
  selectedIds: Set<number>,
  fromBoardIds?: Set<number>,
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
        fromBoard: fromBoardIds?.has(tile.id),
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

/**
 * 理牌预览布局：排除被拖拽的牌，并在 gapIndex（排除后序列中的位置）
 * 留出一个空槽，实时展示牌将插入的位置。
 * 行宽按含占位的完整数量计算，与提交后的布局一致，避免行结构跳动。
 */
export function layoutRackWithGap(
  tiles: Tile[],
  excludeId: number,
  gapIndex: number,
  config: RackConfig,
  selectedIds: Set<number>,
  fromBoardIds?: Set<number>,
): RackTileSlot[] {
  const filtered = tiles.filter((t) => t.id !== excludeId);
  const total = filtered.length + 1; // 含占位的虚拟数量
  const perRow = rackTilesPerRow(config);
  const leftEdge = config.left + RACK_PADDING;
  const width = contentWidth(config);

  const slots: RackTileSlot[] = [];
  filtered.forEach((tile, i) => {
    const v = i < gapIndex ? i : i + 1; // 虚拟位置（跳过占位槽）
    const row = Math.floor(v / perRow);
    const col = v % perRow;
    const rowTileCount = Math.min(perRow, total - row * perRow);
    const rowW = rowTileCount * TILE_WIDTH + (rowTileCount - 1) * TILE_GAP;
    const startX = leftEdge + (width - rowW) / 2;
    const selected = selectedIds.has(tile.id);

    slots.push({
      tile,
      index: i, // 排除后序列的索引，与 reorderRackTile 的 toIndex 语义一致
      opts: {
        x: startX + col * STEP_X,
        y: config.y + RACK_PADDING + row * (TILE_HEIGHT + ROW_GAP_Y) - (selected ? SELECTED_LIFT : 0),
        selected,
        fromBoard: fromBoardIds?.has(tile.id),
      },
    });
  });
  return slots;
}

/**
 * 拖拽预览时，由手指位置求插入索引（排除后序列中的位置）。
 * 基于含占位的完整虚拟布局计算，结果与当前缺口位置无关，不会抖动。
 */
export function rackGapIndexAt(
  px: number,
  py: number,
  filteredCount: number,
  config: RackConfig,
): number {
  if (filteredCount <= 0) return 0;
  const perRow = rackTilesPerRow(config);
  const total = filteredCount + 1;
  const rows = Math.max(1, Math.ceil(total / perRow));

  // 取离手指最近的一行。
  let row = 0;
  let best = Infinity;
  for (let r = 0; r < rows; r++) {
    const cy = config.y + RACK_PADDING + r * (TILE_HEIGHT + ROW_GAP_Y) + TILE_HEIGHT / 2;
    const d = Math.abs(py - cy);
    if (d < best) {
      best = d;
      row = r;
    }
  }

  const rowCount = Math.min(perRow, total - row * perRow);
  const leftEdge = config.left + RACK_PADDING;
  const width = contentWidth(config);
  const rowW = rowCount * TILE_WIDTH + (rowCount - 1) * TILE_GAP;
  const startX = leftEdge + (width - rowW) / 2;

  // 手指越过几个槽位中心 → 插入到第几个位置。
  let local = 0;
  for (let c = 0; c < rowCount; c++) {
    if (px > startX + c * STEP_X + TILE_WIDTH / 2) local = c + 1;
  }
  return Math.max(0, Math.min(row * perRow + local, filteredCount));
}