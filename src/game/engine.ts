// ============================================================================
// engine.ts — 游戏主引擎（状态机 + 动作分发）
// ============================================================================

import type {
  Tile,
  TileColor,
  TileGroup,
  LogicalTile,
  GroupType,
  GameState,
  GameConfig,
  GamePhase,
  PlayerState,
  TurnContext,
  SubmitResult,
  ValidationError,
  GameEvent,
  GameResult,
  EngineOp,
} from './types';
import { TurnPhase, GamePhase as GP } from './types';
import { DEFAULT_CONFIG } from './types';
import {
  createFullSet,
  shuffle,
  isJoker,
  isLogicalJoker,
  toLogical,
  getTileValue,
  findTileById,
  detectGroupType,
} from './tiles';
import { isValidGroup, isValidRun, isValidGroupTiles, validateBoard } from './validate';
import { calculateInitialMeldScore, calculateRackValue, buildGameResult, findLowestScorePlayer } from './scoring';
import { snapshotBoard, snapshotPool, restoreBoard, restorePool, diffBoard, getAllTileIdsOnBoard } from './snapshot';
import {
  createTurnContext,
  recordJokerReplacement,
  recordRackTilesPlaced,
  recordDraw,
  incrementPasses,
  resetPasses,
  hasPlacedFromRack as ctxHasPlacedFromRack,
  markDrawnTilePlaced,
  wasDrawnTilePlaced,
} from './turn';

// ---------------------------------------------------------------------------
// 工具: 解析牌组 ID 编号
// ---------------------------------------------------------------------------

