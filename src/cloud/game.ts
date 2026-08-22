// ============================================================================
// src/cloud/game.ts — 在线对战客户端同步层
// ----------------------------------------------------------------------------
// 与云函数 lami-game 对接：开局 / 出牌提交 / Pass；
// 通过云数据库 watch（实时数据推送）订阅公开状态与本人手牌，
// 效果等同 WebSocket：云端每次落库后毫秒级推送到房间内所有客户端。
// ============================================================================

import type { Tile, TileGroup, GameResult, GameConfig } from '../game/types';
import type { EngineOp } from '../game/types';
import type { TurnLogEntry } from '../game/log';

const GAME_FUNCTION = 'lami-game';

// ----------------------------------------------------------------------------
// 数据结构（与云函数返回保持一致）
// ----------------------------------------------------------------------------

/** 公开玩家信息（手牌保密，仅暴露数量） */
export interface PublicPlayer {
  id: number;
  name: string;
  score: number;
  hasMadeInitialMeld: boolean;
  rackCount: number;
}

/** 云端推送的公开对局状态（不含任何手牌内容与牌池顺序） */
export interface PublicGameState {
  version: number;
  turnDeadline: number;
  phase: string;
  players: PublicPlayer[];
  currentPlayerIndex: number;
  board: TileGroup[];
  turnPhase: string;
  turnNumber: number;
  config: GameConfig;
  result: GameResult | null;
  poolCount: number;
}

/** 云端响应载荷：公开状态 + 本人手牌 */
export interface GameSyncPayload {
  public: PublicGameState;
  hand: Tile[];
}

/** 出牌提交响应（校验失败时携带 errors 与权威状态，供客户端回滚） */
export interface MoveResponse {
  ok: boolean;
  message?: string;
  errors?: Array<{ code: string; message: string }>;
  payload?: GameSyncPayload;
  public?: PublicGameState;
  hand?: Tile[];
}

// ----------------------------------------------------------------------------
// 云函数调用
// ----------------------------------------------------------------------------

function callGameRaw(action: string, data: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: GAME_FUNCTION,
      data: { action, ...data },
      success: (res) => resolve(res.result),
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        reject(
          new Error(msg.includes('not found')
            ? '云函数未部署，请在开发者工具中上传 lami-game'
            : '网络异常，请检查网络后重试')
        );
      },
    });
  });
}

/** 开局（幂等；返回公开状态 + 本人手牌） */
export async function initGame(code: string): Promise<GameSyncPayload> {
  const result = await callGameRaw('init', { code });
  if (!result || !result.ok) {
    throw new Error((result && result.message) || '开局失败');
  }
  return { public: result.public, hand: result.hand };
}

// 曾实现 syncGame 云函数兜底轮询（watch 被数据库安全规则拦截时的降级通道），
// 集合读权限已放开后按用户要求移除；若验收/线上再现卡「正在连接对局」，
// 按记忆「微信云开发 watch 被集合安全规则静默拦截与云函数兜底轮询」恢复。

/** 出牌提交：携带本回合操作日志，云端回放校验 */
export async function sendMove(code: string, ops: readonly EngineOp[]): Promise<MoveResponse> {
  const result = await callGameRaw('move', { code, ops });
  if (!result) throw new Error('请求失败');
  return result as MoveResponse;
}

/** Pass：摸一张并结束回合 */
export async function sendPass(code: string): Promise<MoveResponse> {
  const result = await callGameRaw('pass', { code });
  if (!result) throw new Error('请求失败');
  return result as MoveResponse;
}

/** 读取本局操作日志（云端逐回合写入，房间内所有成员可读；对局结束已清空则返回空） */
export async function fetchTurnLog(code: string): Promise<TurnLogEntry[]> {
  const result = await callGameRaw('log', { code });
  if (!result || !result.ok) return [];
  return Array.isArray(result.log) ? result.log : [];
}

/** 结束对局（房主）：终止当前对局并清理云端数据，用于关闭测试房 / 紧急终止。 */
export async function endGame(code: string): Promise<void> {
  const result = await callGameRaw('end', { code });
  if (!result || !result.ok) {
    throw new Error((result && result.message) || '结束对局失败');
  }
}

/** 单个玩家的得分详情（结算时快照）。 */
export interface MatchScoreEntry {
  /** 玩家昵称。 */
  name: string;
  /** 本局加减分：胜者得其余家之和，其余家扣自己剩余分。 */
  scoreDelta: number;
  /** 结算时手牌剩余分值（胜者为 0）。 */
  remainingScore: number;
  /** 结算时手牌剩余张数。 */
  remainingCount: number;
  /** 是否冠军。 */
  isWinner: boolean;
}

/** 单条历史战绩（云端 lami_history 查询结果，已按本人视角加工）。 */
export interface MatchHistoryRecord {
  /** 对局结束时间戳（毫秒）。 */
  date: number;
  /** 对局时长（毫秒）。 */
  durationMs: number;
  /** 参与者昵称（按座位序）。 */
  players: string[];
  /** 冠军昵称。 */
  winnerName: string;
  /** 本人是否夺冠。 */
  selfWon: boolean;
  /** 得分详情（部署前的老局可能为空数组）。 */
  scores: MatchScoreEntry[];
}

/** 查询本人历史战绩（云端权威，最新在前，上限 50 条）。 */
export async function fetchMatchHistory(): Promise<MatchHistoryRecord[]> {
  const result = await callGameRaw('history', {});
  if (!result || !result.ok) {
    throw new Error((result && result.message) || '查询战绩失败');
  }
  return Array.isArray(result.records) ? result.records : [];
}

// ----------------------------------------------------------------------------
// 实时订阅（云数据库 watch）
// ----------------------------------------------------------------------------

/**
 * 订阅对局实时推送：公开状态（lami_rooms.game.public）+ 本人手牌（lami_hands）。
 * 任一文档变化都会触发 onUpdate；返回取消订阅函数。
 */
export function watchGame(
  code: string,
  selfOpenid: string,
  onUpdate: (publicState: PublicGameState, hand: Tile[] | null) => void
): () => void {
  const db = wx.cloud.database();
  let latestPublic: PublicGameState | null = null;
  let latestHand: Tile[] | null = null;

  const push = () => {
    if (latestPublic) onUpdate(latestPublic, latestHand);
  };

  const roomWatcher = db
    .collection('lami_rooms')
    .where({ code })
    .watch({
      onChange: (snap) => {
        const doc = snap.docs && snap.docs[0];
        if (doc && doc.game && doc.game.public) {
          latestPublic = doc.game.public;
          push();
        }
      },
      onError: (err) => {
        console.error('watch lami_rooms 失败:', err);
      },
    });

  const handWatcher = db
    .collection('lami_hands')
    .where({ code, owner: selfOpenid })
    .watch({
      onChange: (snap) => {
        const doc = snap.docs && snap.docs[0];
        if (doc && Array.isArray(doc.rack)) {
          latestHand = doc.rack;
          push();
        }
      },
      onError: (err) => {
        console.error('watch lami_hands 失败:', err);
      },
    });

  return () => {
    try {
      roomWatcher.close();
      handWatcher.close();
    } catch (e) {
      // 忽略关闭异常
    }
  };
}
