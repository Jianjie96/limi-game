"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/engine-entry.ts
var engine_entry_exports = {};
__export(engine_entry_exports, {
  RummikubEngine: () => RummikubEngine,
  applyOps: () => applyOps,
  findLowestScorePlayer: () => findLowestScorePlayer,
  planBotTurn: () => planBotTurn
});
module.exports = __toCommonJS(engine_entry_exports);

// src/game/types.ts
var TILE_COLORS = ["red", "blue", "yellow", "black"];
var NUMBER_MIN = 1;
var NUMBER_MAX = 13;
var DEFAULT_CONFIG = {
  playerCount: 4,
  initialHandSize: 14,
  initialMeldMinScore: 30,
  turnTimeLimit: 0
};

// src/game/tiles.ts
function createFullSet() {
  const tiles = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const color of TILE_COLORS) {
      for (let num = NUMBER_MIN; num <= NUMBER_MAX; num++) {
        tiles.push({ id: id++, color, number: num });
      }
    }
  }
  tiles.push({ id: id++, color: "joker", number: 0 });
  tiles.push({ id: id++, color: "joker", number: 0 });
  return tiles;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function isLogicalJoker(lt) {
  return lt.logicalColor === "joker" && lt.logicalNumber === 0;
}
function getTileValue(tile) {
  if ("originalTile" in tile) {
    if (tile.logicalColor === "joker") return 30;
    return tile.logicalNumber;
  }
  if (tile.color === "joker") return 30;
  return tile.number;
}
function toLogical(tile) {
  return {
    originalTile: tile,
    logicalColor: tile.color,
    logicalNumber: tile.number
  };
}
function findTileById(tiles, id) {
  return tiles.find((t) => t.id === id);
}
var COLOR_NAMES = {
  red: "\u7EA2",
  blue: "\u84DD",
  yellow: "\u9EC4",
  black: "\u9ED1"
};
function describeTile(lt) {
  var _a;
  const color = "logicalColor" in lt ? lt.logicalColor : lt.color;
  const number = "logicalNumber" in lt ? lt.logicalNumber : lt.number;
  if (color === "joker") return "\u767E\u642D";
  return `${(_a = COLOR_NAMES[color]) != null ? _a : color} ${number}`;
}
function describeGroup(tiles) {
  return `[${tiles.map(describeTile).join(", ")}]`;
}
function detectGroupType(tiles) {
  const nonJokers = tiles.filter((t) => t.color !== "joker");
  const numbers = new Set(nonJokers.map((t) => t.number));
  if (numbers.size === 1) return "group";
  const colors = new Set(nonJokers.map((t) => t.color));
  if (colors.size === 1) return "run";
  return "group";
}

