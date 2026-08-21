// ============================================================================
// turn.ts — 回合状态管理（Joker 替换追踪）
// ============================================================================

import type {
  Tile,
  TileGroup,
  LogicalTile,
  TurnContext,
  TurnPhase,
  ReplacedJoker,
} from './types';
import { snapshotBoard, snapshotPool } from './snapshot';

// ---------------------------------------------------------------------------
// 回合上下文创建
// ---------------------------------------------------------------------------

export function createTurnContext(
  board: readonly TileGroup[],
  pool: readonly Tile[],
  rack: readonly Tile[],
  previousConsecutivePasses: number,
): TurnContext {
  return {
    phase: 'PLAY' as TurnPhase,
    boardSnapshot: snapshotBoard(board),
    poolSnapshot: snapshotPool(pool),
    rackAtTurnStart: rack.map(t => ({ ...t })),
    replacedJokers: [],
    hasDrawnFromPool: false,
    drawnTile: null,
    drawnTileId: null,
    hasPlacedFromRack: false,
    rackTilesPlacedThisTurn: [],
    consecutivePasses: previousConsecutivePasses,
    justDrawnTilePlaced: false,
  };
}

// ---------------------------------------------------------------------------
// Joker 替换追踪
// ---------------------------------------------------------------------------

export function recordJokerReplacement(
  ctx: TurnContext,
  jokerTile: Tile,
  originalGroupId: string,
  realTileUsed: Tile,
): void {
  ctx.replacedJokers.push({ jokerTile, originalGroupId, realTileUsed });
}

export function getReplacedJokers(ctx: TurnContext): readonly ReplacedJoker[] {
  return ctx.replacedJokers;
}

// ---------------------------------------------------------------------------
// 牌架操作追踪
// ---------------------------------------------------------------------------

export function recordRackTilesPlaced(ctx: TurnContext, tiles: Tile[]): void {
  ctx.hasPlacedFromRack = true;
  ctx.rackTilesPlacedThisTurn.push(...tiles);
}

export function hasPlacedFromRack(ctx: TurnContext): boolean {
  return ctx.hasPlacedFromRack;
}

// ---------------------------------------------------------------------------
// 摸牌追踪
// ---------------------------------------------------------------------------

export function recordDraw(ctx: TurnContext, tile: Tile): void {
  ctx.hasDrawnFromPool = true;
  ctx.drawnTile = tile;
  ctx.drawnTileId = tile.id;
}

export function getDrawnTile(ctx: TurnContext): Tile | null {
  return ctx.drawnTile;
}

export function markDrawnTilePlaced(ctx: TurnContext): void {
  ctx.justDrawnTilePlaced = true;
}

export function wasDrawnTilePlaced(ctx: TurnContext): boolean {
  return ctx.justDrawnTilePlaced;
}

// ---------------------------------------------------------------------------
// 阶段切换
// ---------------------------------------------------------------------------

export function setTurnPhase(ctx: TurnContext, phase: TurnPhase): void {
  (ctx as { phase: TurnPhase }).phase = phase;
}

// ---------------------------------------------------------------------------
// Pass 计数
// ---------------------------------------------------------------------------

export function incrementPasses(ctx: TurnContext): void {
  ctx.consecutivePasses++;
}

export function resetPasses(ctx: TurnContext): void {
  ctx.consecutivePasses = 0;
}
