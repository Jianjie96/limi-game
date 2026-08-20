// ============================================================================
// GameScene.ts — 用原生 Canvas 2D 渲染的主游戏场景
// ----------------------------------------------------------------------------
// 仅负责「渲染 + 输入」，所有游戏规则仍在 src/game/ 纯逻辑层（引擎）中。
// 命中检测复用纯计算的布局函数（layoutRack / layoutBoard / hitTest*），
// 绘制统一通过 Canvas 2D 上下文在逻辑坐标下进行（由 DPR 缩放映射到物理像素）。
// ============================================================================

import type { Tile, GameState } from '../game/types';
import { GamePhase } from '../game/types';
import { RummikubEngine } from '../game/engine';
import { canFormMelds, isValidRun, isValidGroupTiles } from '../game/validate';
import { detectGroupType, toLogical } from '../game/tiles';
import {
  LAYOUT,
  FONT_FAMILY,
  FONT_SIZE_LABEL,
  FONT_SIZE_BUTTON,
  PLAYER_INFO_HEIGHT,
  PLAYER_INFO_BG,
  PLAYER_INFO_TEXT,
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_GAP,
  WORKING_AREA_BG,
  WORKING_AREA_BORDER,
  WORKING_AREA_LABEL,
  WORKING_AREA_HEIGHT,
  BOARD_BG,
  BOARD_GROUP_BG,
  BOARD_GROUP_BORDER,
  RACK_BG,
  BUTTON_HEIGHT,
  BUTTON_RADIUS,
  BUTTON_COLORS,
} from './constants';
import { layoutRack, hitTestRack, rackHeight, type RackConfig, type RackTileSlot } from './Rack';
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
import {
  drawBoardTile,
  drawPhysicalTile,
  roundRectPath,
  type TileRenderOptions,
} from './renderer';
import { getScreenInfo, type ScreenInfo } from './screen';

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
}

