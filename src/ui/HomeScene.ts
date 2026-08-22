// ============================================================================
// HomeScene.ts — 首页场景
// ----------------------------------------------------------------------------
// 进入游戏的第一屏：「创建房间」与「加入房间」两个入口。
// 创建房间弹出人数选择（2/3/4 人）；加入房间弹窗输入 5 位房号进房。
// 与 GameScene 共享同一块画布，通过 dispose() 交还触控与渲染循环。
// ============================================================================

import { ScreenInfo, getScreenInfo, applyCanvasSize } from './screen';
import { roundRectPath, wrapTextLines } from './renderer';
import {
  drawBackdrop,
  drawSceneText,
  drawCapsuleButton,
  hitRect,
  SceneButtonRect,
} from './backdrop';
import { FROST_STRONG, FROST_BORDER, GOLD, INK, INK_SOFT, GOLD_DEEP, FONT_FAMILY } from './constants';
import { getNickname, drawAvatar } from './profile';

export class HomeScene {
  /** 选择人数并确认后回调（创建房间请求由外部发起） */
  onCreateRoom: ((capacity: number) => void) | null = null;
  /** 输入房号后回调（加入房间请求由外部发起） */
  onJoinByCode: ((code: string) => void) | null = null;
  /** 断线重连：回到上次未结束的对局 */
  onResume: (() => void) | null = null;
  /** 打开个人中心（设置页） */
  onOpenProfile: (() => void) | null = null;

  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private screenW: number;
  private screenH: number;
  private pixelRatio: number;
  private safeTop: number;

  private rafId = 0;
  private dirty = true;

  // 人数选择面板
  private pickerVisible = false;
  private pickerCapacity = 4;

  /** 正在处理的入口（建房/入房/回对局）：只有对应入口显示自己的进度文案。 */
  private busySource: 'create' | 'join' | 'resume' | null = null;

  // 轻提示
  private message = '';
  private messageUntil = 0;