/** 从桌面牌组 ID 中解析出最大编号（序列化恢复时用于同步计数器）。 */
function maxGroupIdFromBoard(board: readonly TileGroup[]): number {
  let max = 0;
  for (const g of board) {
    const m = /^g(\d+)$/.exec(g.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/** 刻子理牌的固定颜色顺序（Joker 殿后）。 */
const SET_COLOR_ORDER: Record<string, number> = {
  red: 0,
  blue: 1,
  yellow: 2,
  black: 3,
  joker: 4,
};

/**
 * 顺子理牌：按数字升序排列，Joker 先填中间缺口、再向上延伸（与渲染层
 * 「首=向下延伸、尾=向上延伸」的位置推断一致）。不改 Joker 逻辑值，
 * 仅重排存储（显示）顺序。合法性已由提交前校验保证。
 */
function tidyRunTiles(tiles: LogicalTile[]): LogicalTile[] {
  const jokers = tiles.filter((t) => isLogicalJoker(t));
  const reals = tiles.filter((t) => !isLogicalJoker(t));
  if (reals.length === 0 || jokers.length === 0) {
    // 无 Joker 直接升序；纯 Joker 防御性原样返回。
    return [...tiles].sort(
      (a, b) => a.logicalNumber - b.logicalNumber ||
        (SET_COLOR_ORDER[a.logicalColor] ?? 9) - (SET_COLOR_ORDER[b.logicalColor] ?? 9),
    );
  }

  reals.sort((a, b) => a.logicalNumber - b.logicalNumber);
  const min = reals[0].logicalNumber;
  const max = reals[reals.length - 1].logicalNumber;

  // Joker 承担的数值：中间缺口优先，剩余优先向上延伸，不够再向下。
  const jokerValues: number[] = [];
  for (let v = min; v <= max; v++) {
    if (!reals.some((t) => t.logicalNumber === v)) jokerValues.push(v);
  }
  let remaining = jokers.length - jokerValues.length;
  for (let v = max + 1; remaining > 0 && v <= 13; v++, remaining--) jokerValues.push(v);
  for (let v = min - 1; remaining > 0 && v >= 1; v--, remaining--) jokerValues.push(v);

  // 按升序逐位分配：真实牌占本数值位，其余由 Joker 填充。
  const values = [...reals.map((t) => t.logicalNumber), ...jokerValues].sort((a, b) => a - b);
  const realQueue = [...reals];
  const jokerQueue = [...jokers];
  return values.map((v) => {
    const idx = realQueue.findIndex((t) => t.logicalNumber === v);
    return idx >= 0 ? realQueue.splice(idx, 1)[0] : jokerQueue.shift()!;
  });
}

// ---------------------------------------------------------------------------
// RummikubEngine
// ---------------------------------------------------------------------------

export class RummikubEngine {
  private state: GameState;
  private listeners: Map<GameEvent, Set<(...args: any[]) => void>>;
  /** 本回合桌面操作日志（在线对战：提交时发云端回放校验） */
  private turnOps: EngineOp[] = [];
  /** 牌组 ID 计数器（实例级，fromState 时按桌面最大编号恢复） */
  private groupIdCounter = 0;

  private nextGroupId(): string {
    return `g${++this.groupIdCounter}`;
  }

  constructor(config?: Partial<GameConfig>) {
    this.listeners = new Map();
    this.state = {
      phase: GP.WAITING,
      players: [],
      currentPlayerIndex: 0,
      board: [],
      pool: [],
      turnPhase: TurnPhase.PLAY,
      turnContext: null,
      turnNumber: 0,
      config: { ...DEFAULT_CONFIG, ...config },
      result: null,
    };
  }

  // =========================================================================
  // 游戏生命周期
  // =========================================================================

  startGame(playerNames: string[]): void {
    const count = playerNames.length;
    if (count < 2 || count > 4) {
      throw new Error(`玩家数量必须为 2-4, 当前: ${count}`);
    }

    const allTiles = shuffle(createFullSet());

    const players: PlayerState[] = [];
    let dealIndex = 0;
    for (let i = 0; i < count; i++) {
      const rack = allTiles.splice(0, this.state.config.initialHandSize);
      players.push({
        id: i,
        name: playerNames[i],
        rack,
        score: 0,
        hasMadeInitialMeld: false,
      });
    }

    const pool = allTiles;

    this.groupIdCounter = 0;
    this.state = {
      ...this.state,
      phase: GP.PLAYING,
      players,
      currentPlayerIndex: 0,
      board: [],
      pool,
      turnPhase: TurnPhase.PLAY,
      turnNumber: 1,
      result: null,
    };

    this.state.turnContext = createTurnContext(
      this.state.board,
      this.state.pool,
      this.getCurrentPlayer().rack,
      0,
    );

    this.emit('gameStart', { players, turnNumber: 1 });
    this.emit('turnStart', { playerId: 0 });
    this.turnOps = [];
  }

  newGame(): void {
    this.groupIdCounter = 0;
    this.state = {
      ...this.state,
      phase: GP.WAITING,
      players: [],
      currentPlayerIndex: 0,
      board: [],
      pool: [],
      turnPhase: TurnPhase.PLAY,
      turnContext: null,
      turnNumber: 0,
      result: null,
    };
    this.turnOps = [];
  }

  // =========================================================================
  // 回合动作
  // =========================================================================

  drawTile(): Tile | null {
    this.assertPlaying();
    const ctx = this.getTurnContext();

    // 每回合最多摸 1 张牌（首次出牌前无需摸牌；摸牌用于 Pass 或超时惩罚）。
    if (ctx.hasDrawnFromPool || this.state.pool.length === 0) {
      return null;
    }

    const tile = this.state.pool.pop()!;
    recordDraw(ctx, tile);
    this.getCurrentPlayer().rack.push(tile);

    this.emit('tileDrawn', { playerId: this.getCurrentPlayer().id, tile });
    return tile;
  }

  /**
   * 调整自己牌架中某张牌的顺序（理牌）。
   * 纯牌架内整理，不改变手牌内容、不消耗动作、不影响回合状态。
   */
  reorderRackTile(tileId: number, toIndex: number): void {
    this.assertPhase(TurnPhase.PLAY);
    const player = this.getCurrentPlayer();
    const fromIndex = player.rack.findIndex(t => t.id === tileId);
    if (fromIndex < 0) throw new Error(`牌架中找不到牌 ${tileId}`);

    const rack = [...player.rack];
    const [moved] = rack.splice(fromIndex, 1);
    const insertAt = Math.max(0, Math.min(toIndex, rack.length));
    rack.splice(insertAt, 0, moved);
    player.rack = rack;

    this.emit('boardManipulated', { action: 'reorderRack', tileId, fromIndex, toIndex: insertAt });
  }

  /**
   * 将牌从牌架放到桌面已有牌组。
   */
  placeTilesOnBoard(tileIds: number[], groupId: string, position: number = -1): void {
    this.assertPhase(TurnPhase.PLAY);
    const player = this.getCurrentPlayer();
    const group = this.findGroup(groupId);
    if (!group) throw new Error(`牌组 ${groupId} 不存在`);

    const tiles: Tile[] = [];
    for (const id of tileIds) {
      const tile = findTileById(player.rack, id);
      if (!tile) throw new Error(`牌架中找不到牌 ${id}`);
      tiles.push(tile);
    }

    // 检查是否是本回合刚摸到的牌
    const ctx = this.getTurnContext();
    if (ctx.drawnTileId !== null) {
      for (const tile of tiles) {
        if (tile.id === ctx.drawnTileId) {
          markDrawnTilePlaced(ctx);
        }
      }
    }

    const idSet = new Set(tileIds);
    player.rack = player.rack.filter(t => !idSet.has(t.id));

    const logicalTiles = tiles.map(toLogical);
    let newTiles = [...group.tiles];
    if (position < 0 || position >= newTiles.length) {
      newTiles.push(...logicalTiles);
    } else {
      newTiles.splice(position, 0, ...logicalTiles);
    }

    // Joker 保持为通配牌（不写死代表值），提交时由验证器按“是否存在合法赋值”动态校验。
    this.replaceGroup({ ...group, tiles: newTiles });

    recordRackTilesPlaced(ctx, tiles);
    resetPasses(ctx);

    this.recordOp({ op: 'PLACE_ON_BOARD', tileIds, groupId, position });
    this.emit('tilesPlaced', { playerId: player.id, tileIds, groupId });
  }

  /**
   * 在桌面创建新牌组。
   */
  createNewGroupOnBoard(tiles: Tile[], groupType: GroupType): string {
    this.assertPhase(TurnPhase.PLAY);
    const player = this.getCurrentPlayer();
    const ctx = this.getTurnContext();

    const tileIds = tiles.map(t => t.id);
    for (const id of tileIds) {
      if (!findTileById(player.rack, id)) {
        throw new Error(`牌 ${id} 不在牌架中`);
      }
    }

    // 检查是否包含本回合刚摸到的牌
    if (ctx.drawnTileId !== null) {
      for (const tile of tiles) {
        if (tile.id === ctx.drawnTileId) {
          markDrawnTilePlaced(ctx);
        }
      }
    }

    const idSet = new Set(tileIds);
    player.rack = player.rack.filter(t => !idSet.has(t.id));

    const groupId = this.nextGroupId();
    const logicalTiles = tiles.map(toLogical);

    const newGroup: TileGroup = {
      id: groupId,
      type: groupType,
      tiles: logicalTiles,
    };

    this.state.board = [...this.state.board, newGroup];

    recordRackTilesPlaced(ctx, tiles);
    resetPasses(ctx);

    this.recordOp({ op: 'CREATE_GROUP', tileIds, groupType });
    this.emit('tilesPlaced', { playerId: player.id, tileIds, groupId, isNew: true });
    return groupId;
  }

  /**
   * 把牌放回当前玩家的牌架（未破冰时撤销首次出牌使用）。
   * 从桌面牌组取回；同时更新「本回合从牌架放下」的追踪。
   */
  returnTilesToRack(tileIds: number[]): Tile[] {
    this.assertPhase(TurnPhase.PLAY);
    const player = this.getCurrentPlayer();
    const ctx = this.getTurnContext();
    const idSet = new Set(tileIds);
    const returned: Tile[] = [];

    // 从桌面牌组中移除
    const nextBoard: TileGroup[] = [];
    for (const group of this.state.board) {
      const remaining: LogicalTile[] = [];
      for (const lt of group.tiles) {
        if (idSet.has(lt.originalTile.id)) {
          returned.push(lt.originalTile);
        } else {
          remaining.push(lt);
        }
      }
      if (remaining.length === 0) continue; // 整组被拿回 → 移除该组
      nextBoard.push(remaining.length === group.tiles.length ? group : { ...group, tiles: remaining });
    }
    this.state.board = nextBoard;

    if (returned.length !== tileIds.length) {
      throw new Error('部分牌不在桌面');
    }

    // 放回牌架
    player.rack = [...player.rack, ...returned];

    // 更新「本回合从牌架放下」追踪，保持状态一致
    const returnedIds = new Set(returned.map(t => t.id));
    ctx.rackTilesPlacedThisTurn = ctx.rackTilesPlacedThisTurn.filter(t => !returnedIds.has(t.id));
    if (ctx.rackTilesPlacedThisTurn.length === 0) {
      ctx.hasPlacedFromRack = false;
    }

    this.recordOp({ op: 'RETURN_TO_RACK', tileIds });
    this.emit('boardManipulated', { action: 'returnToRack', tileIds });
    return returned;
  }

  /**
   * 替换桌面上的 Joker。
   * Joker 是通配牌，替换只需保证「用真实牌替换后牌组仍然合法」，
   * 因此动态校验替换结果，而非比对某个写死的代表值。
   */
  replaceJokerOnBoard(groupId: string, jokerPosition: number, realTile: Tile): void {
    this.assertPhase(TurnPhase.PLAY);
    const player = this.getCurrentPlayer();
    const group = this.findGroup(groupId);
    if (!group) throw new Error(`牌组 ${groupId} 不存在`);

    const jokerLT = group.tiles[jokerPosition];
    if (!jokerLT || jokerLT.originalTile.color !== 'joker') {
      throw new Error(`位置 ${jokerPosition} 不是 Joker`);
    }

    const rackTile = findTileById(player.rack, realTile.id);
    if (!rackTile) throw new Error(`牌架中找不到牌 ${realTile.id}`);

    const newTiles = [...group.tiles];
    newTiles[jokerPosition] = toLogical(realTile);

    // 真实牌必须是该 Joker 可以代表的牌之一：替换后牌组需保持合法。
    const isValid =
      group.type === 'run' ? isValidRun(newTiles) : isValidGroupTiles(newTiles);
    if (!isValid) {
      throw new Error(`牌 ${realTile.color}${realTile.number} 无法替换该 Joker`);
    }

    // 检查是否是本回合刚摸到的牌
    const ctx = this.getTurnContext();
    if (ctx.drawnTileId !== null && realTile.id === ctx.drawnTileId) {
      markDrawnTilePlaced(ctx);
    }

    this.replaceGroup({ ...group, tiles: newTiles });

    player.rack = player.rack.filter(t => t.id !== realTile.id);

    const jokerTile = jokerLT.originalTile;
    // 换下的 Joker 回到牌架：本回合必须重新放上桌面（提交时校验）。
    player.rack = [...player.rack, jokerTile];

    recordJokerReplacement(ctx, jokerTile, groupId, realTile);
    recordRackTilesPlaced(ctx, [realTile]);

    this.recordOp({ op: 'REPLACE_JOKER', groupId, jokerPosition, realTileId: realTile.id });
    this.emit('jokerReplaced', {
      playerId: player.id,
      groupId,
      jokerPosition,
      jokerTile,
      realTile,
    });
  }

  /**
   * 在同一牌组内调整某张牌的顺序（拖拽重排）。
   * 不改变牌组内的牌集合，仅改变展示顺序；Joker 的代表值由渲染层按位置动态推断，
   * 提交时仍按「是否存在合法赋值」动态校验。
   */
  moveTileWithinGroup(groupId: string, tileId: number, toIndex: number): void {
    this.assertPhase(TurnPhase.PLAY);
    const group = this.findGroup(groupId);
    if (!group) throw new Error(`牌组 ${groupId} 不存在`);

    const fromIndex = group.tiles.findIndex(lt => lt.originalTile.id === tileId);
    if (fromIndex < 0) throw new Error(`牌组中找不到牌 ${tileId}`);

    const tiles = [...group.tiles];
    const [moved] = tiles.splice(fromIndex, 1);
    // 目标牌的原下标即拖拽牌应落到的位置；移除后数组长度 -1，故上界为当前长度。
    const insertAt = Math.max(0, Math.min(toIndex, tiles.length));
    tiles.splice(insertAt, 0, moved);

    this.replaceGroup({ ...group, tiles });
    this.recordOp({ op: 'MOVE_WITHIN_GROUP', groupId, tileId, toIndex });
    this.emit('boardManipulated', { action: 'reorder', groupId, tileId, fromIndex, toIndex: insertAt });
  }

  /**
   * Pass: 不出牌，摸 1 张牌保留在牌架上，结束回合。
   */
  pass(): void {
    this.assertPlaying();
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();

    // 如果还没摸牌且牌池非空，先摸牌
    if (!ctx.hasDrawnFromPool && this.state.pool.length > 0) {
      this.drawTile();
    }

    // 恢复桌面与牌架到回合开始时的状态
    this.rollbackTurn(ctx);

    incrementPasses(ctx);

    this.emit('turnEnd', { playerId: player.id, reason: 'pass' });

    // 死局检测：牌池耗尽且全员连续 Pass → 最低分获胜，不再移交回合
    if (this.isDeadlock()) {
      const winnerId = findLowestScorePlayer(this.state.players);
      this.endGame(winnerId, 'lowest_score');
      return;
    }

    // 进入下一位玩家
    this.nextPlayer();
  }

  /**
   * 提交回合: 验证并确认或回滚。
   */
  submitTurn(): SubmitResult {
    this.assertPlaying();
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();

    // 验证提交
    const errors = this.validateSubmit();

    if (errors.length > 0) {
      // 验证失败（含破冰失败）→ 回滚桌面与牌架，保留已摸到的牌，
      // 但不结束回合：玩家仍处于本回合，可修正后重新提交或选择 Pass。
      this.rollbackTurn(ctx);
      this.resetTurnForRetry(ctx);
      this.emit('turnRollback', { playerId: player.id, errors });
      return { valid: false, errors };
    }

    // 验证通过
    return this.confirmTurn();
  }

  /**
   * 超时处理: 回滚桌面，保留已摸到的牌作为惩罚，结束回合。
   */
  handleTimeout(): void {
    if (this.state.phase !== GP.PLAYING) return;
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();

    // 执行摸牌惩罚：从牌池摸 1 张牌（若有）。
    if (!ctx.hasDrawnFromPool && this.state.pool.length > 0) {
      this.drawTile();
    }

    this.rollbackTurn(ctx);
    incrementPasses(ctx);

    this.emit('turnRollback', { playerId: player.id, reason: 'timeout' });
    this.emit('turnEnd', { playerId: player.id, reason: 'timeout' });

    // 死局检测：与 pass 同逻辑，避免牌池耗尽后超时托管无限循环
    if (this.isDeadlock()) {
      const winnerId = findLowestScorePlayer(this.state.players);
      this.endGame(winnerId, 'lowest_score');
      return;
    }

    this.nextPlayer();
  }

  // =========================================================================
  // 提交验证 (核心校验逻辑)
  // =========================================================================

  private validateSubmit(): ValidationError[] {
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();
    const errors: ValidationError[] = [];

    // 1. 桌面所有牌组必须合法（桌面为草稿，提交时才整体校验）
    const boardValidation = validateBoard(this.state.board);
    errors.push(...boardValidation.errors);

    if (errors.length > 0) return errors;

    // 3. 本回合刚摸到的牌不能在当前回合打出
    if (wasDrawnTilePlaced(ctx)) {
      errors.push({
        code: 'DRAWN_TILE_PLACED',
        message: '刚摸到的牌不能在当前回合立即打出',
      });
      return errors;
    }

    // 4. 非首次出牌: 至少从牌架放 1 张牌
    if (player.hasMadeInitialMeld) {
      if (!ctxHasPlacedFromRack(ctx)) {
        errors.push({
          code: 'NO_TILE_PLACED',
          message: '本回合必须至少从牌架放 1 张牌到桌面',
        });
      }
    } else {
      // 5. 首次出牌: 校验 30 分 + 不能借用桌面牌 + 只能创建新牌组
      const meldErrors = this.validateInitialMeld();
      errors.push(...meldErrors);
    }

    // 5. Joker 替换后必须立即重组：换下的每个 Joker 都必须已重新放上桌面。
    for (const rj of ctx.replacedJokers) {
      const jokerId = rj.jokerTile.id;
      const onBoard = this.state.board.some((g) =>
        g.tiles.some((lt) => lt.originalTile.id === jokerId),
      );
      if (!onBoard) {
        errors.push({
          code: 'JOKER_NOT_REUSED',
          message: '替换的 Joker 必须在当前回合立即重新组成合法牌组',
        });
        break;
      }
    }

    return errors;
  }

  /** 首次出牌验证 */
  private validateInitialMeld(): ValidationError[] {
    const errors: ValidationError[] = [];
    const ctx = this.getTurnContext();

    // 首次出牌: 只能创建新牌组，不能修改已有牌组
    const snapshotGroupIds = new Set(ctx.boardSnapshot.map(g => g.id));
    const currentGroupIds = new Set(this.state.board.map(g => g.id));

    // 检查是否修改了已有牌组
    for (const snapGroup of ctx.boardSnapshot) {
      if (!currentGroupIds.has(snapGroup.id)) {
        errors.push({
          code: 'INITIAL_MELD_MODIFIED_BOARD_GROUP',
          message: `首次出牌不能删除或修改已有牌组 ${snapGroup.id}`,
          groupId: snapGroup.id,
        });
        continue;
      }
      const curGroup = this.state.board.find(g => g.id === snapGroup.id);
      if (curGroup && !this.groupsHaveSameTiles(snapGroup, curGroup)) {
        errors.push({
          code: 'INITIAL_MELD_MODIFIED_BOARD_GROUP',
          message: `首次出牌不能修改已有牌组 ${snapGroup.id}`,
          groupId: snapGroup.id,
        });
      }
    }

    // 检查新增的牌组中所有牌都来自牌架
    const rackIds = new Set(ctx.rackAtTurnStart.map(t => t.id));
    for (const group of this.state.board) {
      if (!snapshotGroupIds.has(group.id)) {
        for (const lt of group.tiles) {
          if (!rackIds.has(lt.originalTile.id)) {
            errors.push({
              code: 'INITIAL_MELD_USED_BOARD_TILES',
              message: `首次出牌不能借用桌面已有牌 (牌 ${lt.originalTile.id})`,
              groupId: group.id,
            });
          }
        }
      }
    }

    if (errors.length > 0) return errors;

    // 计算首次出牌总分 (仅计算新放到桌面的牌)
    const diff = diffBoard(ctx.boardSnapshot, this.state.board);
    const meldScore = calculateInitialMeldScore(diff.addedTiles);
    if (meldScore < this.state.config.initialMeldMinScore) {
      errors.push({
        code: 'INITIAL_MELD_UNDER_30',
        message: `首次出牌总分 ${meldScore} 未达到 ${this.state.config.initialMeldMinScore} 分`,
      });
    }

    return errors;
  }

  private groupsHaveSameTiles(a: TileGroup, b: TileGroup): boolean {
    if (a.tiles.length !== b.tiles.length) return false;
    const aIds = new Set(a.tiles.map(t => t.originalTile.id));
    return b.tiles.every(t => aIds.has(t.originalTile.id));
  }

  // =========================================================================
  // 回滚 / 确认
  // =========================================================================

  /**
   * 回滚到回合开始：恢复桌面与牌架。
   * 本回合摸到的牌保留在牌架上（摸牌即使在失败回合也归玩家所有）。
   */
  private rollbackTurn(ctx: TurnContext): void {
    this.state.board = restoreBoard(ctx.boardSnapshot);

    const player = this.getCurrentPlayer();
    const rack = ctx.rackAtTurnStart.map((t) => ({ ...t }));
    if (ctx.drawnTile) rack.push(ctx.drawnTile);
    player.rack = rack;

    // 桌面已回到回合起点，操作日志作废。
    this.turnOps = [];
  }

  /**
   * 提交失败重试前，清空回合内的瞬时状态（Joker 替换、已放置追踪），
   * 但保留「本回合已摸牌」这一事实。
   */
  private resetTurnForRetry(ctx: TurnContext): void {
    ctx.replacedJokers = [];
    ctx.rackTilesPlacedThisTurn = [];
    ctx.hasPlacedFromRack = false;
    ctx.justDrawnTilePlaced = false;
  }

  /**
   * 把桌面所有牌组理成规范展示顺序（出牌确认后调用）：
   * - 顺子：数字升序，Joker 归位到其承担的数值位
   * - 刻子：固定颜色顺序（红蓝黄黑，Joker 殿后）
   * 仅重排顺序，不改变牌组集合与 Joker 逻辑值；牌组类型不变。
   */
  private tidyBoardGroups(): void {
    this.state.board = this.state.board.map((group) => {
      const tiles =
        group.type === 'run'
          ? tidyRunTiles([...group.tiles])
          : [...group.tiles].sort(
              (a, b) =>
                (SET_COLOR_ORDER[a.logicalColor] ?? 9) - (SET_COLOR_ORDER[b.logicalColor] ?? 9),
            );
      return { ...group, tiles };
    });
  }

  /** 确认回合 (验证通过) */
  private confirmTurn(): SubmitResult {
    // 出牌成立后把桌面所有牌组理成规范顺序（顺子升序、刻子按颜色序），
    // 客户端乐观提交与云端回放校验都会执行，两侧结果一致。
    this.tidyBoardGroups();

    const player = this.getCurrentPlayer();
    const ctx = this.getTurnContext();

    // 标记首次出牌
    if (!player.hasMadeInitialMeld && ctx.rackTilesPlacedThisTurn.length > 0) {
      player.hasMadeInitialMeld = true;
      this.emit('initialMeld', { playerId: player.id });
    }

    // 检查是否获胜 (牌架清空)
    if (player.rack.length === 0) {
      this.endGame(player.id, 'empty_rack');
      return { valid: true, errors: [] };
    }

    // 检查死局
    if (this.isDeadlock()) {
      const winnerId = findLowestScorePlayer(this.state.players);
      this.endGame(winnerId, 'lowest_score');
      return { valid: true, errors: [] };
    }

    this.emit('turnEnd', { playerId: player.id, reason: 'submit' });
    this.nextPlayer();
    return { valid: true, errors: [] };
  }

  // =========================================================================
  // 游戏结束
  // =========================================================================

  private endGame(winnerId: number, winReason: 'empty_rack' | 'lowest_score'): void {
    const result = buildGameResult(this.state.players, winnerId, winReason);

    for (const pr of result.playerResults) {
      const player = this.state.players.find(p => p.id === pr.playerId)!;
      player.score += pr.scoreDelta;
    }

    this.state.phase = GP.GAME_OVER;
    this.state.result = result;

    this.emit('gameOver', { result });
  }

  private isDeadlock(): boolean {
    if (this.state.pool.length > 0) return false;
    const ctx = this.getTurnContext();
    return ctx.consecutivePasses >= this.state.players.length;
  }

  // =========================================================================
  // 玩家轮转
  // =========================================================================

  private nextPlayer(): void {
    const nextIndex = (this.state.currentPlayerIndex + 1) % this.state.players.length;
    this.state.currentPlayerIndex = nextIndex;
    this.state.turnNumber++;
    this.state.turnPhase = TurnPhase.PLAY;

    const nextPlayer = this.state.players[nextIndex];
    this.state.turnContext = createTurnContext(
      this.state.board,
      this.state.pool,
      nextPlayer.rack,
      this.state.turnContext?.consecutivePasses ?? 0,
    );

    this.emit('turnStart', { playerId: nextIndex, turnNumber: this.state.turnNumber });
    this.turnOps = [];
  }

  // =========================================================================
  // 查询接口
  // =========================================================================

  getState(): Readonly<GameState> {
    return this.state;
  }

  /** 本回合已记录的桌面操作日志（只读）。 */
  getTurnOps(): readonly EngineOp[] {
    return this.turnOps;
  }

  getCurrentPlayer(): PlayerState {
    return this.state.players[this.state.currentPlayerIndex];
  }

  getTurnContext(): TurnContext {
    if (!this.state.turnContext) throw new Error('回合上下文未初始化');
    return this.state.turnContext;
  }

  canPlaceTile(tile: Tile, groupId: string): boolean {
    const group = this.findGroup(groupId);
    if (!group) return false;

    const lt = toLogical(tile);
    const testTiles = [...group.tiles, lt];

    if (group.type === 'run') {
      return isValidRun(testTiles);
    } else {
      return isValidGroupTiles(testTiles);
    }
  }

  // =========================================================================
  // 事件系统
  // =========================================================================

  on(event: GameEvent, callback: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: GameEvent, callback: (...args: any[]) => void): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      cbs.delete(callback);
    }
  }

  private emit(event: GameEvent, data?: any): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      }
    }
  }

  // =========================================================================
  // 内部辅助
  // =========================================================================

  private findGroup(groupId: string): TileGroup | undefined {
    return this.state.board.find(g => g.id === groupId);
  }

  private replaceGroup(newGroup: TileGroup): void {
    // 牌组类型随牌面构成动态重推断：加/减牌可能改变类型
    // （如 4+Joker 再加同色 6 应由刻子变顺子，Joker 才能推断为 5）。
    const type = detectGroupType(newGroup.tiles.map(lt => lt.originalTile));
    this.state.board = this.state.board.map(g =>
      g.id === newGroup.id ? { ...newGroup, type } : g,
    );
  }

  private assertPhase(expected: TurnPhase): void {
    if (this.state.phase !== GP.PLAYING) {
      throw new Error(`游戏未在进行中, 当前: ${this.state.phase}`);
    }
    if (this.state.turnPhase !== expected) {
      throw new Error(`回合阶段错误, 期望: ${expected}, 当前: ${this.state.turnPhase}`);
    }
  }

  private assertPlaying(): void {
    if (this.state.phase !== GP.PLAYING) {
      throw new Error(`游戏未在进行中, 当前: ${this.state.phase}`);
    }
  }

  private recordOp(op: EngineOp): void {
    this.turnOps.push(op);
  }

  // =========================================================================
  // 序列化 / 反序列化（在线对战：云端权威状态同步）
  // =========================================================================

  /** 完整导出当前状态（含手牌/牌池，仅限可信侧使用）。 */
  serializeState(): string {
    return JSON.stringify(this.state);
  }

  /**
   * 原地注入序列化状态（不新建实例，保留已绑定的事件监听）。
   * 在线模式下 GameScene 持有引擎引用，云端权威状态推送时用此方法整体覆盖。
   */
  loadState(json: string): void {
    const state = JSON.parse(json) as GameState;
    this.state = state;
    this.turnOps = [];
    this.groupIdCounter = maxGroupIdFromBoard(state.board);
    this.emit('stateLoaded', { phase: state.phase });
  }

  /**
   * 从序列化状态重建引擎（含回合上下文）。
   * 同时把牌组 ID 计数器恢复到桌面最大编号，保证后续回放生成相同 groupId。
   */
  static fromState(json: string): RummikubEngine {
    const state = JSON.parse(json) as GameState;
    const engine = new RummikubEngine(state.config);
    engine.loadState(json);
    return engine;
  }
}

