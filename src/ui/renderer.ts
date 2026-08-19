// ============================================================================
// renderer.ts — 原生 Canvas 2D 绘制（牌面绘制 + 几何命中检测）
// ----------------------------------------------------------------------------
// 不依赖任何第三方框架，直接用 wx 提供的 2D 上下文按逻辑像素绘制。
// 牌面图形以 (0,0) 为左上角、按原始尺寸绘制，位置与缩放通过 translate/scale 设置。
// 命中检测（getTileBounds / hitTestTile）为纯计算，供 Rack/Board 布局模块复用。
// ============================================================================

import type { Tile, LogicalTile, TileColor, GroupType } from '../game/types';
import { TILE_COLORS } from '../game/types';
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_RADIUS,
  TILE_COLORS_RGB,
  TILE_BG,
  TILE_BG_SELECTED,
  TILE_BORDER,
  JOKER_BG,
  JOKER_STAR_COLOR,
  FONT_FAMILY,
  FONT_SIZE_TILE,
  FONT_SIZE_TILE_SMALL,
} from './constants';

/** 牌面渲染选项（坐标为逻辑像素） */
export interface TileRenderOptions {
  x: number;
  y: number;
  selected?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  scale?: number;
  showLabel?: string;
}

// ---------------------------------------------------------------------------
// 几何 / 命中检测
// ---------------------------------------------------------------------------

/** 获取牌的包围盒（逻辑坐标） */
export function getTileBounds(opts: TileRenderOptions): { x: number; y: number; w: number; h: number } {
  const scale = opts.scale ?? 1;
  return {
    x: opts.x,
    y: opts.y,
    w: TILE_WIDTH * scale,
    h: TILE_HEIGHT * scale,
  };
}

/** 判断点是否在牌内 */
export function hitTestTile(px: number, py: number, opts: TileRenderOptions): boolean {
  const { x, y, w, h } = getTileBounds(opts);
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

// ---------------------------------------------------------------------------
// 绘制辅助
// ---------------------------------------------------------------------------

/** 圆角矩形路径（不 fill/stroke，供调用方自行处理样式） */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function setFont(ctx: CanvasRenderingContext2D, size: number, bold: boolean): void {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
}

// ---------------------------------------------------------------------------
// 牌面绘制
// ---------------------------------------------------------------------------

/** 绘制一张数字牌 */
export function drawNumberTile(
  ctx: CanvasRenderingContext2D,
  color: TileColor,
  number: number,
  opts: TileRenderOptions,
): void {
  const scale = opts.scale ?? 1;
  const { selected, highlighted, dimmed } = opts;

  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.scale(scale, scale);
  if (dimmed) ctx.globalAlpha = 0.4;

  ctx.fillStyle = selected ? TILE_BG_SELECTED : TILE_BG;
  ctx.strokeStyle = highlighted ? '#FFC107' : TILE_BORDER;
  ctx.lineWidth = highlighted ? 2 : 1;
  roundRectPath(ctx, 0, 0, TILE_WIDTH, TILE_HEIGHT, TILE_RADIUS);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = TILE_COLORS_RGB[color];
  setFont(ctx, number >= 10 ? FONT_SIZE_TILE_SMALL : FONT_SIZE_TILE, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), TILE_WIDTH / 2, TILE_HEIGHT / 2);

  if (scale >= 1) {
    setFont(ctx, 10, false);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(number), 3, 2);
  }

  ctx.restore();
}

/**
 * 绘制一张 Joker 牌。
 * - 普通 Joker：显示 "JOKER" 与星星。
 * - 桌面上代表某张牌的 Joker：显示其代表的颜色/数字 + 星星标记。
 */
