// ============================================================================
// ProfileScene.ts — 个人中心场景
// ----------------------------------------------------------------------------
// 从首页「个人中心」进入：头像（微信头像/拍照/相册三选一；未设置时
// 元素色圆片 + 昵称末字兜底）+ 昵称（原生键盘修改）+ 历史战绩（云端 lami_history 查库：可滚动摘要列表，
// 点击单局弹详情弹窗：开始时间/时长/MVP/参与者/得分/完整回合记录），以及 背景音 / 音效 / 震动反馈 / 横屏模式 四个开关。
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
import { FROST_STRONG, FROST_BORDER, GOLD, INK, INK_SOFT, FONT_FAMILY } from './constants';
import { audio } from './audio';
import { requestOrientation, orientationSupported } from './orientation';
import { clearLastRoom } from '../cloud/room';
import {
  fetchMatchHistory,
  fetchMatchHistoryDetail,
  type MatchHistoryRecord,
  type MatchHistoryDetail,
} from '../cloud/game';
import type { TurnLogEntry } from '../game/log';
import {
  getNickname,
  chooseAvatarFromWeChat,
  drawAvatar,
  saveNicknameToCloud,
  saveAvatarImageToCloud,
  isVibrateEnabled,
  setVibrateEnabled,
  vibrateIfEnabled,
  getPreferredOrientation,
  setPreferredOrientation,
} from './profile';

