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
  /** 本回合从桌面拿进牌架的牌（非本人手牌）：中央数字放大加粗，出牌校验失败时供用户辨认。 */
  fromBoard?: boolean;
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

/** 带白色描边的卡通大数字（先描边后填充，醒目且与牌色融合）。
 *  italic：斜体（「从桌面拿回」的牌用斜体 + 双下划线以示区分）。 */
function drawCartoonNumber(
  ctx: CanvasRenderingContext2D,
  number: number,
  color: string,
  cx: number,
  cy: number,
  italic = false,
): void {
  const size = number >= 10 ? FONT_SIZE_TILE_SMALL : FONT_SIZE_TILE;
  ctx.font = `${italic ? 'italic ' : ''}bold ${size}px ${FONT_FAMILY}`;
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

  // 中央大号卡通数字；「从桌面拿回」的牌用斜体，与本人手牌区分。
  drawCartoonNumber(
    ctx,
    number,
    TILE_COLORS_RGB[color],
    TILE_WIDTH / 2,
    TILE_HEIGHT / 2 + 3,
    !!opts.fromBoard,
  );

  // 「借来的牌」：数字下方两条牌色下划线。
  if (opts.fromBoard) {
    ctx.strokeStyle = TILE_COLORS_RGB[color];
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const x0 = TILE_WIDTH / 2 - 11;
    const x1 = TILE_WIDTH / 2 + 11;
    ctx.beginPath();
    ctx.moveTo(x0, TILE_HEIGHT / 2 + 16);
    ctx.lineTo(x1, TILE_HEIGHT / 2 + 16);
    ctx.moveTo(x0, TILE_HEIGHT / 2 + 20);
    ctx.lineTo(x1, TILE_HEIGHT / 2 + 20);
    ctx.stroke();
  }

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
    // 「借来的」Joker：JOKER 文字用斜体，与本人手牌区分。
    if (opts.fromBoard) ctx.font = `italic bold 8.5px ${FONT_FAMILY}`;
    else setFont(ctx, 8.5, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JOKER', TILE_WIDTH / 2, TILE_HEIGHT - 11);

    // 「借来的」Joker：文字下方两条紫色下划线（与数字牌的双下划线同款标记）。
    if (opts.fromBoard) {
      ctx.strokeStyle = TILE_COLORS_RGB.joker;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      const x0 = TILE_WIDTH / 2 - 11;
      const x1 = TILE_WIDTH / 2 + 11;
      ctx.beginPath();
      ctx.moveTo(x0, TILE_HEIGHT - 6);
      ctx.lineTo(x1, TILE_HEIGHT - 6);
      ctx.moveTo(x0, TILE_HEIGHT - 3);
      ctx.lineTo(x1, TILE_HEIGHT - 3);
      ctx.stroke();
    }
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
 * 仅用于渲染：不改动逻辑牌本身。
 * - 顺子：枚举能容纳全部真实牌的合法连续区间（长度=牌数、落 1..13）：
 *   唯一区间时结果完全由牌面集合决定，拖拽顺序不影响（修复 3,5,6,7,8+J
 *   被误推成 2 的不确定问题）；多区间时按百搭左右邻居选延伸方向
 *   （缺口优先、再向上延伸、再向下，与引擎 tidyRun 一致）。
 * - 刻子：取缺失颜色、与组内数字一致。
 */
export function inferJokerDisplayValue(
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

  // Run：区间反推。枚举能容纳全部真实牌的合法连续区间（长度=牌数、落 1..13）：
  // 唯一区间时结果完全由牌面集合决定，拖拽顺序不影响；多区间时按各百搭的
  // 「位置优先值」给区间打分选最优，平手取 start 最大（与引擎「向上延伸优先」一致）。
  const color = nonJokers[0].logicalColor as TileColor;
  const nums = nonJokers.map(t => t.logicalNumber).sort((a, b) => a - b);
  const min = nums[0];
  const max = nums[nums.length - 1];
  const n = tiles.length;
  const numSet = new Set(nums);
  const jokerCount = tiles.filter(isJokerTile).length;

  const starts: number[] = [];
  const lo = Math.max(1, max - n + 1);
  const hi = Math.min(min, 13 - n + 1);
  for (let s = lo; s <= hi; s++) starts.push(s);

  if (starts.length === 0) {
    // 草稿尚不构成任何合法顺子（如 3-J-8 缺口超百搭数）：防撞启发式，
    // 从两端向外找第一个不与真实牌重复的数字（结果仍只由牌面集合决定）。
    let pick = -1;
    for (let v = min - 1; v >= 1 && pick < 0; v--) if (!numSet.has(v)) pick = v;
    for (let v = max + 1; v <= 13 && pick < 0; v++) if (!numSet.has(v)) pick = v;
    if (pick < 0) pick = max + 1;
    return { color, number: pick };
  }

  // 每张百搭的「位置优先值」：取最近真实邻居向外推算（左链优先），
  // 与存储顺序中「Joker 摆在哪一侧」的玩家意图一致。
  const preferredOf = (idx: number): number => {
    let left: LogicalTile | null = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (!isJokerTile(tiles[j])) { left = tiles[j]; break; }
    }
    let right: LogicalTile | null = null;
    for (let j = idx + 1; j < tiles.length; j++) {
      if (!isJokerTile(tiles[j])) { right = tiles[j]; break; }
    }
    let jokersBefore = 0;
    for (let j = idx - 1; j >= 0 && isJokerTile(tiles[j]); j--) jokersBefore++;
    let jokersAfter = 0;
    for (let j = idx + 1; j < tiles.length && isJokerTile(tiles[j]); j++) jokersAfter++;
    if (left) return left.logicalNumber + jokersBefore + 1;
    if (right) return right.logicalNumber - jokersAfter - 1;
    return -1;
  };

  // 选区间：统计每个区间命中多少张百搭的优先值，取命中最多者；
  // 平手取 start 最大（向上延伸优先）。任一视角调用结果一致，无随机性。
  const gapsOf = (s: number): Set<number> => {
    const gaps = new Set<number>();
    for (let v = s; v < s + n; v++) if (!numSet.has(v)) gaps.add(v);
    return gaps;
  };
  let start = starts[starts.length - 1];
  if (starts.length > 1) {
    let best = -1;
    // 降序遍历：同分时保留 start 最大者（向上延伸优先）。
    for (let si = starts.length - 1; si >= 0; si--) {
      const s = starts[si];
      const gaps = gapsOf(s);
      let score = 0;
      for (let i = 0; i < tiles.length; i++) {
        if (!isJokerTile(tiles[i])) continue;
        const p = preferredOf(i);
        if (p >= 1 && p <= 13 && gaps.has(p)) score++;
      }
      if (score > best) {
        best = score;
        start = s;
      }
    }
  }

  // 缺值升序收集：缺口优先，不够再向上、再向下延伸（与引擎 tidyRun 一致）。
  const jokerValues: number[] = [];
  for (let v = start; v < start + n; v++) {
    if (!numSet.has(v)) jokerValues.push(v);
  }
  let extra = jokerCount - jokerValues.length;
  for (let v = start + n; extra > 0 && v <= 13; v++, extra--) jokerValues.push(v);
  for (let v = start - 1; extra > 0 && v >= 1; v--, extra--) jokerValues.push(v);

  // 按出现顺序逐张分配：区间选定后结果唯一。
  let k = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (!isJokerTile(tiles[i])) continue;
    if (i === jokerIndex) return { color, number: jokerValues[k] };
    k++;
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
