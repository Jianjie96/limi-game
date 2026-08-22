// ============================================================================
// ProfileScene.ts — 个人中心场景
// ----------------------------------------------------------------------------
// 从首页「个人中心」进入：头像（微信相册/拍照选择，元素色兜底）+
// 昵称（原生键盘修改）+ 历史战绩列表（云端 lami_history 查库：
// 日期/耗时/参与者/是否冠军/各家得分详情），以及 背景音 / 音效 / 震动反馈 / 横屏模式 四个开关。
// 与 HomeScene 共享画布与 backdrop 视觉语言，通过 dispose() 交还。
// ============================================================================

import { ScreenInfo, getScreenInfo, getScreenInfoAfterRotation, applyCanvasSize } from './screen';
import { roundRectPath, wrapTextLines } from './renderer';
import {
  drawBackdrop,
  drawSceneText,
  drawCapsuleButton,
  hitRect,
  SceneButtonRect,
} from './backdrop';
import { FROST_STRONG, FROST_BORDER, GOLD, INK, INK_SOFT, AVATAR_COLORS, FONT_FAMILY } from './constants';
import { audio } from './audio';
import { requestOrientation, orientationSupported } from './orientation';
import { clearLastRoom } from '../cloud/room';
import { fetchMatchHistory, type MatchHistoryRecord } from '../cloud/game';
import {
  getNickname,
  setNickname,
  getAvatarIndex,
  setAvatarIndex,
  getAvatarPath,
  chooseAvatarFromWeChat,
  resetAvatar,
  drawAvatar,
  syncProfileToCloud,
  isVibrateEnabled,
  setVibrateEnabled,
  vibrateIfEnabled,
  getPreferredOrientation,
  setPreferredOrientation,
} from './profile';

const ROW_H = 48;

export class ProfileScene {
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

  /** 云端历史战绩：null = 尚未加载；加载失败也落为空列表 + 失败标记。 */
  private historyRecords: MatchHistoryRecord[] | null = null;
  private historyFailed = false;