// src/game/validate.ts
function isValidRun(tiles) {
  if (tiles.length < 3) return false;
  const nonJokers = [];
  let jokerCount = 0;
  for (const t of tiles) {
    if (isLogicalJoker(t)) {
      jokerCount++;
    } else {
      nonJokers.push(t);
    }
  }
  if (nonJokers.length === 0) return false;
  const color = nonJokers[0].logicalColor;
  if (nonJokers.some((t) => t.logicalColor !== color)) return false;
  const sorted = nonJokers.map((t) => t.logicalNumber).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) return false;
  }
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const span = max - min + 1;
  const gaps = span - nonJokers.length;
  if (jokerCount < gaps) return false;
  const remainingJokers = jokerCount - gaps;
  const roomBelow = min - 1;
  const roomAbove = 13 - max;
  if (remainingJokers > roomBelow + roomAbove) return false;
  const totalLen = span + remainingJokers;
  return tiles.length === totalLen;
}
function isValidGroupTiles(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;
  const nonJokers = [];
  let jokerCount = 0;
  for (const t of tiles) {
    if (isLogicalJoker(t)) {
      jokerCount++;
    } else {
      nonJokers.push(t);
    }
  }
  if (nonJokers.length > 0) {
    const num = nonJokers[0].logicalNumber;
    if (nonJokers.some((t) => t.logicalNumber !== num)) return false;
  }
  const colors = new Set(nonJokers.map((t) => t.logicalColor));
  if (colors.size !== nonJokers.length) return false;
  const missingColors = 4 - nonJokers.length;
  if (jokerCount > missingColors) return false;
  return true;
}
function isValidGroup(group) {
  if (group.tiles.length < 3) return false;
  if (group.type === "run") {
    return isValidRun(group.tiles);
  } else {
    return isValidGroupTiles(group.tiles);
  }
}
function validateBoard(board) {
  const errors = [];
  for (const group of board) {
    if (!isValidGroup(group)) {
      errors.push({
        code: "INVALID_GROUP",
        message: `\u724C\u7EC4 ${describeGroup(group.tiles)} \u4E0D\u662F\u5408\u6CD5\u7EC4\u5408`,
        groupId: group.id
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

// src/game/scoring.ts
function sumTileValues(tiles) {
  return tiles.reduce((sum, t) => sum + getTileValue(t), 0);
}
function calculateRackValue(rack) {
  return sumTileValues(rack);
}
function calculateInitialMeldScore(tiles) {
  return sumTileValues(tiles);
}
function calculateFinalScores(players, winnerId) {
  let othersTotal = 0;
  const intermediate = [];
  for (const player of players) {
    const remainingScore = calculateRackValue(player.rack);
    if (player.id !== winnerId) {
      othersTotal += remainingScore;
    }
    intermediate.push({ player, remainingScore });
  }
  return intermediate.map(({ player, remainingScore }) => ({
    playerId: player.id,
    playerName: player.name,
    remainingTiles: [...player.rack],
    remainingScore,
    scoreDelta: player.id === winnerId ? othersTotal : -remainingScore,
    isWinner: player.id === winnerId
  }));
}
function findLowestScorePlayer(players) {
  let lowest = Infinity;
  let winnerId = 0;
  for (const p of players) {
    const val = calculateRackValue(p.rack);
    if (val < lowest) {
      lowest = val;
      winnerId = p.id;
    }
  }
  return winnerId;
}
function buildGameResult(players, winnerId, winReason) {
  const playerResults = calculateFinalScores(players, winnerId);
  return {
    winnerId,
    winReason,
    playerResults
  };
}

// src/game/snapshot.ts
function cloneLogicalTile(lt) {
  return {
    originalTile: { ...lt.originalTile },
    logicalColor: lt.logicalColor,
    logicalNumber: lt.logicalNumber
  };
}
function cloneGroup(group) {
  return {
    id: group.id,
    type: group.type,
    tiles: group.tiles.map(cloneLogicalTile)
  };
}
function snapshotBoard(board) {
  return board.map(cloneGroup);
}
function snapshotPool(pool) {
  return pool.map((t) => ({ ...t }));
}
function diffBoard(snapshot, current) {
  const snapshotTileMap = /* @__PURE__ */ new Map();
  for (const group of snapshot) {
    for (const lt of group.tiles) {
      snapshotTileMap.set(lt.originalTile.id, lt);
    }
  }
  const currentTileMap = /* @__PURE__ */ new Map();
  for (const group of current) {
    for (const lt of group.tiles) {
      currentTileMap.set(lt.originalTile.id, lt);
    }
  }
  const removedTiles = [];
  for (const [id, lt] of snapshotTileMap) {
    if (!currentTileMap.has(id)) {
      removedTiles.push(lt);
    }
  }
  const addedTiles = [];
  for (const [id, lt] of currentTileMap) {
    if (!snapshotTileMap.has(id)) {
      addedTiles.push(lt);
    }
  }
  const modifiedGroupIds = [];
  const currentGroupMap = new Map(current.map((g) => [g.id, g]));
  for (const snapGroup of snapshot) {
    const curGroup = currentGroupMap.get(snapGroup.id);
    if (!curGroup) {
      modifiedGroupIds.push(snapGroup.id);
      continue;
    }
    if (!groupsHaveSameTiles(snapGroup, curGroup)) {
      modifiedGroupIds.push(snapGroup.id);
    }
  }
  const snapshotGroupIds = new Set(snapshot.map((g) => g.id));
  for (const group of current) {
    if (!snapshotGroupIds.has(group.id)) {
      modifiedGroupIds.push(group.id);
    }
  }
  return { removedTiles, addedTiles, modifiedGroupIds };
}
function restoreBoard(snapshot) {
  return snapshotBoard(snapshot);
}
function groupsHaveSameTiles(a, b) {
  if (a.tiles.length !== b.tiles.length) return false;
  const aIds = new Set(a.tiles.map((t) => t.originalTile.id));
  return b.tiles.every((t) => aIds.has(t.originalTile.id));
}

// src/game/turn.ts
function createTurnContext(board, pool, rack, previousConsecutivePasses) {
  return {
    phase: "PLAY",
    boardSnapshot: snapshotBoard(board),
    poolSnapshot: snapshotPool(pool),
    rackAtTurnStart: rack.map((t) => ({ ...t })),
    replacedJokers: [],
    hasDrawnFromPool: false,
    drawnTile: null,
    drawnTileId: null,
    hasPlacedFromRack: false,
    rackTilesPlacedThisTurn: [],
    consecutivePasses: previousConsecutivePasses,
    justDrawnTilePlaced: false
  };
}
function recordJokerReplacement(ctx, jokerTile, originalGroupId, realTileUsed) {
  ctx.replacedJokers.push({ jokerTile, originalGroupId, realTileUsed });
}
function recordRackTilesPlaced(ctx, tiles) {
  ctx.hasPlacedFromRack = true;
  ctx.rackTilesPlacedThisTurn.push(...tiles);
}
function hasPlacedFromRack(ctx) {
  return ctx.hasPlacedFromRack;
}
function recordDraw(ctx, tile) {
  ctx.hasDrawnFromPool = true;
  ctx.drawnTile = tile;
  ctx.drawnTileId = tile.id;
}
function markDrawnTilePlaced(ctx) {
  ctx.justDrawnTilePlaced = true;
}
function wasDrawnTilePlaced(ctx) {
  return ctx.justDrawnTilePlaced;
}
function incrementPasses(ctx) {
  ctx.consecutivePasses++;
}
function resetPasses(ctx) {
  ctx.consecutivePasses = 0;
}

// src/game/engine.ts
function maxGroupIdFromBoard(board) {
  let max = 0;
  for (const g of board) {
    const m = /^g(\d+)$/.exec(g.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}
var SET_COLOR_ORDER = {
  red: 0,
  blue: 1,
  yellow: 2,
  black: 3,
  joker: 4
};
function tidyRunTiles(tiles) {
  const jokers = tiles.filter((t) => isLogicalJoker(t));
  const reals = tiles.filter((t) => !isLogicalJoker(t));
  if (reals.length === 0 || jokers.length === 0) {
    return [...tiles].sort(
      (a, b) => {
        var _a, _b;
        return a.logicalNumber - b.logicalNumber || ((_a = SET_COLOR_ORDER[a.logicalColor]) != null ? _a : 9) - ((_b = SET_COLOR_ORDER[b.logicalColor]) != null ? _b : 9);
      }
    );
  }
  reals.sort((a, b) => a.logicalNumber - b.logicalNumber);
  const min = reals[0].logicalNumber;
  const max = reals[reals.length - 1].logicalNumber;
  const jokerValues = [];
  for (let v = min; v <= max; v++) {
    if (!reals.some((t) => t.logicalNumber === v)) jokerValues.push(v);
  }
  let remaining = jokers.length - jokerValues.length;
  for (let v = max + 1; remaining > 0 && v <= 13; v++, remaining--) jokerValues.push(v);
  for (let v = min - 1; remaining > 0 && v >= 1; v--, remaining--) jokerValues.push(v);
  const values = [...reals.map((t) => t.logicalNumber), ...jokerValues].sort((a, b) => a - b);
  const realQueue = [...reals];
  const jokerQueue = [...jokers];
  return values.map((v) => {
    const idx = realQueue.findIndex((t) => t.logicalNumber === v);
    return idx >= 0 ? realQueue.splice(idx, 1)[0] : jokerQueue.shift();
  });
}
var RummikubEngine = class _RummikubEngine {
  constructor(config) {
    /** 本回合桌面操作日志（在线对战：提交时发云端回放校验） */
    this.turnOps = [];
    /** 牌组 ID 计数器（实例级，fromState 时按桌面最大编号恢复） */
    this.groupIdCounter = 0;
    this.listeners = /* @__PURE__ */ new Map();
    this.state = {
      phase: "WAITING" /* WAITING */,
      players: [],
      currentPlayerIndex: 0,
      board: [],
      pool: [],
      turnPhase: "PLAY" /* PLAY */,
      turnContext: null,
      turnNumber: 0,
      config: { ...DEFAULT_CONFIG, ...config },
      result: null
    };
  }
  nextGroupId() {
    return `g${++this.groupIdCounter}`;
  }
  // =========================================================================
  // 游戏生命周期
  // =========================================================================
  startGame(playerNames) {
    const count = playerNames.length;
    if (count < 2 || count > 4) {
      throw new Error(`\u73A9\u5BB6\u6570\u91CF\u5FC5\u987B\u4E3A 2-4, \u5F53\u524D: ${count}`);
    }
    const allTiles = shuffle(createFullSet());
    const players = [];
    let dealIndex = 0;
    for (let i = 0; i < count; i++) {
      const rack = allTiles.splice(0, this.state.config.initialHandSize);
      players.push({
        id: i,
        name: playerNames[i],
        rack,
        score: 0,
        hasMadeInitialMeld: false
      });
    }
    const pool = allTiles;
    this.groupIdCounter = 0;
    this.state = {
      ...this.state,
      phase: "PLAYING" /* PLAYING */,
      players,
      currentPlayerIndex: 0,
      board: [],
      pool,
      turnPhase: "PLAY" /* PLAY */,
      turnNumber: 1,
      result: null
    };
    this.state.turnContext = createTurnContext(
      this.state.board,
      this.state.pool,
      this.getCurrentPlayer().rack,
      0
    );
    this.emit("gameStart", { players, turnNumber: 1 });
    this.emit("turnStart", { playerId: 0 });
    this.turnOps = [];
  }
  newGame() {
    this.groupIdCounter = 0;
    this.state = {
      ...this.state,
      phase: "WAITING" /* WAITING */,
      players: [],
      currentPlayerIndex: 0,
      board: [],
      pool: [],
      turnPhase: "PLAY" /* PLAY */,
      turnContext: null,
      turnNumber: 0,
      result: null
    };
    this.turnOps = [];
  }
  // =========================================================================
  // 回合动作
  // =========================================================================
  drawTile() {
    this.assertPlaying();
    const ctx = this.getTurnContext();
    if (ctx.hasDrawnFromPool || this.state.pool.length === 0) {
      return null;
    }
    const tile = this.state.pool.pop();
    recordDraw(ctx, tile);
    this.getCurrentPlayer().rack.push(tile);
    this.emit("tileDrawn", { playerId: this.getCurrentPlayer().id, tile });
    return tile;
  }
  /**
   * 调整自己牌架中某张牌的顺序（理牌）。
   * 纯牌架内整理，不改变手牌内容、不消耗动作、不影响回合状态。
   */
  reorderRackTile(tileId, toIndex) {
    this.assertPhase("PLAY" /* PLAY */);
    const player = this.getCurrentPlayer();
    const fromIndex = player.rack.findIndex((t) => t.id === tileId);
    if (fromIndex < 0) throw new Error(`\u724C\u67B6\u4E2D\u627E\u4E0D\u5230\u724C ${tileId}`);
    const rack = [...player.rack];
    const [moved] = rack.splice(fromIndex, 1);
    const insertAt = Math.max(0, Math.min(toIndex, rack.length));
    rack.splice(insertAt, 0, moved);
    player.rack = rack;
    this.emit("boardManipulated", { action: "reorderRack", tileId, fromIndex, toIndex: insertAt });
  }
  /**
   * 将牌从牌架放到桌面已有牌组。
   */
  placeTilesOnBoard(tileIds, groupId, position = -1) {
    this.assertPhase("PLAY" /* PLAY */);
    const player = this.getCurrentPlayer();
    const group = this.findGroup(groupId);
    if (!group) throw new Error(`\u724C\u7EC4 ${groupId} \u4E0D\u5B58\u5728`);
    const tiles = [];
    for (const id of tileIds) {
      const tile = findTileById(player.rack, id);
      if (!tile) throw new Error(`\u724C\u67B6\u4E2D\u627E\u4E0D\u5230\u724C ${id}`);
      tiles.push(tile);
    }
    const ctx = this.getTurnContext();
    if (ctx.drawnTileId !== null) {
      for (const tile of tiles) {
        if (tile.id === ctx.drawnTileId) {
          markDrawnTilePlaced(ctx);
        }
      }
    }
    const idSet = new Set(tileIds);
    player.rack = player.rack.filter((t) => !idSet.has(t.id));
    const logicalTiles = tiles.map(toLogical);
    let newTiles = [...group.tiles];
    if (position < 0 || position >= newTiles.length) {
      newTiles.push(...logicalTiles);
    } else {
      newTiles.splice(position, 0, ...logicalTiles);
    }
    this.replaceGroup({ ...group, tiles: newTiles });
    recordRackTilesPlaced(ctx, tiles);
    resetPasses(ctx);
    this.recordOp({ op: "PLACE_ON_BOARD", tileIds, groupId, position });
    this.emit("tilesPlaced", { playerId: player.id, tileIds, groupId });
  }
  /**
   * 在桌面创建新牌组。
   */
  createNewGroupOnBoard(tiles, groupType) {
    this.assertPhase("PLAY" /* PLAY */);
    const player = this.getCurrentPlayer();
    const ctx = this.getTurnContext();
    const tileIds = tiles.map((t) => t.id);
    for (const id of tileIds) {
      if (!findTileById(player.rack, id)) {
        throw new Error(`\u724C ${id} \u4E0D\u5728\u724C\u67B6\u4E2D`);
      }
    }
    if (ctx.drawnTileId !== null) {
      for (const tile of tiles) {
        if (tile.id === ctx.drawnTileId) {
          markDrawnTilePlaced(ctx);
        }
      }
    }
    const idSet = new Set(tileIds);
    player.rack = player.rack.filter((t) => !idSet.has(t.id));
    const groupId = this.nextGroupId();
    const logicalTiles = tiles.map(toLogical);
    const newGroup = {
      id: groupId,
      type: groupType,
      tiles: logicalTiles
    };
    this.state.board = [...this.state.board, newGroup];
    recordRackTilesPlaced(ctx, tiles);
    resetPasses(ctx);
    this.recordOp({ op: "CREATE_GROUP", tileIds, groupType });
    this.emit("tilesPlaced", { playerId: player.id, tileIds, groupId, isNew: true });
    return groupId;
  }
  /**
   * 把牌放回当前玩家的牌架（未破冰时撤销首次出牌使用）。
   * 从桌面牌组取回；同时更新「本回合从牌架放下」的追踪。
   */
  returnTilesToRack(tileIds) {
    this.assertPhase("PLAY" /* PLAY */);
    const player = this.getCurrentPlayer();
    const ctx = this.getTurnContext();
    const idSet = new Set(tileIds);
    const returned = [];
    const nextBoard = [];
    for (const group of this.state.board) {
      const remaining = [];
      for (const lt of group.tiles) {
        if (idSet.has(lt.originalTile.id)) {
          returned.push(lt.originalTile);
        } else {
          remaining.push(lt);
        }
      }
      if (remaining.length === 0) continue;
      nextBoard.push(remaining.length === group.tiles.length ? group : { ...group, tiles: remaining });
    }
    this.state.board = nextBoard;
    if (returned.length !== tileIds.length) {
      throw new Error("\u90E8\u5206\u724C\u4E0D\u5728\u684C\u9762");
    }
    player.rack = [...player.rack, ...returned];
    const returnedIds = new Set(returned.map((t) => t.id));
    ctx.rackTilesPlacedThisTurn = ctx.rackTilesPlacedThisTurn.filter((t) => !returnedIds.has(t.id));
    if (ctx.rackTilesPlacedThisTurn.length === 0) {
      ctx.hasPlacedFromRack = false;
    }
    this.recordOp({ op: "RETURN_TO_RACK", tileIds });
    this.emit("boardManipulated", { action: "returnToRack", tileIds });
    return returned;
  }
  /**
   * 替换桌面上的 Joker。
   * Joker 是通配牌，替换只需保证「用真实牌替换后牌组仍然合法」，
   * 因此动态校验替换结果，而非比对某个写死的代表值。
   */
  replaceJokerOnBoard(groupId, jokerPosition, realTile) {
    this.assertPhase("PLAY" /* PLAY */);
    const player = this.getCurrentPlayer();
    const group = this.findGroup(groupId);
    if (!group) throw new Error(`\u724C\u7EC4 ${groupId} \u4E0D\u5B58\u5728`);
    const jokerLT = group.tiles[jokerPosition];
    if (!jokerLT || jokerLT.originalTile.color !== "joker") {
      throw new Error(`\u4F4D\u7F6E ${jokerPosition} \u4E0D\u662F Joker`);
    }
    const rackTile = findTileById(player.rack, realTile.id);
    if (!rackTile) throw new Error(`\u724C\u67B6\u4E2D\u627E\u4E0D\u5230\u724C ${realTile.id}`);
    const newTiles = [...group.tiles];
    newTiles[jokerPosition] = toLogical(realTile);
    const isValid = group.type === "run" ? isValidRun(newTiles) : isValidGroupTiles(newTiles);
    if (!isValid) {
      throw new Error(`\u724C ${realTile.color}${realTile.number} \u65E0\u6CD5\u66FF\u6362\u8BE5 Joker`);
    }
    const ctx = this.getTurnContext();
    if (ctx.drawnTileId !== null && realTile.id === ctx.drawnTileId) {
      markDrawnTilePlaced(ctx);
    }
    this.replaceGroup({ ...group, tiles: newTiles });
    player.rack = player.rack.filter((t) => t.id !== realTile.id);
    const jokerTile = jokerLT.originalTile;
    player.rack = [...player.rack, jokerTile];
    recordJokerReplacement(ctx, jokerTile, groupId, realTile);
    recordRackTilesPlaced(ctx, [realTile]);
    this.recordOp({ op: "REPLACE_JOKER", groupId, jokerPosition, realTileId: realTile.id });
    this.emit("jokerReplaced", {
      playerId: player.id,
      groupId,
      jokerPosition,
      jokerTile,
      realTile
    });
  }
  /**
   * 在同一牌组内调整某张牌的顺序（拖拽重排）。
   * 不改变牌组内的牌集合，仅改变展示顺序；Joker 的代表值由渲染层按位置动态推断，
   * 提交时仍按「是否存在合法赋值」动态校验。
   */
  moveTileWithinGroup(groupId, tileId, toIndex) {
    this.assertPhase("PLAY" /* PLAY */);
    const group = this.findGroup(groupId);
    if (!group) throw new Error(`\u724C\u7EC4 ${groupId} \u4E0D\u5B58\u5728`);
    const fromIndex = group.tiles.findIndex((lt) => lt.originalTile.id === tileId);
    if (fromIndex < 0) throw new Error(`\u724C\u7EC4\u4E2D\u627E\u4E0D\u5230\u724C ${tileId}`);
    const tiles = [...group.tiles];
    const [moved] = tiles.splice(fromIndex, 1);
    const insertAt = Math.max(0, Math.min(toIndex, tiles.length));
    tiles.splice(insertAt, 0, moved);
    this.replaceGroup({ ...group, tiles });
    this.recordOp({ op: "MOVE_WITHIN_GROUP", groupId, tileId, toIndex });
    this.emit("boardManipulated", { action: "reorder", groupId, tileId, fromIndex, toIndex: insertAt });
  }
  /**
   * Pass: 不出牌，摸 1 张牌保留在牌架上，结束回合。
   */
  pass() {
    this.assertPlaying();
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();
    if (!ctx.hasDrawnFromPool && this.state.pool.length > 0) {
      this.drawTile();
    }
    this.rollbackTurn(ctx);
    incrementPasses(ctx);
    this.emit("turnEnd", { playerId: player.id, reason: "pass" });
    if (this.isDeadlock()) {
      const winnerId = findLowestScorePlayer(this.state.players);
      this.endGame(winnerId, "lowest_score");
      return;
    }
    this.nextPlayer();
  }
  /**
   * 提交回合: 验证并确认或回滚。
   */
  submitTurn() {
    this.assertPlaying();
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();
    const errors = this.validateSubmit();
    if (errors.length > 0) {
      this.rollbackTurn(ctx);
      this.resetTurnForRetry(ctx);
      this.emit("turnRollback", { playerId: player.id, errors });
      return { valid: false, errors };
    }
    return this.confirmTurn();
  }
  /**
   * 超时处理: 回滚桌面，保留已摸到的牌作为惩罚，结束回合。
   */
  handleTimeout() {
    if (this.state.phase !== "PLAYING" /* PLAYING */) return;
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();
    if (!ctx.hasDrawnFromPool && this.state.pool.length > 0) {
      this.drawTile();
    }
    this.rollbackTurn(ctx);
    incrementPasses(ctx);
    this.emit("turnRollback", { playerId: player.id, reason: "timeout" });
    this.emit("turnEnd", { playerId: player.id, reason: "timeout" });
    if (this.isDeadlock()) {
      const winnerId = findLowestScorePlayer(this.state.players);
      this.endGame(winnerId, "lowest_score");
      return;
    }
    this.nextPlayer();
  }
  // =========================================================================
  // 提交验证 (核心校验逻辑)
  // =========================================================================
  validateSubmit() {
    const ctx = this.getTurnContext();
    const player = this.getCurrentPlayer();
    const errors = [];
    const boardValidation = validateBoard(this.state.board);
    errors.push(...boardValidation.errors);
    if (errors.length > 0) return errors;
    if (wasDrawnTilePlaced(ctx)) {
      errors.push({
        code: "DRAWN_TILE_PLACED",
        message: "\u521A\u6478\u5230\u7684\u724C\u4E0D\u80FD\u5728\u5F53\u524D\u56DE\u5408\u7ACB\u5373\u6253\u51FA"
      });
      return errors;
    }
    if (player.hasMadeInitialMeld) {
      if (!hasPlacedFromRack(ctx)) {
        errors.push({
          code: "NO_TILE_PLACED",
          message: "\u672C\u56DE\u5408\u5FC5\u987B\u81F3\u5C11\u4ECE\u724C\u67B6\u653E 1 \u5F20\u724C\u5230\u684C\u9762"
        });
      }
    } else {
      const meldErrors = this.validateInitialMeld();
      errors.push(...meldErrors);
    }
    for (const rj of ctx.replacedJokers) {
      const jokerId = rj.jokerTile.id;
      const onBoard = this.state.board.some(
        (g) => g.tiles.some((lt) => lt.originalTile.id === jokerId)
      );
      if (!onBoard) {
        errors.push({
          code: "JOKER_NOT_REUSED",
          message: "\u66FF\u6362\u7684 Joker \u5FC5\u987B\u5728\u5F53\u524D\u56DE\u5408\u7ACB\u5373\u91CD\u65B0\u7EC4\u6210\u5408\u6CD5\u724C\u7EC4"
        });
        break;
      }
    }
    return errors;
  }
  /** 首次出牌验证 */
  validateInitialMeld() {
    const errors = [];
    const ctx = this.getTurnContext();
    const snapshotGroupIds = new Set(ctx.boardSnapshot.map((g) => g.id));
    const currentGroupIds = new Set(this.state.board.map((g) => g.id));
    for (const snapGroup of ctx.boardSnapshot) {
      if (!currentGroupIds.has(snapGroup.id)) {
        errors.push({
          code: "INITIAL_MELD_MODIFIED_BOARD_GROUP",
          message: `\u9996\u6B21\u51FA\u724C\u4E0D\u80FD\u5220\u9664\u6216\u4FEE\u6539\u5DF2\u6709\u724C\u7EC4 ${describeGroup(snapGroup.tiles)}`,
          groupId: snapGroup.id
        });
        continue;
      }
      const curGroup = this.state.board.find((g) => g.id === snapGroup.id);
      if (curGroup && !this.groupsHaveSameTiles(snapGroup, curGroup)) {
        errors.push({
          code: "INITIAL_MELD_MODIFIED_BOARD_GROUP",
          message: `\u9996\u6B21\u51FA\u724C\u4E0D\u80FD\u4FEE\u6539\u5DF2\u6709\u724C\u7EC4 ${describeGroup(snapGroup.tiles)}`,
          groupId: snapGroup.id
        });
      }
    }
    const rackIds = new Set(ctx.rackAtTurnStart.map((t) => t.id));
    for (const group of this.state.board) {
      if (!snapshotGroupIds.has(group.id)) {
        for (const lt of group.tiles) {
          if (!rackIds.has(lt.originalTile.id)) {
            errors.push({
              code: "INITIAL_MELD_USED_BOARD_TILES",
              message: `\u9996\u6B21\u51FA\u724C\u4E0D\u80FD\u501F\u7528\u684C\u9762\u5DF2\u6709\u724C\uFF08${describeTile(lt)} \u6240\u5728\u7684\u65B0\u724C\u7EC4\uFF09`,
              groupId: group.id
            });
          }
        }
      }
    }
    if (errors.length > 0) return errors;
    const diff = diffBoard(ctx.boardSnapshot, this.state.board);
    const meldScore = calculateInitialMeldScore(diff.addedTiles);
    if (meldScore < this.state.config.initialMeldMinScore) {
      errors.push({
        code: "INITIAL_MELD_UNDER_30",
        message: `\u9996\u6B21\u51FA\u724C\u603B\u5206 ${meldScore} \u672A\u8FBE\u5230 ${this.state.config.initialMeldMinScore} \u5206`
      });
    }
    return errors;
  }
  groupsHaveSameTiles(a, b) {
    if (a.tiles.length !== b.tiles.length) return false;
    const aIds = new Set(a.tiles.map((t) => t.originalTile.id));
    return b.tiles.every((t) => aIds.has(t.originalTile.id));
  }
  // =========================================================================
  // 回滚 / 确认
  // =========================================================================
  /**
   * 回滚到回合开始：恢复桌面与牌架。
   * 本回合摸到的牌保留在牌架上（摸牌即使在失败回合也归玩家所有）。
   */
  rollbackTurn(ctx) {
    this.state.board = restoreBoard(ctx.boardSnapshot);
    const player = this.getCurrentPlayer();
    const rack = ctx.rackAtTurnStart.map((t) => ({ ...t }));
    if (ctx.drawnTile) rack.push(ctx.drawnTile);
    player.rack = rack;
    this.turnOps = [];
  }
  /**
   * 提交失败重试前，清空回合内的瞬时状态（Joker 替换、已放置追踪），
   * 但保留「本回合已摸牌」这一事实。
   */
  resetTurnForRetry(ctx) {
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
  tidyBoardGroups() {
    this.state.board = this.state.board.map((group) => {
      const tiles = group.type === "run" ? tidyRunTiles([...group.tiles]) : [...group.tiles].sort(
        (a, b) => {
          var _a, _b;
          return ((_a = SET_COLOR_ORDER[a.logicalColor]) != null ? _a : 9) - ((_b = SET_COLOR_ORDER[b.logicalColor]) != null ? _b : 9);
        }
      );
      return { ...group, tiles };
    });
  }
  /** 确认回合 (验证通过) */
  confirmTurn() {
    this.tidyBoardGroups();
    const player = this.getCurrentPlayer();
    const ctx = this.getTurnContext();
    if (!player.hasMadeInitialMeld && ctx.rackTilesPlacedThisTurn.length > 0) {
      player.hasMadeInitialMeld = true;
      this.emit("initialMeld", { playerId: player.id });
    }
    if (player.rack.length === 0) {
      this.endGame(player.id, "empty_rack");
      return { valid: true, errors: [] };
    }
    if (this.isDeadlock()) {
      const winnerId = findLowestScorePlayer(this.state.players);
      this.endGame(winnerId, "lowest_score");
      return { valid: true, errors: [] };
    }
    this.emit("turnEnd", { playerId: player.id, reason: "submit" });
    this.nextPlayer();
    return { valid: true, errors: [] };
  }
  // =========================================================================
  // 游戏结束
  // =========================================================================
  endGame(winnerId, winReason) {
    const result = buildGameResult(this.state.players, winnerId, winReason);
    for (const pr of result.playerResults) {
      const player = this.state.players.find((p) => p.id === pr.playerId);
      player.score += pr.scoreDelta;
    }
    this.state.phase = "GAME_OVER" /* GAME_OVER */;
    this.state.result = result;
    this.emit("gameOver", { result });
  }
  isDeadlock() {
    if (this.state.pool.length > 0) return false;
    const ctx = this.getTurnContext();
    return ctx.consecutivePasses >= this.state.players.length;
  }
  // =========================================================================
  // 玩家轮转
  // =========================================================================
  nextPlayer() {
    var _a, _b;
    const nextIndex = (this.state.currentPlayerIndex + 1) % this.state.players.length;
    this.state.currentPlayerIndex = nextIndex;
    this.state.turnNumber++;
    this.state.turnPhase = "PLAY" /* PLAY */;
    const nextPlayer = this.state.players[nextIndex];
    this.state.turnContext = createTurnContext(
      this.state.board,
      this.state.pool,
      nextPlayer.rack,
      (_b = (_a = this.state.turnContext) == null ? void 0 : _a.consecutivePasses) != null ? _b : 0
    );
    this.emit("turnStart", { playerId: nextIndex, turnNumber: this.state.turnNumber });
    this.turnOps = [];
  }
  // =========================================================================
  // 查询接口
  // =========================================================================
  getState() {
    return this.state;
  }
  /** 本回合已记录的桌面操作日志（只读）。 */
  getTurnOps() {
    return this.turnOps;
  }
  getCurrentPlayer() {
    return this.state.players[this.state.currentPlayerIndex];
  }
  getTurnContext() {
    if (!this.state.turnContext) throw new Error("\u56DE\u5408\u4E0A\u4E0B\u6587\u672A\u521D\u59CB\u5316");
    return this.state.turnContext;
  }
  canPlaceTile(tile, groupId) {
    const group = this.findGroup(groupId);
    if (!group) return false;
    const lt = toLogical(tile);
    const testTiles = [...group.tiles, lt];
    if (group.type === "run") {
      return isValidRun(testTiles);
    } else {
      return isValidGroupTiles(testTiles);
    }
  }
  // =========================================================================
  // 事件系统
  // =========================================================================
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(callback);
  }
  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (cbs) {
      cbs.delete(callback);
    }
  }
  emit(event, data) {
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
  findGroup(groupId) {
    return this.state.board.find((g) => g.id === groupId);
  }
  replaceGroup(newGroup) {
    const type = detectGroupType(newGroup.tiles.map((lt) => lt.originalTile));
    this.state.board = this.state.board.map(
      (g) => g.id === newGroup.id ? { ...newGroup, type } : g
    );
  }
  assertPhase(expected) {
    if (this.state.phase !== "PLAYING" /* PLAYING */) {
      throw new Error(`\u6E38\u620F\u672A\u5728\u8FDB\u884C\u4E2D, \u5F53\u524D: ${this.state.phase}`);
    }
    if (this.state.turnPhase !== expected) {
      throw new Error(`\u56DE\u5408\u9636\u6BB5\u9519\u8BEF, \u671F\u671B: ${expected}, \u5F53\u524D: ${this.state.turnPhase}`);
    }
  }
  assertPlaying() {
    if (this.state.phase !== "PLAYING" /* PLAYING */) {
      throw new Error(`\u6E38\u620F\u672A\u5728\u8FDB\u884C\u4E2D, \u5F53\u524D: ${this.state.phase}`);
    }
  }
  recordOp(op) {
    this.turnOps.push(op);
  }
  // =========================================================================
  // 序列化 / 反序列化（在线对战：云端权威状态同步）
  // =========================================================================
  /** 完整导出当前状态（含手牌/牌池，仅限可信侧使用）。 */
  serializeState() {
    return JSON.stringify(this.state);
  }
  /**
   * 原地注入序列化状态（不新建实例，保留已绑定的事件监听）。
   * 在线模式下 GameScene 持有引擎引用，云端权威状态推送时用此方法整体覆盖。
   */
  loadState(json) {
    const state = JSON.parse(json);
    this.state = state;
    this.turnOps = [];
    this.groupIdCounter = maxGroupIdFromBoard(state.board);
    this.emit("stateLoaded", { phase: state.phase });
  }
  /**
   * 从序列化状态重建引擎（含回合上下文）。
   * 同时把牌组 ID 计数器恢复到桌面最大编号，保证后续回放生成相同 groupId。
   */
  static fromState(json) {
    const state = JSON.parse(json);
    const engine = new _RummikubEngine(state.config);
    engine.loadState(json);
    return engine;
  }
};
function applyOps(engine, ops) {
  for (const op of ops) {
    switch (op.op) {
      case "PLACE_ON_BOARD":
        engine.placeTilesOnBoard(op.tileIds, op.groupId, op.position);
        break;
      case "CREATE_GROUP":
        engine.createNewGroupOnBoard(tilesFromRack(engine, op.tileIds), op.groupType);
        break;
      case "RETURN_TO_RACK":
        engine.returnTilesToRack(op.tileIds);
        break;
      case "REPLACE_JOKER": {
        const realTile = tilesFromRack(engine, [op.realTileId])[0];
        engine.replaceJokerOnBoard(op.groupId, op.jokerPosition, realTile);
        break;
      }
      case "MOVE_WITHIN_GROUP":
        engine.moveTileWithinGroup(op.groupId, op.tileId, op.toIndex);
        break;
      default:
        throw new Error(`\u672A\u77E5\u64CD\u4F5C\u7C7B\u578B: ${op.op}`);
    }
  }
}
function tilesFromRack(engine, tileIds) {
  const rack = engine.getCurrentPlayer().rack;
  return tileIds.map((id) => {
    const tile = rack.find((t) => t.id === id);
    if (!tile) throw new Error(`\u56DE\u653E\u5931\u8D25\uFF1A\u724C ${id} \u4E0D\u5728\u724C\u67B6\u4E2D`);
    return tile;
  });
}

// src/game/bot.ts
function planBotTurn(engine) {
  const state = engine.getState();
  if (state.phase !== "PLAYING") return false;
  const player = engine.getCurrentPlayer();
  if (!player.hasMadeInitialMeld) {
    return planInitialMeld(engine, player.rack, state.config.initialMeldMinScore);
  }
  return planFreePlay(engine);
}
function planInitialMeld(engine, rack, minScore) {
  const chosen = selectDisjointMelds(enumerateMelds(rack));
  const total = chosen.reduce((sum, c) => sum + c.score, 0);
  if (total < minScore) return false;
  for (const meld of chosen) {
    engine.createNewGroupOnBoard(meld.tiles, meld.type);
  }
  return true;
}
function planFreePlay(engine) {
  let placedAny = false;
  const chosen = selectDisjointMelds(enumerateMelds(engine.getCurrentPlayer().rack));
  for (const meld of chosen) {
    engine.createNewGroupOnBoard(meld.tiles, meld.type);
    placedAny = true;
  }
  let progress = true;
  while (progress) {
    progress = false;
    const player = engine.getCurrentPlayer();
    const board = engine.getState().board;
    const rack = [...player.rack].sort((a, b) => getTileValue(b) - getTileValue(a));
    for (const tile of rack) {
      const target = findAttachTarget(tile, board);
      if (target) {
        engine.placeTilesOnBoard([tile.id], target.groupId, target.position);
        placedAny = true;
        progress = true;
        break;
      }
    }
  }
  return placedAny;
}
function findAttachTarget(tile, board) {
  const lt = toLogical(tile);
  for (const group of board) {
    if (group.type === "run") {
      if (group.tiles.some((g) => g.logicalColor === "joker")) continue;
      const low = group.tiles[0].logicalNumber;
      const high = group.tiles[group.tiles.length - 1].logicalNumber;
      const runColor = group.tiles[0].logicalColor;
      if (tile.color === "joker") {
        if (high < 13) return { groupId: group.id, position: group.tiles.length };
        if (low > 1) return { groupId: group.id, position: 0 };
        continue;
      }
      if (tile.color !== runColor) continue;
      if (tile.number === high + 1 && high + 1 <= 13) {
        return { groupId: group.id, position: group.tiles.length };
      }
      if (tile.number === low - 1 && low - 1 >= 1) {
        return { groupId: group.id, position: 0 };
      }
    } else if (isValidGroupTiles([...group.tiles, lt])) {
      return { groupId: group.id, position: group.tiles.length };
    }
  }
  return null;
}
function enumerateMelds(rack) {
  const pure = [];
  const withJoker = [];
  const jokers = rack.filter((t) => t.color === "joker");
  for (const color of TILE_COLORS) {
    pure.push(...findRunCandidates(rack, color, null));
  }
  for (const color of TILE_COLORS) {
    let ji = 0;
    const jokerFor = () => jokers.length > 0 ? jokers[ji % jokers.length] : null;
    for (const candidate of findRunCandidates(rack, color, jokerFor())) {
      withJoker.push(candidate);
      ji++;
    }
  }
  pure.push(...findGroupCandidates(rack, null));
  {
    let ji = 0;
    const jokerFor = () => jokers.length > 0 ? jokers[ji % jokers.length] : null;
    for (const candidate of findGroupCandidates(rack, jokerFor())) {
      withJoker.push(candidate);
      ji++;
    }
  }
  const byScoreDesc = (a, b) => b.score - a.score;
  pure.sort(byScoreDesc);
  withJoker.sort(byScoreDesc);
  return [...pure, ...withJoker];
}
function findRunCandidates(rack, color, joker) {
  const byNumber = /* @__PURE__ */ new Map();
  for (const tile of rack) {
    if (tile.color === color && !byNumber.has(tile.number)) {
      byNumber.set(tile.number, tile);
    }
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  const candidates = [];
  const makeRun = (tiles) => ({
    tiles,
    type: "run",
    score: tiles.reduce((sum, t) => sum + getTileValue(t), 0)
  });
  let i = 0;
  while (i < numbers.length) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    if (j - i + 1 >= 3) {
      candidates.push(makeRun(numbers.slice(i, j + 1).map((n) => byNumber.get(n))));
    }
    i = j + 1;
  }
  if (joker) {
    for (let k = 0; k < numbers.length; k++) {
      const a = numbers[k];
      const b = numbers[k + 1];
      if (b === void 0) break;
      if (b === a + 1) {
        if (a - 1 >= 1) candidates.push(makeRun([joker, byNumber.get(a), byNumber.get(b)]));
        if (b + 1 <= 13) candidates.push(makeRun([byNumber.get(a), byNumber.get(b), joker]));
      } else if (b === a + 2) {
        candidates.push(makeRun([byNumber.get(a), joker, byNumber.get(b)]));
      }
    }
  }
  return candidates;
}
function findGroupCandidates(rack, joker) {
  const candidates = [];
  const makeGroup = (tiles) => ({
    tiles,
    type: "group",
    score: tiles.reduce((sum, t) => sum + getTileValue(t), 0)
  });
  for (let n = 1; n <= 13; n++) {
    const perColor = /* @__PURE__ */ new Map();
    for (const tile of rack) {
      if (tile.number === n && tile.color !== "joker" && !perColor.has(tile.color)) {
        perColor.set(tile.color, tile);
      }
    }
    const distinct = [...perColor.values()];
    if (joker) {
      if (distinct.length === 2) {
        candidates.push(makeGroup([...distinct, joker]));
      }
    } else if (distinct.length >= 3) {
      candidates.push(makeGroup(distinct));
    }
  }
  return candidates;
}
function selectDisjointMelds(candidates) {
  const used = /* @__PURE__ */ new Set();
  const chosen = [];
  for (const candidate of candidates) {
    if (candidate.tiles.some((t) => used.has(t.id))) continue;
    chosen.push(candidate);
    for (const t of candidate.tiles) used.add(t.id);
  }
  return chosen;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RummikubEngine,
  applyOps,
  findLowestScorePlayer,
  planBotTurn
});
