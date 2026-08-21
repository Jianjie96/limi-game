// ============================================================================
// src/cloud/room.ts — 微信云开发客户端封装（房间服务）
// ----------------------------------------------------------------------------
// 对接云函数 lami-room：创建房间 / 通过房号加入 / 轮询房间状态 / 开始游戏。
// 使用前提：在微信开发者工具中开通云开发，并部署 cloudfunctions/lami-room。
// ============================================================================

/**
 * 云环境 ID。留空则使用默认云环境。
 * 开通云开发后可在「云开发控制台 → 设置 → 环境 ID」中查看并填入。
 */
const CLOUD_ENV = '';

const ROOM_FUNCTION = 'lami-room';

// ----------------------------------------------------------------------------
// 数据结构（与云函数返回保持一致）
// ----------------------------------------------------------------------------

export interface RoomPlayer {
  openid: string;
  name: string;
}

export interface RoomInfo {
  code: string;
  host: string;
  capacity: number;
  players: RoomPlayer[];
  /** waiting 等待中 / started 已点开始 / playing 对局中 / finished 已结束。 */
  status: 'waiting' | 'started' | 'playing' | 'finished';
  /** 开局后由 lami-game 写入的对局数据（含公开状态 game.public）。 */
  game?: {
    version?: number;
    turnDeadline?: number;
    currentPlayerIndex?: number;
    playersOpenid?: string[];
    public?: any;
  };
}

export interface RoomResult {
  room: RoomInfo;
  self: string;
}

type RoomResponse = RoomResult & { ok: boolean };

type MyRoomResponse = { ok: boolean; room: RoomInfo | null; self: string };

// ----------------------------------------------------------------------------
// 初始化
// ----------------------------------------------------------------------------

let cloudReady = false;

export function initCloud(): void {
  if (cloudReady) return;
  try {
    if (CLOUD_ENV) {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
    } else {
      wx.cloud.init();
    }
    cloudReady = true;
  } catch (e) {
    // 未开通云开发或环境配置错误时不阻塞游戏启动，调用接口时再提示。
    cloudReady = false;
  }
}

// ----------------------------------------------------------------------------
// 云函数调用封装
// ----------------------------------------------------------------------------

function callRoom<T extends { ok: boolean }>(
  action: string,
  data: Record<string, any> = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!cloudReady) {
      reject(new Error('云开发未就绪，请先在开发者工具中开通云开发'));
      return;
    }
    wx.cloud.callFunction({
      name: ROOM_FUNCTION,
      data: { action, ...data },
      success: (res) => {
        const result = res.result;
        if (result && result.ok) {
          resolve(result as T);
        } else {
          reject(new Error((result && result.message) || '请求失败'));
        }
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        reject(
          new Error(msg.includes('not found')
            ? '云函数未部署，请在开发者工具中上传 lami-room'
            : '网络异常，请检查网络后重试')
        );
      },
    });
  });
}

// ----------------------------------------------------------------------------
// 房间 API
// ----------------------------------------------------------------------------

/** 创建房间（2/3/4 人），房主自动入座。 */
export function createRoom(capacity: number, name: string): Promise<RoomResult> {
  return callRoom<RoomResponse>('create', { capacity, name }).then((result) => {
    saveLastRoom(result.room.code);
    return result;
  });
}

/** 通过房号加入房间（重复加入视为重进，直接返回房间）。 */
export function joinRoom(code: string, name: string): Promise<RoomResult> {
  return callRoom<RoomResponse>('join', { code, name }).then((result) => {
    saveLastRoom(result.room.code);
    return result;
  });
}

/** 查询房间最新状态（轮询用）。 */
export function getRoom(code: string): Promise<RoomResult> {
  return callRoom<RoomResponse>('get', { code });
}

/** 房主开始游戏（云函数校验人齐才允许）。 */
export function startRoom(code: string): Promise<RoomResult> {
  return callRoom<RoomResponse>('start', { code });
}

/** 开发调试：房主用测试机器人补满空位，单人即可开局联调实时对战。 */
export function fillDevBots(code: string): Promise<RoomResult> {
  return callRoom<RoomResponse>('devFill', { code });
}

/**
 * 查询本人进行中的房间（云端权威）。
 * 本地房间记忆（lastRoom）被清除后的兜底：从数据库恢复房号，
 * 保证清缓存不会导致进不去对局。未找到时 room 为 null。
 */
export function findMyActiveRoom(): Promise<{ room: RoomInfo | null; self: string }> {
  return callRoom<MyRoomResponse>('myRoom').then((result) => {
    if (result.room) saveLastRoom(result.room.code); // 回写本地，下次免查
    return { room: result.room, self: result.self };
  });
}

// ----------------------------------------------------------------------------
// 本地玩家身份（小游戏无授权头像昵称，用随机代号）
// ----------------------------------------------------------------------------

/** 生成一个随机本地玩家名（每次启动固定一个）。 */
export function localPlayerName(): string {
  const n = Math.floor(Math.random() * 900) + 100;
  return `旅行者${n}`;
}

// ----------------------------------------------------------------------------
// 上次房间记忆（断线重连：退出后再进游戏可从首页直接回到对局）
// ----------------------------------------------------------------------------

const LAST_ROOM_KEY = 'lami_last_room';

export function saveLastRoom(code: string): void {
  try {
    wx.setStorageSync(LAST_ROOM_KEY, code);
  } catch (e) {
    // 存储失败不影响主流程
  }
}

export function getLastRoom(): string {
  try {
    const code = wx.getStorageSync(LAST_ROOM_KEY);
    return typeof code === 'string' ? code : '';
  } catch (e) {
    return '';
  }
}

export function clearLastRoom(): void {
  try {
    wx.removeStorageSync(LAST_ROOM_KEY);
  } catch (e) {
    // 忽略
  }
}
