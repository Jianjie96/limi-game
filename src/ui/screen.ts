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
  resizeOverride?: { windowWidth?: number; windowHeight?: number },
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

  // resize 事件携带的尺寸是窗口变化瞬间的最新值，优先于窗口 API（真机上可能滞后）。
  const ow = resizeOverride?.windowWidth ?? 0;
  const oh = resizeOverride?.windowHeight ?? 0;
  if (ow > 0 && oh > 0) {
    screenWidth = Math.round(ow);
    screenHeight = Math.round(oh);
  } else if (
    canvas &&
    canvas.width &&
    canvas.height &&
    (screenWidth > screenHeight) !== (canvas.width > canvas.height)
  ) {
    // 真机基准校正：主画布后备存储由系统随窗口（转屏）自动同步，其物理宽高比
    // 比窗口 API 更可靠——真机转屏后 getWindowInfo 可能短暂报告旧方向尺寸
    // （开发工具转屏是瞬时的，不会复现），直接写入画布会导致半屏/拉伸。
    // 方向不一致时以画布为准交换宽高，安全区按 90° 几何关系同步换算。
    const w = screenWidth;
    screenWidth = screenHeight;
    screenHeight = w;
    const t = safeTop;
    safeTop = safeLeft;
    safeLeft = safeBottom;
    safeBottom = safeRight;
    safeRight = t;
  }

  return { screenWidth, screenHeight, pixelRatio, safeTop, safeBottom, safeLeft, safeRight };
}

/**
 * 把画布后备存储同步到指定逻辑尺寸（× 像素比）。
 * 部分真机在转屏窗口未就绪时会把后备存储裁剪到旧窗口尺寸，之后画布一直停在
 * 错误尺寸（表现为半屏）；这里设完后逐帧校验重试若干次，确保最终生效。
 */
export function applyCanvasSize(
  canvas: { width: number; height: number },
  info: ScreenInfo,
): void {
  const W = Math.round(info.screenWidth * info.pixelRatio);
  const H = Math.round(info.screenHeight * info.pixelRatio);
  canvas.width = W;
  canvas.height = H;
  let tries = 10;
  const verify = () => {
    if (tries-- <= 0) return;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
      requestAnimationFrame(verify);
    }
  };
  requestAnimationFrame(verify);
}

/**
 * 等待系统完成转屏后再读取屏幕信息。
 * wx.setDeviceOrientation 是异步的，调用后立即读窗口尺寸拿到的往往还是
 * 旧方向的值（会导致布局拉伸、点击坐标错位）。这里轮询等待宽高发生交换，
 * 最多等 timeout 毫秒；期间若 API 报告了新的 onWindowResize 尺寸则优先采用。
 */
export function getScreenInfoAfterRotation(
  target: 'portrait' | 'landscape',
  canvas?: { width?: number; height?: number },
  timeout = 1200,
): Promise<ScreenInfo> {
  return new Promise((resolve) => {
    const matches = (info: ScreenInfo) =>
      target === 'landscape' ? info.screenWidth > info.screenHeight : info.screenWidth <= info.screenHeight;

    const initial = getScreenInfo(canvas);
    if (matches(initial)) {
      resolve(initial);
      return;
    }

    let latest: ScreenInfo | null = null;
    const onResize = (res: any) => {
      const w = res?.windowWidth ?? 0;
      const h = res?.windowHeight ?? 0;
      if (w > 0 && h > 0) {
        // 只取方向已符合目标的事件，避免拿转屏中间态。
        const ok = target === 'landscape' ? w > h : w <= h;
        if (ok) latest = getScreenInfo(canvas);
      }
    };
    try {
      wx.onWindowResize(onResize);
    } catch (_e) {
      /* 不支持则仅靠轮询 */
    }

    const start = Date.now();
    const timer = setInterval(() => {
      const fresh = latest ?? getScreenInfo(canvas);
      if (matches(fresh) || Date.now() - start >= timeout) {
        clearInterval(timer);
        try {
          wx.offWindowResize(onResize);
        } catch (_e) {
          /* 忽略 */
        }
        resolve(fresh);
      }
    }, 50);
  });
}