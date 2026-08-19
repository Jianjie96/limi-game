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

/**
 * 计算桌面牌组布局（流式布局，自动换行）。
 */
export function layoutBoard(
  groups: TileGroup[],
  config: BoardConfig,
  highlightedGroupIds: Set<string> = new Set(),
): BoardGroupSlot[] {
  const slots: BoardGroupSlot[] = [];
  const margin = 12;
  const left = config.left + margin;
  const right = config.screenW - config.right - margin;

  let curX = left;
  let curY = config.topY + 8;
  const rowHeight = TILE_HEIGHT + BOARD_GROUP_PADDING * 2;

  for (const group of groups) {
    const groupW =
      group.tiles.length * TILE_WIDTH +
      (group.tiles.length - 1) * TILE_GAP +
      BOARD_GROUP_PADDING * 2;
    const groupH = TILE_HEIGHT + BOARD_GROUP_PADDING * 2;

    if (curX + groupW > right && curX > left) {
      curX = left;
      curY += rowHeight + BOARD_GROUP_GAP;
    }

    if (curY + groupH > config.bottomY) break;

    const groupBounds = { x: curX, y: curY, w: groupW, h: groupH };
    const tileSlots: BoardTileSlot[] = [];

    for (let i = 0; i < group.tiles.length; i++) {
      const lt = group.tiles[i];
      tileSlots.push({
        logicalTile: lt,
        groupId: group.id,
        index: i,
        opts: {
          x: curX + BOARD_GROUP_PADDING + i * (TILE_WIDTH + TILE_GAP),
          y: curY + BOARD_GROUP_PADDING,
          highlighted: highlightedGroupIds.has(group.id),
        },
      });
    }

    slots.push({ groupId: group.id, group, bounds: groupBounds, tileSlots });
    curX += groupW + BOARD_GROUP_GAP;
  }

  return slots;
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