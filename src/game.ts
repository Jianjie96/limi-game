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
import { ProfileScene } from './ui/ProfileScene';
import { OnlineCoordinator } from './ui/online';
import { getScreenInfo, getScreenInfoAfterRotation, applyCanvasSize, type ScreenInfo } from './ui/screen';
import { audio } from './ui/audio';
import { getNickname, getPreferredOrientation, setPreferredOrientation } from './ui/profile';
import { requestOrientation, orientationSupported } from './ui/orientation';
import type { PublicGameState } from './cloud/game';
import { endGame } from './cloud/game';
import {
  initCloud,
  createRoom,
  joinRoom,
  getRoom,
  startRoom,
  findMyActiveRoom,
  getLastRoom,
  clearLastRoom,
  RoomInfo,
  RoomResult,
} from './cloud/room';

// 微信小游戏中第一次调用 createCanvas 拿到的是主屏幕画布。
const nativeCanvas = wx.createCanvas();

/** 读取最新屏幕信息，并把主画布后备存储同步到对应物理尺寸。 */
function freshScreenInfo(): ScreenInfo {
  // getScreenInfo 内含真机基准校正（窗口 API 与画布物理方向不符时以画布为准）；
  // applyCanvasSize 带校验重试，防真机转屏窗口未就绪时后备存储被裁剪成半屏。
  const i = getScreenInfo(nativeCanvas);
  applyCanvasSize(nativeCanvas, i);
  return i;
}

// 屏幕信息（逻辑像素 + 像素比 + 安全区）。
const info = freshScreenInfo();

// 初始化云开发（失败不阻塞，调用接口时再提示）。
initCloud();

// 音频：预取云存储音效临时链接；BGM 在用户首次触摸后启动（避开自动播放限制）。
audio.init();
const bgmStarter = () => {
  audio.startBgm();
  wx.offTouchStart(bgmStarter);
};
wx.onTouchStart(bgmStarter);

// 屏幕方向：启动期方向生效（带验证，见 bootOrientation）。
// 不再在这里直接同步切屏：真机转屏异步，未验证的切换 + 持久化偏好会造成
// 「启动就横屏错乱 → 无法点击 → 下次启动依旧」的死循环。
let bootOrientationDone: Promise<void>;
function bootOrientation(): Promise<void> {
  if (getPreferredOrientation() !== 'landscape' || !orientationSupported()) {
    // 竖屏偏好或不支持转屏：保持 game.json 的静态竖屏，零风险。
    return Promise.resolve();
  }
  return requestOrientation('landscape').then((final) => {
    if (final !== 'landscape') {
      // 横屏切换失败（机型不支持/窗口未就绪）：清除坏偏好，
      // 下次启动自动回竖屏——最多坏一次，永不死循环。
      setPreferredOrientation('portrait');
      try {
        wx.showToast({ title: '当前设备不支持横屏，已切回竖屏', icon: 'none', duration: 2500 });
      } catch (e) {
        // 提示不可用则静默
      }
    }
    // 成功时不重建首页：各场景的 onWindowResize 会自动重排。
  });
}
bootOrientationDone = bootOrientation();

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

/** 首页（等方向切换验证完成后再构建，避免用旧方向尺寸布局） */
let goHomeToken = 0;
function goHome(): void {
  // 从对局/设置页回到首页时，方向恢复到个人中心的偏好值。
  // 首次调用先等启动期方向尝试落定，避免与其并发发起第二次转屏。
  const target = getPreferredOrientation();
  const token = ++goHomeToken;
  bootOrientationDone
    .then(() => requestOrientation(target))
    .then((final) => {
      // requestOrientation 已验证方向稳定（失败时已回滚），
      // 再取一次含安全区的完整尺寸后构建。
      return getScreenInfoAfterRotation(final, nativeCanvas);
    })
    .then((info) => {
      if (token !== goHomeToken) return; // 期间又发生了跳转，丢弃过期的构建
      const home = new HomeScene(nativeCanvas, info);
      wireHome(home);
      switchScene(home);
    });
}

