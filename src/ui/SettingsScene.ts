// ============================================================================
// SettingsScene.ts — 个人中心（设置页）场景
// ----------------------------------------------------------------------------
// 从首页「个人中心」进入：头像（微信相册/拍照选择，元素色兜底）+
// 昵称（原生键盘修改），以及 背景音 / 音效 / 震动反馈 / 横屏模式 四个开关。
// 与 HomeScene 共享画布与 backdrop 视觉语言，通过 dispose() 交还。
// ============================================================================

import { ScreenInfo, getScreenInfo, getScreenInfoAfterRotation, applyCanvasSize } from './screen';
import { roundRectPath } from './renderer';
import {
  drawBackdrop,
  drawSceneText,
  drawCapsuleButton,
  hitRect,
  SceneButtonRect,
} from './backdrop';
import { FROST_STRONG, FROST_BORDER, GOLD, INK, INK_SOFT, AVATAR_COLORS } from './constants';
import { audio } from './audio';
import { clearLastRoom } from '../cloud/room';
import {
  getNickname,
  setNickname,
  getAvatarIndex,
  setAvatarIndex,
  getAvatarPath,
  chooseAvatarFromWeChat,
  resetAvatar,
  drawAvatar,
  isVibrateEnabled,
  setVibrateEnabled,
  vibrateIfEnabled,
  getPreferredOrientation,
  setPreferredOrientation,
  applyPreferredOrientation,
} from './profile';

const ROW_H = 48;

export class SettingsScene {
  /** 返回上一页（首页） */
  onExit: (() => void) | null = null;

  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private screenW: number;
  private screenH: number;
  private pixelRatio: number;
  private safeTop: number;
  private safeLeft: number;
  private safeRight: number;

  private rafId = 0;
  private dirty = true;

  // 轻提示
  private message = '';
  private messageUntil = 0;

