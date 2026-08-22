// ============================================================================
// RoomScene.ts — 房间等待场景
// ----------------------------------------------------------------------------
// 展示房号与玩家座位，房主可分享邀请好友或逐个添加机器人补位（真人+机器人混战）；
// 客户端每 2 秒轮询房间状态，人齐后房主点击「开始游戏」，其余玩家轮询到 started 后自动进局。
// 顶栏左上「返回」回首页（房间保留，可从首页重新进入）；房主右上「解散房间」关闭房间，
// 非房主右上「退出房间」把自己移出座位。
// ============================================================================

import { ScreenInfo, getScreenInfo, applyCanvasSize } from './screen';
import { roundRectPath } from './renderer';
import {
  drawBackdrop,
  drawSceneText,
  drawCapsuleButton,
  drawSparkle,
  hitRect,
  SceneButtonRect,
} from './backdrop';
import {
  FROST,
  FROST_STRONG,
  FROST_BORDER,
  GOLD,
  GOLD_SOFT,
  INK,
  INK_SOFT,
  AVATAR_COLORS,
} from './constants';
import { RoomInfo, RoomResult, getRoom, startRoom, addRoomBot, leaveRoom, disbandRoom, clearLastRoom } from '../cloud/room';

const POLL_INTERVAL_MS = 2000;

export class RoomScene {
  /** 房间开始游戏后回调（携带最新房间数据与本人 openid） */
  onStart: ((room: RoomInfo, selfOpenid: string) => void) | null = null;
  /** 返回首页回调（房间保留在云端，可从首页重新进入；解散成功后也走这里） */
  onExit: (() => void) | null = null;

  readonly code: string;

  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private screenW: number;
  private screenH: number;
  private pixelRatio: number;
  private safeTop: number;

  private room: RoomInfo;
  private myOpenid: string;
  private isHost: boolean;

  private rafId = 0;
  private dirty = true;
  private busy = false;
  /** 已触发进场（防止重复 enterGame） */
  private entered = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private message = '';
  private messageUntil = 0;

  private shareBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private startBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private addBotBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private backBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private disbandBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  private leaveBtnRect: SceneButtonRect = { x: 0, y: 0, w: 0, h: 0 };

  private touchStartHandler = (e: { touches: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches[0];
    if (!t) return;
    this.handleTap(t.clientX, t.clientY);
  };

  private resizeHandler = (res?: { windowWidth?: number; windowHeight?: number }) => {
    this.measure(res);
    this.dirty = true;
  };

  constructor(canvas: HTMLCanvasElement, info: ScreenInfo, result: RoomResult) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.screenW = info.screenWidth;
    this.screenH = info.screenHeight;
    this.pixelRatio = info.pixelRatio;
    this.safeTop = info.safeTop;
    this.room = result.room;
    this.myOpenid = result.self;
    this.isHost = result.room.host === result.self;
    this.code = result.room.code;
    this.measure();

    wx.onTouchStart(this.touchStartHandler);
    wx.onWindowResize(this.resizeHandler);
    this.rafId = requestAnimationFrame(this.tick);

    // 等待中持续轮询房间状态；重连进入时房间可能已在对局中，先立即查一次。
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    setTimeout(() => this.poll(), 400);
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    cancelAnimationFrame(this.rafId);
    wx.offTouchStart(this.touchStartHandler);
    wx.offWindowResize(this.resizeHandler);
  }

  showInfo(msg: string, duration = 2600): void {
    this.message = msg;
    this.messageUntil = Date.now() + duration;
    this.dirty = true;
  }

  // --------------------------------------------------------------------------
  // 轮询与开始
  // --------------------------------------------------------------------------

  private poll(): void {
    if (this.busy || this.entered) return;
    getRoom(this.code)
      .then((result) => {
        this.room = result.room;
        this.dirty = true;
        if (this.isRoomStarted()) {
          this.enterGame();
        }
      })
      .catch(() => {
        // 轮询失败静默重试，避免打扰用户
      });
  }

  /** 房主已点开始（started）或对局已在进行（playing，竞态下可能跳过 started）。 */
  private isRoomStarted(): boolean {
    return this.room.status === 'started' || this.room.status === 'playing';
  }

  private enterGame(): void {
    if (this.entered) return;
    this.entered = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.onStart?.(this.room, this.myOpenid);
  }

  private handleTap(px: number, py: number): void {
    if (this.busy) return;

    if (hitRect(px, py, this.backBtnRect)) {
      this.onExit?.();
      return;
    }

    if (this.room.status !== 'waiting') return;

    if (hitRect(px, py, this.shareBtnRect)) {
      this.share();
      return;
    }

    const full = this.room.players.length >= this.room.capacity;

    if (this.isHost && hitRect(px, py, this.disbandBtnRect)) {
      this.confirmDisband();
      return;
    }

    if (!this.isHost && hitRect(px, py, this.leaveBtnRect)) {
      this.confirmLeave();
      return;
    }

    if (this.isHost && !full && hitRect(px, py, this.addBotBtnRect)) {
      this.addBot();
      return;
    }

    if (this.isHost && full && hitRect(px, py, this.startBtnRect)) {
      this.busy = true;
      this.dirty = true;
      startRoom(this.code)
        .then((result) => {
          this.room = result.room;
          this.enterGame();
        })
        .catch((e: Error) => {
          this.busy = false;
          this.showInfo(e.message);
        });
    }
  }

