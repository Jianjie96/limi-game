// ============================================================================
// backdrop.ts — 场景共享绘制工具（首页 / 房间等轻量场景共用）
// ----------------------------------------------------------------------------
// 提供暮色背景装饰、文字、胶囊按钮与命中检测，视觉与 GameScene 保持一致。
// ============================================================================

import { roundRectPath } from './renderer';
import {
  SKY_TOP,
  SKY_MID,
  SKY_BOTTOM,
  FONT_FAMILY,
  BUTTON_COLORS,
} from './constants';

// ----------------------------------------------------------------------------
// 背景：黄昏天色 + 暮云 + 光斑（与 GameScene 装饰一致）
// ----------------------------------------------------------------------------

export function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, SKY_TOP);
  bg.addColorStop(0.55, SKY_MID);
  bg.addColorStop(1, SKY_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 暮云：暖调半透明椭圆组
  const clouds: Array<[number, number, number, number, number]> = [
    [0.18, 0.12, 120, 26, 0.20],
    [0.72, 0.09, 150, 30, 0.16],
    [0.45, 0.20, 90, 20, 0.14],
    [0.90, 0.26, 110, 22, 0.13],
    [0.08, 0.38, 80, 18, 0.11],
  ];
  for (const [rx, ry, cw, ch, a] of clouds) {
    const cx = rx * w;
    const cy = ry * h;
    ctx.fillStyle = `rgba(255,238,214,${a})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw / 2, ch / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - cw * 0.32, cy + ch * 0.18, cw * 0.3, ch * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + cw * 0.34, cy + ch * 0.16, cw * 0.34, ch * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 四芒星光斑：点缀开放世界氛围
  const sparkles: Array<[number, number, number, number]> = [
    [0.3, 0.15, 5, 0.35],
    [0.62, 0.22, 4, 0.28],
    [0.85, 0.12, 6, 0.3],
    [0.15, 0.5, 4, 0.22],
    [0.5, 0.06, 5, 0.25],
  ];
  for (const [rx, ry, r, a] of sparkles) {
    drawSparkle(ctx, rx * w, ry * h, r, `rgba(255,244,214,${a})`);
  }
}

/** 四芒星光斑（内凹弧线） */
export function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
  ctx.fill();
}

// ----------------------------------------------------------------------------
// 文字
// ----------------------------------------------------------------------------

export interface SceneTextOptions {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
  /** 描边色（卡通描边字） */
  outline?: string;
}

export function drawSceneText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  opts: SceneTextOptions = {}
): void {
  ctx.save();
  ctx.font = `${opts.bold ? 'bold ' : ''}${opts.size ?? 14}px ${FONT_FAMILY}`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = opts.baseline ?? 'middle';
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.outline) {
    ctx.lineWidth = Math.max(3, (opts.size ?? 14) / 6);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.outline;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.color ?? '#F2ECDD';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ----------------------------------------------------------------------------
// 胶囊按钮（视觉与 GameScene.drawCartoonButton 一致）
// ----------------------------------------------------------------------------

export interface SceneButtonRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function drawCapsuleButton(
  ctx: CanvasRenderingContext2D,
  rect: SceneButtonRect,
  label: string,
  variant: keyof typeof BUTTON_COLORS = 'secondary',
  fontSize = 17
): void {
  const { x, y, w, h } = rect;
  const c = BUTTON_COLORS[variant];
  const r = h / 2;

  // 偏移投影
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRectPath(ctx, x + 1, y + 3, w, h, r);
  ctx.fill();

  // 渐变按钮体
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, c.top);
  grad.addColorStop(1, c.bottom);
  ctx.fillStyle = grad;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();

  // 描边（danger 加深色描边，其余香槟金）
  if (variant === 'danger') {
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  // 顶部釉面高光（低强度，避免亮斑刺眼）
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRectPath(ctx, x + 6, y + 3, w - 12, h * 0.42, r);
  ctx.fill();

  drawSceneText(ctx, x + w / 2, y + h / 2 + 1, label, {
    size: fontSize,
    bold: true,
    color: c.text,
  });
}

// ----------------------------------------------------------------------------
// 命中检测
// ----------------------------------------------------------------------------

export function hitRect(px: number, py: number, rect: SceneButtonRect): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}
