// ============================================================================
// types.ts — 拉密牌 (Rummikub) 核心类型定义
// ============================================================================

/** 牌面颜色 */
export type TileColor = 'red' | 'blue' | 'yellow' | 'black';

/** 所有合法颜色常量 */
export const TILE_COLORS: readonly TileColor[] = ['red', 'blue', 'yellow', 'black'] as const;

/** 数字牌范围 */
export const NUMBER_MIN = 1;
export const NUMBER_MAX = 13;

/** 牌组类型 */
export type GroupType = 'run' | 'group';

/** 游戏全局阶段 */
export enum GamePhase {
  WAITING = 'WAITING',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
}

/** 回合内阶段 */
export enum TurnPhase {
  DRAW = 'DRAW',
  PLAY = 'PLAY',
  RESOLVE = 'RESOLVE',
}

/** 游戏事件 */
export type GameEvent =
  | 'gameStart'
  | 'turnStart'
  | 'tileDrawn'
  | 'tilesPlaced'
  | 'jokerReplaced'
  | 'boardManipulated'
  | 'turnEnd'
  | 'turnRollback'
  | 'initialMeld'
  | 'gameOver'
  | 'stateLoaded'
  | 'error';

// ---------------------------------------------------------------------------
// 牌的物理模型
// ---------------------------------------------------------------------------

/**
 * 物理牌 — 每张牌有全局唯一 ID，一旦创建永不改变。
 * - 数字牌: id 0-103, color ∈ TileColor, number ∈ [1,13]
 * - Joker:  id 104-105, color = 'joker', number = 0
 */
export interface Tile {
  readonly id: number;
  readonly color: TileColor | 'joker';
  readonly number: number;
}

// ---------------------------------------------------------------------------
// 逻辑牌（桌面上的牌表示）
// ---------------------------------------------------------------------------

/**
 * 逻辑牌 — 牌在桌面上时的表示。
 * - 数字牌: logicalColor/logicalNumber 与物理牌一致
 * - Joker 留在桌面: originalTile 是 Joker, logicalColor/Number 记录它代表的牌
 * - Joker 被替换取回: 恢复为普通 Joker 手牌 (不再以 LogicalTile 形式存在)
 */
export interface LogicalTile {
  readonly originalTile: Tile;
  readonly logicalColor: TileColor | 'joker';
  readonly logicalNumber: number;
}

// ---------------------------------------------------------------------------
// 牌组
// ---------------------------------------------------------------------------

/**
 * 牌组 — 桌面上的合法牌组合。
 * - Run: tiles 按 logicalNumber 升序排列
 * - Group: tiles 按 logicalColor 排序
 */
export interface TileGroup {
  readonly id: string;
  readonly type: GroupType;
  readonly tiles: readonly LogicalTile[];
}

// ---------------------------------------------------------------------------
// 玩家
// ---------------------------------------------------------------------------

export interface PlayerState {
  readonly id: number;
  readonly name: string;
  rack: Tile[];
  score: number;
  hasMadeInitialMeld: boolean;
}

// ---------------------------------------------------------------------------
// 游戏配置
// ---------------------------------------------------------------------------

export interface GameConfig {
  readonly playerCount: number;
  readonly initialHandSize: number;
  readonly initialMeldMinScore: number;
  readonly turnTimeLimit: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  playerCount: 4,
  initialHandSize: 14,
  initialMeldMinScore: 30,
  turnTimeLimit: 0,
};

// ---------------------------------------------------------------------------
// 回合上下文
// ---------------------------------------------------------------------------

/** Joker 替换记录 */
export interface ReplacedJoker {
  readonly jokerTile: Tile;
  readonly originalGroupId: string;
  readonly realTileUsed: Tile;
}

