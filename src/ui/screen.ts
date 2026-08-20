// ============================================================================
// screen.ts — 屏幕信息（逻辑尺寸 / 像素比 / 安全区）
// ----------------------------------------------------------------------------
// 微信小游戏专用：通过 wx.getSystemInfoSync() 获取，jsbridge 未就绪时降级为
// 用主画布物理尺寸 1:1 当作逻辑尺寸。safeTop / safeBottom 用于避开刘海与底部
// 指示条（Home Indicator）。
// ============================================================================

export interface ScreenInfo {
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  safeTop: number;
  safeBottom: number;
  safeLeft: number;
  safeRight: number;
}

export function getScreenInfo(
  canvas?: { width?: number; height?: number },
  fallbackW = 375,
  fallbackH = 667,
  fallbackDpr = 1,
): ScreenInfo {
  let screenWidth = canvas?.width || fallbackW;
  let screenHeight = canvas?.height || fallbackH;
  let pixelRatio = fallbackDpr;
  let safeTop = 0;
  let safeBottom = 0;
  let safeLeft = 0;
  let safeRight = 0;

  try {
    // 优先用 getWindowInfo（基础库 2.20.1+）：getSystemInfoSync 已废弃，
    // 且在 iOS 冷启动早期调用时窗口尺寸/方向可能不准（曾导致画布只有半屏）。
    const info: any = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    pixelRatio = info.pixelRatio || fallbackDpr;
    // 微信小游戏里 windowWidth/windowHeight 均为逻辑像素。
    const w = info.windowWidth || info.screenWidth || screenWidth / pixelRatio;
    const h = info.windowHeight || info.screenHeight || screenHeight / pixelRatio;
    screenWidth = Math.round(w);
    screenHeight = Math.round(h);

    const safeArea = info.safeArea;
    const fullW = info.screenWidth || w;
    const fullH = info.screenHeight || h;
    // 安全区：上方刘海/状态栏、下方 Home 指示条，横屏时左右两侧刘海/圆角。
    if (
      safeArea &&
      typeof safeArea.top === 'number' &&
      typeof safeArea.bottom === 'number' &&
      typeof safeArea.left === 'number' &&
      typeof safeArea.right === 'number'
    ) {
      safeTop = Math.round(safeArea.top);
      safeBottom = Math.round(Math.max(0, fullH - safeArea.bottom));
      safeLeft = Math.round(safeArea.left);
      safeRight = Math.round(Math.max(0, fullW - safeArea.right));
    } else {
      // 兼容旧版本：没有 safeArea 时用状态栏高度兜底，避免顶栏被刘海遮挡。
      safeTop = Math.round(info.statusBarHeight || 0);
      safeBottom = 0;
      safeLeft = 0;
      safeRight = 0;
    }
  } catch (_e) {
    // jsbridge 未就绪：把画布物理尺寸 1:1 当作逻辑尺寸使用。
    pixelRatio = 1;
  }

  return { screenWidth, screenHeight, pixelRatio, safeTop, safeBottom, safeLeft, safeRight };
}