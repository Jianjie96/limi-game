// ============================================================================
// GameScene.ts — 用原生 Canvas 2D 渲染的主游戏场景
// ----------------------------------------------------------------------------
// 仅负责「渲染 + 输入」，所有游戏规则仍在 src/game/ 纯逻辑层（引擎）中。
// 命中检测复用纯计算的布局函数（layoutRack / layoutBoard / hitTest*），
// 绘制统一通过 Canvas 2D 上下文在逻辑坐标下进行（由 DPR 缩放映射到物理像素）。
// ============================================================================

import type { Tile, TileGroup, GameState, PlayerState } from '../game/types';
import { GamePhase } from '../game/types';
import { RummikubEngine } from '../game/engine';
import type { OnlineCoordinator } from './online';
import { drawCapsuleButton } from './backdrop';
import { canFormMelds, isValidRun, isValidGroupTiles } from '../game/validate';
import { detectGroupType, toLogical } from '../game/tiles';
import {
  LAYOUT,
  FONT_FAMILY,
  FONT_SIZE_LABEL,
  FONT_SIZE_BUTTON,
  PLAYER_INFO_HEIGHT,
  PLAYER_INFO_BG,
  AVATAR_COLORS,
  SKY_TOP,
  SKY_MID,
  SKY_BOTTOM,
  FROST,
  FROST_STRONG,
  FROST_BORDER,
  GOLD,
  GOLD_DEEP,
  GOLD_SOFT,
  INK,
  INK_SOFT,
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_GAP,
  WORKING_AREA_BG,
  WORKING_AREA_BORDER,
  WORKING_AREA_LABEL,
  WORKING_AREA_HEIGHT,
  BOARD_GROUP_BG,
  BOARD_GROUP_BORDER,
  BOARD_GROUP_HIGHLIGHT_BG,
  BOARD_GROUP_HIGHLIGHT_BORDER,
  BUTTON_HEIGHT,
  BUTTON_COLORS,
} from './constants';
import { layoutRack, layoutRackWithGap, rackGapIndexAt, hitTestRack, rackHeight, type RackConfig, type RackTileSlot } from './Rack';
import {
  layoutBoard,
  hitTestBoard,
  hitTestBoardGroup,
  boardContentHeight,
  type BoardConfig,
  type BoardGroupSlot,
  type BoardTileSlot,
} from './Board';
import { createButtonStates, hitTestButton, type ButtonState } from './Button';
import { isDevEnvironment } from './env';
import {
  drawBoardTile,
  drawPhysicalTile,
  roundRectPath,
  type TileRenderOptions,
} from './renderer';
import { getScreenInfo, getScreenInfoAfterRotation, type ScreenInfo } from './screen';
import { audio } from './audio';
import { vibrateIfEnabled } from './profile';

/** 工作区单张牌的位置信息（用于绘制与命中检测） */
interface WorkingAreaSlot {
  tile: Tile;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 拖拽来源 */
type DragSourceKind = 'rack' | 'board' | 'working';

/** 被拖拽牌的来源信息 */
interface DragSource {
  kind: DragSourceKind;
  tile: Tile;
  tileId: number;
  sourceGroupId?: string;
}

/** 拖拽过程中的状态 */
interface DragState {
  source: DragSource;
  curX: number;
  curY: number;
}

/** 文本绘制选项 */
interface TextOptions {
  size: number;
  color: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
  /** 卡通描边（先描边后填充，用于标题等醒目文字） */
  outline?: { color: string; width: number };
}

/** 拖拽触发阈值（逻辑像素）：移动超过该距离才进入拖拽状态。 */
const DRAG_THRESHOLD = 8;

/** 长按牌架「拿起」牌的判定时长（毫秒）：拿起后可任意方向拖拽（含牌架内重排）。 */
const LONG_PRESS_DELAY = 400;

/** 拖拽时幽灵牌的缩放系数。 */
const DRAG_GHOST_SCALE = 1.05;
/** 批量发牌时每张牌的错峰间隔（毫秒）：一张一张发，留出观看节拍，堆高对后续牌的期待。 */
const DEAL_STAGGER_MS = 160;
/** 批量发牌判定阈值：一次出现 ≥ 该数量的新牌架牌才按「发牌」仪式慢速节奏。 */
const DEAL_BULK_THRESHOLD = 6;
/** 摸牌等少量增补时每张牌的错峰间隔（毫秒）：快进快出，不阻塞操作。 */
const DEAL_QUICK_STAGGER_MS = 40;
/** 发牌单张飞行基础时长（毫秒），实际随距离小幅加长。 */
const DEAL_FLIGHT_MS = 300;
/** 结算面板弹出动画时长（毫秒）。 */
const GAME_OVER_ANIM_MS = 320;
/** 牌动画平滑速度（越大越跟手，指数平滑系数）。 */
const ANIM_SPEED = 16;

/** 牌的渲染动画状态：当前位置/缩放 + 目标位置/缩放 + 出生延迟。 */
interface TileAnim {
  x: number;
  y: number;
  scale: number;
  tx: number;
  ty: number;
  tscale: number;
  /** 出生延迟（毫秒）：发牌级联时牌先停在牌池点堆成牌堆，到时再逐张飞出。 */
  pending: number;
  /** 拱形飞行：理牌预览让位/复位、发牌飞行时沿二次贝塞尔拱起移动。 */
  arc?: {
    sx: number;
    sy: number;
    /** 起始缩放：飞行期间同步放大到目标缩放。 */
    ss: number;
    t: number;
    dur: number;
    delay: number;
    /** 发牌飞行：用带回弹的缓出曲线强调「落牌感」。 */
    back?: boolean;
  };
}

/** easeOutBack：带轻微回弹的缓出曲线，弹出动画更有卡通感。 */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class GameScene {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private engine: RummikubEngine;

  private screenW: number;
  private screenH: number;
  private pixelRatio: number;
  private safeTop: number;
  private safeBottom: number;
  private safeLeft: number;
  private safeRight: number;

  private boardConfig!: BoardConfig;
  private rackConfig!: RackConfig;
  private workingAreaY = 0;
  private workingAreaHeight = WORKING_AREA_HEIGHT;
  private boardBottom = 0;

  private rackSlots: RackTileSlot[] = [];
  private boardSlots: BoardGroupSlot[] = [];
  private workingAreaSlots: WorkingAreaSlot[] = [];

  private selectedRackIds: Set<number> = new Set();
  private highlightedGroupIds: Set<string> = new Set();

  // 拖拽状态
  private drag: DragState | null = null;
  private pressSource: DragSource | null = null;
  private pressX = 0;
  private pressY = 0;

  // 牌架手势状态：横扫连选 / 长按拿起待拖拽
  private longPressTimer: any = null;
  /** 长按「拿起」状态：激活后任意方向移动即进入拖拽。 */
  private longPressActive = false;
  /** 横扫连选状态：按下牌架牌横向滑动时持续扩展选中范围。 */
  private sweepSelectActive = false;
  private rangeSelectAnchor: number | null = null;
  /** 理牌实时预览：拖拽牌架牌时牌架中开出的缺口索引（排除后序列），null 表示无预览。 */
  private previewGapIndex: number | null = null;

  /**
   * 本场景是否经历过 touchStart。
   * 防止跨场景 tap 穿透：上个场景的点击（如首页「联机测试房」）会在场景切换后
   * 才派发 touchEnd，若不拦截会被本场景误当成一次点击（曾导致进局即误触 Pass）。
   */
  private touchActive = false;

  private buttons: ButtonState[] = [];
  private orientationButton!: ButtonState;
  /** 结束对局回调（仅测试房房主挂接）：挂接后顶栏右侧显示「结束对局」按钮。 */
  onRequestEndGame: (() => void) | null = null;
  private endGameRect: { x: number; y: number; w: number; h: number } | null = null;

  private isLandscape = false;
  /** dispose 后丢弃异步回调（转屏等待可能晚于场景释放）。 */
  private disposed = false;

  private message = '';
  private messageTimer: any = null;
  /** 辅助提示开关：开发版全量展示，线上只保留必要提示。 */
  private tipsEnabled = isDevEnvironment();
  /** 渲染循环句柄（dispose 时取消） */
  private rafId = 0;

  private dirty = true;

  // 动画系统
  /** 每张牌的渲染动画状态（当前位置 → 目标位置）。 */
  private tileAnims = new Map<number, TileAnim>();
  /** 飞行中牌的延迟绘制回调（置顶绘制，不被面板遮挡）。 */
  private flyingDraws: Array<() => void> = [];
  private lastTickAt = 0;
  private messageAlpha = 1;
  private messageFading = false;
  /** 结算面板弹出动画起始时刻（0 = 未开始）。 */
  private gameOverStart = 0;

  /** 本人的玩家索引。 */
  private selfIndex: number;
  /** 在线同步协调器（由入口注入）。 */
  coordinator: OnlineCoordinator | null = null;
  /** 下一次全量加载是否播放发牌动画（断线重连置 false，全量原地展示）。 */
  private dealAnimEnabled = true;

  constructor(
    canvas: HTMLCanvasElement,
    engine: RummikubEngine,
    info: ScreenInfo,
    selfIndex = 0
  ) {
    this.selfIndex = selfIndex;
    this.engine = engine;
    this.screenW = info.screenWidth;
    this.screenH = info.screenHeight;
    this.pixelRatio = info.pixelRatio;
    this.safeTop = info.safeTop;
    this.safeBottom = info.safeBottom;
    this.safeLeft = info.safeLeft;
    this.safeRight = info.safeRight;

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.isLandscape = info.screenWidth > info.screenHeight;

    this.setupButtons();
    this.setupOrientationButton();
    this.updateLayout();
    this.bindTouch();
    this.bindResize();
    this.setupEngineListeners();
  }

  // =========================================================================
  // 布局
  // =========================================================================

  private layoutY(ratio: number): number {
    const usableH = this.screenH - this.safeTop - this.safeBottom;
    return this.safeTop + usableH * ratio;
  }

  private setupButtons(): void {
    // 主按钮「出牌」放右侧（用户习惯右边是主操作）；布局按数组顺序从左到右。
    this.buttons = createButtonStates([
      { id: 'pass', label: 'Pass 摸牌', x: 0, y: 0, width: 0, variant: 'secondary' },
      { id: 'submit', label: '出牌', x: 0, y: 0, width: 0, variant: 'primary' },
    ]);
  }

  private setupOrientationButton(): void {
    this.orientationButton = createButtonStates([
      {
        id: 'toggleOrientation',
        label: this.isLandscape ? '切竖屏' : '切横屏',
        x: 0,
        y: 0,
        width: 76,
        height: 24,
        variant: 'secondary',
      },
    ])[0];
  }

  private updateLayout(): void {
    this.boardConfig = {
      screenW: this.screenW,
      screenH: this.screenH,
      topY: this.layoutY(LAYOUT.boardTop),
      bottomY: this.layoutY(LAYOUT.boardBottom),
      left: this.safeLeft,
      right: this.safeRight,
    };

    this.workingAreaY = this.layoutY(LAYOUT.workingAreaTop);

    this.rackConfig = {
      screenW: this.screenW,
      screenH: this.screenH,
      y: this.layoutY(LAYOUT.rackTop),
      left: this.safeLeft,
      right: this.safeRight,
    };

    const contentW = this.screenW - this.safeLeft - this.safeRight;
    const btnW = (contentW - 40) / 2;
    const btnY = this.layoutY(LAYOUT.buttonAreaTop);
    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i].config.x = this.safeLeft + 8 + i * (btnW + 8);
      this.buttons[i].config.y = btnY;
      this.buttons[i].config.width = btnW;
    }