export interface TurnContext {
  readonly phase: TurnPhase;
  readonly boardSnapshot: TileGroup[];
  readonly poolSnapshot: Tile[];
  readonly rackAtTurnStart: readonly Tile[];
  replacedJokers: ReplacedJoker[];
  hasDrawnFromPool: boolean;
  drawnTile: Tile | null;
  drawnTileId: number | null;
  hasPlacedFromRack: boolean;
  rackTilesPlacedThisTurn: Tile[];
  consecutivePasses: number;
  justDrawnTilePlaced: boolean;
}

// ---------------------------------------------------------------------------
// 游戏结果
// ---------------------------------------------------------------------------

export interface PlayerResult {
  readonly playerId: number;
  readonly playerName: string;
  readonly remainingTiles: Tile[];
  readonly remainingScore: number;
  readonly scoreDelta: number;
  readonly isWinner: boolean;
}

export interface GameResult {
  readonly winnerId: number;
  readonly winReason: 'empty_rack' | 'lowest_score';
  readonly playerResults: PlayerResult[];
}

// ---------------------------------------------------------------------------
// 游戏状态
// ---------------------------------------------------------------------------

export interface GameState {
  phase: GamePhase;
  players: PlayerState[];
  currentPlayerIndex: number;
  board: TileGroup[];
  pool: Tile[];
  turnPhase: TurnPhase;
  turnContext: TurnContext | null;
  turnNumber: number;
  config: GameConfig;
  result: GameResult | null;
}

// ---------------------------------------------------------------------------
// 提交结果
// ---------------------------------------------------------------------------

export interface SubmitResult {
  readonly valid: boolean;
  readonly errors: ValidationError[];
}

export interface ValidationError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly groupId?: string;
}

export type ErrorCode =
  | 'INVALID_GROUP'
  | 'NO_TILE_PLACED'
  | 'INITIAL_MELD_UNDER_30'
  | 'INITIAL_MELD_USED_BOARD_TILES'
  | 'INITIAL_MELD_MODIFIED_BOARD_GROUP'
  | 'TILE_SOURCE_INVALID'
  | 'JOKER_NOT_REUSED'
  | 'JOKER_REPLACEMENT_MISMATCH'
  | 'BOARD_TILES_MISSING'
  | 'DRAWN_TILE_PLACED';

// ---------------------------------------------------------------------------
// 桌面差异
// ---------------------------------------------------------------------------

export interface BoardDiff {
  readonly removedTiles: LogicalTile[];
  readonly addedTiles: LogicalTile[];
  readonly modifiedGroupIds: string[];
}

// ---------------------------------------------------------------------------
// 游戏动作
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'DRAW' }
  | { type: 'PLACE_ON_BOARD'; tileIds: number[]; groupId: string; position?: number }
  | { type: 'CREATE_GROUP'; tiles: Tile[]; groupType: GroupType }
  | { type: 'REPLACE_JOKER'; groupId: string; jokerPosition: number; realTile: Tile }
  | { type: 'PASS' }
  | { type: 'SUBMIT' };

// ---------------------------------------------------------------------------
// 在线对战：回合内操作日志（可序列化，云端回放校验用）
// ---------------------------------------------------------------------------

/**
 * 回合内桌面操作的可序列化记录。
 * 客户端草稿引擎执行变更方法时自动追加；提交时随出牌请求发给云端，
 * 云端用同一套引擎方法回放后再 submitTurn 校验，保证规则单点维护。
 * 牌架内理牌（纯展示顺序）不记录；Pass/超时由云端直接处理。
 */
export type EngineOp =
  | { op: 'PLACE_ON_BOARD'; tileIds: number[]; groupId: string; position: number }
  | { op: 'CREATE_GROUP'; tileIds: number[]; groupType: GroupType }
  | { op: 'RETURN_TO_RACK'; tileIds: number[] }
  | { op: 'REPLACE_JOKER'; groupId: string; jokerPosition: number; realTileId: number }
  | { op: 'MOVE_WITHIN_GROUP'; groupId: string; tileId: number; toIndex: number };