const ROW_H = 48;
/** 历史战绩列表单条高度。 */
const HISTORY_ITEM_H = 34;
/** 滑动超过该阈值视为滚动，不再当点击。 */
const DRAG_THRESHOLD = 8;

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
  /** 战绩列表滚动状态与命中区域（绘制时记录）。 */
  private historyScrollY = 0;
  private historyMaxScroll = 0;
  private historyListRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private historyItemRects: SceneButtonRect[] = [];
  /** 对局详情弹窗：null = 未打开；log 为 null 表示详情加载中。 */
  private detailRecord: MatchHistoryDetail | null = null;
  private detailScrollY = 0;
  private detailMaxScroll = 0;
  private detailPanelRect: SceneButtonRect | null = null;
  /** 触摸滚动状态：按下位置 + 滚动目标区域。 */
  private pressPos: { x: number; y: number } | null = null;
  private pressMoved = false;
  private lastTouchY = 0;
  private scrollTarget: 'history' | 'detail' | null = null;

  private touchStartHandler = (e: { touches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches[0];
    if (!t) return;
    this.pressPos = { x: t.clientX, y: t.clientY };
    this.pressMoved = false;
    this.lastTouchY = t.clientY;
    this.scrollTarget = this.scrollTargetAt(t.clientX, t.clientY);
  };

  /** 拖动：在战绩列表 / 详情弹窗内容区滚动；超阈值后不再视为点击。 */
  private touchMoveHandler = (e: { touches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches[0];
    if (!t || !this.pressPos || !this.scrollTarget) return;
    const dy = t.clientY - this.lastTouchY;
    if (dy !== 0) {
      if (this.scrollTarget === 'history') {
        this.historyScrollY = Math.max(0, Math.min(this.historyMaxScroll, this.historyScrollY - dy));
      } else {
        this.detailScrollY = Math.max(0, Math.min(this.detailMaxScroll, this.detailScrollY - dy));
      }
      this.lastTouchY = t.clientY;
      this.dirty = true;
    }
    if (Math.abs(t.clientY - this.pressPos.y) > DRAG_THRESHOLD) this.pressMoved = true;
  };

  /** 抬起：未拖动则按点击处理（与 touchStart 配对，防跨场景透触）。 */
  private touchEndHandler = (e: { changedTouches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.changedTouches[0];
    const moved = this.pressMoved;
    this.pressPos = null;
    this.scrollTarget = null;
    if (!t || moved) return;
    this.handleTap(t.clientX, t.clientY);
  };

  /** 系统打断（来电等）：丢弃按压状态，避免后续误触。 */
  private touchCancelHandler = () => {
    this.pressPos = null;
    this.scrollTarget = null;
  };

  /** 按下点命中的滚动区域：详情弹窗打开时优先弹窗内容区。 */
  private scrollTargetAt(x: number, y: number): 'history' | 'detail' | null {
    if (this.detailRecord && this.detailPanelRect && hitRect(x, y, this.detailPanelRect)) return 'detail';
    if (!this.detailRecord && hitRect(x, y, this.historyListRect)) return 'history';
    return null;
  }

  private resizeHandler = (res?: { windowWidth?: number; windowHeight?: number }) => {
    this.measure(res);
    this.dirty = true;
  };

  /** 键盘「完成/发送」：云端先行保存昵称，失败不应用变更并提示。 */
  private keyboardConfirmHandler = (res: { value: string }) => {
    const name = (res.value ?? '').trim();
    if (!name) {
      this.showInfo('昵称不能为空');
      return;
    }
    saveNicknameToCloud(name).then((ok) => {
      if (this.disposed) return;
      this.showInfo(ok ? '昵称已更新' : '昵称保存失败，请检查网络后重试', ok ? 2000 : 4200);
      this.dirty = true;
    });
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
    wx.onTouchMove(this.touchMoveHandler);
    wx.onTouchEnd(this.touchEndHandler);
    wx.onTouchCancel(this.touchCancelHandler);
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
    wx.offTouchMove(this.touchMoveHandler);
    wx.offTouchEnd(this.touchEndHandler);
    wx.offTouchCancel(this.touchCancelHandler);
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
    // 详情弹窗打开时屏蔽底层交互：点弹窗外关闭，弹窗内由滚动接管。
    if (this.detailRecord) {
      const p = this.detailPanelRect;
      if (!p || !hitRect(px, py, p)) {
        this.detailRecord = null;
        this.detailPanelRect = null;
        this.dirty = true;
      }
      return;
    }
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
    // 战绩摘要行：点击打开对局详情弹窗（仅限可视列表区内）。
    if (hitRect(px, py, this.historyListRect)) {
      for (let i = 0; i < this.historyItemRects.length; i++) {
        if (hitRect(px, py, this.historyItemRects[i])) {
          this.openHistoryDetail(i);
          return;
        }
      }
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

  /** 头像来源三选一（微信头像/拍照/相册）：云端先行，保存成功才启用新图。 */
  private pickAvatar(): void {
    vibrateIfEnabled();
    chooseAvatarFromWeChat().then((result) => {
      if (this.disposed) return;
      if (result.errorMsg) {
        // 非用户取消的失败：给出可操作提示（最常见是隐私授权被拒）。
        this.showInfo(this.avatarPickFailTip(result.errorMsg), 4200);
        return;
      }
      if (!result.tempPath) return; // 用户主动取消：静默
      saveAvatarImageToCloud(result.tempPath).then((r) => {
        if (this.disposed) return;
        if (r.ok) {
          this.showInfo('头像已更新');
        } else {
          this.showInfo(r.errorMsg || '头像保存失败，请检查网络后重试', 4200);
        }
        this.dirty = true;
      });
    });
  }

  /** 把头像选择的原始 errMsg 翻译成玩家能看懂的提示。 */
  private avatarPickFailTip(errMsg: string): string {
    if (/privacy/i.test(errMsg)) {
      // 已自动尝试重新拉起隐私授权弹窗仍失败：引导用户同意后再试。
      return '需要同意隐私授权才能选择头像：请在弹出的授权窗中点击同意，或重启小游戏后重试';
    }
    if (/not in domain list/i.test(errMsg)) {
      // 微信头像 CDN 域名未配进 downloadFile 合法域名（后台配置问题）：引导替代方式。
      return '微信头像暂不可用，请改用拍照或从相册选择';
    }
    if (/auth\s*deny|authorize|permission/i.test(errMsg)) {
      return '相册未授权：请在微信「设置 → 隐私 → 个人信息与权限」中允许本小游戏访问相册';
    }
    return `头像选择失败：${errMsg}`;
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
      if (this.detailRecord) this.drawDetailPanel();
      if (this.message && Date.now() < this.messageUntil) this.drawMessage();
      return;
    }

    // 内容卡片：贴顶放（下方还要留给历史战绩卡片）。
    const cardW = Math.min(380, w * 0.92);
    const cardH = 96 + ROW_H * 4 + 26; // 头像颜色入口已移除，横屏入口暂隐藏，4 行
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

    const rowsY = cardY + 96;
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

    if (this.detailRecord) this.drawDetailPanel();
    if (this.message && Date.now() < this.messageUntil) this.drawMessage();
  }

  /** 横屏双卡片：左卡片头像/昵称/开关，右卡片历史战绩。 */
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

    // ---- 左列：头像 + 昵称 ----
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

  /** 历史战绩卡片：标题 + 可滚动摘要列表（开始时间/时长/MVP；MVP 行金色底，点击查看详情）。 */
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

    const listTop = y + 36;
    const listH = h - 36 - 10;
    this.historyListRect = { x, y: listTop, w, h: listH };
    this.historyItemRects = [];

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

    // 摘要列表：单行定高 item（开始时间 · 时长 + 右侧 MVP/冠军），裁剪后按滚动偏移平移。
    const contentH = records.length * HISTORY_ITEM_H;
    this.historyMaxScroll = Math.max(0, contentH - listH);
    if (this.historyScrollY > this.historyMaxScroll) this.historyScrollY = this.historyMaxScroll;

    ctx.save();
    roundRectPath(ctx, x + 4, listTop, w - 8, listH, 8);
    ctx.clip();
    ctx.translate(0, -this.historyScrollY);
    let ry = listTop;
    for (const r of records) {
      if (r.selfWon) {
        ctx.fillStyle = 'rgba(233,201,127,0.18)';
        roundRectPath(ctx, x + 10, ry + 3, w - 20, HISTORY_ITEM_H - 6, 8);
        ctx.fill();
      }
      const cy = ry + HISTORY_ITEM_H / 2;
      drawSceneText(ctx, x + 16, cy, `${this.fmtDate(r.startedAt)} · ${this.fmtDuration(r.durationMs)}`, {
        size: 11,
        color: INK,
        align: 'left',
      });
      drawSceneText(ctx, x + w - 16, cy, r.selfWon ? '🏆 MVP' : `冠军 ${r.winnerName}`, {
        size: 11,
        color: r.selfWon ? GOLD : INK_SOFT,
        align: 'right',
      });
      // 命中矩形换算回屏幕坐标（绘制空间已平移 -historyScrollY）。
      this.historyItemRects.push({ x: x + 4, y: ry - this.historyScrollY, w: w - 8, h: HISTORY_ITEM_H });
      ry += HISTORY_ITEM_H;
    }
    ctx.restore();

    // 滚动指示条：内容溢出时右侧小滑块。
    if (this.historyMaxScroll > 0) {
      const trackX = x + w - 7;
      const trackY = listTop + 2;
      const trackH = listH - 4;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundRectPath(ctx, trackX, trackY, 3, trackH, 1.5);
      ctx.fill();
      const thumbH = Math.max(18, trackH * (listH / contentH));
      const thumbY = trackY + (this.historyScrollY / this.historyMaxScroll) * (trackH - thumbH);
      ctx.fillStyle = 'rgba(233,201,127,0.85)';
      roundRectPath(ctx, trackX, thumbY, 3, thumbH, 1.5);
      ctx.fill();
    }
  }

  /** 点击摘要行：打开详情弹窗并查云端单局详情（含完整回合日志）。 */
  private openHistoryDetail(index: number): void {
    const records = this.historyRecords;
    if (!records || !records[index]) return;
    const r = records[index];
    vibrateIfEnabled();
    // 先以列表已有字段展示基础信息，回合记录等详情异步补齐。
    this.detailRecord = { ...r, log: null as unknown as TurnLogEntry[] } as MatchHistoryDetail;
    this.detailScrollY = 0;
    this.dirty = true;
    fetchMatchHistoryDetail(r.code)
      .then((detail) => {
        if (this.disposed || !this.detailRecord || this.detailRecord.code !== r.code) return;
        this.detailRecord = detail;
        this.dirty = true;
      })
      .catch((e: any) => {
        if (this.disposed || !this.detailRecord || this.detailRecord.code !== r.code) return;
        this.detailRecord = { ...this.detailRecord, log: [] };
        this.showInfo((e && e.message) || '对局详情加载失败', 3000);
        this.dirty = true;
      });
  }

  /** 对局详情弹窗：开始时间/时长/MVP/参与者/得分/回合记录，整块内容可滚动。 */
  private drawDetailPanel(): void {
    const ctx = this.ctx;
    const d = this.detailRecord;
    if (!d) return;
    // 全屏遮罩：压暗背景，突出弹窗卡片。
    ctx.fillStyle = 'rgba(24,32,44,0.55)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    const panelW = Math.min(320, this.screenW * 0.9);
    const panelH = Math.min(400, this.screenH * 0.82);
    const px = (this.screenW - panelW) / 2;
    const py = (this.screenH - panelH) / 2;
    this.detailPanelRect = { x: px, y: py, w: panelW, h: panelH };

    // 墨玻璃卡片（与回合记录弹窗同一视觉语言）。
    ctx.fillStyle = 'rgba(6,14,22,0.4)';
    roundRectPath(ctx, px + 2, py + 4, panelW, panelH, 14);
    ctx.fill();
    ctx.fillStyle = FROST_STRONG;
    roundRectPath(ctx, px, py, panelW, panelH, 14);
    ctx.fill();
    ctx.strokeStyle = FROST_BORDER;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, px, py, panelW, panelH, 14);
    ctx.stroke();

    drawSceneText(ctx, this.screenW / 2, py + 24, `对局详情 · 房号 ${d.code}`, {
      size: 15,
      bold: true,
      color: INK,
    });

    const textLeft = px + 20;
    const maxTextW = panelW - 40;

    // 内容整体一个滚动区：头部信息 + 参与者 + 得分 + 回合记录。
    const loading = d.log === null;
    const log = d.log || [];
    const logLines = log.map((entry) => this.detailLogLines(entry, maxTextW - 12));
    let contentH = 8 + 20 + 26 + 20 + 28;
    contentH += d.players.length * 16 + 10;
    contentH += (d.scores.length > 0 ? d.scores.length * 17 + 26 : 20);
    contentH += 8;
    if (loading) contentH += 24;
    else if (log.length === 0) contentH += 24;
    else for (const lines of logLines) contentH += 24 + lines.length * 14 + 6;

    const listTop = py + 42;
    const listH = panelH - 42 - 12;
    this.detailMaxScroll = Math.max(0, contentH - listH);
    if (this.detailScrollY > this.detailMaxScroll) this.detailScrollY = this.detailMaxScroll;

    ctx.save();
    roundRectPath(ctx, px + 10, listTop, panelW - 20, listH, 8);
    ctx.clip();
    ctx.translate(0, -this.detailScrollY);

    let ry = listTop + 8;
    drawSceneText(ctx, textLeft, ry + 10, `开始时间 ${this.fmtDate(d.startedAt)} · 时长 ${this.fmtDuration(d.durationMs)}`, {
      size: 12,
      color: INK,
      align: 'left',
    });
    ry += 20;
    drawSceneText(ctx, textLeft, ry + 13, d.selfWon ? '🏆 MVP（本人夺冠）' : `冠军：${d.winnerName}`.slice(0, 24), {
      size: 12,
      color: d.selfWon ? GOLD : INK,
      align: 'left',
    });
    ry += 26;

    drawSceneText(ctx, textLeft, ry + 10, '参与者', { size: 12, bold: true, color: INK_SOFT, align: 'left' });
    ry += 20;
    for (const name of d.players) {
      drawSceneText(ctx, textLeft + 8, ry + 8, this.fitText(name, maxTextW - 8), { size: 11, color: INK, align: 'left' });
      ry += 16;
    }
    ry += 10;

    drawSceneText(ctx, textLeft, ry + 10, '得分情况', { size: 12, bold: true, color: INK_SOFT, align: 'left' });
    ry += 20;
    if (d.scores.length === 0) {
      drawSceneText(ctx, textLeft + 8, ry + 8, '（老局无得分记录）', { size: 11, color: INK_SOFT, align: 'left' });
      ry += 20;
    } else {
      for (const s of d.scores) {
        const delta = s.scoreDelta > 0 ? `+${s.scoreDelta}` : `${s.scoreDelta}`;
        const detail = s.isWinner ? '出完所有牌' : `余${s.remainingCount}张/${s.remainingScore}分`;
        drawSceneText(ctx, textLeft + 8, ry + 8, this.fitText(`${s.isWinner ? '🏆 ' : ''}${s.name}  ${delta}（${detail}）`, maxTextW - 8), {
          size: 11,
          color: s.isWinner ? GOLD : INK,
          align: 'left',
        });
        ry += 17;
      }
      ry += 9;
    }
    ry += 8;

    drawSceneText(ctx, textLeft, ry + 10, `回合记录（${loading ? '加载中…' : `${log.length} 回合`}）`, {
      size: 12,
      bold: true,
      color: INK_SOFT,
      align: 'left',
    });
    ry += 20;
    if (loading) {
      drawSceneText(ctx, textLeft + 8, ry + 12, '正在加载回合记录…', { size: 11, color: INK_SOFT, align: 'left' });
    } else if (log.length === 0) {
      drawSceneText(ctx, textLeft + 8, ry + 12, '该对局无回合记录', { size: 11, color: INK_SOFT, align: 'left' });
    } else {
      log.forEach((entry, i) => {
        const eh = 24 + logLines[i].length * 14;
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        roundRectPath(ctx, px + 14, ry, panelW - 28, eh, 8);
        ctx.fill();
        drawSceneText(ctx, px + 24, ry + 14, `回合 ${entry.turnNumber} · ${entry.playerName}`, {
          size: 12,
          bold: true,
          color: INK,
          align: 'left',
        });
        let ly = ry + 28;
        for (const line of logLines[i]) {
          drawSceneText(ctx, px + 24, ly, line, { size: 11, color: INK_SOFT, align: 'left' });
          ly += 14;
        }
        ry += eh + 6;
      });
    }
    ctx.restore();

    // 滚动指示条。
    if (this.detailMaxScroll > 0) {
      const trackX = px + panelW - 7;
      const trackY = listTop + 2;
      const trackH = listH - 4;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundRectPath(ctx, trackX, trackY, 3, trackH, 1.5);
      ctx.fill();
      const thumbH = Math.max(18, trackH * (listH / contentH));
      const thumbY = trackY + (this.detailScrollY / this.detailMaxScroll) * (trackH - thumbH);
      ctx.fillStyle = 'rgba(233,201,127,0.85)';
      roundRectPath(ctx, trackX, thumbY, 3, thumbH, 1.5);
      ctx.fill();
    }
  }

  /** 回合记录条目按可用宽度折行（首行总述与牌面明细都可能超宽）。 */
  private detailLogLines(entry: TurnLogEntry, maxW: number): string[] {
    const ctx = this.ctx;
    ctx.font = `11px ${FONT_FAMILY}`;
    const out: string[] = [];
    for (const line of entry.lines) {
      const wrapped = wrapTextLines(ctx, line, maxW);
      for (const wl of wrapped) out.push(wl);
    }
    return out;
  }

  /** 单行文本按可用宽度截断（超出补省略号）。 */
  private fitText(text: string, maxWidth: number): string {
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t}…`;
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