  // 命中区域（绘制时记录）
  private createBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private joinBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private optionRects: SceneButtonRect[] = [];
  private confirmRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private cancelRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private resumeBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private profileRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };

  /** 断线重连入口房号（外部校验房间仍在对局/等待后调 showResume 激活） */
  private resumeCode = '';
  /** 重连入口文案前缀：对局中「回到对局」，等待中「回到房间」 */
  private resumeLabel = '回到对局';

  private touchStartHandler = (e: { touches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches[0];
    if (!t) return;
    this.handleTap(t.clientX, t.clientY);
  };

  private resizeHandler = (res?: { windowWidth?: number; windowHeight?: number }) => {
    this.measure(res);
    this.dirty = true;
  };

  constructor(canvas: HTMLCanvasElement, info: ScreenInfo) {
    this.canvas = canvas;
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
    this.busySource = null;
    this.showInfo(msg);
  }

  /** 「加入房间」：弹窗输入 5 位房号（不区分大小写），交给外部发起加入请求。 */
  promptJoinCode(): void {
    wx.showModal({
      title: '加入房间',
      editable: true,
      placeholderText: '请输入 5 位房号',
      confirmText: '加入',
      success: (res) => {
        if (!res.confirm) return;
        const code = (res.content || '').trim().toUpperCase();
        if (!code) {
          this.showInfo('房号不能为空');
          return;
        }
        this.busySource = 'join';
        this.dirty = true;
        this.onJoinByCode?.(code);
      },
    });
  }

  showInfo(msg: string, duration = 2600): void {
    this.message = msg;
    this.messageUntil = Date.now() + duration;
    this.dirty = true;
  }

  /** 创建成功后由外部调用，避免残留面板状态 */
  closePicker(): void {
    this.pickerVisible = false;
    this.busySource = null;
    this.dirty = true;
  }

  /** 展示重连入口（房间仍在对局中/等待中且本人在场时由外部激活） */
  showResume(code: string, label = '回到对局'): void {
    this.resumeCode = code;
    this.resumeLabel = label;
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

  /** 重读屏幕信息（含像素比/安全区）并同步画布后备存储尺寸。 */
  private measure(res?: { windowWidth?: number; windowHeight?: number }): void {
    try {
      const fresh = getScreenInfo(this.canvas, res);
      this.screenW = fresh.screenWidth;
      this.screenH = fresh.screenHeight;
      this.pixelRatio = fresh.pixelRatio;
      this.safeTop = fresh.safeTop;
      applyCanvasSize(this.canvas, fresh);
    } catch (e) {
      // 保持现有尺寸
    }
  }

  private handleTap(px: number, py: number): void {
    if (this.busySource) return;

    if (this.pickerVisible) {
      for (let i = 0; i < this.optionRects.length; i++) {
        if (hitRect(px, py, this.optionRects[i])) {
          this.pickerCapacity = 2 + i;
          this.dirty = true;
          return;
        }
      }
      if (hitRect(px, py, this.confirmRect)) {
        this.busySource = 'create';
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
    if (this.onOpenProfile && hitRect(px, py, this.profileRect)) {
      this.onOpenProfile();
      return;
    }
    if (hitRect(px, py, this.joinBtnRect)) {
      this.promptJoinCode();
      return;
    }
    if (this.resumeCode && hitRect(px, py, this.resumeBtnRect)) {
      this.busySource = 'resume';
      this.dirty = true;
      this.onResume?.();
      return;
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
    drawSceneText(ctx, w / 2, titleY, '拉 密 牌', {
      size: 46,
      bold: true,
      color: INK,
      outline: GOLD_DEEP,
    });
    drawSceneText(ctx, w / 2, titleY + 38, 'Rummikub · 和朋友来一局', {
      size: 14,
      color: INK_SOFT,
    });

    // 个人中心入口：居中置于页面最底部（头像 + 昵称），不干扰主按钮动线。
    if (this.onOpenProfile) {
      const name = getNickname();
      const entryY = h - 80;
      const avatarR = 15;
      ctx.font = `bold 14px ${FONT_FAMILY}`;
      const nameW = ctx.measureText(name).width;
      const clusterW = avatarR * 2 + 8 + nameW + 12;
      const startX = (w - clusterW) / 2;
      this.profileRect = { x: startX - 12, y: entryY - 26, w: clusterW + 24, h: 52 };

      // 头像（微信图片优先，元素色兜底）
      const avX = startX + avatarR;
      drawAvatar(ctx, avX, entryY, avatarR, () => {
        this.dirty = true;
      });

      // 昵称 + 进入箭头
      drawSceneText(ctx, avX + avatarR + 8, entryY, name, {
        size: 14,
        bold: true,
        color: INK,
        align: 'left',
      });
      drawSceneText(ctx, startX + clusterW - 4, entryY, '›', {
        size: 14,
        color: INK_SOFT,
      });
    }

    // 主按钮
    const btnW = Math.min(220, w * 0.32);
    const btnH = 46;
    const cx = w / 2;
    const createY = h * 0.52;
    this.createBtnRect = { x: cx - btnW / 2, y: createY, w: btnW, h: btnH };
    this.joinBtnRect = { x: cx - btnW / 2, y: createY + btnH + 18, w: btnW, h: btnH };

    // 断线重连入口：置于主按钮上方最醒目的位置；宽度按文案自适应（含房号，比主按钮长）。
    if (this.resumeCode) {
      const label = this.busySource === 'resume' ? '进入中…' : `${this.resumeLabel} · 房间 ${this.resumeCode}`;
      ctx.font = `bold 16px ${FONT_FAMILY}`;
      const resumeW = Math.min(w * 0.86, Math.max(btnW, ctx.measureText(label).width + 56));
      this.resumeBtnRect = { x: cx - resumeW / 2, y: createY - btnH - 22, w: resumeW, h: btnH };
      drawCapsuleButton(
        ctx,
        this.resumeBtnRect,
        label,
        'primary',
        16
      );
    }

    drawCapsuleButton(
      ctx,
      this.createBtnRect,
      this.busySource === 'create' ? '创建中…' : '创建房间',
      'primary',
      18
    );
    drawCapsuleButton(ctx, this.joinBtnRect, this.busySource === 'join' ? '进入中…' : '加入房间', 'secondary', 18);

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

    const cardW = Math.min(360, w * 0.9);
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

    // 取消 / 确认：主按钮在右（用户习惯），两按钮宽度不同按整组总宽居中
    const confirmW = Math.min(150, cardW * 0.42);
    const cancelW = Math.min(100, cardW * 0.28);
    const actionGap = 16;
    const actionY = cardY + cardH - 58;
    const actionX = cardX + (cardW - (cancelW + actionGap + confirmW)) / 2;
    this.cancelRect = {
      x: actionX,
      y: actionY,
      w: cancelW,
      h: 40,
    };
    this.confirmRect = {
      x: actionX + cancelW + actionGap,
      y: actionY,
      w: confirmW,
      h: 40,
    };
    drawCapsuleButton(ctx, this.confirmRect, '确认创建', 'primary', 16);
    drawCapsuleButton(ctx, this.cancelRect, '取消', 'secondary', 16);
  }

  /** 底部轻提示气泡 */
  private drawMessage(): void {
    const ctx = this.ctx;
    ctx.font = 'bold 14px PingFang SC, Microsoft YaHei, sans-serif';
    // 长提示自动换行（最多 4 行），底边锚在原来单行位置向上长高。
    const maxW = this.screenW - 48;
    const lines = wrapTextLines(ctx, this.message, maxW - 40);
    const lineH = 20;
    const msgW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40);
    const msgH = lines.length * lineH + 12;
    const x = (this.screenW - msgW) / 2;
    const y = this.screenH * 0.82 + 30 - msgH;
    const radius = lines.length === 1 ? msgH / 2 : 12;

    ctx.fillStyle = 'rgba(24,40,52,0.92)';
    roundRectPath(ctx, x, y, msgW, msgH, radius);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, msgW, msgH, radius);
    ctx.stroke();

    lines.forEach((line, i) => {
      drawSceneText(ctx, this.screenW / 2, y + 6 + lineH * i + lineH / 2, line, {
        size: 14,
        color: INK,
      });
    });
  }
}
