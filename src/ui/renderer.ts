// ============================================================================
// renderer.ts — 原生 Canvas 2D 绘制（卡通风牌面 + 几何命中检测）
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
  TILE_BG_BOTTOM,
  TILE_BG_SELECTED,
  TILE_BORDER,
  TILE_SHADOW,
  GOLD,
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

/** 垂直线性渐变（卡通牌身 / 按钮常用） */
function verticalGradient(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  top: string,
  bottom: string,
): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/**
 * 绘制卡通牌身：投影 → 渐变牌面 → 彩色粗边框 → 顶部高光。
 * selected 时叠加金色选中圈。
 */
function drawTileBody(
  ctx: CanvasRenderingContext2D,
  accent: string,
  opts: TileRenderOptions,
  baseBg: string = TILE_BG,
): void {
  const { selected, highlighted } = opts;

  // 卡通投影（偏移的深色圆角矩形，比 shadowBlur 更省性能）。
  ctx.fillStyle = TILE_SHADOW;
  roundRectPath(ctx, 1.5, 2.5, TILE_WIDTH, TILE_HEIGHT, TILE_RADIUS);
  ctx.fill();

  // 渐变牌身。
  ctx.fillStyle = verticalGradient(
    ctx,
    0,
    TILE_HEIGHT,
    selected ? TILE_BG_SELECTED : baseBg,
    selected ? '#FFE082' : TILE_BG_BOTTOM,
  );
  roundRectPath(ctx, 0, 0, TILE_WIDTH, TILE_HEIGHT, TILE_RADIUS);
  ctx.fill();

  // 彩色粗边框（卡通描边）。
  ctx.strokeStyle = highlighted ? GOLD : accent;
  ctx.lineWidth = highlighted ? 2.5 : 2;
  roundRectPath(ctx, 1, 1, TILE_WIDTH - 2, TILE_HEIGHT - 2, TILE_RADIUS - 1);
  ctx.stroke();

  // 选中金色外圈。
  if (selected) {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    roundRectPath(ctx, 0.5, 0.5, TILE_WIDTH - 1, TILE_HEIGHT - 1, TILE_RADIUS);
    ctx.stroke();
  }

  // 顶部高光（上釉质感）。
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRectPath(ctx, 3, 2.5, TILE_WIDTH - 6, TILE_HEIGHT * 0.32, TILE_RADIUS - 2);
  ctx.fill();
}

/** 带白色描边的卡通大数字（先描边后填充，醒目且与牌色融合）。 */
function drawCartoonNumber(ctx: CanvasRenderingContext2D, number: number, color: string, cx: number, cy: number): void {
  const size = number >= 10 ? FONT_SIZE_TILE_SMALL : FONT_SIZE_TILE;
  setFont(ctx, size, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#FFFFFF';
  ctx.strokeText(String(number), cx, cy);
  ctx.fillStyle = color;
  ctx.fillText(String(number), cx, cy);
}

/** 五角星路径 */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
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
  const { dimmed } = opts;

  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.scale(scale, scale);
  if (dimmed) ctx.globalAlpha = 0.4;

  drawTileBody(ctx, TILE_COLORS_RGB[color], opts);

  // 中央大号卡通数字。
  drawCartoonNumber(ctx, number, TILE_COLORS_RGB[color], TILE_WIDTH / 2, TILE_HEIGHT / 2 + 3);

  // 左上角小数字 + 色点（放大时才绘制，缩小牌保持干净）。
  if (scale >= 0.9) {
    ctx.fillStyle = TILE_COLORS_RGB[color];
    setFont(ctx, 9, true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(number), 4.5, 4);
    ctx.beginPath();
    ctx.arc(TILE_WIDTH - 7, TILE_HEIGHT - 7, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * 绘制一张 Joker 牌。
 * - 普通 Joker：紫色渐变牌身 + 大小星星 + "JOKER" 字样。
 * - 桌面上代表某张牌的 Joker：显示其代表的颜色/数字 + 星星角标。
 */
export function drawJokerTile(
  ctx: CanvasRenderingContext2D,
  opts: TileRenderOptions,
  isLogical = false,
  logicalColor?: TileColor,
  logicalNumber?: number,
): void {
  const scale = opts.scale ?? 1;
  const { dimmed } = opts;

  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.scale(scale, scale);
  if (dimmed) ctx.globalAlpha = 0.4;

  drawTileBody(ctx, TILE_COLORS_RGB.joker, opts, '#F6EFFC');

  if (isLogical && logicalColor && logicalNumber) {
    // 代表牌：中央按代表值显示，右上角星星标记其 Joker 身份。
    drawCartoonNumber(ctx, logicalNumber, TILE_COLORS_RGB[logicalColor], TILE_WIDTH / 2, TILE_HEIGHT / 2 + 3);

    ctx.fillStyle = '#EFC26B';
    starPath(ctx, TILE_WIDTH - 9, 9, 5.5, 2.4);
    ctx.fill();
    ctx.strokeStyle = TILE_COLORS_RGB.joker;
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // 本体 Joker：大星星 + 环绕小星 + 文字。
    ctx.fillStyle = '#EFC26B';
    starPath(ctx, TILE_WIDTH / 2, TILE_HEIGHT / 2 - 3, 11, 4.8);
    ctx.fill();
    ctx.strokeStyle = TILE_COLORS_RGB.joker;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = TILE_COLORS_RGB.joker;
    starPath(ctx, TILE_WIDTH / 2 - 11, TILE_HEIGHT / 2 - 13, 3.4, 1.5);
    ctx.fill();
    starPath(ctx, TILE_WIDTH / 2 + 11, TILE_HEIGHT / 2 - 11, 2.8, 1.2);
    ctx.fill();

    ctx.fillStyle = TILE_COLORS_RGB.joker;
    setFont(ctx, 8.5, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JOKER', TILE_WIDTH / 2, TILE_HEIGHT - 11);
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

  // Run：依据非 Joker 的真实数字区间反推代表值，与存储顺序解耦。
  // 组内顺序只决定 Joker 位于「左端 / 中间 / 右端」，再用区间两端正确回推。
  const color = nonJokers[0].logicalColor as TileColor;
  const nums = nonJokers.map(t => t.logicalNumber).sort((a, b) => a - b);
  const min = nums[0];
  const max = nums[nums.length - 1];

  const hasBefore = tiles.slice(0, jokerIndex).some(t => !isJokerTile(t));
  const hasAfter = tiles.slice(jokerIndex + 1).some(t => !isJokerTile(t));

  if (hasBefore && hasAfter) {
    // 中间填充：以左侧紧邻非 Joker 为基准，向左连续 Joker 依次 +1。
    let left: LogicalTile | null = null;
    for (let i = jokerIndex - 1; i >= 0; i--) {
      if (!isJokerTile(tiles[i])) {
        left = tiles[i];
        break;
      }
    }
    let jokersBefore = 0;
    for (let i = jokerIndex; i >= 0 && isJokerTile(tiles[i]); i--) jokersBefore++;
    return { color, number: (left?.logicalNumber ?? min) + jokersBefore };
  }
  if (hasAfter) {
    // 左端延伸：min 向小延伸，连续 Joker 依次 -1。
    let jokers = 0;
    for (let i = jokerIndex; i < tiles.length && isJokerTile(tiles[i]); i++) jokers++;
    return { color, number: min - jokers };
  }
  if (hasBefore) {
    // 右端延伸：max 向大延伸，连续 Joker 依次 +1。
    let jokers = 0;
    for (let i = jokerIndex; i >= 0 && isJokerTile(tiles[i]); i--) jokers++;
    return { color, number: max + jokers };
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
