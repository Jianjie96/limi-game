// ============================================================================
// Board.ts — 桌面牌组布局 + 命中检测（纯计算，与渲染解耦）
// ============================================================================

import type { TileGroup, LogicalTile } from '../game/types';
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_GAP,
  BOARD_GROUP_PADDING,
  BOARD_GROUP_GAP,
} from './constants';
import { hitTestTile, type TileRenderOptions } from './renderer';

/** 桌面渲染配置 */
export interface BoardConfig {
  screenW: number;
  screenH: number;
  topY: number;
  bottomY: number;
  left: number; // 左侧安全区宽度
  right: number; // 右侧安全区宽度
}

/** 桌面牌组的位置信息 */
export interface BoardGroupSlot {
  groupId: string;
  group: TileGroup;
  bounds: { x: number; y: number; w: number; h: number };
  tileSlots: BoardTileSlot[];
}

/** 桌面单张牌的位置信息 */
export interface BoardTileSlot {
  logicalTile: LogicalTile;
  groupId: string;
  index: number;
  opts: TileRenderOptions;
}

/** 组内理牌预览：在目标牌组的 gapIndex 处留空槽，excludeId 为被拖起的牌。 */
export interface BoardGapPreview {
  groupId: string;
  excludeId: number;
  gapIndex: number;
}

/** 单个牌组占用的高度（单行，含上下内边距；组内多行时高度随行数增长） */
export const BOARD_ROW_HEIGHT = TILE_HEIGHT + BOARD_GROUP_PADDING * 2;

/**
 * 计算桌面牌组布局（流式布局，自动换行）。
 * 牌组之间放不下时换行；单个牌组内牌数过多（如 13 张满顺子）超出可用宽度时，
 * 组内也按可用宽度换行，盒子高度随行数增长。
 *
 * @param scale 牌面缩放系数。当桌面内容超出可视区域时，可按此系数整体缩放，
 *              保证所有牌组都落在可用高度内，避免与牌架重叠。
 * @param gapPreview 组内理牌预览：目标牌组排除被拖牌并在 gapIndex 留空槽，
 *              槽位数与完整布局一致，组宽不变，其余牌组不重排。
 */
export function layoutBoard(
  groups: TileGroup[],
  config: BoardConfig,
  highlightedGroupIds: Set<string> = new Set(),
  scale = 1,
  gapPreview?: BoardGapPreview,
): BoardGroupSlot[] {
  const slots: BoardGroupSlot[] = [];
  const margin = 12;
  const left = config.left + margin;
  const right = config.screenW - config.right - margin;

  const tw = TILE_WIDTH * scale;
  const th = TILE_HEIGHT * scale;
  const pad = BOARD_GROUP_PADDING * scale;
  const gap = TILE_GAP * scale;
  const groupGap = BOARD_GROUP_GAP * scale;

  // 组内每行最多槽位：受可用宽度约束；极端窄屏也至少 1 个（允许单槽溢出）。
  const availW = Math.max(right - left, tw + pad * 2);
  const perRow = Math.max(1, Math.floor((availW - pad * 2 + gap) / (tw + gap)));

  let curX = left;
  let curY = config.topY + 8;
  let rowMaxH = 0; // 当前行内最高组的高度（换行推进用，兼容单行/多行组混排）

  for (const group of groups) {
    const gapForGroup = gapPreview && gapPreview.groupId === group.id ? gapPreview : null;
    // 预览时排除被拖牌并计入占位槽，组宽与完整布局一致。
    const tiles = gapForGroup
      ? group.tiles.filter((lt) => lt.originalTile.id !== gapForGroup.excludeId)
      : group.tiles;
    const total = tiles.length + (gapForGroup ? 1 : 0);

    // 组内换行：槽位按行折叠，盒子宽高随之变化（单行时与原布局完全一致）。
    const cols = Math.min(total, perRow);
    const rows = total > 0 ? Math.ceil(total / perRow) : 1;
    const groupW = cols * tw + (cols - 1) * gap + pad * 2;
    const groupH = rows * th + (rows - 1) * gap + pad * 2;

    // 放不下则换行（当前行已有内容时才换，避免单组过宽死循环）；
    // 按当前行最高组推进纵坐标，避免前一行多行组被新行覆盖。
    if (curX + groupW > right && curX > left) {
      curX = left;
      curY += Math.max(rowMaxH, groupH) + groupGap;
      rowMaxH = 0;
    }

    const groupBounds = { x: curX, y: curY, w: groupW, h: groupH };
    const tileSlots: BoardTileSlot[] = [];

    for (let i = 0; i < tiles.length; i++) {
      const lt = tiles[i];
      const v = gapForGroup && i >= gapForGroup.gapIndex ? i + 1 : i; // 虚拟位置（跳过占位槽）
      const row = Math.floor(v / perRow);
      const col = v % perRow;
      tileSlots.push({
        logicalTile: lt,
        groupId: group.id,
        index: i, // 排除后序列的索引，与 moveTileWithinGroup 的 toIndex 语义一致
        opts: {
          x: curX + pad + col * (tw + gap),
          y: curY + pad + row * (th + gap),
          scale,
          highlighted: highlightedGroupIds.has(group.id),
        },
      });
    }

    slots.push({ groupId: group.id, group, bounds: groupBounds, tileSlots });
    curX += groupW + groupGap;
    rowMaxH = Math.max(rowMaxH, groupH);
  }

  return slots;
}

/** 计算已布局牌组占用的内容高度（顶部留白 + 最后一行下边缘）。 */
export function boardContentHeight(slots: BoardGroupSlot[], topY: number): number {
  if (slots.length === 0) return 0;
  const last = slots[slots.length - 1];
  const contentBottom = last.bounds.y + last.bounds.h;
  return Math.max(0, contentBottom - topY);
}

/** 命中检测：点击位置对应桌面哪张牌 */
export function hitTestBoard(
  px: number,
  py: number,
  slots: BoardGroupSlot[],
): BoardTileSlot | null {
  for (let i = slots.length - 1; i >= 0; i--) {
    const group = slots[i];
    for (let j = group.tileSlots.length - 1; j >= 0; j--) {
      const tileSlot = group.tileSlots[j];
      if (hitTestTile(px, py, tileSlot.opts)) {
        return tileSlot;
      }
    }
  }
  return null;
}

/** 命中检测：点击位置对应哪个牌组 */
export function hitTestBoardGroup(
  px: number,
  py: number,
  slots: BoardGroupSlot[],
): BoardGroupSlot | null {
  for (let i = slots.length - 1; i >= 0; i--) {
    const { x, y, w, h } = slots[i].bounds;
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      return slots[i];
    }
  }
  return null;
}