  // 命中区域（绘制时记录）
  private backRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private avatarRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private nickEditRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private swatchRects: SceneButtonRect[] = [];
  private bgmRowRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private sfxRowRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private vibrateRowRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private landscapeRowRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private clearCacheRowRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };

  private editingNickname = false;
  /** dispose 后丢弃异步回调（转屏等待可能晚于返回）。 */
  private disposed = false;

  private touchStartHandler = (e: { touches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches[0];
    if (!t) return;
    this.handleTap(t.clientX, t.clientY);
  };

  private resizeHandler = (res?: { windowWidth?: number; windowHeight?: number }) => {
    this.measure(res);
    this.dirty = true;
  };

  /** 键盘「完成/发送」：提交昵称。 */
  private keyboardConfirmHandler = (res: { value: string }) => {
    const name = (res.value ?? '').trim();
    if (!name) {
      this.showInfo('昵称不能为空');
      return;
    }
    if (setNickname(name)) {
      this.showInfo('昵称已更新');
    }
    this.dirty = true;
  };

  /** 键盘收起：复位编辑态。 */
  private keyboardCompleteHandler = () => {
    this.editingNickname = false;
    this.dirty = true;
  };

  constructor(canvas: HTMLCanvasElement, info: ScreenInfo) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.screenW = info.screenWidth;
    this.screenH = info.screenHeight;
    this.pixelRatio = info.pixelRatio;
    this.safeTop = info.safeTop;
    this.safeLeft = info.safeLeft;
    this.safeRight = info.safeRight;
    this.measure();

    wx.onTouchStart(this.touchStartHandler);
    wx.onWindowResize(this.resizeHandler);
    try {
      wx.onKeyboardConfirm(this.keyboardConfirmHandler);
      wx.onKeyboardComplete(this.keyboardCompleteHandler);
    } catch (e) {
      // 键盘 API 不可用时仅禁用昵称修改
    }
    this.rafId = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    wx.offTouchStart(this.touchStartHandler);
    wx.offWindowResize(this.resizeHandler);
    try {
      wx.offKeyboardConfirm(this.keyboardConfirmHandler);
      wx.offKeyboardComplete(this.keyboardCompleteHandler);
      if (this.editingNickname) wx.hideKeyboard();
    } catch (e) {
      // 忽略
    }
  }

  showInfo(msg: string, duration = 2200): void {
    this.message = msg;
    this.messageUntil = Date.now() + duration;
    this.dirty = true;
  }

  // --------------------------------------------------------------------------
  // 交互
  // --------------------------------------------------------------------------

  private measure(res?: { windowWidth?: number; windowHeight?: number }): void {
    try {
      const fresh = getScreenInfo(this.canvas, res);
      this.screenW = fresh.screenWidth;
      this.screenH = fresh.screenHeight;
      this.pixelRatio = fresh.pixelRatio;
      this.safeTop = fresh.safeTop;
      this.safeLeft = fresh.safeLeft;
      this.safeRight = fresh.safeRight;
      applyCanvasSize(this.canvas, fresh);
    } catch (e) {
      // 保持现有尺寸
    }
  }

  private handleTap(px: number, py: number): void {
    if (hitRect(px, py, this.backRect)) {
      this.onExit?.();
      return;
    }
    if (hitRect(px, py, this.avatarRect)) {
      this.pickAvatar();
      return;
    }
    if (hitRect(px, py, this.nickEditRect)) {
      this.openNicknameKeyboard();
      return;
    }
    for (let i = 0; i < this.swatchRects.length; i++) {
      if (hitRect(px, py, this.swatchRects[i])) {
        // 选色卡 = 恢复默认头像（如已设微信头像则清除）并切换底色。
        if (getAvatarPath()) {
          resetAvatar();
          this.showInfo('已恢复默认头像');
        }
        if (getAvatarIndex() !== i) {
          setAvatarIndex(i);
          vibrateIfEnabled();
        }
        this.dirty = true;
        return;
      }
    }
    if (hitRect(px, py, this.bgmRowRect)) {
      const muted = audio.toggleBgmMute();
      if (!muted) vibrateIfEnabled();
      this.dirty = true;
      return;
    }
    if (hitRect(px, py, this.sfxRowRect)) {
      const muted = audio.toggleSfxMute();
      if (!muted) audio.play('place'); // 解除静音给一个确认音
      this.dirty = true;
      return;
    }
    if (hitRect(px, py, this.vibrateRowRect)) {
      const on = !isVibrateEnabled();
      setVibrateEnabled(on);
      if (on) vibrateIfEnabled();
      this.dirty = true;
      return;
    }
    if (hitRect(px, py, this.landscapeRowRect)) {
      const next = getPreferredOrientation() === 'landscape' ? 'portrait' : 'landscape';
      setPreferredOrientation(next);
      vibrateIfEnabled();
      // 立即切设备方向；转屏是异步的，等尺寸真正交换后再重排布局，
      // 固定延时不可靠（会导致拉伸/点击错位）。
      applyPreferredOrientation();
      getScreenInfoAfterRotation(next, this.canvas).then((info) => {
        if (this.disposed) return;
        this.applyScreenInfo(info);
        this.dirty = true;
      });
      this.dirty = true;
      return;
    }
    if (hitRect(px, py, this.clearCacheRowRect)) {
      this.confirmClearCache();
      return;
    }
  }

  /** 二次确认后清除本地缓存（房间记忆 + 音频文件缓存；昵称/头像/设置不受影响）。 */
  private confirmClearCache(): void {
    vibrateIfEnabled();
    wx.showModal({
      title: '清除缓存',
      content: '将清除房间记忆与音频本地缓存（进行中的对局仍可从云端恢复），昵称、头像与各项设置不受影响。',
      confirmText: '清除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm || this.disposed) return;
        clearLastRoom();
        audio.clearCache();
        this.showInfo('缓存已清除');
        this.dirty = true;
      },
    });
  }

  /** 拉起微信原生选择器更换头像（相册/拍照），随时可再点重选。 */
  private pickAvatar(): void {
    if (typeof wx.chooseMedia !== 'function') {
      this.showInfo('当前环境不支持选择头像');
      return;
    }
    vibrateIfEnabled();
    chooseAvatarFromWeChat().then((path) => {
      if (this.disposed) return;
      if (path) {
        this.showInfo('头像已更新');
        this.dirty = true;
      }
    });
  }

  private openNicknameKeyboard(): void {
    if (typeof wx.showKeyboard !== 'function') {
      this.showInfo('当前环境不支持修改昵称');
      return;
    }
    try {
      wx.showKeyboard({
        defaultValue: getNickname(),
        maxLength: 12,
        multiple: false,
        confirmHold: false,
        fail: () => this.showInfo('键盘启动失败'),
      });
      this.editingNickname = true;
    } catch (e) {
      this.showInfo('当前环境不支持修改昵称');
    }
  }

  /** 应用已确认的屏幕信息（转屏完成后），同步画布后备存储。 */
  private applyScreenInfo(info: ScreenInfo): void {
    this.screenW = info.screenWidth;
    this.screenH = info.screenHeight;
    this.pixelRatio = info.pixelRatio;
    this.safeTop = info.safeTop;
    this.safeLeft = info.safeLeft;
    this.safeRight = info.safeRight;
    applyCanvasSize(this.canvas, info);
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

    // 返回按钮（左上）
    this.backRect = { x: this.safeLeft + 12, y: this.safeTop + 12, w: 72, h: 30 };
    drawCapsuleButton(ctx, this.backRect, '‹ 返回', 'secondary', 14);

    drawSceneText(ctx, w / 2, this.safeTop + 27, '个人中心', {
      size: 20,
      bold: true,
      color: INK,
    });

    // 横屏：屏幕高度放不下单列卡片，改用双列紧凑布局（左资料、右开关）。
    if (w > h) {
      this.drawLandscapeCard(w, h);
      if (this.message && Date.now() < this.messageUntil) this.drawMessage();
      return;
    }

    // 内容卡片
    const cardW = Math.min(380, w * 0.92);
    const cardH = 96 + 46 + ROW_H * 5 + 26;
    const cardX = (w - cardW) / 2;
    const cardY = Math.max(this.safeTop + 56, (h - cardH) / 2 + 10);

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

    this.drawProfileRow(cardX, cardY, cardW);
    this.drawSwatchRow(cardX, cardY + 96, cardW);

    const rowsY = cardY + 96 + 46;
    this.bgmRowRect = { x: cardX + 16, y: rowsY, w: cardW - 32, h: ROW_H };
    this.sfxRowRect = { x: cardX + 16, y: rowsY + ROW_H, w: cardW - 32, h: ROW_H };
    this.vibrateRowRect = { x: cardX + 16, y: rowsY + ROW_H * 2, w: cardW - 32, h: ROW_H };
    this.landscapeRowRect = { x: cardX + 16, y: rowsY + ROW_H * 3, w: cardW - 32, h: ROW_H };
    this.clearCacheRowRect = { x: cardX + 16, y: rowsY + ROW_H * 4, w: cardW - 32, h: ROW_H };

    this.drawToggleRow(this.bgmRowRect, '背景音', !audio.isBgmMuted());
    this.drawDivider(this.bgmRowRect);
    this.drawToggleRow(this.sfxRowRect, '音效', !audio.isSfxMuted());
    this.drawDivider(this.sfxRowRect);
    this.drawToggleRow(this.vibrateRowRect, '震动反馈', isVibrateEnabled());
    this.drawDivider(this.vibrateRowRect);
    this.drawToggleRow(this.landscapeRowRect, '横屏模式', getPreferredOrientation() === 'landscape');
    this.drawDivider(this.landscapeRowRect);
    this.drawClearCacheRow(this.clearCacheRowRect);

    if (this.message && Date.now() < this.messageUntil) this.drawMessage();
  }

  /** 横屏双列卡片：左列头像/昵称/色卡，右列四个紧凑开关行。 */
  private drawLandscapeCard(w: number, h: number): void {
    const ctx = this.ctx;
    const availW = w - this.safeLeft - this.safeRight;
    const cardW = Math.min(620, availW - 24);
    const cardH = 236;
    const cardX = this.safeLeft + (availW - cardW) / 2;
    const cardY = Math.max(this.safeTop + 48, (h - cardH) / 2);

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

    // ---- 左列：头像 + 昵称 + 头像颜色 ----
    const leftW = cardW * 0.42;
    const name = getNickname();
    const cx = cardX + 50;
    const cy = cardY + 50;
    drawAvatar(ctx, cx, cy, 24, () => {
      if (!this.disposed) this.dirty = true;
    });
    this.avatarRect = { x: cx - 28, y: cy - 28, w: 56, h: 56 };

    const nameX = cardX + 86;
    drawSceneText(ctx, nameX, cy - 9, name, {
      size: 16,
      bold: true,
      color: INK,
      align: 'left',
    });
    drawSceneText(ctx, nameX, cy + 13, '点击修改 ›', {
      size: 11,
      color: INK_SOFT,
      align: 'left',
    });
    this.nickEditRect = { x: nameX - 8, y: cardY + 14, w: leftW - 24 - (nameX - cardX - 8), h: 76 };

    drawSceneText(ctx, cardX + 24, cardY + cardH - 56, '头像颜色', {
      size: 12,
      color: INK_SOFT,
      align: 'left',
    });
    this.swatchRects = [];
    const hasCustomAvatar = !!getAvatarPath();
    const selected = hasCustomAvatar ? -1 : getAvatarIndex();
    const r = 11;
    const gap = 14;
    let x = cardX + 24;
    const sy = cardY + cardH - 26;
    for (let i = 0; i < AVATAR_COLORS.length; i++) {
      ctx.fillStyle = AVATAR_COLORS[i];
      ctx.beginPath();
      ctx.arc(x + r, sy, r, 0, Math.PI * 2);
      ctx.fill();
      if (i === selected) {
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x + r, sy, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.swatchRects.push({ x: x - 4, y: sy - r - 6, w: r * 2 + 8, h: r * 2 + 12 });
      x += r * 2 + gap;
    }

    // 中间竖向分隔线
    ctx.strokeStyle = 'rgba(211,188,142,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + leftW, cardY + 16);
    ctx.lineTo(cardX + leftW, cardY + cardH - 16);
    ctx.stroke();

    // ---- 右列：四个紧凑开关行 ----
    const rowX = cardX + leftW + 16;
    const rowW = cardW - leftW - 32;
    const rowH = 42;
    const rowsY = cardY + (cardH - rowH * 5) / 2;
    this.bgmRowRect = { x: rowX, y: rowsY, w: rowW, h: rowH };
    this.sfxRowRect = { x: rowX, y: rowsY + rowH, w: rowW, h: rowH };
    this.vibrateRowRect = { x: rowX, y: rowsY + rowH * 2, w: rowW, h: rowH };
    this.landscapeRowRect = { x: rowX, y: rowsY + rowH * 3, w: rowW, h: rowH };
    this.clearCacheRowRect = { x: rowX, y: rowsY + rowH * 4, w: rowW, h: rowH };

    this.drawToggleRow(this.bgmRowRect, '背景音', !audio.isBgmMuted());
    this.drawDivider(this.bgmRowRect);
    this.drawToggleRow(this.sfxRowRect, '音效', !audio.isSfxMuted());
    this.drawDivider(this.sfxRowRect);
    this.drawToggleRow(this.vibrateRowRect, '震动反馈', isVibrateEnabled());
    this.drawDivider(this.vibrateRowRect);
    this.drawToggleRow(this.landscapeRowRect, '横屏模式', getPreferredOrientation() === 'landscape');
    this.drawDivider(this.landscapeRowRect);
    this.drawClearCacheRow(this.clearCacheRowRect);
  }

  /** 头像 + 昵称行 */
  private drawProfileRow(cardX: number, cardY: number, cardW: number): void {
    const ctx = this.ctx;
    const name = getNickname();

    // 头像（微信图片优先，元素色兜底；可点选更换）
    const cx = cardX + 56;
    const cy = cardY + 48;
    drawAvatar(ctx, cx, cy, 28, () => {
      if (!this.disposed) this.dirty = true;
    });
    this.avatarRect = { x: cx - 32, y: cy - 32, w: 64, h: 64 };

    // 昵称 + 修改入口（唤起键盘）
    const nameX = cardX + 100;
    drawSceneText(ctx, nameX, cy - 10, name, {
      size: 18,
      bold: true,
      color: INK,
      align: 'left',
    });
    drawSceneText(ctx, nameX, cy + 14, '点击修改昵称 ›', {
      size: 12,
      color: INK_SOFT,
      align: 'left',
    });
    this.nickEditRect = { x: nameX - 8, y: cardY + 16, w: cardW - 100 - 8, h: 64 };
  }

  /** 头像色选择行（选中即恢复默认头像并换底色） */
  private drawSwatchRow(cardX: number, y: number, cardW: number): void {
    const ctx = this.ctx;
    drawSceneText(ctx, cardX + 24, y + 16, '头像颜色', {
      size: 14,
      color: INK_SOFT,
      align: 'left',
    });

    this.swatchRects = [];
    const hasCustom = !!getAvatarPath();
    const selected = hasCustom ? -1 : getAvatarIndex();
    const r = 13;
    const gap = 18;
    const totalW = AVATAR_COLORS.length * r * 2 + (AVATAR_COLORS.length - 1) * gap;
    let x = cardX + cardW - 24 - totalW;
    const cy = y + 16;
    for (let i = 0; i < AVATAR_COLORS.length; i++) {
      ctx.fillStyle = AVATAR_COLORS[i];
      ctx.beginPath();
      ctx.arc(x + r, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (i === selected) {
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x + r, cy, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.swatchRects.push({ x: x - 4, y: cy - r - 6, w: r * 2 + 8, h: r * 2 + 12 });
      x += r * 2 + gap;
    }
  }

  /** 开关行：左侧标签 + 右侧拨杆（整行可点） */
  private drawToggleRow(rect: SceneButtonRect, label: string, on: boolean): void {
    const ctx = this.ctx;
    const cy = rect.y + rect.h / 2;
    drawSceneText(ctx, rect.x + 8, cy, label, {
      size: 15,
      color: INK,
      align: 'left',
    });
    this.drawSwitch(rect.x + rect.w - 46, cy - 13, on);
  }

  private drawSwitch(x: number, y: number, on: boolean): void {
    const ctx = this.ctx;
    const w = 46;
    const h = 26;
    const r = h / 2;
    ctx.fillStyle = on ? GOLD : 'rgba(120,132,142,0.5)';
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
    const knobR = r - 3;
    const kx = on ? x + w - r : x + r;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(kx, y + r, knobR, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 清除缓存行：左侧标签 + 右侧操作词（整行可点，弹原生确认框） */
  private drawClearCacheRow(rect: SceneButtonRect): void {
    const ctx = this.ctx;
    const cy = rect.y + rect.h / 2;
    drawSceneText(ctx, rect.x + 8, cy, '清除缓存', {
      size: 15,
      color: INK,
      align: 'left',
    });
    drawSceneText(ctx, rect.x + rect.w - 8, cy, '清除 ›', {
      size: 14,
      color: GOLD,
      align: 'right',
    });
  }

  private drawDivider(rowRect: SceneButtonRect): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(211,188,142,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rowRect.x + 8, rowRect.y + rowRect.h);
    ctx.lineTo(rowRect.x + rowRect.w - 8, rowRect.y + rowRect.h);
    ctx.stroke();
  }

  /** 底部轻提示气泡 */
  private drawMessage(): void {
    const ctx = this.ctx;
    ctx.font = 'bold 14px PingFang SC, Microsoft YaHei, sans-serif';
    const tw = ctx.measureText(this.message).width;
    const msgW = tw + 40;
    const msgH = 30;
    const x = (this.screenW - msgW) / 2;
    const y = this.screenH * 0.86;

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
