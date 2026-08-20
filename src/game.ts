// ============================================================================
// game.ts — 微信小游戏入口（原生 Canvas 2D 渲染）
// ----------------------------------------------------------------------------
// 流程编排：
//   1. 正常启动 → 首页（创建房间 / 加入房间）
//   2. 创建房间 → 选人数（2/3/4）→ 云函数建房 → 房间等待页（分享邀请）
//   3. 好友通过分享卡片进入 → 携带 roomId 自动加入房间
//   4. 人齐后房主点击「开始游戏」，所有客户端进入对局
// ============================================================================

import { RummikubEngine } from './game/engine';
import { GameScene } from './ui/GameScene';
import { HomeScene } from './ui/HomeScene';
import { RoomScene } from './ui/RoomScene';
import { OnlineCoordinator } from './ui/online';
import { getScreenInfo } from './ui/screen';
import type { PublicGameState } from './cloud/game';
import {
  initCloud,
  createRoom,
  joinRoom,
  getRoom,
  localPlayerName,
  getLastRoom,
  clearLastRoom,
  RoomInfo,
  RoomResult,
} from './cloud/room';

// 微信小游戏中第一次调用 createCanvas 拿到的是主屏幕画布。
const nativeCanvas = wx.createCanvas();

// 屏幕信息（逻辑像素 + 像素比 + 安全区）。
const info = getScreenInfo(nativeCanvas);

// 主画布尺寸设为物理像素（逻辑 × 像素比），绘制时通过 ctx.setTransform 缩放。
nativeCanvas.width = info.screenWidth * info.pixelRatio;
nativeCanvas.height = info.screenHeight * info.pixelRatio;

// 初始化云开发（失败不阻塞，调用接口时再提示）。
initCloud();

// 本机玩家名（每次启动固定一个随机代号）。
const myName = localPlayerName();

/** 是否开发版（envVersion === 'develop'），体验版/正式版均视为线上。 */
function isDevEnvironment(): boolean {
  try {
    return (
      typeof wx.getAccountInfoSync === 'function' &&
      wx.getAccountInfoSync().miniProgram.envVersion === 'develop'
    );
  } catch (e) {
    // API 不可用时按线上处理，隐藏调试入口。
    return false;
  }
}

// ----------------------------------------------------------------------------
// 场景切换
// ----------------------------------------------------------------------------

interface DisposableScene {
  dispose(): void;
}

let current: DisposableScene | null = null;

function switchScene(next: DisposableScene): void {
  current?.dispose();
  current = next;
}

/** 首页 */
function goHome(): HomeScene {
  const home = new HomeScene(nativeCanvas, info);
  home.onCreateRoom = (capacity: number) => {
    createRoom(capacity, myName)
      .then((result) => {
        home.closePicker();
        enterRoom(result);
      })
      .catch((e: Error) => {
        home.showError(e.message);
      });
  };
  // 开发后门：仅开发版显示，不依赖云开发，直接本地开一局（4 人）方便调试。
  if (isDevEnvironment()) {
    home.onLocalPlay = () => {
      const demo: RoomInfo = {
        code: 'LOCAL',
        host: 'local',
        capacity: 4,
        status: 'started',
        players: [
          { openid: 'local-1', name: myName },
          { openid: 'local-2', name: '玩家2' },
          { openid: 'local-3', name: '玩家3' },
          { openid: 'local-4', name: '玩家4' },
        ],
      };
      startLocalGame(demo);
    };
  }
  // 断线重连：上次房间若仍在对局中且本人在场，首页展示「回到对局」入口。
  const lastCode = getLastRoom();
  if (lastCode) {
    getRoom(lastCode)
      .then((result) => {
        const room = result.room;
        const isMember = room.players.some((p) => p.openid === result.self);
        const inGame = room.status === 'started' || room.status === 'playing';
        if (isMember && inGame) {
          home.onResume = () => {
            joinRoom(room.code, myName)
              .then((joinResult) => {
                home.closePicker();
                enterRoom(joinResult);
              })
              .catch((e: Error) => {
                home.hideResume();
                home.showError(`回到对局失败：${e.message}`);
              });
          };
          home.showResume(room.code);
        } else if (room.status === 'finished') {
          // 对局已收尾：清除记忆，下次不再提示。
          clearLastRoom();
        }
      })
      .catch(() => {
        // 查询失败静默（房间可能已被清理），不打扰首页。
      });
  }
  switchScene(home);
  return home;
}

