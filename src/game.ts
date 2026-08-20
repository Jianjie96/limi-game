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
import { getScreenInfo } from './ui/screen';
import {
  initCloud,
  createRoom,
  joinRoom,
  localPlayerName,
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
  switchScene(home);
  return home;
}

/** 房间等待页（创建成功后 / 加入成功后进入） */
function enterRoom(result: RoomResult): void {
  const roomScene = new RoomScene(nativeCanvas, info, result);
  roomScene.onStart = (room: RoomInfo) => {
    startGame(room);
  };
  roomScene.onExit = () => {
    goHome();
  };
  switchScene(roomScene);
}

/** 进入对局：按房间人数创建引擎与游戏场景 */
function startGame(room: RoomInfo): void {
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

const launchQuery = wx.getLaunchOptionsSync().query || {};
if (launchQuery.roomId) {
  // 分享链接进入：先到首页再自动加入，失败时有地方展示提示。
  goHome();
  tryJoinSharedRoom(String(launchQuery.roomId));
} else {
  goHome();
}

// 游戏中被分享卡片再次唤起时，也尝试加入对应房间。
wx.onShow((res) => {
  const roomId = res.query?.roomId;
  if (!roomId) return;
  if (current instanceof RoomScene && current.code === roomId) return;
  tryJoinSharedRoom(String(roomId), true);
});