// ---------------------------------------------------------------------------
// 操作回放（云端/本地校验共用）
// ---------------------------------------------------------------------------

/**
 * 在指定引擎上按序回放操作日志。
 * 使用与客户端完全相同的公开方法，保证行为一致；任何非法 op 会抛出异常。
 */
export function applyOps(engine: RummikubEngine, ops: readonly EngineOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'PLACE_ON_BOARD':
        engine.placeTilesOnBoard(op.tileIds, op.groupId, op.position);
        break;
      case 'CREATE_GROUP':
        engine.createNewGroupOnBoard(tilesFromRack(engine, op.tileIds), op.groupType);
        break;
      case 'RETURN_TO_RACK':
        engine.returnTilesToRack(op.tileIds);
        break;
      case 'REPLACE_JOKER': {
        const realTile = tilesFromRack(engine, [op.realTileId])[0];
        engine.replaceJokerOnBoard(op.groupId, op.jokerPosition, realTile);
        break;
      }
      case 'MOVE_WITHIN_GROUP':
        engine.moveTileWithinGroup(op.groupId, op.tileId, op.toIndex);
        break;
      default:
        throw new Error(`未知操作类型: ${(op as any).op}`);
    }
  }
}

/** 从当前玩家牌架中按 ID 取出牌对象。 */
function tilesFromRack(engine: RummikubEngine, tileIds: number[]): Tile[] {
  const rack = engine.getCurrentPlayer().rack;
  return tileIds.map(id => {
    const tile = rack.find(t => t.id === id);
    if (!tile) throw new Error(`回放失败：牌 ${id} 不在牌架中`);
    return tile;
  });
}