/** 拖拽触发阈值（逻辑像素）：移动超过该距离才进入拖拽状态。 */
const DRAG_THRESHOLD = 8;

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

  private buttons: ButtonState[] = [];
  private orientationButton!: ButtonState;

  private isLandscape = false;

  private message = '';
  private messageTimer: any = null;

  private dirty = true;

  constructor(canvas: HTMLCanvasElement, engine: RummikubEngine, info: ScreenInfo) {
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
    this.buttons = createButtonStates([
      { id: 'submit', label: '出牌', x: 0, y: 0, width: 0, variant: 'primary' },
      { id: 'pass', label: 'Pass 摸牌', x: 0, y: 0, width: 0, variant: 'secondary' },
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
    this.orientationButton.config.y = this.safeTop + PLAYER_INFO_HEIGHT + 6;
    this.orientationButton.config.label = this.isLandscape ? '切竖屏' : '切横屏';
  }

  private updateButtonStates(): void {
    const isMyTurn = this.engine.getState().phase === GamePhase.PLAYING;
    // 回合即处于可操作阶段：玩家可随时「出牌」或选择「Pass 摸牌」。
    for (const btn of this.buttons) {
      btn.config.enabled = isMyTurn;
    }
  }

  // =========================================================================
  // 输入（微信触摸事件）
  // =========================================================================

  private bindTouch(): void {
    wx.onTouchStart((e) => {
      const t = e.touches?.[0];
      if (!t) return;
      this.pressX = t.clientX;
      this.pressY = t.clientY;
      // 仅记录潜在拖拽来源，不立即执行点击动作（区分点击与拖拽）。
      this.pressSource = this.findTileSource(t.clientX, t.clientY);
      this.markDirty();
    });

    wx.onTouchMove((e) => {
      const t = e.touches?.[0];
      if (!t || !this.pressSource) return;

      const dx = t.clientX - this.pressX;
      const dy = t.clientY - this.pressY;

      if (!this.drag) {
        // 超过阈值才进入拖拽，避免误触。
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          this.drag = { source: this.pressSource, curX: t.clientX, curY: t.clientY };
        }
      } else {
        this.drag.curX = t.clientX;
        this.drag.curY = t.clientY;
      }
      this.markDirty();
    });

    wx.onTouchEnd((e) => {
      const t = e.changedTouches?.[0];

      if (this.drag) {
        this.handleTileDrop(this.drag, this.drag.curX, this.drag.curY);
        this.drag = null;
        this.pressSource = null;
        this.markDirty();
        return;
      }

      // 未进入拖拽 → 视作点击，走原有命中的点击分发。
      if (t) this.onPointerDown(t.clientX, t.clientY);
      this.pressSource = null;
    });

    wx.onTouchCancel(() => {
      this.drag = null;
      this.pressSource = null;
      this.markDirty();
    });
  }

  private bindResize(): void {
    // onWindowResize 作为辅助监听：真机旋转 / 开发者工具改窗口大小也会触发。
    wx.onWindowResize(() => {
      this.refreshScreenInfo();
    });
  }

  private refreshScreenInfo(): void {
    // 转屏后重新读取全量屏幕信息（含更新后的逻辑尺寸与安全区）。
    const info = getScreenInfo(this.canvas);
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

  private toggleOrientation(): void {
    if (typeof wx.setDeviceOrientation !== 'function') {
      this.showMessage('当前环境不支持转屏');
      return;
    }
    const target = this.isLandscape ? 'portrait' : 'landscape';
    wx.setDeviceOrientation({
      value: target,
      success: () => {
        // 转屏后系统信息不会立即更新，延迟一段时间再刷新，确保拿到新尺寸。
        setTimeout(() => this.refreshScreenInfo(), 300);
      },
      fail: () => {
        this.showMessage('转屏失败');
      },
    });
  }

  private setupEngineListeners(): void {
    this.engine.on('turnStart', () => {
      this.selectedRackIds.clear();
      this.highlightedGroupIds.clear();
      this.markDirty();
    });

    this.engine.on('tileDrawn', () => {
      this.showMessage('摸牌成功');
    });

    this.engine.on('turnEnd', (data: any) => {
      const reason = data?.reason || '';
      if (reason === 'pass') this.showMessage('Pass 成功，回合结束');
      else if (reason === 'submit') this.showMessage('出牌成功');
      else if (reason === 'timeout') this.showMessage('超时，回合结束');
    });

    this.engine.on('turnRollback', () => {
      // 桌面/牌架已回滚，清除本回合的选中状态。
      this.selectedRackIds.clear();
      this.highlightedGroupIds.clear();
      this.markDirty();
    });

    this.engine.on('gameOver', (data: any) => {
      const winner = data.result.playerResults.find((r: any) => r.isWinner);
      this.showMessage(`游戏结束! ${winner?.playerName} 获胜!`);
    });

    this.engine.on('error', (data: any) => {
      this.showMessage(`错误: ${data.message || '未知错误'}`);
    });
  }

  private onPointerDown(x: number, y: number): void {
    if (hitTestButton(x, y, [this.orientationButton])) {
      this.toggleOrientation();
      return;
    }

    const btn = hitTestButton(x, y, this.buttons);
    if (btn && btn.config.enabled !== false) {
      this.onButtonTap(btn.config.id);
      return;
    }

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

  /** 当前是否正在拖拽某来源的某张牌（用于在原位置隐藏该牌）。 */
  private isDraggingTile(kind: DragSourceKind, tileId: number): boolean {
    return !!this.drag && this.drag.source.kind === kind && this.drag.source.tileId === tileId;
  }

  /** 拖拽放下：根据来源与落点执行拆分/合并/加牌/成组。 */
  private handleTileDrop(drag: DragState, x: number, y: number): void {
    const src = drag.source;

    const boardTile = hitTestBoard(x, y, this.boardSlots);
    const boardGroupSlot = boardTile ? null : hitTestBoardGroup(x, y, this.boardSlots);
    const workingHit = this.hitTestWorkingArea(x, y);
    const onWorkingArea = !!workingHit || this.isInWorkingAreaRegion(x, y);
    const targetGroupId = boardTile?.groupId ?? boardGroupSlot?.groupId ?? null;
    const onBoardEmpty = this.isInBoardRegion(x, y) && !targetGroupId && !onWorkingArea;
    const rackTarget = hitTestRack(x, y, this.rackSlots);

    try {
      // 牌架 → 牌架：拖到另一张手牌上重排顺序（理牌）。
      if (src.kind === 'rack' && rackTarget && !targetGroupId && !onWorkingArea) {
        this.engine.reorderRackTile(src.tileId, rackTarget.index);
        return;
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
          this.showMessage('已加入牌组');
        } else if (onBoardEmpty) {
          this.engine.createNewGroupOnBoard([src.tile], detectGroupType([src.tile]));
          this.selectedRackIds.delete(src.tileId);
        }
        return;
      }

      // 工作区 → 桌面：合并到牌组 / 取出成组。
      if (src.kind === 'working') {
        if (!this.canManipulateBoard()) {
          this.showMessage('破冰后才能操作桌面牌');
          return;
        }
        if (targetGroupId) {
          this.engine.placeWorkingAreaTilesOnBoard([src.tileId], targetGroupId);
          this.showMessage('已合并到牌组');
        } else if (onBoardEmpty) {
          this.engine.createNewGroupFromWorkingArea([src.tile], detectGroupType([src.tile]));
        }
        return;
      }

      // 桌面 → 其它地方：拆分 / 移动 / 合并 / 成立新组。
      if (!this.canManipulateBoard()) {
        this.showMessage('破冰后才能操作桌面牌');
        return;
      }
      const sourceGroupId = src.sourceGroupId!;
      if (boardTile && targetGroupId === sourceGroupId) {
        // 同一牌组内拖到另一张牌上 → 仅重排顺序（Joker 显示值随位置变化）。
        this.engine.moveTileWithinGroup(sourceGroupId, src.tileId, boardTile.index);
        this.showMessage('已调整顺序');
      } else if (targetGroupId && targetGroupId !== sourceGroupId) {
        this.engine.removeTilesFromBoard(sourceGroupId, [src.tileId]);
        this.engine.placeWorkingAreaTilesOnBoard([src.tileId], targetGroupId);
        this.showMessage('已移动');
      } else if (onBoardEmpty) {
        this.engine.removeTilesFromBoard(sourceGroupId, [src.tileId]);
        this.engine.createNewGroupFromWorkingArea([src.tile], detectGroupType([src.tile]));
      } else if (onWorkingArea) {
        this.engine.removeTilesFromBoard(sourceGroupId, [src.tileId]);
        this.showMessage('已拆分到工作区');
      }
      // 落回原牌组或无效位置 → 不操作（牌保持原位）。
    } catch (err: any) {
      this.showMessage(err.message || '操作失败');
    }
  }

  /** 在拖拽位置绘制幽灵牌。 */
  private drawDragGhost(): void {
    if (!this.drag) return;
    const scale = 1.05;
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
            const rack = this.engine.getCurrentPlayer().rack;
            const tiles = rack.filter((t) => this.selectedRackIds.has(t.id));
            const type = detectGroupType(tiles);
            this.engine.createNewGroupOnBoard(tiles, type);
            this.selectedRackIds.clear();
          } catch (err: any) {
            this.showMessage(err.message || '放置失败');
            return;
          }
        }

        const result = this.engine.submitTurn();
        if (!result.valid) {
          const errMsg = result.errors.map((er) => er.message).join('; ');
          this.showMessage(`出牌失败: ${errMsg}`);
        }
        break;
      }

      case 'pass':
        this.engine.pass();
        break;
    }
  }

  private onRackTap(slot: RackTileSlot): void {
    const id = slot.tile.id;
    if (this.selectedRackIds.has(id)) {
      this.selectedRackIds.delete(id);
      this.markDirty();
      return;
    }

    // 实时校验：新牌与已选中牌须能共同凑成合法顺子/刻子，否则禁止选中。
    const rack = this.engine.getCurrentPlayer().rack;
    const candidateTiles = rack.filter((t) => this.selectedRackIds.has(t.id) || t.id === id);
    if (!canFormMelds(candidateTiles)) {
      this.showMessage('所选牌存在明显冲突，无法组成合法顺子/刻子');
      return;
    }

    this.selectedRackIds.add(id);

    // 已选中一组完整合法的顺子/刻子时，给出「可以出牌」提示。
    if (this.isCompleteMeld(rack.filter((t) => this.selectedRackIds.has(t.id)))) {
      this.showMessage('已选好合法牌组，可点击「出牌」');
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
    return state.phase === GamePhase.PLAYING && this.engine.getCurrentPlayer().hasMadeInitialMeld;
  }

  /** 点击桌面上的某张牌：有选中牌架牌时加牌，否则拆分到工作区。 */
  private onBoardTileTap(slot: BoardTileSlot): void {
    if (!this.canManipulateBoard()) {
      this.showMessage('破冰后才能操作桌面牌');
      return;
    }

    // 有选中牌架牌 → 把它们加到这个牌组（给已有牌组加牌）。
    if (this.selectedRackIds.size > 0) {
      try {
        const rack = this.engine.getCurrentPlayer().rack;
        const tiles = rack.filter((t) => this.selectedRackIds.has(t.id));
        this.engine.placeTilesOnBoard(tiles.map(t => t.id), slot.groupId);
        this.selectedRackIds.clear();
        this.showMessage('已加入牌组');
      } catch (err: any) {
        this.showMessage(err.message || '加牌失败');
      }
      this.markDirty();
      return;
    }

    // 否则拆分：把这张牌移到工作区。
    try {
      const tileId = slot.logicalTile.originalTile.id;
      this.engine.removeTilesFromBoard(slot.groupId, [tileId]);
      this.showMessage('已拆分：牌移入工作区');
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
        this.showMessage('已合并到选中牌组');
      } else {
        this.engine.createNewGroupFromWorkingArea([tile], detectGroupType([tile]));
        this.showMessage('已从工作区取出');
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
    if (this.dirty) {
      this.dirty = false;
      // 重置为逻辑坐标系（逻辑像素 × DPR = 物理像素）。
      this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      this.rebuild();
    }
    requestAnimationFrame(this.tick);
  };

  start(): void {
    requestAnimationFrame(this.tick);
  }

  private rebuild(): void {
    const state = this.engine.getState();
    this.updateButtonStates();

    // 全局背景
    this.ctx.fillStyle = '#1B5E20';
    this.ctx.fillRect(0, 0, this.screenW, this.screenH);

    if (state.phase === GamePhase.WAITING) {
      this.buildWaiting();
    } else if (state.phase === GamePhase.GAME_OVER) {
      this.buildGameOver(state);
    } else {
      this.buildTopBar(state);
      this.buildOpponents(state);

      const rackTiles = this.engine.getCurrentPlayer().rack;
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

      // 桌面：从顶部向下铺，底部不越过工作区顶部。
      this.boardSlots = layoutBoard(state.board, this.boardConfig, this.highlightedGroupIds);
      const contentH = boardContentHeight(this.boardSlots, this.boardConfig.topY);
      const minBoardH = 72; // 空桌面也保留一个最小高度，避免布局抖动。
      const boardBottom = Math.min(
        this.boardConfig.topY + Math.max(contentH, minBoardH),
        this.workingAreaY,
      );
      this.boardBottom = boardBottom;

      this.buildBoard(state, boardBottom);
      this.buildWorkingArea(state);
      this.rackSlots = layoutRack(rackTiles, this.rackConfig, this.selectedRackIds);
      this.buildRack();
      this.buildButtons();
      this.buildPoolInfo(state);
      if (this.message) this.buildMessage();
    }

    // 切换方向按钮始终最后绘制，保证位于其他图层之上、不被桌面/牌架等遮挡。
    this.buildOrientationButton();

    // 拖拽幽灵牌绘制在最上层。
    this.drawDragGhost();
  }

  private buildWaiting(): void {
    this.drawText(this.screenW / 2, this.screenH / 2 - 30, '拉密 Rummikub', {
      size: 24,
      color: '#FFFFFF',
      bold: true,
    });
    this.drawText(this.screenW / 2, this.screenH / 2 + 10, '等待游戏开始...', {
      size: 16,
      color: '#FFFFFF',
    });
  }

  private buildGameOver(state: GameState): void {
    const result = state.result;
    if (!result) return;

    this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this.ctx.fillRect(0, 0, this.screenW, this.screenH);

    this.drawText(this.screenW / 2, this.screenH / 2 - 80, '游戏结束', {
      size: 28,
      color: '#FFD700',
      bold: true,
    });

    const winner = result.playerResults.find((r) => r.isWinner);
    this.drawText(this.screenW / 2, this.screenH / 2 - 40, `${winner?.playerName} 获胜!`, {
      size: 20,
      color: '#FFFFFF',
      bold: true,
    });

    let y = this.screenH / 2;
    for (const pr of result.playerResults) {
      const color = pr.isWinner ? '#4CAF50' : '#EF5350';
      const sign = pr.scoreDelta >= 0 ? '+' : '';
      this.drawText(this.screenW / 2, y, `${pr.playerName}: ${sign}${pr.scoreDelta}`, {
        size: 16,
        color,
      });
      y += 30;
    }
  }

  private buildTopBar(state: GameState): void {
    const y = this.safeTop;
    this.ctx.fillStyle = PLAYER_INFO_BG;
    this.ctx.fillRect(0, y, this.screenW, PLAYER_INFO_HEIGHT);

    const player = this.engine.getCurrentPlayer();
    const cy = y + PLAYER_INFO_HEIGHT / 2;

    this.drawText(this.safeLeft + 12, cy, `回合 ${state.turnNumber} | ${player.name} 的回合`, {
      size: FONT_SIZE_LABEL,
      color: PLAYER_INFO_TEXT,
      bold: true,
      align: 'left',
    });

    this.drawText(this.screenW - this.safeRight - 12, cy, '出牌 或 Pass 摸牌', {
      size: FONT_SIZE_LABEL,
      color: PLAYER_INFO_TEXT,
      align: 'right',
    });
  }

  private buildOpponents(state: GameState): void {
    const opponents = state.players.filter((p) => p.id !== state.currentPlayerIndex);
    const y = this.safeTop + PLAYER_INFO_HEIGHT + 4;

    let x = this.safeLeft + 12;
    for (const opp of opponents) {
      const text = `${opp.name}: ${opp.rack.length}张`;
      const w = this.drawText(x, y, text, {
        size: FONT_SIZE_LABEL - 2,
        color: '#FFFFFF',
        align: 'left',
        alpha: 0.7,
      });
      x += w + 20;
    }
  }

  private buildBoard(state: GameState, boardBottom: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, this.boardConfig.topY, this.screenW, Math.max(0, boardBottom - this.boardConfig.topY));

    for (const slot of this.boardSlots) {
      const { x, y, w, h } = slot.bounds;

      ctx.fillStyle = BOARD_GROUP_BG;
      ctx.strokeStyle = BOARD_GROUP_BORDER;
      ctx.lineWidth = 1;
      roundRectPath(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.stroke();

      for (const tileSlot of slot.tileSlots) {
        if (this.isDraggingTile('board', tileSlot.logicalTile.originalTile.id)) continue;
        drawBoardTile(ctx, slot.group.type, slot.group.tiles, tileSlot.index, tileSlot.opts);
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

    ctx.fillStyle = WORKING_AREA_BG;
    ctx.strokeStyle = WORKING_AREA_BORDER;
    ctx.lineWidth = 1;
    roundRectPath(ctx, this.safeLeft + 8, y, this.screenW - this.safeLeft - this.safeRight - 16, h, 4);
    ctx.fill();
    ctx.stroke();

    this.drawText(this.safeLeft + 12, y + 2, WORKING_AREA_LABEL, {
      size: 10,
      color: '#E1BEE7',
      align: 'left',
      baseline: 'top',
    });

    for (const slot of this.workingAreaSlots) {
      if (this.isDraggingTile('working', slot.tile.id)) continue;
      drawPhysicalTile(ctx, slot.tile, {
        x: slot.x,
        y: slot.y,
        scale: 0.7,
      });
    }
  }

  private buildRack(): void {
    const ctx = this.ctx;
    const { screenW, y, left, right } = this.rackConfig;
    const h = rackHeight(this.rackSlots.length, this.rackConfig);

    ctx.fillStyle = RACK_BG;
    roundRectPath(ctx, left + 8, y, screenW - left - right - 16, h, 8);
    ctx.fill();

    for (const slot of this.rackSlots) {
      if (this.isDraggingTile('rack', slot.tile.id)) continue;
      drawPhysicalTile(ctx, slot.tile, slot.opts);
    }
  }

  private buildOrientationButton(): void {
    const ctx = this.ctx;
    const { config } = this.orientationButton;
    const colors = BUTTON_COLORS.secondary;

    ctx.fillStyle = colors.bg;
    roundRectPath(ctx, config.x, config.y, config.width, BUTTON_HEIGHT, BUTTON_RADIUS);
    ctx.fill();

    this.drawText(config.x + config.width / 2, config.y + BUTTON_HEIGHT / 2, config.label, {
      size: FONT_SIZE_BUTTON - 2,
      color: colors.text,
      bold: true,
    });
  }

  private buildButtons(): void {
    const ctx = this.ctx;
    for (const btn of this.buttons) {
      const { config } = btn;
      const variant = config.enabled === false ? 'disabled' : config.variant ?? 'primary';
      const colors = BUTTON_COLORS[variant];
      const h = BUTTON_HEIGHT;

      ctx.fillStyle = colors.bg;
      roundRectPath(ctx, config.x, config.y, config.width, h, BUTTON_RADIUS);
      ctx.fill();

      this.drawText(config.x + config.width / 2, config.y + h / 2, config.label, {
        size: FONT_SIZE_BUTTON,
        color: colors.text,
        bold: true,
      });
    }
  }

  private buildPoolInfo(state: GameState): void {
    this.drawText(this.screenW / 2, this.rackConfig.y - 20, `牌池剩余: ${state.pool.length} 张`, {
      size: FONT_SIZE_LABEL - 2,
      color: '#FFFFFF',
      baseline: 'top',
    });
  }

  private buildMessage(): void {
    const ctx = this.ctx;
    const msgW = this.screenW * 0.8;
    const msgH = 40;
    const x = (this.screenW - msgW) / 2;
    const y = this.screenH * 0.45;

    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    roundRectPath(ctx, x, y, msgW, msgH, 8);
    ctx.fill();

    this.drawText(this.screenW / 2, y + msgH / 2, this.message, {
      size: FONT_SIZE_LABEL,
      color: '#FFFFFF',
      bold: true,
    });
  }

  // =========================================================================
  // 文本辅助
  // =========================================================================

  private drawText(x: number, y: number, text: string, opts: TextOptions): number {
    const ctx = this.ctx;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    ctx.fillStyle = opts.color;
    ctx.font = `${opts.bold ? 'bold ' : ''}${opts.size}px ${FONT_FAMILY}`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = opts.baseline ?? 'middle';
    const w = ctx.measureText(text).width;
    ctx.fillText(text, x, y);
    ctx.restore();
    return w;
  }

  // =========================================================================
  // 对外接口
  // =========================================================================

  showMessage(msg: string, duration: number = 2000): void {
    this.message = msg;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.message = '';
      this.markDirty();
    }, duration);
    this.markDirty();
  }

  startGame(playerNames: string[]): void {
    this.engine.startGame(playerNames);
    this.markDirty();
  }
}