// ============================================================================
// src/cloud/game.ts — 在线对战客户端同步层
// ----------------------------------------------------------------------------
// 与云函数 lami-game 对接：开局 / 出牌提交 / Pass；
// 通过云数据库 watch（实时数据推送）订阅公开状态与本人手牌，
// 效果等同 WebSocket：云端每次落库后毫秒级推送到房间内所有客户端。
// ============================================================================

import type { Tile, TileGroup, GameResult, GameConfig } from '../game/types';
import type { EngineOp } from '../game/types';

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