  /** 房主解散房间（二次确认）：云端删除文档后清本地房间记忆，回首页。 */
  private confirmDisband(): void {
    wx.showModal({
      title: '解散房间',
      content: '解散后房间将关闭，所有玩家都会移出。确定解散吗？',
      confirmText: '解散',
      success: (res) => {
        if (!res.confirm) return;
        this.busy = true;
        this.dirty = true;
        disbandRoom(this.code)
          .then(() => {
            clearLastRoom();
            this.onExit?.();
          })
          .catch((e: Error) => {
            this.busy = false;
            this.showInfo(e.message);
          });
      },
    });
  }

  /** 非房主退出房间（二次确认）：把自己移出座位后清本地房间记忆，回首页。 */
  private confirmLeave(): void {
    wx.showModal({
      title: '退出房间',
      content: '退出后你会离开这个房间，想再玩需要重新加入。确定退出吗？',
      confirmText: '退出',
      success: (res) => {
        if (!res.confirm) return;
        this.busy = true;
        this.dirty = true;
        leaveRoom(this.code)
          .then(() => {
            clearLastRoom();
            this.onExit?.();
          })
          .catch((e: Error) => {
            this.busy = false;
            this.showInfo(e.message);
          });
      },
    });
  }

  /** 房主添加一个机器人补位；凑满人数后即可真人+机器人开局。 */
  private addBot(): void {
    this.busy = true;
    this.dirty = true;
    addRoomBot(this.code)
      .then((result) => {
        this.room = result.room;
        this.busy = false;
        this.dirty = true;
      })
      .catch((e: Error) => {
        this.busy = false;
        this.showInfo(e.message);
      });
  }