/** 房间等待页（创建成功后 / 加入成功后进入） */
function enterRoom(result: RoomResult): void {
  const roomScene = new RoomScene(nativeCanvas, info, result);
  roomScene.onStart = (room: RoomInfo, selfOpenid: string) => {
    startOnlineGame(room, selfOpenid);
  };
  roomScene.onExit = () => {
    goHome();
  };
  switchScene(roomScene);
}

/** 本地试玩（仅开发后门）：引擎完全离线运行，热座轮流操作。 */
function startLocalGame(room: RoomInfo): void {
  const engine = new RummikubEngine({
    playerCount: room.capacity,
    initialHandSize: 14,
    initialMeldMinScore: 30,
    turnTimeLimit: 60,
  });
  const scene = new GameScene(nativeCanvas, engine, info);
  switchScene(scene);
  scene.start();
  scene.startGame(room.players.map((p) => p.name));
  scene.showMessage('游戏开始! 可出牌或 Pass 摸牌', 3000);
}

/**
 * 在线对战：云端权威引擎 + 数据库实时推送。
 * 房主负责调 initGame 开局（幂等）；所有客户端通过 watch 订阅
 * 公开状态与本人手牌，推送到达后 loadState 整体重绘。
 */
function startOnlineGame(room: RoomInfo, selfOpenid: string): void {
  const selfIndex = Math.max(
    0,
    room.players.findIndex((p) => p.openid === selfOpenid)
  );
  const engine = new RummikubEngine({
    playerCount: room.capacity,
    initialHandSize: 14,
    initialMeldMinScore: 30,
    turnTimeLimit: 60,
  });
  const scene = new GameScene(nativeCanvas, engine, info, 'online', selfIndex);
  const coordinator = new OnlineCoordinator(
    engine,
    scene,
    room.code,
    selfOpenid,
    selfIndex,
    room.host === selfOpenid
  );
  scene.coordinator = coordinator;
  switchScene(scene);
  scene.start();
  scene.showMessage('正在连接对局…', 2000);
  coordinator.begin(room.game?.public as PublicGameState | undefined);
}

// ----------------------------------------------------------------------------
// 启动入口：分享链接（携带 roomId）直接加入房间，否则进首页
// ----------------------------------------------------------------------------

function tryJoinSharedRoom(roomId: string, silent = false): void {
  joinRoom(roomId, myName)
    .then((result) => {
      enterRoom(result);
    })
    .catch((e: Error) => {
      if (!silent && current instanceof HomeScene) {
        current.showError(`加入房间失败：${e.message}`);
      }
    });
}

let launchQuery: Record<string, string> = {};
try {
  // 部分旧基础库 / 特殊环境下该 API 可能不存在，失败不阻塞启动。
  launchQuery = (typeof wx.getLaunchOptionsSync === 'function'
    ? wx.getLaunchOptionsSync().query
    : {}) || {};
} catch (e) {
  launchQuery = {};
}

if (launchQuery.roomId) {
  // 分享链接进入：先到首页再自动加入，失败时有地方展示提示。
  goHome();
  tryJoinSharedRoom(String(launchQuery.roomId));
} else {
  goHome();
}

// 游戏中被分享卡片再次唤起时，也尝试加入对应房间。
try {
  wx.onShow((res) => {
    const roomId = res.query?.roomId;
    if (!roomId) return;
    if (current instanceof RoomScene && current.code === roomId) return;
    tryJoinSharedRoom(String(roomId), true);
  });
} catch (e) {
  // 不支持 onShow 的环境忽略即可
}
