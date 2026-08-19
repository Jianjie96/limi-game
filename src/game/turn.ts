// ============================================================================
// turn.ts — 回合状态管理（工作区、Joker 替换追踪）
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
    workingArea: [],
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
// 工作区操作
// ---------------------------------------------------------------------------

export function addToWorkingArea(ctx: TurnContext, tiles: Tile[]): void {
  ctx.workingArea.push(...tiles);
}

export function removeFromWorkingArea(ctx: TurnContext, tileIds: number[]): Tile[] {
  const removed: Tile[] = [];
  const idSet = new Set(tileIds);
  ctx.workingArea = ctx.workingArea.filter(t => {
    if (idSet.has(t.id)) {
      removed.push(t);
      return false;
    }
    return true;
  });
  return removed;
}

export function isWorkingAreaEmpty(ctx: TurnContext): boolean {
  return ctx.workingArea.length === 0;
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