/** 首页各入口接线：建房 / 房号入房 / 个人中心 / 断线重连。 */
function wireHome(home: HomeScene): void {
  home.onCreateRoom = (capacity: number) => {
    createRoom(capacity, getNickname())
      .then((result) => {
        home.closePicker();
        enterRoom(result);
      })
      .catch((e: Error) => {
        home.showError(e.message);
      });
  };
  // 房号入房：体验版同伴无法通过分享卡片进入时，口口相传房号即可真人对战。
  home.onJoinByCode = (code: string) => {
    joinRoom(code, getNickname())
      .then((result) => {
        home.closePicker();
        enterRoom(result);
      })
      .catch((e: Error) => {
        home.showError(e.message);
      });
  };
  home.onOpenProfile = () => {
    goProfile();
  };
  // 断线重连：优先本地房间记忆；本地无记录（如清过缓存）则查云端进行中的房间，
  // 保证清缓存不会导致进不去对局。房间在对局中或等待中且本人在场时展示回进入口。
  const lastCode = getLastRoom();
  const probe: Promise<{ room: RoomInfo | null; self: string }> = lastCode
    ? getRoom(lastCode).catch(() => ({ room: null, self: '' }))
    : findMyActiveRoom().catch(() => ({ room: null, self: '' }));
  probe
    .then((result) => {
      const room = result.room;
      if (!room) return;
      const isMember = room.players.some((p) => p.openid === result.self);
      const inGame = room.status === 'started' || room.status === 'playing';
      if (isMember && (inGame || room.status === 'waiting')) {
        home.onResume = () => {
          joinRoom(room.code, getNickname())
            .then((joinResult) => {
              home.closePicker();
              enterRoom(joinResult);
            })
            .catch((e: Error) => {
              home.hideResume();
              home.showError(`进入房间失败：${e.message}`);
            });
        };
        home.showResume(room.code, inGame ? '回到对局' : '回到房间');
      } else if (room.status === 'finished') {
        // 对局已收尾：清除记忆，下次不再提示。
        clearLastRoom();
      }
    })
    .catch(() => {
      // 查询失败静默（房间可能已被清理），不打扰首页。
    });
}

/** 个人中心：头像昵称 + 历史战绩 + 音频/震动/方向开关 */
function goProfile(): void {
  const scene = new ProfileScene(nativeCanvas, freshScreenInfo());
  scene.onExit = () => {
    goHome();
  };
  switchScene(scene);
}

/** 房间等待页（创建成功后 / 加入成功后进入） */
function enterRoom(result: RoomResult): void {
  const roomScene = new RoomScene(nativeCanvas, freshScreenInfo(), result);
  roomScene.onStart = (room: RoomInfo, selfOpenid: string) => {
    startOnlineGame(room, selfOpenid);
  };
  roomScene.onExit = () => {
    goHome();
  };
  switchScene(roomScene);
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
  });
  const scene = new GameScene(nativeCanvas, engine, freshScreenInfo(), selfIndex);
  const coordinator = new OnlineCoordinator(
    engine,
    scene,
    room.code,
    selfOpenid,
    selfIndex,
    room.host === selfOpenid
  );
  scene.coordinator = coordinator;
  // 结算面板「返回」：对局已结束，退出回首页（重连入口由首页自行探测房间状态）。
  scene.onExitGameOver = () => {
    goHome();
  };
  // 房主专属出口：对局中随时「结束对局」（云端 end 仅限房主），真人局/机器人局都能收尾。
  if (room.host === selfOpenid) {
    scene.onRequestEndGame = () => {
      wx.showModal({
        title: '结束对局',
        content: '确定结束当前对局吗？房间将被关闭。',
        confirmText: '结束',
        success: (res) => {
          if (!res.confirm) return;
          endGame(room.code)
            .then(() => {
              clearLastRoom();
              goHome();
            })
            .catch((e: Error) => {
              scene.showMessage(`结束失败：${e.message}`, 2400);
            });
        },
      });
    };
  }
  switchScene(scene);
  scene.start();
  scene.showMessage('正在连接对局…', 2000);
  coordinator.begin(room.game?.public as PublicGameState | undefined);
}

// ----------------------------------------------------------------------------
// 启动入口：分享链接（携带 roomId）直接加入房间，否则进首页
// ----------------------------------------------------------------------------

function tryJoinSharedRoom(roomId: string, silent = false): void {
  joinRoom(roomId, getNickname())
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
