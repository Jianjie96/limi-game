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

/**
 * 提示文案换行：按 maxWidth 逐单位拆行，中文逐字可断，
 * ASCII 字母/数字/常见符号成完整单元不被拦腰截断；
 * 超过 maxLines 行时截断并在末行补「…」。
 * 注意：调用前需自行设置好 ctx.font。
 */
export function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 4,
): string[] {
  if (!text) return [];
  // 拆成最小单元：「abc12」是一个单元，「中」是一个单元。
  const units: string[] = [];
  let word = '';
  for (const ch of text) {
    if (/[A-Za-z0-9.,:%]/.test(ch)) {
      word += ch;
      continue;
    }
    if (word) {
      units.push(word);
      word = '';
    }
    units.push(ch);
  }
  if (word) units.push(word);

  const lines: string[] = [];
  let line = '';
  for (const u of units) {
    if (line && ctx.measureText(line + u).width > maxWidth) {
      lines.push(line);
      line = u === ' ' ? '' : u;
    } else {
      line += u;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  // 超长截断：只留前 maxLines 行，末行补省略号（量宽自适应）。
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = last + '…';
  return kept;
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
 * - 顺子三步走：① 真实数字排序后，缺口升序补给百搭（与存储顺序无关，
 *   如 3,5,6,7,8+J → 4）；② 剩余百搭落到两端延伸：头部向下、尾部向上、
 *   中间默认向上（joker,3,4 → 2；3,4,joker → 5）；③ 越过 1/13 翻转到
 *   另一端（joker,1,2 → 3；12,13,joker → 11）。同副牌面结果唯一，无随机性。
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

  // Run 三步走：排序真实数字 → 缺口补给百搭 → 剩余百搭按端位延伸。
  const color = nonJokers[0].logicalColor as TileColor;
  const nums = nonJokers.map(t => t.logicalNumber).sort((a, b) => a - b);
  const min = nums[0];
  const max = nums[nums.length - 1];
  const used = new Set(nums);
  const jokerIdxs: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (isJokerTile(tiles[i])) jokerIdxs.push(i);
  }
  const assigned = new Map<number, number>();

  // 第一步：排序后的真实数字缺口升序补给百搭，与存储顺序无关：
  //   3,5,6,7,8 + J → 4；3,5,6 + J,J,8 → 4,7。
  const gaps: number[] = [];
  for (let v = min + 1; v < max; v++) if (!used.has(v)) gaps.push(v);
  let gi = 0;
  for (const idx of jokerIdxs) {
    if (gi >= gaps.length) break;
    assigned.set(idx, gaps[gi]);
    used.add(gaps[gi]);
    gi++;
  }

  // 第二步：剩余百搭落到顺子两端——头部（前面无真实牌）向下延伸、
  // 尾部（后面无真实牌）向上延伸、中间默认向上；越过 1/13 翻转到另一端；
  // 取值跳过已分配数字防撞。
  let downNext = min - 1;
  let upNext = max + 1;
  const takeDown = (): number => {
    while (downNext >= 1 && used.has(downNext)) downNext--;
    return downNext--;
  };
  const takeUp = (): number => {
    while (upNext <= 13 && used.has(upNext)) upNext++;
    return upNext++;
  };
  const hasRealBefore = (idx: number) => tiles.slice(0, idx).some(t => !isJokerTile(t));

  // 头部百搭批量处理：取下延值后升序再分配，显示向真实牌递增（[J,J,3,4] 显示 1,2,3,4）。
  const headIdxs = jokerIdxs.filter(idx => !assigned.has(idx) && !hasRealBefore(idx));
  const headVals = headIdxs
    .map(() => {
      let v = takeDown();
      if (v < 1) v = takeUp(); // 越过 1 翻转向上（joker,1,2 → 3）
      return v;
    })
    .sort((a, b) => a - b);
  headIdxs.forEach((idx, i) => {
    if (headVals[i] >= 1 && headVals[i] <= 13) {
      assigned.set(idx, headVals[i]);
      used.add(headVals[i]);
    }
  });

  // 尾部/中间百搭按出现顺序分配（尾部上延越 13 翻转向下：12,13,joker → 11）。
  for (const idx of jokerIdxs) {
    if (assigned.has(idx)) continue;
    let v = takeUp();
    if (v > 13) v = takeDown();
    if (v < 1 || v > 13) continue; // 退化草稿无可赋値：显示百搭本体
    assigned.set(idx, v);
    used.add(v);
  }

  const v = assigned.get(jokerIndex);
  return v ? { color, number: v } : null;
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
