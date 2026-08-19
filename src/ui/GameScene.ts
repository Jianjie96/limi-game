// ============================================================================
// GameScene.ts — 用原生 Canvas 2D 渲染的主游戏场景
// ----------------------------------------------------------------------------
// 仅负责「渲染 + 输入」，所有游戏规则仍在 src/game/ 纯逻辑层（引擎）中。
// 命中检测复用纯计算的布局函数（layoutRack / layoutBoard / hitTest*），
// 绘制统一通过 Canvas 2D 上下文在逻辑坐标下进行（由 DPR 缩放映射到物理像素）。
// ============================================================================

import type { Tile, GameState } from '../game/types';
import { GamePhase, TurnPhase } from '../game/types';
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
import { layoutBoard, hitTestBoard, type BoardConfig, type BoardGroupSlot, type BoardTileSlot } from './Board';
import { createButtonStates, hitTestButton, type ButtonState } from './Button';
import {
  drawLogicalTile,
  drawPhysicalTile,
  roundRectPath,
  type TileRenderOptions,
} from './renderer';
import { getScreenInfo, type ScreenInfo } from './screen';

/** 文本绘制选项 */
interface TextOptions {
  size: number;
  color: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
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

  private rackSlots: RackTileSlot[] = [];
  private boardSlots: BoardGroupSlot[] = [];
  private workingAreaSlots: Array<{ tile: Tile; index: number }> = [];

  private selectedRackIds: Set<number> = new Set();
  private highlightedGroupIds: Set<string> = new Set();

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
      if (t) this.onPointerDown(t.clientX, t.clientY);
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
      this.onBoardTap(boardSlot);
      return;
    }
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

  private onBoardTap(slot: BoardTileSlot): void {
    const groupId = slot.groupId;
    if (this.highlightedGroupIds.has(groupId)) this.highlightedGroupIds.delete(groupId);
    else this.highlightedGroupIds.add(groupId);
    this.markDirty();
  }

  private onWorkingAreaTap(slot: { tile: Tile; index: number }): void {
    const state = this.engine.getState();
    if (state.turnPhase !== TurnPhase.PLAY) {
      this.showMessage('当前不能操作工作区');
      return;
    }

    try {
      const ctx = this.engine.getTurnContext();
      const tile = ctx.workingArea[slot.index];
      if (!tile) return;

      if (this.highlightedGroupIds.size > 0) {
        const groupId = [...this.highlightedGroupIds][0];
        this.engine.placeWorkingAreaTilesOnBoard([tile.id], groupId);
        this.highlightedGroupIds.delete(groupId);
        this.showMessage('牌已放回牌组');
      } else {
        try {
          const groupId = this.engine.createNewGroupFromWorkingArea([tile], 'run');
          this.highlightedGroupIds.add(groupId);
          this.showMessage('已创建新牌组 (顺子)');
        } catch {
          const groupId = this.engine.createNewGroupFromWorkingArea([tile], 'group');
          this.highlightedGroupIds.add(groupId);
          this.showMessage('已创建新牌组 (刻子)');
        }
      }
    } catch (err: any) {
      this.showMessage(err.message || '操作失败');
    }

    this.markDirty();
  }

  private hitTestWorkingArea(px: number, py: number): { tile: Tile; index: number } | null {
    const turned = this.engine.getState().turnContext;
    if (!turned) return null;

    const tileY = this.workingAreaY + 16;
    const scaledW = TILE_WIDTH * 0.7;
    const scaledH = TILE_HEIGHT * 0.7;

    for (let i = 0; i < this.workingAreaSlots.length; i++) {
      const slot = this.workingAreaSlots[i];
      const x = this.safeLeft + 12 + i * (TILE_WIDTH + TILE_GAP);
      if (px >= x && px <= x + scaledW && py >= tileY && py <= tileY + scaledH) {
        return { tile: slot.tile, index: i };
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
      this.boardSlots = layoutBoard(state.board, this.boardConfig, this.highlightedGroupIds);
      this.buildBoard(state);
      this.buildWorkingArea(state);
      this.rackSlots = layoutRack(
        this.engine.getCurrentPlayer().rack,
        this.rackConfig,
        this.selectedRackIds,
      );
      this.buildRack();
      this.buildButtons();
      this.buildPoolInfo(state);
      if (this.message) this.buildMessage();
    }

    // 切换方向按钮始终最后绘制，保证位于其他图层之上、不被桌面/牌架等遮挡。
    this.buildOrientationButton();
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

  private buildBoard(state: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, this.boardConfig.topY, this.screenW, this.boardConfig.bottomY - this.boardConfig.topY);

    for (const slot of this.boardSlots) {
      const { x, y, w, h } = slot.bounds;

      ctx.fillStyle = BOARD_GROUP_BG;
      ctx.strokeStyle = BOARD_GROUP_BORDER;
      ctx.lineWidth = 1;
      roundRectPath(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.stroke();

      for (const tileSlot of slot.tileSlots) {
        drawLogicalTile(ctx, tileSlot.logicalTile, tileSlot.opts);
      }
    }
  }

  private buildWorkingArea(state: GameState): void {
    const ctx = this.ctx;
    const y = this.workingAreaY;
    const h = WORKING_AREA_HEIGHT;

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

    this.workingAreaSlots = [];
    const turnCtx = state.turnContext;
    if (turnCtx && turnCtx.workingArea.length > 0) {
      const tiles = turnCtx.workingArea;
      const startX = this.safeLeft + 12;
      const tileY = y + 16;

      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const opts: TileRenderOptions = {
          x: startX + i * (TILE_WIDTH + TILE_GAP),
          y: tileY,
          scale: 0.7,
        };
        drawPhysicalTile(ctx, tile, opts);
        this.workingAreaSlots.push({ tile, index: i });
      }
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