export function drawJokerTile(
  ctx: CanvasRenderingContext2D,
  opts: TileRenderOptions,
  isLogical = false,
  logicalColor?: TileColor,
  logicalNumber?: number,
): void {
  const scale = opts.scale ?? 1;
  const { selected, highlighted, dimmed } = opts;

  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.scale(scale, scale);
  if (dimmed) ctx.globalAlpha = 0.4;

  ctx.fillStyle = selected ? TILE_BG_SELECTED : JOKER_BG;
  ctx.strokeStyle = highlighted ? '#FFC107' : TILE_COLORS_RGB.joker;
  ctx.lineWidth = highlighted ? 2 : 1.5;
  roundRectPath(ctx, 0, 0, TILE_WIDTH, TILE_HEIGHT, TILE_RADIUS);
  ctx.fill();
  ctx.stroke();

  if (isLogical && logicalColor && logicalNumber) {
    ctx.fillStyle = TILE_COLORS_RGB[logicalColor];
    setFont(ctx, logicalNumber >= 10 ? FONT_SIZE_TILE_SMALL : FONT_SIZE_TILE, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(logicalNumber), TILE_WIDTH / 2, TILE_HEIGHT / 2);

    ctx.fillStyle = JOKER_STAR_COLOR;
    setFont(ctx, 10, false);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('★', TILE_WIDTH - 2, 2);
  } else {
    ctx.fillStyle = JOKER_STAR_COLOR;
    setFont(ctx, 12, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JOKER', TILE_WIDTH / 2, TILE_HEIGHT / 2 - 4);

    setFont(ctx, 16, false);
    ctx.fillText('★', TILE_WIDTH / 2, TILE_HEIGHT / 2 + 12);
  }

  ctx.restore();
}

/** 绘制一张逻辑牌（自动判断是数字牌还是 Joker） */
export function drawLogicalTile(ctx: CanvasRenderingContext2D, lt: LogicalTile, opts: TileRenderOptions): void {
  const isJoker = lt.originalTile.color === 'joker';
  if (isJoker) {
    const hasLogical = lt.logicalColor !== 'joker';
    drawJokerTile(ctx, opts, hasLogical, lt.logicalColor as TileColor, lt.logicalNumber);
  } else {
    drawNumberTile(ctx, lt.logicalColor as TileColor, lt.logicalNumber, opts);
  }
}

/**
 * 推断桌面牌组中某张 Joker 的「显示代表值」。
 * 仅用于渲染：根据 Joker 在组内的位置动态计算，不改动逻辑牌本身。
 * - 顺子：按存储顺序（显示顺序），左侧延伸取最小值、右侧延伸取最大值、中间取相邻填充值。
 * - 刻子：取缺失颜色、与组内数字一致。
 */
function inferJokerDisplayValue(
  groupType: GroupType,
  tiles: readonly LogicalTile[],
  jokerIndex: number,
): { color: TileColor; number: number } | null {
  const joker = tiles[jokerIndex];
  if (!joker || joker.originalTile.color !== 'joker') return null;

  const isJokerTile = (lt: LogicalTile) => lt.originalTile.color === 'joker';
  const nonJokers = tiles.filter(t => !isJokerTile(t));
  if (nonJokers.length === 0) return null;

  if (groupType === 'group') {
    const number = nonJokers[0].logicalNumber;
    const used = new Set(nonJokers.map(t => t.logicalColor as TileColor));
    for (const c of TILE_COLORS) {
      if (!used.has(c)) return { color: c, number };
    }
    return null;
  }

  // Run：以存储顺序（显示顺序）推断，位置是决定代表值的唯一依据。
  const color = nonJokers[0].logicalColor as TileColor;

  let left: LogicalTile | null = null;
  for (let i = jokerIndex - 1; i >= 0; i--) {
    if (!isJokerTile(tiles[i])) {
      left = tiles[i];
      break;
    }
  }
  let right: LogicalTile | null = null;
  for (let i = jokerIndex + 1; i < tiles.length; i++) {
    if (!isJokerTile(tiles[i])) {
      right = tiles[i];
      break;
    }
  }

  if (left && right) {
    return { color, number: left.logicalNumber + 1 };
  }
  if (right) {
    let jokers = 0;
    for (let i = jokerIndex; i < tiles.length && isJokerTile(tiles[i]); i++) jokers++;
    return { color, number: right.logicalNumber - jokers };
  }
  if (left) {
    let jokers = 0;
    for (let i = jokerIndex; i >= 0 && isJokerTile(tiles[i]); i--) jokers++;
    return { color, number: left.logicalNumber + jokers };
  }
  return null;
}

/** 绘制桌面牌组中的一张牌；Joker 按位置推断出的代表值显示（带星标）。 */
export function drawBoardTile(
  ctx: CanvasRenderingContext2D,
  groupType: GroupType,
  groupTiles: readonly LogicalTile[],
  index: number,
  opts: TileRenderOptions,
): void {
  const lt = groupTiles[index];
  if (lt.originalTile.color === 'joker') {
    const d = inferJokerDisplayValue(groupType, groupTiles, index);
    if (d) {
      drawJokerTile(ctx, opts, true, d.color, d.number);
    } else {
      drawJokerTile(ctx, opts, false);
    }
  } else {
    drawNumberTile(ctx, lt.logicalColor as TileColor, lt.logicalNumber, opts);
  }
}

/** 绘制一张物理牌 */
export function drawPhysicalTile(ctx: CanvasRenderingContext2D, tile: Tile, opts: TileRenderOptions): void {
  if (tile.color === 'joker') {
    drawJokerTile(ctx, opts, false);
  } else {
    drawNumberTile(ctx, tile.color as TileColor, tile.number, opts);
  }
}