// ============================================================================
// wx.d.ts — 微信小游戏全局类型声明 (最小集)
// ============================================================================

declare namespace wx {
  function createCanvas(): HTMLCanvasElement;
  function createImage(): any;
  function getSystemInfoSync(): {
    windowWidth: number;
    windowHeight: number;
    screenWidth: number;
    screenHeight: number;
    pixelRatio: number;
    platform: string;
    statusBarHeight?: number;
    safeArea?: {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    };
  };
  function onTouchStart(callback: (res: { touches: Touch[] }) => void): void;
  function onTouchMove(callback: (res: { touches: Touch[] }) => void): void;
  function onTouchEnd(callback: (res: { changedTouches: Touch[] }) => void): void;
  function onTouchCancel(callback: (res: { changedTouches: Touch[] }) => void): void;
  function offTouchStart(callback: Function): void;
  function offTouchMove(callback: Function): void;
  function offTouchEnd(callback: Function): void;
  function offTouchCancel(callback: Function): void;
  function setDeviceOrientation(options: {
    value: 'landscape' | 'portrait';
    success?: (res?: any) => void;
    fail?: (res?: any) => void;
    complete?: (res?: any) => void;
  }): void;
  function onWindowResize(callback: (res: { windowWidth: number; windowHeight: number }) => void): void;
  function offWindowResize(callback: Function): void;
  // 注意：requestAnimationFrame / cancelAnimationFrame 是微信小游戏的「全局函数」，
  // 不是 wx 命名空间下的方法，因此不要在这里声明为 wx.requestAnimationFrame。

  interface Touch {
    identifier: number;
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
  }
}
