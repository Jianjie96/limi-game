// ============================================================================
// HomeScene.ts — 首页场景
// ----------------------------------------------------------------------------
// 进入游戏的第一屏：「创建房间」与「加入房间」两个入口。
// 创建房间弹出人数选择（2/3/4 人）；加入房间暂未开放，提示开发中。
// 与 GameScene 共享同一块画布，通过 dispose() 交还触控与渲染循环。
// ============================================================================

import { ScreenInfo } from './screen';
import { roundRectPath } from './renderer';
import {
  drawBackdrop,
  drawSceneText,
  drawCapsuleButton,
  hitRect,
  SceneButtonRect,
} from './backdrop';
import { FROST_STRONG, FROST_BORDER, GOLD, INK, INK_SOFT, GOLD_DEEP } from './constants';

export class HomeScene {
  /** 选择人数并确认后回调（创建房间请求由外部发起） */
  onCreateRoom: ((capacity: number) => void) | null = null;
  /** 本地试玩（开发后门，不依赖云开发） */
  onLocalPlay: (() => void) | null = null;
  /** 断线重连：回到上次未结束的对局 */
  onResume: (() => void) | null = null;

  private ctx: CanvasRenderingContext2D;
  private screenW: number;
  private screenH: number;
  private pixelRatio: number;
  private safeTop: number;

  private rafId = 0;
  private dirty = true;

  // 人数选择面板
  private pickerVisible = false;
  private pickerCapacity = 4;

  /** 创建房间请求进行中 */
  private busy = false;

  // 轻提示
  private message = '';
  private messageUntil = 0;

