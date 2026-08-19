// ============================================================================
// snapshot.ts — 桌面快照 & 差异比较（支持回滚）
// ============================================================================

import type { TileGroup, LogicalTile, BoardDiff, TileColor } from './types';

// ---------------------------------------------------------------------------
// 深拷贝
// ---------------------------------------------------------------------------

/** 深拷贝单张逻辑牌 */
export function cloneLogicalTile(lt: LogicalTile): LogicalTile {
  return {
    originalTile: { ...lt.originalTile },
    logicalColor: lt.logicalColor,
    logicalNumber: lt.logicalNumber,
  };
}

/** 深拷贝一个牌组 */
export function cloneGroup(group: TileGroup): TileGroup {
  return {
    id: group.id,
    type: group.type,
    tiles: group.tiles.map(cloneLogicalTile),
  };
}

/** 深拷贝整个桌面 */
export function snapshotBoard(board: readonly TileGroup[]): TileGroup[] {
  return board.map(cloneGroup);
}

/** 深拷贝牌池 */
export function snapshotPool(pool: readonly import('./types').Tile[]): import('./types').Tile[] {
  return pool.map(t => ({ ...t }));
}

// ---------------------------------------------------------------------------
// 差异比较
// ---------------------------------------------------------------------------

/**
 * 比较当前桌面 vs 快照, 返回差异。
 *
 * 通过 originalTile.id 来追踪每张牌。
 * - removedTiles: 快照中有但当前没有的牌
 * - addedTiles: 当前有但快照中没有的牌
 * - modifiedGroupIds: 内容发生变化的牌组 ID
 */
export function diffBoard(snapshot: readonly TileGroup[], current: readonly TileGroup[]): BoardDiff {
  // 收集快照中所有牌的 ID → LogicalTile 映射
  const snapshotTileMap = new Map<number, LogicalTile>();
  for (const group of snapshot) {
    for (const lt of group.tiles) {
      snapshotTileMap.set(lt.originalTile.id, lt);
    }
  }

  // 收集中当前所有牌的 ID → LogicalTile 映射
  const currentTileMap = new Map<number, LogicalTile>();
  for (const group of current) {
    for (const lt of group.tiles) {
      currentTileMap.set(lt.originalTile.id, lt);
    }
  }

  // 被移除的牌: 在快照中但不在当前
  const removedTiles: LogicalTile[] = [];
  for (const [id, lt] of snapshotTileMap) {
    if (!currentTileMap.has(id)) {
      removedTiles.push(lt);
    }
  }

  // 新增的牌: 在当前但不在快照中
  const addedTiles: LogicalTile[] = [];
  for (const [id, lt] of currentTileMap) {
    if (!snapshotTileMap.has(id)) {
      addedTiles.push(lt);
    }
  }

  // 被修改的牌组: 比较每个牌组的牌 ID 集合
  const modifiedGroupIds: string[] = [];
  const currentGroupMap = new Map(current.map(g => [g.id, g]));

  for (const snapGroup of snapshot) {
    const curGroup = currentGroupMap.get(snapGroup.id);
    if (!curGroup) {
      // 牌组被删除
      modifiedGroupIds.push(snapGroup.id);
      continue;
    }
    if (!groupsHaveSameTiles(snapGroup, curGroup)) {
      modifiedGroupIds.push(snapGroup.id);
    }
  }

  // 新增的牌组
  const snapshotGroupIds = new Set(snapshot.map(g => g.id));
  for (const group of current) {
    if (!snapshotGroupIds.has(group.id)) {
      modifiedGroupIds.push(group.id);
    }
  }

  return { removedTiles, addedTiles, modifiedGroupIds };
}

// ---------------------------------------------------------------------------
// 恢复
// ---------------------------------------------------------------------------

/** 从快照恢复桌面 (返回深拷贝) */
export function restoreBoard(snapshot: readonly TileGroup[]): TileGroup[] {
  return snapshotBoard(snapshot);
}

/** 从快照恢复牌池 (返回深拷贝) */
export function restorePool(snapshot: readonly import('./types').Tile[]): import('./types').Tile[] {
  return snapshotPool(snapshot);
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 判断两个牌组是否包含相同的牌 (按 originalTile.id) */
function groupsHaveSameTiles(a: TileGroup, b: TileGroup): boolean {
  if (a.tiles.length !== b.tiles.length) return false;
  const aIds = new Set(a.tiles.map(t => t.originalTile.id));
  return b.tiles.every(t => aIds.has(t.originalTile.id));
}

/**
 * 从牌组集合中提取所有牌的 ID 集合。
 */
export function getAllTileIdsOnBoard(board: readonly TileGroup[]): Set<number> {
  const ids = new Set<number>();
  for (const group of board) {
    for (const lt of group.tiles) {
      ids.add(lt.originalTile.id);
    }
  }
  return ids;
}

/**
 * 从牌组集合中提取所有 LogicalTile 的扁平列表。
 */
export function getAllLogicalTiles(board: readonly TileGroup[]): LogicalTile[] {
  const result: LogicalTile[] = [];
  for (const group of board) {
    for (const lt of group.tiles) {
      result.push(lt);
    }
  }
  return result;
}