    // 转屏按钮：固定在右上角（顶栏下方），避开右侧安全区。
    const ow = this.orientationButton.config.width;
    this.orientationButton.config.x = this.screenW - this.safeRight - ow - 8;
    this.orientationButton.config.y = this.safeTop + PLAYER_INFO_HEIGHT + 3;
    this.orientationButton.config.label = this.isLandscape ? '切竖屏' : '切横屏';
  }

  private updateButtonStates(): void {
    // 仅本人回合处于可操作阶段：玩家可随时「出牌」或选择「Pass 摸牌」。
    const canAct = this.canAct();
    for (const btn of this.buttons) {
      btn.config.enabled = canAct;
    }
  }

  private getSelfPlayer(): PlayerState {
    const state = this.engine.getState();
    return state.players[this.selfIndex] ?? this.engine.getCurrentPlayer();
  }

  /** 发牌动画开关（一次性）：断线重连首次全量加载前置 false，跳过发牌仪式。 */
  setDealAnimEnabled(enabled: boolean): void {
    this.dealAnimEnabled = enabled;
  }

  /** 当前是否允许本人操作（非本人回合仅可观看）。 */
  private canAct(): boolean {
    const state = this.engine.getState();
    if (state.phase !== GamePhase.PLAYING) return false;
    return state.currentPlayerIndex === this.selfIndex;
  }

  // =========================================================================
  // 输入（微信触摸事件）
  // =========================================================================

  private touchStartHandler = (e: { touches?: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches?.[0];
    if (!t) return;
    this.touchActive = true;
    this.pressX = t.clientX;
    this.pressY = t.clientY;
    // 仅记录潜在拖拽来源，不立即执行点击动作（区分点击与拖拽）。
    // 在线模式非本人回合：禁用一切牌面交互（保留观看）。
    this.pressSource = this.canAct() ? this.findTileSource(t.clientX, t.clientY) : null;
    this.markDirty();

    // 牌架长按 → 「拿起」该牌（震动反馈），之后任意方向拖动都可拖拽（含牌架内横向重排）。
    // 横扫连选不依赖长按：由 touchMove 判定水平滑动立即触发。
    this.longPressActive = false;
    this.sweepSelectActive = false;
    this.rangeSelectAnchor = null;
    this.clearLongPressTimer();
    if (this.pressSource?.kind === 'rack') {
      const rackSlot = hitTestRack(t.clientX, t.clientY, this.rackSlots);
      if (rackSlot) {
        this.rangeSelectAnchor = rackSlot.index;
        this.longPressTimer = setTimeout(() => {
          this.longPressActive = true;
          vibrateIfEnabled();
          audio.play('pickup');
          this.showTip('已拿起牌：拖动可重排或放到桌面');
          this.markDirty();
        }, LONG_PRESS_DELAY);
      }
    }
  };

  private touchMoveHandler = (e: { touches?: Array<{ clientX: number; clientY: number }> }) => {
    const t = e.touches?.[0];
    if (!t || !this.pressSource) return;

    // 横扫连选模式：滑动划过牌架时连续选中范围。
    if (this.sweepSelectActive) {
      // 逃逸通道：手指已明显离开牌架区域 → 改为拖拽（扫着扫着想拿牌上桌）。
      const dist = Math.hypot(t.clientX - this.pressX, t.clientY - this.pressY);
      if (!this.isInRackRegion(t.clientX, t.clientY) && dist > DRAG_THRESHOLD * 2) {
        this.sweepSelectActive = false;
        this.rangeSelectAnchor = null;
        this.drag = { source: this.pressSource, curX: t.clientX, curY: t.clientY };
        this.markDirty();
        return;
      }
      const rackSlot = hitTestRack(t.clientX, t.clientY, this.rackSlots);
      if (rackSlot) this.applyRangeSelect(rackSlot.index);
      this.markDirty();
      return;
    }

    // 长按「拿起」后：一旦移动即进入正常拖拽（任意方向）。
    if (this.longPressActive) {
      const dist = Math.hypot(t.clientX - this.pressX, t.clientY - this.pressY);
      if (dist > DRAG_THRESHOLD) {
        this.longPressActive = false;
        this.rangeSelectAnchor = null;
        this.drag = { source: this.pressSource, curX: t.clientX, curY: t.clientY };
      }
      this.markDirty();
      return;
    }

    const dx = t.clientX - this.pressX;
    const dy = t.clientY - this.pressY;

    if (!this.drag) {
      // 超过阈值才分流，避免误触。
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        // 牌架牌 + 水平滑动 → 立即进入横扫连选（无需长按，不会误判成单击/拖拽）。
        // 竖直滑动照旧进入拖拽（拿牌上桌）；牌架内横向重排改由长按拿起后拖。
        if (
          this.pressSource.kind === 'rack' &&
          Math.abs(dx) > Math.abs(dy) &&
          this.isInRackRegion(t.clientX, t.clientY)
        ) {
          this.clearLongPressTimer();
          this.sweepSelectActive = true;
          audio.play('pickup');
          const rackSlot = hitTestRack(t.clientX, t.clientY, this.rackSlots);
          if (rackSlot) this.applyRangeSelect(rackSlot.index);
          this.markDirty();
          return;
        }
        // 开始正常拖拽，取消长按计时。
        this.clearLongPressTimer();
        this.drag = { source: this.pressSource, curX: t.clientX, curY: t.clientY };
      }
    } else {
      this.drag.curX = t.clientX;
      this.drag.curY = t.clientY;

      // 理牌实时预览：拖的是牌架牌时，牌架内实时开缺口提示将插入的位置；
      // 拖出牌架区域则闭合缺口（邻牌拱回原位），松手不改变顺序。
      if (this.drag.source.kind === 'rack') {
        const next = this.isInRackRegion(t.clientX, t.clientY)
          ? rackGapIndexAt(t.clientX, t.clientY, this.getSelfPlayer().rack.length - 1, this.rackConfig)
          : null;
        if (next !== this.previewGapIndex) {
          this.previewGapIndex = next;
        }
      }
    }
    this.markDirty();
  };

  private touchEndHandler = (e: { changedTouches?: Array<{ clientX: number; clientY: number }> }) => {
    // 拦截上个场景遗留的 tap：没在本场景按下过，就不算本场景的点击。
    if (!this.touchActive) return;
    this.touchActive = false;
    const t = e.changedTouches?.[0];

    // 横扫连选结束：保留已选中的范围。
    if (this.sweepSelectActive) {
      this.sweepSelectActive = false;
      this.rangeSelectAnchor = null;
      this.pressSource = null;
      this.markDirty();
      return;
    }

    // 长按拿起后未移动就松手 → 放回，不做任何动作（不当作点按，避免误改选中）。
    if (this.longPressActive) {
      this.clearLongPressTimer();
      this.longPressActive = false;
      this.rangeSelectAnchor = null;
      this.previewGapIndex = null;
      this.pressSource = null;
      this.markDirty();
      return;
    }

    if (this.drag) {
      this.handleTileDrop(this.drag, this.drag.curX, this.drag.curY);
      this.drag = null;
      this.previewGapIndex = null;
      this.pressSource = null;
      this.markDirty();
      return;
    }

    // 未进入拖拽 → 视作点击，走原有命中的点击分发。
    this.clearLongPressTimer();
    if (t) this.onPointerDown(t.clientX, t.clientY);
    this.pressSource = null;
  };

  private touchCancelHandler = () => {
    this.touchActive = false;
    this.clearLongPressTimer();
    this.longPressActive = false;
    this.sweepSelectActive = false;
    this.rangeSelectAnchor = null;
    this.previewGapIndex = null;
    this.drag = null;
    this.pressSource = null;
    this.markDirty();
  };

  private resizeHandler = () => {
    this.refreshScreenInfo();
  };

  private bindTouch(): void {
    wx.onTouchStart(this.touchStartHandler);
    wx.onTouchMove(this.touchMoveHandler);
    wx.onTouchEnd(this.touchEndHandler);
    wx.onTouchCancel(this.touchCancelHandler);
  }

  private bindResize(): void {
    // onWindowResize 作为辅助监听：真机旋转 / 开发者工具改窗口大小也会触发。
    wx.onWindowResize(this.resizeHandler);
  }

  /** 场景切换时释放全部监听与定时器，交还画布给下一个场景。 */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    wx.offTouchStart(this.touchStartHandler);
    wx.offTouchMove(this.touchMoveHandler);
    wx.offTouchEnd(this.touchEndHandler);
    wx.offTouchCancel(this.touchCancelHandler);
    wx.offWindowResize(this.resizeHandler);
    this.clearLongPressTimer();
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.coordinator?.dispose();
    this.coordinator = null;
  }

  private refreshScreenInfo(): void {
    // 转屏后重新读取全量屏幕信息（含更新后的逻辑尺寸与安全区）。
    this.applyScreenInfo(getScreenInfo(this.canvas));
  }

  private toggleOrientation(): void {
    if (typeof wx.setDeviceOrientation !== 'function') {
      this.showMessage('当前环境不支持转屏');
      return;
    }
    const target = this.isLandscape ? 'portrait' : 'landscape';
    wx.setDeviceOrientation({
      value: target,
      success: () => {
        // 转屏是异步的：等宽高真正交换后再刷新布局，
        // 固定延时不可靠（会拿到旧尺寸导致拉伸/点击错位）。
        getScreenInfoAfterRotation(target, this.canvas).then((info) => {
          if (this.disposed) return;
          this.applyScreenInfo(info);
        });
      },
      fail: () => {
        this.showMessage('转屏失败');
      },
    });
  }

  /** 应用已确认的屏幕信息（转屏完成后）并重排布局。 */
  private applyScreenInfo(info: ScreenInfo): void {
    this.screenW = info.screenWidth;
    this.screenH = info.screenHeight;
    this.pixelRatio = info.pixelRatio;
    this.safeTop = info.safeTop;
    this.safeBottom = info.safeBottom;
    this.safeLeft = info.safeLeft;
    this.safeRight = info.safeRight;
    this.isLandscape = this.screenW > this.screenH;
    this.canvas.width = Math.round(this.screenW * this.pixelRatio);
    this.canvas.height = Math.round(this.screenH * this.pixelRatio);
    this.updateLayout();
    this.markDirty();
  }

  private setupEngineListeners(): void {
    // 发牌音效由动画系统在批量发牌（开局/换手）时统一触发，
    // 本地与联机模式都能听到，不在此处重复播放。

    this.engine.on('turnStart', () => {
      this.selectedRackIds.clear();
      this.highlightedGroupIds.clear();
      this.markDirty();
    });

    this.engine.on('tileDrawn', () => {
      audio.play('draw');
      this.showTip('摸牌成功');
    });

    this.engine.on('turnEnd', (data: any) => {
      const reason = data?.reason || '';
      if (reason === 'pass') {
        audio.play('pass');
        this.showTip('Pass 成功，回合结束');
      } else if (reason === 'submit') {
        audio.play('submit');
        this.showTip('出牌成功');
      } else if (reason === 'timeout') {
        audio.play('draw');
        this.showMessage('超时，回合结束');
      }
    });

    this.engine.on('turnRollback', () => {
      // 桌面/牌架已回滚，清除本回合的选中状态。
      this.selectedRackIds.clear();
      this.highlightedGroupIds.clear();
      this.markDirty();
    });

    this.engine.on('gameOver', (data: any) => {
      const winner = data.result.playerResults.find((r: any) => r.isWinner);
      this.gameOverStart = Date.now();
      audio.play('victory');
      this.showMessage(`游戏结束! ${winner?.playerName} 获胜!`);
    });

    this.engine.on('stateLoaded', () => {
      // 在线模式：云端权威状态整体覆盖后，清除本回合选中/高亮状态。
      this.selectedRackIds.clear();
      this.highlightedGroupIds.clear();
      this.markDirty();
    });

    this.engine.on('error', (data: any) => {
      audio.play('error');
      this.showMessage(`错误: ${data.message || '未知错误'}`);
    });
  }

  private onPointerDown(x: number, y: number): void {
    const er = this.endGameRect;
    if (er && x >= er.x && x <= er.x + er.w && y >= er.y && y <= er.y + er.h) {
      this.onRequestEndGame?.();
      return;
    }
    if (hitTestButton(x, y, [this.orientationButton])) {
      this.toggleOrientation();
      return;
    }

    const btn = hitTestButton(x, y, this.buttons);
    if (btn && btn.config.enabled !== false) {
      this.onButtonTap(btn.config.id);
      return;
    }

    // 在线模式非本人回合：牌面/桌面/工作区均不可交互。
    if (!this.canAct()) return;

    const rackSlot = hitTestRack(x, y, this.rackSlots);
    if (rackSlot) {
      this.onRackTap(rackSlot);
      return;
    }

    const workingSlot = this.hitTestWorkingArea(x, y);
    if (workingSlot) {
      this.onWorkingAreaTap(workingSlot);
      return;
    }

    const boardSlot = hitTestBoard(x, y, this.boardSlots);
    if (boardSlot) {
      this.onBoardTileTap(boardSlot);
      return;
    }

    const groupSlot = hitTestBoardGroup(x, y, this.boardSlots);
    if (groupSlot) {
      this.onBoardGroupTap(groupSlot);
      return;
    }

    // 点到空白处：清空选中的手牌与牌组高亮（快速反悔，不必逐张取消）。
    if (this.selectedRackIds.size > 0 || this.highlightedGroupIds.size > 0) {
      this.selectedRackIds.clear();
      this.highlightedGroupIds.clear();
      this.markDirty();
    }
  }

  // =========================================================================
  // 拖拽交互（破冰后自由拆牌 / 组合）
  // =========================================================================

  /** 命中某个可拖拽的牌（牌架 / 工作区 / 桌面），返回其来源。 */
  private findTileSource(x: number, y: number): DragSource | null {
    const rackSlot = hitTestRack(x, y, this.rackSlots);
    if (rackSlot) {
      return { kind: 'rack', tile: rackSlot.tile, tileId: rackSlot.tile.id };
    }

    const workingSlot = this.hitTestWorkingArea(x, y);
    if (workingSlot) {
      return { kind: 'working', tile: workingSlot.tile, tileId: workingSlot.tile.id };
    }

    const boardSlot = hitTestBoard(x, y, this.boardSlots);
    if (boardSlot) {
      return {
        kind: 'board',
        tile: boardSlot.logicalTile.originalTile,
        tileId: boardSlot.logicalTile.originalTile.id,
        sourceGroupId: boardSlot.groupId,
      };
    }

    return null;
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer != null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /** 长按牌架时，按连续范围选中 [anchor, cur] 之间的牌（须能凑成合法顺子/刻子）。 */
  private applyRangeSelect(curIndex: number): void {
    const anchor = this.rangeSelectAnchor;
    if (anchor == null) return;

    const rack = this.getSelfPlayer().rack;
    const lo = Math.min(anchor, curIndex);
    const hi = Math.max(anchor, curIndex);
    const rangeTiles = rack.filter((_, i) => i >= lo && i <= hi);
    if (!canFormMelds(rangeTiles)) return; // 超出可合法组合范围，保持上次选中结果。

    this.selectedRackIds = new Set(rangeTiles.map(t => t.id));
    if (rangeTiles.length >= 3 && this.isCompleteMeld(rangeTiles)) {
      this.showTip('已选好合法牌组，可点击「出牌」');
    }
  }

  /** 判断点是否落在桌面区域（用于把牌拖到空白处成立新组）。 */
  private isInBoardRegion(x: number, y: number): boolean {
    return y >= this.boardConfig.topY && y <= this.boardBottom;
  }

  /** 判断点是否落在工作区（用于把桌面牌拆分到工作区）。 */
  private isInWorkingAreaRegion(x: number, y: number): boolean {
    const left = this.safeLeft + 8;
    const right = this.screenW - this.safeRight - 8;
    return x >= left && x <= right && y >= this.workingAreaY && y <= this.workingAreaY + this.workingAreaHeight;
  }

  /** 判断点是否落在牌架区域（用于把牌拖回牌架，无需精确命中某张手牌）。 */
  private isInRackRegion(x: number, y: number): boolean {
    const left = this.safeLeft + 8;
    const right = this.screenW - this.safeRight - 8;
    const top = this.rackConfig.y;
    const bottom = top + rackHeight(this.rackSlots.length, this.rackConfig);
    return x >= left && x <= right && y >= top && y <= bottom;
  }

  /** 当前是否正在拖拽某来源的某张牌（用于在原位置隐藏该牌）。 */
  private isDraggingTile(kind: DragSourceKind, tileId: number): boolean {
    return !!this.drag && this.drag.source.kind === kind && this.drag.source.tileId === tileId;
  }

  /** 拖拽放下：根据来源与落点执行拆分/合并/加牌/成组。 */
  private handleTileDrop(drag: DragState, x: number, y: number): void {
    // 先把拖拽牌交给动画系统：从指尖落点飞向新槽位（操作无效时会自动飞回原位）。
    this.releaseDragAnim(drag, x, y);
    const src = drag.source;

    const boardTile = hitTestBoard(x, y, this.boardSlots);
    const boardGroupSlot = boardTile ? null : hitTestBoardGroup(x, y, this.boardSlots);
    const workingHit = this.hitTestWorkingArea(x, y);
    const onWorkingArea = !!workingHit || this.isInWorkingAreaRegion(x, y);
    const targetGroupId = boardTile?.groupId ?? boardGroupSlot?.groupId ?? null;
    const onBoardEmpty = this.isInBoardRegion(x, y) && !targetGroupId && !onWorkingArea;
    const rackTarget = hitTestRack(x, y, this.rackSlots);
    const onRack = !!rackTarget || this.isInRackRegion(x, y);

    try {
      // 牌架 → 牌架：优先用实时预览的缺口位置提交重排（理牌）。
      if (src.kind === 'rack' && !targetGroupId && !onWorkingArea) {
        const insertAt = this.previewGapIndex ?? (rackTarget ? rackTarget.index : null);
        if (insertAt != null) {
          this.engine.reorderRackTile(src.tileId, insertAt);
          audio.play('sort');
          return;
        }
      }

      // 牌架 → 桌面：加到已有牌组 / 空白处成新组。
      if (src.kind === 'rack') {
        if (targetGroupId) {
          if (!this.canManipulateBoard()) {
            this.showMessage('破冰后才能给桌面牌组加牌');
            return;
          }
          this.engine.placeTilesOnBoard([src.tileId], targetGroupId);
          this.selectedRackIds.delete(src.tileId);
          audio.play('place');
          this.showTip('已加入牌组');
        } else if (onBoardEmpty) {
          this.engine.createNewGroupOnBoard([src.tile], detectGroupType([src.tile]));
          this.selectedRackIds.delete(src.tileId);
          audio.play('place');
        }
        return;
      }

      // 工作区 → 牌架 / 桌面。
      if (src.kind === 'working') {
        // 工作区内拖到另一张牌上 → 仅调整顺序（理牌），不受破冰限制。
        if (workingHit && workingHit.tile.id !== src.tileId) {
          this.engine.reorderWorkingAreaTile(src.tileId, workingHit.index);
          audio.play('sort');
          this.showTip('已调整顺序');
          return;
        }

        // 未破冰：工作区里本回合放下的牌可放回牌架。
        if (!this.canManipulateBoard()) {
          if (onRack && !targetGroupId && !onWorkingArea && this.isRackPlacedThisTurn(src.tileId)) {
            this.engine.returnTilesToRack([src.tileId]);
            audio.play('pickup');
            this.showTip('已放回牌架');
            return;
          }
          this.showMessage('破冰后才能操作桌面牌');
          return;
        }
        if (targetGroupId) {
          this.engine.placeWorkingAreaTilesOnBoard([src.tileId], targetGroupId);
          audio.play('place');
          this.showTip('已合并到牌组');
        } else if (onBoardEmpty) {
          this.engine.createNewGroupFromWorkingArea([src.tile], detectGroupType([src.tile]));
          audio.play('place');
        }
        return;
      }

      // 桌面 → 其它地方：拆分 / 移动 / 合并 / 成立新组。
      const sourceGroupId = src.sourceGroupId!;

      // 未破冰时，仅能操作本回合从牌架放下的牌：放回牌架或拆到工作区。
      if (!this.canManipulateBoard()) {
        if (!this.isRackPlacedThisTurn(src.tileId)) {
          this.showMessage('破冰后才能操作桌面牌');
          return;
        }
        if (onRack && !targetGroupId && !onWorkingArea) {
          this.engine.returnTilesToRack([src.tileId]);
          audio.play('pickup');
          this.showTip('已放回牌架');
        } else if (onWorkingArea) {
          this.engine.removeTilesFromBoard(sourceGroupId, [src.tileId]);
          audio.play('pickup');
          this.showTip('已拆分到工作区');
        } else {
          this.showMessage('破冰后才能操作桌面牌');
        }
        return;
      }

      if (boardTile && targetGroupId === sourceGroupId) {
        // 同一牌组内拖到另一张牌上 → 仅重排顺序（Joker 显示值随位置变化）。
        this.engine.moveTileWithinGroup(sourceGroupId, src.tileId, boardTile.index);
        audio.play('sort');
        this.showTip('已调整顺序');
      } else if (targetGroupId && targetGroupId !== sourceGroupId) {
        this.engine.removeTilesFromBoard(sourceGroupId, [src.tileId]);
        this.engine.placeWorkingAreaTilesOnBoard([src.tileId], targetGroupId);
        audio.play('place');
        this.showTip('已移动');
      } else if (onBoardEmpty) {
        this.engine.removeTilesFromBoard(sourceGroupId, [src.tileId]);
        this.engine.createNewGroupFromWorkingArea([src.tile], detectGroupType([src.tile]));
        audio.play('place');
      } else if (onWorkingArea) {
        this.engine.removeTilesFromBoard(sourceGroupId, [src.tileId]);
        audio.play('pickup');
        this.showTip('已拆分到工作区');
      }
      // 落回原牌组或无效位置 → 不操作（牌保持原位）。
    } catch (err: any) {
      audio.play('error');
      this.showMessage(err.message || '操作失败');
    }
  }

  /** 在拖拽位置绘制幽灵牌。 */
  private drawDragGhost(): void {
    if (!this.drag) return;
    const scale = DRAG_GHOST_SCALE;
    const w = TILE_WIDTH * scale;
    const h = TILE_HEIGHT * scale;
    drawPhysicalTile(this.ctx, this.drag.source.tile, {
      x: this.drag.curX - w / 2,
      y: this.drag.curY - h / 2,
      scale,
    });
  }

  private onButtonTap(buttonId: string): void {
    switch (buttonId) {
      case 'submit': {
        // 若有选中的牌架牌，先把它们作为新牌组放到桌面。
        if (this.selectedRackIds.size > 0) {
          try {
            const rack = this.getSelfPlayer().rack;
            const tiles = rack.filter((t) => this.selectedRackIds.has(t.id));
            const type = detectGroupType(tiles);
            this.engine.createNewGroupOnBoard(tiles, type);
            this.selectedRackIds.clear();
            audio.play('place');
          } catch (err: any) {
            audio.play('error');
            this.showMessage(err.message || '放置失败');
            return;
          }
        }

        // 提交操作日志给云端回放校验（云端是唯一裁判）。
        this.coordinator?.submit();
        break;
      }

      case 'pass':
        this.coordinator?.pass();
        break;
    }
  }

  private onRackTap(slot: RackTileSlot): void {
    const id = slot.tile.id;
    if (this.selectedRackIds.has(id)) {
      this.selectedRackIds.delete(id);
      audio.play('pickup');
      this.markDirty();
      return;
    }

    // 实时校验：新牌与已选中牌须能共同凑成合法顺子/刻子，否则禁止选中。
    const rack = this.getSelfPlayer().rack;
    const candidateTiles = rack.filter((t) => this.selectedRackIds.has(t.id) || t.id === id);
    if (!canFormMelds(candidateTiles)) {
      audio.play('error');
      this.showMessage('所选牌存在明显冲突，无法组成合法顺子/刻子');
      return;
    }

    this.selectedRackIds.add(id);
    audio.play('pickup');

    // 已选中一组完整合法的顺子/刻子时，给出「可以出牌」提示。
    if (this.isCompleteMeld(rack.filter((t) => this.selectedRackIds.has(t.id)))) {
      this.showTip('已选好合法牌组，可点击「出牌」');
    }

    this.markDirty();
  }

  /** 判断一组牌是否恰好构成一个完整的合法顺子或刻子。 */
  private isCompleteMeld(tiles: Tile[]): boolean {
    const logicals = tiles.map(toLogical);
    return isValidRun(logicals) || isValidGroupTiles(logicals);
  }

  /** 当前玩家是否已完成破冰（可自由操作桌面牌）。 */
  private canManipulateBoard(): boolean {
    const state = this.engine.getState();
    return state.phase === GamePhase.PLAYING && this.getSelfPlayer().hasMadeInitialMeld;
  }

  /** 该牌是否是本回合从牌架放下桌面的牌（未破冰时可拿回自己的牌）。 */
  private isRackPlacedThisTurn(tileId: number): boolean {
    const ctx = this.engine.getState().turnContext;
    return !!ctx && ctx.rackTilesPlacedThisTurn.some(t => t.id === tileId);
  }

  /** 点击桌面上的某张牌：有选中牌架牌时加牌，否则拆分到工作区。 */
  private onBoardTileTap(slot: BoardTileSlot): void {
    const tileId = slot.logicalTile.originalTile.id;

    // 有选中牌架牌 → 把它们加到这个牌组（给已有牌组加牌，需破冰）。
    if (this.selectedRackIds.size > 0) {
      if (!this.canManipulateBoard()) {
        this.showMessage('破冰后才能给桌面牌组加牌');
        return;
      }
      try {
        const rack = this.getSelfPlayer().rack;
        const tiles = rack.filter((t) => this.selectedRackIds.has(t.id));
        this.engine.placeTilesOnBoard(tiles.map(t => t.id), slot.groupId);
        this.selectedRackIds.clear();
        this.showTip('已加入牌组');
      } catch (err: any) {
        this.showMessage(err.message || '加牌失败');
      }
      this.markDirty();
      return;
    }

    // 否则拆分到工作区（未破冰时仅允许拿回本回合从牌架放下的牌）。
    if (!this.canManipulateBoard() && !this.isRackPlacedThisTurn(tileId)) {
      this.showMessage('破冰后才能操作桌面牌');
      return;
    }

    try {
      this.engine.removeTilesFromBoard(slot.groupId, [tileId]);
      this.showTip('已拆分：牌移入工作区');
    } catch (err: any) {
      this.showMessage(err.message || '拆分失败');
    }
    this.markDirty();
  }

  /** 点击桌面牌组空白处：切换目标牌组高亮（用于把工作区牌合并进去）。 */
  private onBoardGroupTap(slot: BoardGroupSlot): void {
    const groupId = slot.groupId;
    if (this.highlightedGroupIds.has(groupId)) this.highlightedGroupIds.delete(groupId);
    else this.highlightedGroupIds.add(groupId);
    this.markDirty();
  }

  private onWorkingAreaTap(slot: WorkingAreaSlot): void {
    const state = this.engine.getState();
    if (state.phase !== GamePhase.PLAYING) return;

    try {
      const ctx = this.engine.getTurnContext();
      const tile = ctx.workingArea[slot.index];
      if (!tile) return;

      if (this.highlightedGroupIds.size > 0) {
        const groupId = [...this.highlightedGroupIds][0];
        this.engine.placeWorkingAreaTilesOnBoard([tile.id], groupId);
        this.showTip('已合并到选中牌组');
      } else {
        this.engine.createNewGroupFromWorkingArea([tile], detectGroupType([tile]));
        this.showTip('已从工作区取出');
      }
    } catch (err: any) {
      this.showMessage(err.message || '操作失败');
    }

    this.markDirty();
  }

  private hitTestWorkingArea(px: number, py: number): WorkingAreaSlot | null {
    for (let i = this.workingAreaSlots.length - 1; i >= 0; i--) {
      const slot = this.workingAreaSlots[i];
      if (px >= slot.x && px <= slot.x + slot.w && py >= slot.y && py <= slot.y + slot.h) {
        return slot;
      }
    }
    return null;
  }

  // =========================================================================
  // 渲染
  // =========================================================================

  private markDirty(): void {
    this.dirty = true;
  }

  private tick = (): void => {
    const now = Date.now();
    const dt = this.lastTickAt > 0 ? Math.min(64, now - this.lastTickAt) : 16;
    this.lastTickAt = now;

    if (this.dirty) {
      this.dirty = false;
      // 重置为逻辑坐标系（逻辑像素 × DPR = 物理像素）。
      this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      this.rebuild(now);
    }

    // 推进动画；还有活跃动画就继续重绘（静止时不置脏，零额外开销）。
    let animating = this.updateAnimations(dt);
    animating = this.updateMessageFade(dt) || animating;
    if (this.gameOverStart > 0 && now - this.gameOverStart < GAME_OVER_ANIM_MS) animating = true;
    if (animating) this.dirty = true;

    this.rafId = requestAnimationFrame(this.tick);
  };

  start(): void {
    this.rafId = requestAnimationFrame(this.tick);
  }

  private rebuild(now: number): void {
    const state = this.engine.getState();
    this.updateButtonStates();

    // 全局背景：原神式黄昏天色（黛蓝 → 青碧 → 暖赭渐变）+ 暮云光斑。
    const bg = this.ctx.createLinearGradient(0, 0, 0, this.screenH);
    bg.addColorStop(0, SKY_TOP);
    bg.addColorStop(0.55, SKY_MID);
    bg.addColorStop(1, SKY_BOTTOM);
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, this.screenW, this.screenH);
    this.drawSkyDecor();

    if (state.phase === GamePhase.WAITING) {
      this.buildWaiting();
    } else if (state.phase === GamePhase.GAME_OVER) {
      this.buildGameOver(state, now);
    } else {
      this.buildTopBar(state);
      this.buildOpponents(state);

      const rackTiles = this.getSelfPlayer().rack;
      const workingTiles = state.turnContext?.workingArea ?? [];

      // 自底向上布局：按钮 → 牌架 → 工作区，剩余空间留给桌面，
      // 让牌架稳定贴在底部（而非紧跟在桌面内容后面被顶到上方）。
      const buttonTop = this.buttons[0].config.y;
      const rackH = rackHeight(rackTiles.length, this.rackConfig);
      const rackTop = buttonTop - rackH - 8;
      this.rackConfig.y = rackTop;

      // 工作区高度与 y 无关，先测高度再反推顶部 y（紧贴牌架上方）。
      const waMeasured = this.workingAreaLayout(workingTiles, 0);
      this.workingAreaHeight = waMeasured.height;
      this.workingAreaY = rackTop - waMeasured.height - 8;
      this.workingAreaSlots = this.workingAreaLayout(workingTiles, this.workingAreaY).slots;

      // 桌面：顶部预留出对手信息行（顶栏 + 一行徽章高度），向下填满到工作区上方。
      this.boardConfig.topY = this.safeTop + PLAYER_INFO_HEIGHT + 30;
      const boardBottom = this.workingAreaY - 8;
      this.boardBottom = boardBottom;
      this.boardSlots = this.layoutBoardToFit(state.board, boardBottom);
      // 理牌实时预览：拖拽牌架牌且缺口开着时，用含缺口的预览布局（邻牌让位）。
      const draggingRackId = this.drag?.source.kind === 'rack' ? this.drag.source.tileId : null;
      this.rackSlots =
        draggingRackId != null && this.previewGapIndex != null
          ? layoutRackWithGap(rackTiles, draggingRackId, this.previewGapIndex, this.rackConfig, this.selectedRackIds)
          : layoutRack(rackTiles, this.rackConfig, this.selectedRackIds);

      // 先登记全部牌的动画目标，再按当前动画位置绘制。
      this.registerAnimTargets();
      this.flyingDraws = [];

      this.buildBoard(state, boardBottom);
      this.buildWorkingArea(state);
      this.buildRack();
      // 飞行中的牌最后绘制：跨区飞牌不会被其它区域面板遮挡。
      for (const draw of this.flyingDraws) draw();
      this.flyingDraws = [];
      this.buildButtons();
      this.buildPoolInfo(state);
      if (this.message) this.buildMessage();
    }

    // 切换方向按钮始终最后绘制，保证位于其他图层之上、不被桌面/牌架等遮挡。
    this.buildOrientationButton();

    // 拖拽幽灵牌绘制在最上层。
    this.drawDragGhost();
  }

  // =========================================================================
  // 动画系统（牌飞行 / 发牌级联 / 气泡淡入淡出）
  // =========================================================================

  /** 牌池点：新牌出生点，发牌/摸牌时从桌面中部逐张飞出。 */
  private deckPoint(): { x: number; y: number } {
    return { x: this.screenW / 2, y: (this.boardConfig.topY + this.workingAreaY) / 2 };
  }

  /**
   * 登记所有可见牌的动画目标。
   * - 已有牌：只更新目标位置，渲染循环自动平滑趋近
   *   （覆盖选中抬升、理牌重排、跨区移动、桌面缩放等全部场景）。
   * - 新牌（发牌/摸牌/回合切换）：在牌池点生成错峰出生状态。
   */
  private registerAnimTargets(): void {
    const seen = new Set<number>();
    const deck = this.deckPoint();
    // 槽位发生「跳跃」的牌架牌（预览让位/复位）→ 拱形飞行，先收集再统一错峰。
    const arcCandidates: TileAnim[] = [];
    // 本帧新出现的牌架牌：按出生批次决定发牌节奏。
    const newRackSlots: RackTileSlot[] = [];

    for (const slot of this.rackSlots) {
      const id = slot.tile.id;
      seen.add(id);
      const tscale = slot.opts.selected ? 1.06 : 1; // 选中轻微放大
      const a = this.tileAnims.get(id);
      if (a) {
        // 横向位移超过一个槽位 → 拱起移动（预览中的临时让位，与平滑落位区分）。
        if (!a.arc && Math.abs(slot.opts.x - a.x) > TILE_WIDTH * 0.8) {
          arcCandidates.push(a);
        }
        a.tx = slot.opts.x;
        a.ty = slot.opts.y;
        a.tscale = tscale;
      } else {
        newRackSlots.push(slot);
      }
    }

    // 断线重连/中途进局的首次全量加载：跳过发牌仪式，新牌直接原地展示。
    // 一次性开关，消费后恢复，后续摸牌等增补仍走飞行动画。
    const suppressDeal = !this.dealAnimEnabled && newRackSlots.length > 0;
    if (suppressDeal) {
      this.dealAnimEnabled = true;
      for (const slot of newRackSlots) {
        const s = slot.opts.selected ? 1.06 : 1;
        this.tileAnims.set(slot.tile.id, {
          x: slot.opts.x, y: slot.opts.y, scale: s,
          tx: slot.opts.x, ty: slot.opts.y, tscale: s,
          pending: 0,
        });
      }
    } else {
      // 发牌节奏：一次出现大量新牌（开局发牌/换手）时一张一张慢发，
      // 让玩家看清每张牌并堆叠对后续牌的期待；摸牌等少量增补快进快出。
      const bulkDeal = newRackSlots.length >= DEAL_BULK_THRESHOLD;
      const stagger = bulkDeal ? DEAL_STAGGER_MS : DEAL_QUICK_STAGGER_MS;
      if (bulkDeal) audio.play('deal');
      for (let i = 0; i < newRackSlots.length; i++) {
        const slot = newRackSlots[i];
        // 待发的牌先在牌池点堆成牌堆（轻微错位模拟牌堆厚度），到点后拱形飞入牌架。
        const sx = deck.x + ((i % 3) - 1) * 1.5;
        const sy = deck.y - Math.min(i, 10) * 1.2;
        const dist = Math.hypot(slot.opts.x - sx, slot.opts.y - sy);
        this.tileAnims.set(slot.tile.id, {
          x: sx, y: sy, scale: 0.42,
          tx: slot.opts.x, ty: slot.opts.y,
          tscale: slot.opts.selected ? 1.06 : 1,
          pending: i * stagger,
          arc: {
            sx, sy, ss: 0.42, t: 0,
            dur: DEAL_FLIGHT_MS + Math.min(140, dist * 0.25),
            delay: 0,
            back: bulkDeal,
          },
        });
      }
    }

    // 让位动效保持轻快：统一短时长、无错峰，避免眼花缭乱。
    for (const a of arcCandidates) {
      const dist = Math.hypot(a.tx - a.x, a.ty - a.y);
      a.arc = {
        sx: a.x,
        sy: a.y,
        ss: a.scale,
        t: 0,
        dur: 200 + Math.min(80, dist * 0.4),
        delay: 0,
      };
    }

    for (const group of this.boardSlots) {
      for (const ts of group.tileSlots) {
        const id = ts.logicalTile.originalTile.id;
        seen.add(id);
        const s = ts.opts.scale ?? 1;
        const a = this.tileAnims.get(id);
        if (a) {
          a.tx = ts.opts.x;
          a.ty = ts.opts.y;
          a.tscale = s;
        } else {
          this.tileAnims.set(id, {
            x: ts.opts.x, y: ts.opts.y, scale: s,
            tx: ts.opts.x, ty: ts.opts.y, tscale: s,
            pending: 0,
          });
        }
      }
    }

    for (const slot of this.workingAreaSlots) {
      const id = slot.tile.id;
      seen.add(id);
      const a = this.tileAnims.get(id);
      if (a) {
        a.tx = slot.x;
        a.ty = slot.y;
        a.tscale = 0.7;
      } else {
        this.tileAnims.set(id, {
          x: slot.x, y: slot.y, scale: 0.7,
          tx: slot.x, ty: slot.y, tscale: 0.7,
          pending: 0,
        });
      }
    }

    // 清理不再出现在屏幕上的牌的动画状态（如回合切换到其他玩家的手牌）。
    for (const id of [...this.tileAnims.keys()]) {
      if (!seen.has(id)) this.tileAnims.delete(id);
    }
  }

  /** 该牌是否正在飞行（渲染位置与目标差异明显），飞行牌置顶绘制避免被面板遮挡。 */
  private isTileMoving(id: number): boolean {
    const a = this.tileAnims.get(id);
    if (!a) return false;
    return (
      a.pending > 0 ||
      !!a.arc ||
      Math.abs(a.tx - a.x) > 1.5 ||
      Math.abs(a.ty - a.y) > 1.5 ||
      Math.abs(a.tscale - a.scale) > 0.01
    );
  }

  /** 推进所有牌动画（指数平滑，帧率无关），返回是否仍有活跃动画。 */
  private updateAnimations(dt: number): boolean {
    if (this.tileAnims.size === 0) return false;
    let animating = false;
    const f = 1 - Math.exp((-dt * ANIM_SPEED) / 1000);
    for (const a of this.tileAnims.values()) {
      if (a.pending > 0) {
        a.pending -= dt;
        animating = true;
        continue;
      }

      // 拱形飞行：发牌用带回弹的缓出曲线强调落牌感，让位用轻快缓出保持克制。
      if (a.arc) {
        animating = true;
        if (a.arc.delay > 0) {
          a.arc.delay -= dt;
          continue;
        }
        a.arc.t += dt;
        const raw = Math.min(1, a.arc.t / a.arc.dur);
        const u = a.arc.back ? easeOutBack(raw) : 1 - Math.pow(1 - raw, 3);
        // 发牌弧度高一些，让每张牌的飞行轨迹清晰可见；让位只抬高一点点。
        const lift = a.arc.back
          ? Math.min(80, 30 + Math.abs(a.tx - a.arc.sx) * 0.18)
          : Math.min(12, 5 + Math.abs(a.tx - a.arc.sx) * 0.05);
        const cx = (a.arc.sx + a.tx) / 2;
        const cy = Math.min(a.arc.sy, a.ty) - lift;
        const inv = 1 - u;
        a.x = inv * inv * a.arc.sx + 2 * inv * u * cx + u * u * a.tx;
        a.y = inv * inv * a.arc.sy + 2 * inv * u * cy + u * u * a.ty;
        // 飞行期间同步放大到目标缩放，落位时轻微过冲更有「拍在桌上」的感觉。
        a.scale = a.arc.ss + (a.tscale - a.arc.ss) * u;
        if (raw >= 1) {
          a.x = a.tx;
          a.y = a.ty;
          a.scale = a.tscale;
          a.arc = undefined;
        }
        continue;
      }

      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const ds = a.tscale - a.scale;
      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2 && Math.abs(ds) < 0.004) {
        a.x = a.tx;
        a.y = a.ty;
        a.scale = a.tscale;
        continue;
      }
      a.x += dx * f;
      a.y += dy * f;
      a.scale += ds * f;
      animating = true;
    }
    return animating;
  }

  /** 推进提示气泡的淡入/淡出，返回是否仍活跃。 */
  private updateMessageFade(dt: number): boolean {
    if (!this.message) return false;
    if (this.messageFading) {
      this.messageAlpha -= dt / 160;
      if (this.messageAlpha <= 0) {
        this.message = '';
        this.messageAlpha = 0;
        this.messageFading = false;
      }
      return true;
    }
    if (this.messageAlpha < 1) {
      this.messageAlpha = Math.min(1, this.messageAlpha + dt / 140);
      return true;
    }
    return false;
  }

  /** 拖拽松手交接：把牌的渲染状态设为指尖落点，之后由动画系统丝滑送往目标槽位。 */
  private releaseDragAnim(drag: DragState, x: number, y: number): void {
    const s = DRAG_GHOST_SCALE;
    this.tileAnims.set(drag.source.tileId, {
      x: x - (TILE_WIDTH * s) / 2,
      y: y - (TILE_HEIGHT * s) / 2,
      scale: s,
      tx: x - (TILE_WIDTH * s) / 2,
      ty: y - (TILE_HEIGHT * s) / 2,
      tscale: s,
      pending: 0,
    });
  }

  // =========================================================================
  // 开放世界氛围装饰（云朵 / 光斑 / 菱形点缀）
  // =========================================================================

  /** 天空装饰：柔和云朵 + 漂浮光斑（固定比例位置，避免逐帧闪烁）。 */
  private drawSkyDecor(): void {
    const ctx = this.ctx;

    // 柔云：暖调半透明椭圆组，透出墨玻璃面板下方，暮色空气感。
    const clouds: Array<[number, number, number, number, number]> = [
      // [x比例, y比例, 宽, 高, 透明度]
      [0.18, 0.10, 120, 26, 0.20],
      [0.72, 0.07, 150, 30, 0.16],
      [0.45, 0.17, 90, 20, 0.14],
      [0.90, 0.22, 110, 22, 0.13],
      [0.08, 0.32, 80, 18, 0.11],
    ];
    for (const [rx, ry, w, h, a] of clouds) {
      const cx = rx * this.screenW;
      const cy = ry * this.screenH;
      ctx.fillStyle = `rgba(255,238,214,${a})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - w * 0.28, cy + h * 0.16, w * 0.30, h * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + w * 0.30, cy + h * 0.12, w * 0.26, h * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 漂浮光斑：香槟金四芒星，点缀在面板间隙。
    const sparkles: Array<[number, number, number, number]> = [
      // [x比例, y比例, 半径, 透明度]
      [0.06, 0.56, 4, 0.55],
      [0.93, 0.50, 3, 0.5],
      [0.50, 0.615, 2.6, 0.45],
      [0.10, 0.965, 3.2, 0.5],
      [0.88, 0.965, 3.6, 0.55],
    ];
    for (const [rx, ry, r, a] of sparkles) {
      this.drawSparkle(rx * this.screenW, ry * this.screenH, r, `rgba(255,255,255,${a})`);
    }
  }

  /** 四芒星光斑（菱形十字），原神风格的漂浮光点。 */
  private drawSparkle(x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2);
    ctx.quadraticCurveTo(x + r * 0.35, y - r * 0.35, x + r * 2, y);
    ctx.quadraticCurveTo(x + r * 0.35, y + r * 0.35, x, y + r * 2);
    ctx.quadraticCurveTo(x - r * 0.35, y + r * 0.35, x - r * 2, y);
    ctx.quadraticCurveTo(x - r * 0.35, y - r * 0.35, x, y - r * 2);
    ctx.closePath();
    ctx.fill();
  }

  /** 菱形点缀（UI 装饰）。 */
  private drawDiamond(x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  }

  private buildWaiting(): void {
    // 清新等待页：白字香槟描边标题 + 三张装饰牌。
    const cx = this.screenW / 2;
    const cy = this.screenH / 2;
    this.drawText(cx, cy - 60, '拉密 Rummikub', {
      size: 30,
      color: '#FFFFFF',
      bold: true,
      outline: { color: '#B08A45', width: 4 },
    });
    this.drawText(cx, cy - 20, '等待游戏开始...', {
      size: 16,
      color: INK_SOFT,
      bold: true,
    });

    // 装饰牌：红 7 / 紫 Joker / 蓝 9，微微倾斜更有动势。
    const decor: Array<{ tile: Tile; dx: number; rot: number }> = [
      { tile: { id: -1, color: 'red', number: 7 }, dx: -64, rot: -0.14 },
      { tile: { id: -2, color: 'joker', number: 0 }, dx: 0, rot: 0 },
      { tile: { id: -3, color: 'blue', number: 9 }, dx: 64, rot: 0.14 },
    ];
    for (const d of decor) {
      this.ctx.save();
      this.ctx.translate(cx + d.dx, cy + 42);
      this.ctx.rotate(d.rot);
      drawPhysicalTile(this.ctx, d.tile, { x: -TILE_WIDTH / 2, y: 0, scale: 1.15 });
      this.ctx.restore();
    }
  }

  private buildGameOver(state: GameState, now: number): void {
    const result = state.result;
    if (!result) return;
    const ctx = this.ctx;

    // 面板弹出动画：easeOutBack 回弹 + 遮罩淡入。
    const t = this.gameOverStart > 0 ? Math.min(1, (now - this.gameOverStart) / GAME_OVER_ANIM_MS) : 1;
    const pop = 0.6 + 0.4 * (t >= 1 ? 1 : easeOutBack(t));

    this.ctx.fillStyle = `rgba(58,66,80,${0.45 * Math.min(1, t * 2)})`;
    this.ctx.fillRect(0, 0, this.screenW, this.screenH);

    // 中央卡通结算面板：米色圆角卡片 + 金色描边。
    const panelW = Math.min(300, this.screenW * 0.85);
    const rows = result.playerResults.length;
    const panelH = 150 + rows * 32;
    const px = (this.screenW - panelW) / 2;
    const py = (this.screenH - panelH) / 2;

    // 以面板中心为基准缩放，做出弹出感。
    ctx.save();
    ctx.translate(this.screenW / 2, py + panelH / 2);
    ctx.scale(pop, pop);
    ctx.translate(-this.screenW / 2, -(py + panelH / 2));

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRectPath(ctx, px + 3, py + 5, panelW, panelH, 18);
    ctx.fill();
    ctx.fillStyle = '#FFFDF5';
    roundRectPath(ctx, px, py, panelW, panelH, 18);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    roundRectPath(ctx, px + 3, py + 3, panelW - 6, panelH - 6, 15);
    ctx.stroke();

    this.drawText(this.screenW / 2, py + 34, '游戏结束', {
      size: 26,
      color: '#C08A3E',
      bold: true,
      outline: { color: '#FFFDF5', width: 2 },
    });

    const winner = result.playerResults.find((r) => r.isWinner);
    this.drawText(this.screenW / 2, py + 68, `🏆 ${winner?.playerName} 获胜!`, {
      size: 18,
      color: INK,
      bold: true,
    });

    let y = py + 106;
    for (const pr of result.playerResults) {
      const isWin = pr.isWinner;
      // 单行结算胶囊：赢家暖金底，其余薄绿底。
      const rowW = panelW - 48;
      ctx.fillStyle = isWin ? 'rgba(233,201,127,0.45)' : 'rgba(139,201,139,0.16)';
      roundRectPath(ctx, px + 24, y - 12, rowW, 26, 13);
      ctx.fill();

      const color = isWin ? '#B0742A' : '#5A6478';
      const sign = pr.scoreDelta >= 0 ? '+' : '';
      this.drawText(px + 36, y + 1, pr.playerName, {
        size: 14,
        color,
        bold: true,
        align: 'left',
      });
      this.drawText(px + panelW - 36, y + 1, `${sign}${pr.scoreDelta}`, {
        size: 15,
        color: pr.scoreDelta >= 0 ? '#C07A2C' : '#D96A5E',
        bold: true,
        align: 'right',
      });
      y += 32;
    }
    ctx.restore();
  }

  private buildTopBar(state: GameState): void {
    const ctx = this.ctx;
    const y = this.safeTop;

    // 磨砂玻璃顶栏 + 香槟金细分隔线（原神 HUD 风）。
    ctx.fillStyle = PLAYER_INFO_BG;
    ctx.fillRect(0, y, this.screenW, PLAYER_INFO_HEIGHT);
    ctx.fillStyle = GOLD_SOFT;
    ctx.fillRect(0, y + PLAYER_INFO_HEIGHT - 1, this.screenW, 1);

    const player = this.engine.getCurrentPlayer();
    const cy = y + PLAYER_INFO_HEIGHT / 2;

    // 左侧「回合数」香槟金渐变胶囊徽章。
    const turnText = `回合 ${state.turnNumber}`;
    ctx.font = `bold ${FONT_SIZE_LABEL - 2}px ${FONT_FAMILY}`;
    const tw = ctx.measureText(turnText).width;
    const badge = ctx.createLinearGradient(0, cy - 10, 0, cy + 10);
    badge.addColorStop(0, '#F0D89C');
    badge.addColorStop(1, '#D3A85C');
    ctx.fillStyle = badge;
    roundRectPath(ctx, this.safeLeft + 10, cy - 10, tw + 18, 20, 10);
    ctx.fill();
    this.drawText(this.safeLeft + 19 + tw / 2, cy, turnText, {
      size: FONT_SIZE_LABEL - 2,
      color: '#FFFFFF',
      bold: true,
    });

    this.drawText(this.safeLeft + 10 + tw + 28, cy, `${player.name} 的回合`, {
      size: FONT_SIZE_LABEL,
      color: INK,
      bold: true,
      align: 'left',
    });

    if (this.onRequestEndGame) {
      // 测试房应急出口：顶栏右侧「结束对局」按钮（代替右侧提示文案）。
      const bw = 76;
      const bh = 26;
      this.endGameRect = {
        x: this.screenW - this.safeRight - 12 - bw,
        y: cy - bh / 2,
        w: bw,
        h: bh,
      };
      drawCapsuleButton(ctx, this.endGameRect, '结束对局', 'danger', 12);
    } else {
      this.endGameRect = null;
      this.drawText(this.screenW - this.safeRight - 12, cy, '出牌 或 Pass 摸牌', {
        size: FONT_SIZE_LABEL - 2,
        color: INK_SOFT,
        align: 'right',
      });
    }
  }

  private buildOpponents(state: GameState): void {
    const ctx = this.ctx;
    // 固定以自己为视角。
    const opponents = state.players.filter((p) => p.id !== this.selfIndex);
    // 对手行贴着顶栏下沿，整体位于桌面区域（topY）上方，避免被桌面遮盖。
    const y = this.safeTop + PLAYER_INFO_HEIGHT + 15;
    // 右侧止于转屏按钮左侧，防止徽章被按钮遮挡。
    const maxX = this.orientationButton.config.x - 8;

    let x = this.safeLeft + 12;
    for (const opp of opponents) {
      const avatarColor = AVATAR_COLORS[opp.id % AVATAR_COLORS.length];

      // 先量出徽章总宽，整枚放不下时才截断，避免画到一半遮住按钮。
      const text = `${opp.rack.length}张`;
      ctx.font = `${FONT_SIZE_LABEL - 3}px ${FONT_FAMILY}`;
      const tw = ctx.measureText(text).width;
      const badgeW = 23 + tw + 14;
      if (x + badgeW > maxX) break;

      // 元素风头像圆片 + 白环 + 末字。
      ctx.fillStyle = avatarColor;
      ctx.beginPath();
      ctx.arc(x + 10, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.drawText(x + 10, y + 0.5, opp.name.charAt(opp.name.length - 1), {
        size: 11,
        color: '#FFFFFF',
        bold: true,
      });

      // 剩余牌数磨砂胶囊。
      ctx.fillStyle = FROST_STRONG;
      roundRectPath(ctx, x + 23, y - 9, tw + 14, 18, 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(211,188,142,0.6)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, x + 23, y - 9, tw + 14, 18, 9);
      ctx.stroke();
      this.drawText(x + 30 + tw / 2, y + 0.5, text, {
        size: FONT_SIZE_LABEL - 3,
        color: INK,
      });

      x += 23 + tw + 14 + 16;
    }
  }

  /** 计算桌面布局：内容超出可用高度时整体缩放假面，保证不与工作区/牌架重叠。 */
  private layoutBoardToFit(groups: TileGroup[], boardBottom: number): BoardGroupSlot[] {
    const availableH = Math.max(48, boardBottom - this.boardConfig.topY);

    let slots = layoutBoard(groups, this.boardConfig, this.highlightedGroupIds, 1);
    let scale = 1;
    for (let i = 0; i < 6; i++) {
      const h = boardContentHeight(slots, this.boardConfig.topY);
      if (groups.length === 0 || h <= availableH) break;
      scale = Math.max(0.5, scale * (availableH / h));
      slots = layoutBoard(groups, this.boardConfig, this.highlightedGroupIds, scale);
    }
    return slots;
  }

  private buildBoard(state: GameState, boardBottom: number): void {
    const ctx = this.ctx;
    const top = this.boardConfig.topY;
    const h = Math.max(0, boardBottom - top);

    // 墨玻璃桌面板：深色半透明 + 香槟金细边 + 顶部菱形点缀。
    ctx.fillStyle = FROST;
    roundRectPath(ctx, 6, top, this.screenW - 12, h, 14);
    ctx.fill();
    ctx.strokeStyle = FROST_BORDER;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, 6, top, this.screenW - 12, h, 14);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(211,188,142,0.5)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, 9, top + 3, this.screenW - 18, h - 6, 11);
    ctx.stroke();

    // 顶部中央点缀：菱形 + 两侧细线（二次元 UI 装饰语汇）。
    const bcx = this.screenW / 2;
    ctx.strokeStyle = 'rgba(233,217,180,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bcx - 46, top + 3);
    ctx.lineTo(bcx - 9, top + 3);
    ctx.moveTo(bcx + 9, top + 3);
    ctx.lineTo(bcx + 46, top + 3);
    ctx.stroke();
    this.drawDiamond(bcx, top + 3, 4, GOLD_SOFT);

    for (const slot of this.boardSlots) {
      const { x, y, w, h: gh } = slot.bounds;
      const highlighted = this.highlightedGroupIds.has(slot.groupId);

      // 牌组托盘：高亮时用暖金（合并目标），否则半透明白。
      ctx.fillStyle = highlighted ? BOARD_GROUP_HIGHLIGHT_BG : BOARD_GROUP_BG;
      ctx.strokeStyle = highlighted ? BOARD_GROUP_HIGHLIGHT_BORDER : BOARD_GROUP_BORDER;
      ctx.lineWidth = highlighted ? 2 : 1;
      roundRectPath(ctx, x, y, w, gh, 8);
      ctx.fill();
      ctx.stroke();

      for (const tileSlot of slot.tileSlots) {
        const tileId = tileSlot.logicalTile.originalTile.id;
        if (this.isDraggingTile('board', tileId)) continue;
        // 绘制位置取自动画状态；飞行中的牌延迟到最上层绘制。
        const a = this.tileAnims.get(tileId);
        const opts: TileRenderOptions = {
          ...tileSlot.opts,
          x: a ? a.x : tileSlot.opts.x,
          y: a ? a.y : tileSlot.opts.y,
          scale: a ? a.scale : tileSlot.opts.scale,
        };
        if (this.isTileMoving(tileId)) {
          const g = slot.group;
          this.flyingDraws.push(() => drawBoardTile(ctx, g.type, g.tiles, tileSlot.index, opts));
        } else {
          drawBoardTile(ctx, slot.group.type, slot.group.tiles, tileSlot.index, opts);
        }
      }
    }
  }

  /** 计算工作区布局（自动换行），返回牌位与所需高度。 */
  private workingAreaLayout(
    tiles: Tile[],
    baseY: number,
  ): { slots: WorkingAreaSlot[]; height: number } {
    const scale = 0.7;
    const tw = TILE_WIDTH * scale;
    const th = TILE_HEIGHT * scale;
    const gapX = TILE_GAP + 2;
    const gapY = 4;
    const contentLeft = this.safeLeft + 12;
    const contentRight = this.screenW - this.safeRight - 12;
    const usableW = contentRight - contentLeft;
    const perRow = Math.max(1, Math.floor((usableW + gapX) / (tw + gapX)));
    const topOffset = 16; // 顶部留出标签高度

    const slots: WorkingAreaSlot[] = tiles.map((tile, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      return {
        tile,
        index: i,
        x: contentLeft + col * (tw + gapX),
        y: baseY + topOffset + row * (th + gapY),
        w: tw,
        h: th,
      };
    });

    const rows = tiles.length === 0 ? 0 : Math.ceil(tiles.length / perRow);
    const height =
      tiles.length === 0
        ? WORKING_AREA_HEIGHT
        : Math.max(WORKING_AREA_HEIGHT, topOffset + rows * th + (rows - 1) * gapY + 6);

    return { slots, height };
  }

  private buildWorkingArea(state: GameState): void {
    const ctx = this.ctx;
    const y = this.workingAreaY;
    const h = this.workingAreaHeight;

    // 磨砂面板 + 香槟金虚线边框（清新「待整理区」）。
    ctx.fillStyle = WORKING_AREA_BG;
    roundRectPath(ctx, this.safeLeft + 8, y, this.screenW - this.safeLeft - this.safeRight - 16, h, 10);
    ctx.fill();
    ctx.strokeStyle = WORKING_AREA_BORDER;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    roundRectPath(ctx, this.safeLeft + 8, y, this.screenW - this.safeLeft - this.safeRight - 16, h, 10);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawText(this.safeLeft + 14, y + 2, WORKING_AREA_LABEL, {
      size: 10,
      color: INK_SOFT,
      align: 'left',
      baseline: 'top',
    });

    for (const slot of this.workingAreaSlots) {
      if (this.isDraggingTile('working', slot.tile.id)) continue;
      const a = this.tileAnims.get(slot.tile.id);
      const opts: TileRenderOptions = {
        x: a ? a.x : slot.x,
        y: a ? a.y : slot.y,
        scale: a ? a.scale : 0.7,
      };
      if (this.isTileMoving(slot.tile.id)) {
        const tile = slot.tile;
        this.flyingDraws.push(() => drawPhysicalTile(ctx, tile, opts));
      } else {
        drawPhysicalTile(ctx, slot.tile, opts);
      }
    }
  }

  private buildRack(): void {
    const ctx = this.ctx;
    const { screenW, y, left, right } = this.rackConfig;
    // 预览开缺口时 rackSlots 少一张，背景高度仍按完整牌数算，避免牌架抽动。
    const tileCount = this.rackSlots.length + (this.previewGapIndex != null ? 1 : 0);
    const h = rackHeight(tileCount, this.rackConfig);
    const x = left + 8;
    const w = screenW - left - right - 16;

    // 墨玻璃牌架：深色半透明 + 柔和投影 + 香槟金细边。
    ctx.fillStyle = 'rgba(6,14,22,0.35)';
    roundRectPath(ctx, x + 2, y + 3, w, h, 14);
    ctx.fill();

    ctx.fillStyle = FROST;
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = FROST_BORDER;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(211,188,142,0.5)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, x + 3, y + 3, w - 6, h - 6, 11);
    ctx.stroke();

    for (const slot of this.rackSlots) {
      if (this.isDraggingTile('rack', slot.tile.id)) continue;
      const a = this.tileAnims.get(slot.tile.id);
      const opts: TileRenderOptions = a ? { ...slot.opts, x: a.x, y: a.y, scale: a.scale } : slot.opts;
      if (this.isTileMoving(slot.tile.id)) {
        const tile = slot.tile;
        this.flyingDraws.push(() => drawPhysicalTile(ctx, tile, opts));
      } else {
        drawPhysicalTile(ctx, slot.tile, opts);
      }
    }
  }

  private buildOrientationButton(): void {
    const { config } = this.orientationButton;
    const h = config.height ?? BUTTON_HEIGHT;
    this.drawCartoonButton(config.x, config.y, config.width, h, config.label, 'secondary', FONT_SIZE_BUTTON - 5);
  }

  private buildButtons(): void {
    for (const btn of this.buttons) {
      const { config } = btn;
      const variant = config.enabled === false ? 'disabled' : config.variant ?? 'primary';
      this.drawCartoonButton(config.x, config.y, config.width, BUTTON_HEIGHT, config.label, variant, FONT_SIZE_BUTTON);
    }
  }

  /** 卡通渐变胶囊按钮：投影 + 渐变 + 描边 + 顶部高光 + 粗体文字。 */
  private drawCartoonButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    variant: keyof typeof BUTTON_COLORS,
    fontSize: number,
  ): void {
    const ctx = this.ctx;
    const colors = BUTTON_COLORS[variant];

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRectPath(ctx, x + 1.5, y + 2.5, w, h, h / 2);
    ctx.fill();

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, colors.top);
    grad.addColorStop(1, colors.bottom);
    ctx.fillStyle = grad;
    roundRectPath(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, (h - 2) / 2);
    ctx.stroke();

    // 顶部釉面高光（深色面板上降低强度，避免亮斑刺眼）。
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRectPath(ctx, x + 6, y + 3, w - 12, h * 0.42, h / 2);
    ctx.fill();

    this.drawText(x + w / 2, y + h / 2 + 1, label, {
      size: fontSize,
      color: colors.text,
      bold: true,
      outline: variant === 'danger' ? { color: 'rgba(0,0,0,0.25)', width: 2 } : undefined,
    });
  }

  private buildPoolInfo(state: GameState): void {
    const ctx = this.ctx;
    const text = `牌池剩余: ${state.pool.length} 张`;
    ctx.font = `bold ${FONT_SIZE_LABEL - 2}px ${FONT_FAMILY}`;
    const tw = ctx.measureText(text).width;
    // 徽章底边止于牌架上方、与工作区（底边 = rackTop - 8）保持间距，避免互相压盖。
    const cy = this.rackConfig.y - 22;

    // 磨砂胶囊徽章（香槟金描边 + 光斑），居中悬浮在牌架上方。
    ctx.fillStyle = FROST_STRONG;
    roundRectPath(ctx, this.screenW / 2 - tw / 2 - 12, cy - 11, tw + 24, 22, 11);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, this.screenW / 2 - tw / 2 - 12, cy - 11, tw + 24, 22, 11);
    ctx.stroke();

    this.drawSparkle(this.screenW / 2 - tw / 2 - 2, cy, 3, GOLD_SOFT);
    this.drawText(this.screenW / 2 + 4, cy, text, {
      size: FONT_SIZE_LABEL - 2,
      color: INK,
      bold: true,
    });
  }

  private buildMessage(): void {
    const ctx = this.ctx;
    // 淡入淡出 + 上浮 12px 的卡通气泡动效。
    const alpha = Math.max(0, Math.min(1, this.messageAlpha));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${FONT_SIZE_LABEL}px ${FONT_FAMILY}`;
    const tw = ctx.measureText(this.message).width;
    const msgW = Math.min(this.screenW * 0.86, tw + 40);
    const msgH = 42;
    const x = (this.screenW - msgW) / 2;
    const y = this.screenH * 0.45 + (1 - alpha) * 12;

    // 原神式墨玻璃提示条：深色半透明 + 香槟金描边（暖白文字）。
    ctx.fillStyle = 'rgba(6,14,22,0.35)';
    roundRectPath(ctx, x + 2, y + 3, msgW, msgH, msgH / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(24,40,52,0.92)';
    roundRectPath(ctx, x, y, msgW, msgH, msgH / 2);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, x + 1, y + 1, msgW - 2, msgH - 2, (msgH - 2) / 2);
    ctx.stroke();

    this.drawText(this.screenW / 2, y + msgH / 2, this.message, {
      size: FONT_SIZE_LABEL,
      color: INK,
      bold: true,
    });
    ctx.restore();
  }

  // =========================================================================
  // 文本辅助
  // =========================================================================

  private drawText(x: number, y: number, text: string, opts: TextOptions): number {
    const ctx = this.ctx;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    ctx.font = `${opts.bold ? 'bold ' : ''}${opts.size}px ${FONT_FAMILY}`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = opts.baseline ?? 'middle';
    const w = ctx.measureText(text).width;
    if (opts.outline) {
      // 卡通描边文字：先粗描边再填充，保证任何底色上都醒目。
      ctx.lineJoin = 'round';
      ctx.lineWidth = opts.outline.width;
      ctx.strokeStyle = opts.outline.color;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = opts.color;
    ctx.fillText(text, x, y);
    ctx.restore();
    return w;
  }

  // =========================================================================
  // 对外接口
  // =========================================================================

  showMessage(msg: string, duration: number = 2000): void {
    const isNew = !this.message;
    this.message = msg;
    this.messageFading = false;
    if (isNew) this.messageAlpha = 0;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.messageFading = true;
      this.markDirty();
    }, duration);
    this.markDirty();
  }

  /**
   * 辅助性提示（操作确认/引导）：仅开发版展示。
   * 线上环境（体验版/正式版）静默，避免频繁打扰玩家；
   * 错误、失败、阻断类必要提示请继续用 showMessage。
   */
  showTip(msg: string, duration: number = 2000): void {
    if (!this.tipsEnabled) return;
    this.showMessage(msg, duration);
  }

  startGame(playerNames: string[]): void {
    this.engine.startGame(playerNames);
    this.markDirty();
  }
}