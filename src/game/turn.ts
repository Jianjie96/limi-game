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
  // 只统计回合开始时就在牌架的牌：桌面跨组移动走「退回牌架 + 重新放置」
  // 两步实现，若不过滤会把纯桌面整理误判为「从牌架出了牌」，导致没出牌也能提交。
  const startIds = new Set(ctx.rackAtTurnStart.map(t => t.id));
  const ownTiles = tiles.filter(t => startIds.has(t.id));
  if (ownTiles.length === 0) return;
  ctx.hasPlacedFromRack = true;
  ctx.rackTilesPlacedThisTurn.push(...ownTiles);
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
