// ============================================================================
// index.ts — 统一导出
// ============================================================================

// 类型
export type {
  Tile,
  TileColor,
  LogicalTile,
  TileGroup,
  GroupType,
  PlayerState,
  GameConfig,
  GameState,
  TurnContext,
  ReplacedJoker,
  SubmitResult,
  ValidationError,
  ErrorCode,
  BoardDiff,
  GameAction,
  GameEvent,
  GameResult,
  PlayerResult,
} from './types';

export { GamePhase, TurnPhase, TILE_COLORS, NUMBER_MIN, NUMBER_MAX, DEFAULT_CONFIG } from './types';

// 牌操作
export {
  createFullSet,
  shuffle,
  isJoker,
  isLogicalJoker,
  getTileValue,
  toLogical,
  findTileById,
  findLogicalByOriginalId,
  inferJokerInRun,
  inferJokerInGroup,
  updateJokerLogical,
  inferAndUpdateJokers,
} from './tiles';

// 校验
export {
  isValidRun,
  isValidGroupTiles,
  isValidGroup,
  validateBoard,
  canExtendRun,
  canAddToGroup,
} from './validate';

// 划分
export { canPartition, isPartitionable } from './partition';
export type { PartitionResult } from './partition';

// 计分
export {
  sumTileValues,
  calculateRackValue,
  calculateInitialMeldScore,
  meetsInitialMeldRequirement,
  calculateFinalScores,
  findLowestScorePlayer,
  buildGameResult,
} from './scoring';

// 快照
export {
  snapshotBoard,
  snapshotPool,
  restoreBoard,
  restorePool,
  diffBoard,
  getAllTileIdsOnBoard,
  getAllLogicalTiles,
  cloneGroup,
  cloneLogicalTile,
} from './snapshot';

// 回合管理
export {
  createTurnContext,
  addToWorkingArea,
  removeFromWorkingArea,
  isWorkingAreaEmpty,
  recordJokerReplacement,
  getReplacedJokers,
  recordRackTilesPlaced,
  hasPlacedFromRack,
  recordDraw,
  getDrawnTile,
  markDrawnTilePlaced,
  wasDrawnTilePlaced,
  setTurnPhase,
  incrementPasses,
  resetPasses,
} from './turn';

// 引擎
export { RummikubEngine } from './engine';
