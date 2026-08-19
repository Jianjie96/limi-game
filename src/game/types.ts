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
  workingArea: Tile[];
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
  | 'WORKING_AREA_NOT_EMPTY'
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
  | { type: 'REMOVE_FROM_BOARD'; groupId: string; tileIds: number[] }
  | { type: 'REPLACE_JOKER'; groupId: string; jokerPosition: number; realTile: Tile }
  | { type: 'TO_WORKING_AREA'; groupId: string; tileIds: number[] }
  | { type: 'PASS' }
  | { type: 'SUBMIT' };