  /** 微信分享邀请好友（好友点开分享卡片会携带 roomId 直接进入房间） */
  private share(): void {
    const remain = this.room.capacity - this.room.players.length;
    wx.shareAppMessage({
      title: remain > 0
        ? `来一起玩拉密！房间 ${this.code} 还差 ${remain} 人`
        : `来围观拉密对局！房间 ${this.code}`,
      query: `roomId=${this.code}`,
      fail: () => {
        this.showInfo('分享失败，请重试');
      },
    });
  }

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
    this.drawBackButton();
    this.drawDisbandButton();
    this.drawLeaveButton();
    this.drawRoomCard();
    if (this.message && Date.now() < this.messageUntil) this.drawMessage();
  }

  private drawBackButton(): void {
    this.backBtnRect = { x: 12, y: this.safeTop + 8, w: 64, h: 30 };
    drawCapsuleButton(this.ctx, this.backBtnRect, '返回', 'secondary', 13);
  }

  /** 房主专属：解散等待中的房间（danger 醒目样式，区别于普通返回）。
   * 紧贴「返回」按钮右侧排布：右上角留给微信胶囊按钮，避免遮挡。 */
  private drawDisbandButton(): void {
    if (!this.isHost || this.room.status !== 'waiting') {
      this.disbandBtnRect = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }
    this.disbandBtnRect = { x: 88, y: this.safeTop + 8, w: 80, h: 30 };
    drawCapsuleButton(this.ctx, this.disbandBtnRect, this.busy ? '解散中…' : '解散房间', 'danger', 13);
  }

  /** 非房主专属：退出等待中的房间（把自己移出座位，与「返回」区分）。 */
  private drawLeaveButton(): void {
    if (this.isHost || this.room.status !== 'waiting') {
      this.leaveBtnRect = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }
    this.leaveBtnRect = { x: 88, y: this.safeTop + 8, w: 80, h: 30 };
    drawCapsuleButton(this.ctx, this.leaveBtnRect, this.busy ? '退出中…' : '退出房间', 'secondary', 13);
  }

  private drawRoomCard(): void {
    const ctx = this.ctx;
    const { screenW: w, screenH: h } = this;
    const room = this.room;
    const full = room.players.length >= room.capacity;

    // 墨玻璃主卡片（高度容纳标题+座位+操作区+底部提示，矮屏时按屏幕夹住）
    const cardW = Math.min(460, w * 0.86);
    const cardH = Math.min(280, h * 0.86);
    const cardX = (w - cardW) / 2;
    const cardY = (h - cardH) / 2;

    ctx.fillStyle = 'rgba(6,14,22,0.4)';
    roundRectPath(ctx, cardX + 2, cardY + 4, cardW, cardH, 18);
    ctx.fill();
    ctx.fillStyle = FROST;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 18);
    ctx.fill();
    ctx.strokeStyle = FROST_BORDER;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 18);
    ctx.stroke();

    // 房号标题（两侧光斑点缀）
    const titleY = cardY + 34;
    const title = `房间 ${room.code}`;
    drawSceneText(ctx, w / 2, titleY, title, {
      size: 24,
      bold: true,
      color: INK,
    });
    drawSparkle(ctx, w / 2 - 104, titleY, 4, GOLD_SOFT);
    drawSparkle(ctx, w / 2 + 104, titleY, 4, GOLD_SOFT);
    drawSceneText(ctx, w / 2, titleY + 24, `${room.players.length} / ${room.capacity} 人`, {
      size: 13,
      color: INK_SOFT,
    });

    // 玩家座位
    const slotY = titleY + 52;
    const slotGap = Math.min(96, (cardW - 60) / room.capacity);
    const rowW = slotGap * room.capacity;
    for (let i = 0; i < room.capacity; i++) {
      const sx = w / 2 - rowW / 2 + slotGap / 2 + i * slotGap;
      const player = room.players[i];
      const color = AVATAR_COLORS[i % AVATAR_COLORS.length];

      if (player) {
        // 已入座：头像圆 + 名字（房主加金色星标）
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, slotY, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const initial = player.name.slice(0, 1);
        drawSceneText(ctx, sx, slotY + 1, initial, { size: 16, bold: true, color: '#FFFFFF' });

        const isMe = player.openid === this.myOpenid;
        drawSceneText(ctx, sx, slotY + 36, `${player.name}${isMe ? '(我)' : ''}`, {
          size: 12,
          color: INK,
        });
        if (player.openid === room.host) {
          drawSceneText(ctx, sx + 26, slotY - 14, '★', { size: 12, color: GOLD_SOFT });
        }
      } else {
        // 空位：虚线圆
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sx, slotY, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        drawSceneText(ctx, sx, slotY + 36, '等待加入…', { size: 12, color: INK_SOFT });
      }
    }

    // 操作区（按钮与底部提示分开两行，避免重叠）
    const actionY = cardY + cardH - 70;
    const shareW = Math.min(180, cardW * 0.4);
    this.shareBtnRect = { x: w / 2 - shareW / 2, y: actionY, w: shareW, h: 40 };
    this.addBotBtnRect = { x: 0, y: 0, w: 0, h: 0 };

    if (room.status !== 'waiting') {
      const text = room.status === 'finished' ? '该房间对局已结束' : '正在进入游戏…';
      drawSceneText(ctx, w / 2, actionY + 20, text, { size: 16, color: INK });
      return;
    }

    if (!full) {
      if (this.isHost) {
        // 房主：邀请好友 + 添加机器人双按钮，凑满即可开局
        const btnW = Math.min(150, cardW * 0.34);
        this.shareBtnRect = { x: w / 2 - btnW - 8, y: actionY, w: btnW, h: 40 };
        this.addBotBtnRect = { x: w / 2 + 8, y: actionY, w: btnW, h: 40 };
        drawCapsuleButton(ctx, this.shareBtnRect, '邀请好友', 'secondary', 15);
        drawCapsuleButton(ctx, this.addBotBtnRect, this.busy ? '添加中…' : '+ 机器人', 'primary', 15);
        drawSceneText(ctx, w / 2, cardY + cardH - 12, '凑满人数即可开始（机器人可补位）', {
          size: 11,
          color: INK_SOFT,
        });
      } else {
        drawCapsuleButton(ctx, this.shareBtnRect, '邀请好友', 'primary', 16);
        drawSceneText(ctx, w / 2, cardY + cardH - 12, '等人齐，房主开始后自动进入', {
          size: 11,
          color: INK_SOFT,
        });
      }
    } else if (this.isHost) {
      // 人齐：只留开始按钮（满员后分享邀请已无意义，join 会被拒）
      const btnW = Math.min(180, cardW * 0.4);
      this.shareBtnRect = { x: 0, y: 0, w: 0, h: 0 };
      this.startBtnRect = { x: w / 2 - btnW / 2, y: actionY, w: btnW, h: 40 };
      drawCapsuleButton(ctx, this.startBtnRect, this.busy ? '开始中…' : '开始游戏', 'primary', 16);
    } else {
      drawSceneText(ctx, w / 2, actionY + 20, '人已齐，等待房主开始…', { size: 16, color: INK });
    }
  }

  private drawMessage(): void {
    const ctx = this.ctx;
    ctx.font = 'bold 14px PingFang SC, Microsoft YaHei, sans-serif';
    const tw = ctx.measureText(this.message).width;
    const msgW = tw + 40;
    const msgH = 30;
    const x = (this.screenW - msgW) / 2;
    const y = this.screenH * 0.85;

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