  // 命中区域（绘制时记录）
  private createBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private joinBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private optionRects: SceneButtonRect[] = [];
  private confirmRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private cancelRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private localPlayRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private resumeBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };

  /** 断线重连入口房号（外部校验房间仍在对局后调 showResume 激活） */
  private resumeCode = '';

  private touchStartHandler = (e: { touches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches[0];
    if (!t) return;
    this.handleTap(t.clientX, t.clientY);
  };

  private resizeHandler = () => {
    this.measure();
    this.dirty = true;
  };

  constructor(canvas: HTMLCanvasElement, info: ScreenInfo) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.screenW = info.screenWidth;
    this.screenH = info.screenHeight;
    this.pixelRatio = info.pixelRatio;
    this.safeTop = info.safeTop;
    this.measure();

    wx.onTouchStart(this.touchStartHandler);
    wx.onWindowResize(this.resizeHandler);
    this.rafId = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    wx.offTouchStart(this.touchStartHandler);
    wx.offWindowResize(this.resizeHandler);
  }

  /** 外部请求失败时展示错误提示 */
  showError(msg: string): void {
    this.busy = false;
    this.showInfo(msg);
  }

  showInfo(msg: string, duration = 2600): void {
    this.message = msg;
    this.messageUntil = Date.now() + duration;
    this.dirty = true;
  }

  /** 创建成功后由外部调用，避免残留面板状态 */
  closePicker(): void {
    this.pickerVisible = false;
    this.busy = false;
    this.dirty = true;
  }

  /** 展示「回到对局」入口（仅当上次房间仍在对局中且本人在场时由外部激活） */
  showResume(code: string): void {
    this.resumeCode = code;
    this.dirty = true;
  }

  /** 隐藏重连入口（重连失败 / 房间已失效时调用） */
  hideResume(): void {
    this.resumeCode = '';
    this.dirty = true;
  }

  // --------------------------------------------------------------------------
  // 交互
  // --------------------------------------------------------------------------

  private measure(): void {
    try {
      const info: any = wx.getSystemInfoSync();
      this.screenW = info.windowWidth || this.screenW;
      this.screenH = info.windowHeight || this.screenH;
    } catch (e) {
      // 保持现有尺寸
    }
  }

  private handleTap(px: number, py: number): void {
    if (this.busy) return;

    if (this.pickerVisible) {
      for (let i = 0; i < this.optionRects.length; i++) {
        if (hitRect(px, py, this.optionRects[i])) {
          this.pickerCapacity = 2 + i;
          this.dirty = true;
          return;
        }
      }
      if (hitRect(px, py, this.confirmRect)) {
        this.busy = true;
        this.dirty = true;
        this.onCreateRoom?.(this.pickerCapacity);
        return;
      }
      if (hitRect(px, py, this.cancelRect)) {
        this.pickerVisible = false;
        this.dirty = true;
      }
      return;
    }

    if (hitRect(px, py, this.createBtnRect)) {
      this.pickerVisible = true;
      this.dirty = true;
      return;
    }
    if (hitRect(px, py, this.joinBtnRect)) {
      this.showInfo('开发中，敬请期待～');
      return;
    }
    if (this.resumeCode && hitRect(px, py, this.resumeBtnRect)) {
      this.busy = true;
      this.dirty = true;
      this.onResume?.();
      return;
    }
    if (this.onLocalPlay && hitRect(px, py, this.localPlayRect)) {
      this.onLocalPlay();
    }
  }

  // --------------------------------------------------------------------------
  // 渲染
  // --------------------------------------------------------------------------

  private tick = () => {
    if (this.dirty || Date.now() < this.messageUntil) {
      this.dirty = false;
      this.render();
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private render(): void {
    const ctx = this.ctx;
    const { screenW: w, screenH: h } = this;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);

    drawBackdrop(ctx, w, h);

    // 标题区
    const titleY = this.safeTop + Math.min(72, h * 0.2);
    drawSceneText(ctx, w / 2, titleY, '拉 密', {
      size: 46,
      bold: true,
      color: INK,
      outline: GOLD_DEEP,
    });
    drawSceneText(ctx, w / 2, titleY + 38, 'Rummikub · 和朋友来一局', {
      size: 14,
      color: INK_SOFT,
    });

    // 主按钮
    const btnW = Math.min(220, w * 0.32);
    const btnH = 46;
    const cx = w / 2;
    const createY = h * 0.52;
    this.createBtnRect = { x: cx - btnW / 2, y: createY, w: btnW, h: btnH };
    this.joinBtnRect = { x: cx - btnW / 2, y: createY + btnH + 18, w: btnW, h: btnH };

    // 断线重连入口：置于主按钮上方最醒目的位置。
    if (this.resumeCode) {
      this.resumeBtnRect = { x: cx - btnW / 2, y: createY - btnH - 22, w: btnW, h: btnH };
      drawCapsuleButton(
        ctx,
        this.resumeBtnRect,
        this.busy ? '进入中…' : `回到对局 · 房间 ${this.resumeCode}`,
        'primary',
        16
      );
    }

    drawCapsuleButton(ctx, this.createBtnRect, this.busy ? '创建中…' : '创建房间', 'primary', 18);
    drawCapsuleButton(ctx, this.joinBtnRect, '加入房间', 'secondary', 18);

    // 底部本地试玩入口（开发调试用，不依赖云开发）
    if (this.onLocalPlay) {
      const lpW = 130;
      const lpH = 26;
      this.localPlayRect = {
        x: (w - lpW) / 2,
        y: h - this.safeTop - lpH - 8,
        w: lpW,
        h: lpH,
      };
      drawSceneText(ctx, w / 2, this.localPlayRect.y + lpH / 2, '本地试玩 ›', {
        size: 13,
        color: INK_SOFT,
      });
    }

    if (this.pickerVisible) this.drawPicker();
    if (this.message && Date.now() < this.messageUntil) this.drawMessage();
  }

  /** 人数选择面板（墨玻璃卡片 + 2/3/4 人选项） */
  private drawPicker(): void {
    const ctx = this.ctx;
    const { screenW: w, screenH: h } = this;

    // 暗化遮罩
    ctx.fillStyle = 'rgba(8,16,24,0.55)';
    ctx.fillRect(0, 0, w, h);

    const cardW = Math.min(340, w * 0.6);
    const cardH = 190;
    const cardX = (w - cardW) / 2;
    const cardY = (h - cardH) / 2;

    ctx.fillStyle = 'rgba(6,14,22,0.4)';
    roundRectPath(ctx, cardX + 2, cardY + 4, cardW, cardH, 16);
    ctx.fill();
    ctx.fillStyle = FROST_STRONG;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 16);
    ctx.fill();
    ctx.strokeStyle = FROST_BORDER;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 16);
    ctx.stroke();

    drawSceneText(ctx, cardX + cardW / 2, cardY + 32, '选择房间人数', {
      size: 18,
      bold: true,
      color: INK,
    });

    // 选项：2 / 3 / 4 人
    this.optionRects = [];
    const optW = 76;
    const optH = 38;
    const gap = 18;
    const rowW = optW * 3 + gap * 2;
    const optY = cardY + 62;
    for (let i = 0; i < 3; i++) {
      const rect: SceneButtonRect = {
        x: cardX + (cardW - rowW) / 2 + i * (optW + gap),
        y: optY,
        w: optW,
        h: optH,
      };
      this.optionRects.push(rect);
      const selected = this.pickerCapacity === 2 + i;
      drawCapsuleButton(ctx, rect, `${2 + i} 人`, selected ? 'primary' : 'secondary', 16);
    }

    // 确认 / 取消
    const confirmW = Math.min(150, cardW * 0.42);
    const cancelW = Math.min(100, cardW * 0.28);
    const actionY = cardY + cardH - 58;
    this.confirmRect = {
      x: cardX + cardW / 2 - confirmW - 8,
      y: actionY,
      w: confirmW,
      h: 40,
    };
    this.cancelRect = {
      x: cardX + cardW / 2 + 8,
      y: actionY,
      w: cancelW,
      h: 40,
    };
    drawCapsuleButton(ctx, this.confirmRect, '确认创建', 'primary', 16);
    drawCapsuleButton(ctx, this.cancelRect, '取消', 'secondary', 16);
  }

  /** 底部轻提示气泡 */
  private drawMessage(): void {
    const ctx = this.ctx;
    ctx.font = 'bold 14px PingFang SC, Microsoft YaHei, sans-serif';
    const tw = ctx.measureText(this.message).width;
    const msgW = tw + 40;
    const msgH = 30;
    const x = (this.screenW - msgW) / 2;
    const y = this.screenH * 0.82;

    ctx.fillStyle = 'rgba(24,40,52,0.92)';
    roundRectPath(ctx, x, y, msgW, msgH, msgH / 2);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, msgW, msgH, msgH / 2);
    ctx.stroke();

    drawSceneText(ctx, this.screenW / 2, y + msgH / 2, this.message, {
      size: 14,
      color: INK,
    });
  }
}