  private touchStartHandler = (e: { touches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches[0];
    if (!t) return;
    this.handleTap(t.clientX, t.clientY);
  };

  private resizeHandler = (res?: { windowWidth?: number; windowHeight?: number }) => {
    this.measure(res);
    this.dirty = true;
  };

  /** 键盘「完成/发送」：提交昵称并落库云端。 */
  private keyboardConfirmHandler = (res: { value: string }) => {
    const name = (res.value ?? '').trim();
    if (!name) {
      this.showInfo('昵称不能为空');
      return;
    }
    if (setNickname(name)) {
      this.showInfo('昵称已更新');
      this.pushProfileToCloud();
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
    this.loadHistory();
  }

  /** 查库拉取本人历史战绩（失败不阻断页面，卡片内提示）。 */
  private loadHistory(): void {
    fetchMatchHistory()
      .then((records) => {
        if (this.disposed) return;
        this.historyRecords = records;
        this.dirty = true;
      })
      .catch(() => {
        if (this.disposed) return;
        this.historyRecords = [];
        this.historyFailed = true;
        this.dirty = true;
      });
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
        let changed = false;
        if (getAvatarPath()) {
          resetAvatar();
          this.showInfo('已恢复默认头像');
          changed = true;
        }
        if (getAvatarIndex() !== i) {
          setAvatarIndex(i);
          vibrateIfEnabled();
          changed = true;
        }
        if (changed) this.pushProfileToCloud();
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
    // 横屏模式入口暂时隐藏（待优化后恢复）：置零使其不可命中。
    this.landscapeRowRect = { x: 0, y: 0, w: 0, h: 0 };
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

  /**
   * 横屏开关：先切屏验证成功再落盘偏好（防「切屏失败 + 偏好持久化」造成
   * 下次启动直接坏在横屏的死循环）；失败时开关自动弹回并提示。
   */
  private toggleOrientationPref(): void {
    if (!orientationSupported()) {
      this.showInfo('当前环境不支持转屏');
      return;
    }
    const target = getPreferredOrientation() === 'landscape' ? 'portrait' : 'landscape';
    vibrateIfEnabled();
    requestOrientation(target).then((final) => {
      if (this.disposed) return null;
      if (final === target) {
        setPreferredOrientation(target);
      } else {
        this.showInfo(target === 'landscape' ? '横屏切换失败，已保持竖屏' : '竖屏切换失败');
      }
      // 方向已验证稳定（或已回滚），取完整尺寸重排布局。
      return getScreenInfoAfterRotation(final, this.canvas);
    }).then((info) => {
      if (!info || this.disposed) return;
      this.applyScreenInfo(info);
      this.dirty = true;
    });
    this.dirty = true;
  }

  /** 拉起微信原生选择器更换头像（相册/拍照），选中后上传云存储并落库。 */
  private pickAvatar(): void {
    vibrateIfEnabled();
    chooseAvatarFromWeChat().then((result) => {
      if (this.disposed) return;
      if (result.path) {
        this.showInfo('头像已更新');
        this.pushProfileToCloud();
        this.dirty = true;
        return;
      }
      if (result.errorMsg) {
        // 非用户取消的失败：给出可操作提示（最常见是隐私指引未声明相册接口）。
        this.showInfo(this.avatarPickFailTip(result.errorMsg), 4200);
      }
    });
  }

  /** 把 chooseMedia 的原始 errMsg 翻译成玩家能看懂的提示。 */
  private avatarPickFailTip(errMsg: string): string {
    if (/privacy/i.test(errMsg)) {
      return '无法访问相册：开发者需在微信公众平台「用户隐私保护指引」中声明相册权限后重试';
    }
    if (/auth\s*deny|authorize|permission/i.test(errMsg)) {
      return '相册未授权：请在微信「设置 → 隐私 → 个人信息与权限」中允许本小游戏访问相册';
    }
    return `头像选择失败：${errMsg}`;
  }

  /** 资料变更后推送云端（头像未传过云存储时会先上传）；失败轻提示不打断操作。 */
  private pushProfileToCloud(): void {
    syncProfileToCloud().catch(() => {
      if (!this.disposed) this.showInfo('云端同步失败，下次启动将重试');
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

    // 内容卡片：贴顶放（下方还要留给历史战绩卡片）。
    const cardW = Math.min(380, w * 0.92);
    const cardH = 96 + 46 + ROW_H * 4 + 26; // 横屏模式入口暂隐藏，4 行
    const cardX = (w - cardW) / 2;
    const cardY = this.safeTop + 56;

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
    // 横屏模式入口暂时隐藏（待优化后恢复），清除缓存行上移补位。
    this.landscapeRowRect = { x: 0, y: 0, w: 0, h: 0 };
    this.clearCacheRowRect = { x: cardX + 16, y: rowsY + ROW_H * 3, w: cardW - 32, h: ROW_H };

    this.drawToggleRow(this.bgmRowRect, '背景音', !audio.isBgmMuted());
    this.drawDivider(this.bgmRowRect);
    this.drawToggleRow(this.sfxRowRect, '音效', !audio.isSfxMuted());
    this.drawDivider(this.sfxRowRect);
    this.drawToggleRow(this.vibrateRowRect, '震动反馈', isVibrateEnabled());
    this.drawDivider(this.vibrateRowRect);
    this.drawClearCacheRow(this.clearCacheRowRect);

    // 历史战绩卡片：填满下方剩余空间（放不下则不画）。
    const histY = cardY + cardH + 12;
    const histH = h - 12 - histY;
    if (histH >= 96) this.drawHistoryCard(cardX, histY, cardW, histH);

    if (this.message && Date.now() < this.messageUntil) this.drawMessage();
  }

  /** 横屏双卡片：左卡片头像/昵称/色卡/开关，右卡片历史战绩。 */
  private drawLandscapeCard(w: number, h: number): void {
    const ctx = this.ctx;
    const availW = w - this.safeLeft - this.safeRight;
    // 主卡占 56%，剩余宽度给历史战绩卡（中间 16 间距）。
    const cardW = Math.min(560, Math.floor(availW * 0.56));
    const histW = availW - cardW - 16;
    const cardH = 236;
    const cardX = this.safeLeft;
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
    const rowsY = cardY + (cardH - rowH * 4) / 2; // 横屏模式入口暂隐藏，4 行
    this.bgmRowRect = { x: rowX, y: rowsY, w: rowW, h: rowH };
    this.sfxRowRect = { x: rowX, y: rowsY + rowH, w: rowW, h: rowH };
    this.vibrateRowRect = { x: rowX, y: rowsY + rowH * 2, w: rowW, h: rowH };
    this.landscapeRowRect = { x: 0, y: 0, w: 0, h: 0 };
    this.clearCacheRowRect = { x: rowX, y: rowsY + rowH * 3, w: rowW, h: rowH };

    this.drawToggleRow(this.bgmRowRect, '背景音', !audio.isBgmMuted());
    this.drawDivider(this.bgmRowRect);
    this.drawToggleRow(this.sfxRowRect, '音效', !audio.isSfxMuted());
    this.drawDivider(this.sfxRowRect);
    this.drawToggleRow(this.vibrateRowRect, '震动反馈', isVibrateEnabled());
    this.drawDivider(this.vibrateRowRect);
    this.drawClearCacheRow(this.clearCacheRowRect);

    // 右侧历史战绩卡片（与主卡等高）。
    if (histW >= 160) this.drawHistoryCard(cardX + cardW + 16, cardY, histW, cardH);
  }

  /** 历史战绩卡片：标题 + 最近对局记录（日期/耗时/参与者/冠军/得分详情，夺冠行金色底）。 */
  private drawHistoryCard(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(6,14,22,0.4)';
    roundRectPath(ctx, x + 2, y + 4, w, h, 16);
    ctx.fill();
    ctx.fillStyle = FROST_STRONG;
    roundRectPath(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = FROST_BORDER;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, x, y, w, h, 16);
    ctx.stroke();

    drawSceneText(ctx, x + 16, y + 20, '历史战绩', {
      size: 14,
      bold: true,
      color: INK,
      align: 'left',
    });

    const records = this.historyRecords;
    if (records === null) {
      drawSceneText(ctx, x + w / 2, y + h / 2 + 8, this.historyFailed ? '战绩加载失败' : '战绩加载中…', {
        size: 12,
        color: INK_SOFT,
      });
      return;
    }
    if (records.length === 0) {
      drawSceneText(ctx, x + w / 2, y + h / 2 + 8, this.historyFailed ? '战绩加载失败，稍后再试' : '暂无战绩，先去打一局吧', {
        size: 12,
        color: INK_SOFT,
      });
      return;
    }

    // 每条三行：日期/耗时 + 冠军、参与者（小字）、得分详情（老局无 scores 则两行）。
    let ry = y + 36;
    const bottomLimit = y + h - 8;
    for (const r of records) {
      const hasScores = r.scores && r.scores.length > 0;
      const rowH = hasScores ? 52 : 36;
      if (ry + rowH > bottomLimit) break;
      const cy = ry + (hasScores ? 16 : rowH / 2);
      if (r.selfWon) {
        ctx.fillStyle = 'rgba(233,201,127,0.18)';
        roundRectPath(ctx, x + 10, ry + 2, w - 20, rowH - 4, 8);
        ctx.fill();
      }
      drawSceneText(ctx, x + 16, cy - 8, `${this.fmtDate(r.date)} · ${this.fmtDuration(r.durationMs)}`, {
        size: 11,
        color: INK,
        align: 'left',
      });
      drawSceneText(ctx, x + w - 16, cy - 8, r.selfWon ? '🏆 我夺冠' : `🏆 ${r.winnerName}`, {
        size: 11,
        color: r.selfWon ? GOLD : INK,
        align: 'right',
      });
      drawSceneText(ctx, x + 16, cy + 8, this.fitParticipantText(r, w - 32), {
        size: 10,
        color: INK_SOFT,
        align: 'left',
      });
      if (hasScores) {
        drawSceneText(ctx, x + 16, cy + 26, this.fitScoreText(r, w - 32), {
          size: 10,
          color: INK_SOFT,
          align: 'left',
        });
      }
      ry += rowH;
    }
  }

  /** 得分详情行：各家「昵称 ±本局分（余N张/M分）」，按可用宽度截断。 */
  private fitScoreText(r: MatchHistoryRecord, maxWidth: number): string {
    this.ctx.font = `10px ${FONT_FAMILY}`;
    const parts = r.scores.map((s) => {
      const delta = s.scoreDelta > 0 ? `+${s.scoreDelta}` : `${s.scoreDelta}`;
      const detail = s.isWinner ? '出完' : `余${s.remainingCount}张/${s.remainingScore}分`;
      return `${s.name} ${delta}（${detail}）`;
    });
    let text = `得分：${parts.join(' ')}`;
    while (parts.length > 1 && this.ctx.measureText(text).width > maxWidth) {
      parts.pop();
      text = `得分：${parts.join(' ')}…`;
    }
    return text;
  }

  /** 参与者行按可用宽度截断（超出补省略号）。 */
  private fitParticipantText(r: MatchHistoryRecord, maxWidth: number): string {
    let names = r.players.join('、');
    this.ctx.font = `10px ${FONT_FAMILY}`;
    let text = `参与者：${names}`;
    while (names.length > 1 && this.ctx.measureText(text).width > maxWidth) {
      names = names.slice(0, -1);
      text = `参与者：${names}…`;
    }
    return text;
  }

  /** 日期时间：MM-DD HH:mm。 */
  private fmtDate(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 对局时长：分钟级，超过一小时带小时。 */
  private fmtDuration(ms: number): string {
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return `${min}分钟`;
    return `${Math.floor(min / 60)}小时${min % 60}分`;
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
    // 长提示自动换行（最多 4 行），底边锚在原来单行位置向上长高。
    const maxW = this.screenW - 48;
    const lines = wrapTextLines(ctx, this.message, maxW - 40);
    const lineH = 20;
    const msgW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40);
    const msgH = lines.length * lineH + 12;
    const x = (this.screenW - msgW) / 2;
    const y = this.screenH * 0.86 + 30 - msgH;
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
