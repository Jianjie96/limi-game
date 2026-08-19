// ============================================================================
// game.ts — 微信小游戏入口（原生 Canvas 2D 渲染）
// ----------------------------------------------------------------------------
// wx.createCanvas() 获取主屏幕画布 → 读取屏幕信息 → 设置物理尺寸 →
// 初始化游戏引擎与 GameScene（获取 2d 上下文 + 绑定 wx 触摸事件）。
// ============================================================================

import { RummikubEngine } from './game/engine';
import { GameScene } from './ui/GameScene';
import { getScreenInfo } from './ui/screen';

// 微信小游戏中第一次调用 createCanvas 拿到的是主屏幕画布。
const nativeCanvas = wx.createCanvas();

// 屏幕信息（逻辑像素 + 像素比 + 安全区）。
const info = getScreenInfo(nativeCanvas);

// 主画布尺寸设为物理像素（逻辑 × 像素比），绘制时通过 ctx.setTransform 缩放。
nativeCanvas.width = info.screenWidth * info.pixelRatio;
nativeCanvas.height = info.screenHeight * info.pixelRatio;

// 创建游戏引擎。
const engine = new RummikubEngine({
  playerCount: 4,
  initialHandSize: 14,
  initialMeldMinScore: 30,
  turnTimeLimit: 60,
});

// 创建游戏场景（内部获取 2d 上下文并绑定触摸事件）。
const scene = new GameScene(nativeCanvas, engine, info);

// 启动渲染循环。
scene.start();
scene.showMessage('拉密 Rummikub', 3000);

// 启动一局游戏。
setTimeout(() => {
  scene.startGame(['玩家1', '玩家2', '玩家3', '玩家4']);
  scene.showMessage('游戏开始! 可出牌或 Pass 摸牌', 3000);
}, 1000);