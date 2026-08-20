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
  /** 新版窗口信息接口（基础库 2.20.1+），比 getSystemInfoSync 更可靠。 */
  function getWindowInfo(): {
    windowWidth: number;
    windowHeight: number;
    screenWidth: number;
    screenHeight: number;
    pixelRatio: number;
    statusBarHeight: number;
    safeArea: {
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

  // 触感反馈（连选模式激活提示）
  function vibrateShort(options?: {
    type?: 'heavy' | 'medium' | 'light';
    success?: () => void;
    fail?: (err?: any) => void;
    complete?: () => void;
  }): void;

  // 提示 / 分享 / 启动参数
  function showToast(options: {
    title: string;
    icon?: 'success' | 'error' | 'loading' | 'none';
    duration?: number;
  }): void;
  function shareAppMessage(options: {
    title?: string;
    imageUrl?: string;
    query?: string;
    success?: () => void;
    fail?: (err?: any) => void;
  }): void;
  function getLaunchOptionsSync(): { scene: number; query: Record<string, string> };
  function onShow(callback: (res: { scene: number; query?: Record<string, string> }) => void): void;

  // 本地存储（断线重连：记忆上次房间号）
  function setStorageSync(key: string, data: any): void;
  function getStorageSync(key: string): any;
  function removeStorageSync(key: string): void;
  /** 小程序账号信息：envVersion 区分 develop（开发版）/ trial（体验版）/ release（正式版） */
  function getAccountInfoSync(): {
    miniProgram: { envVersion: 'develop' | 'trial' | 'release'; appId?: string };
  };

  // 音频（背景音乐 + 操作音效）
  interface InnerAudioContext {
    src: string;
    loop: boolean;
    volume: number;
    /** iOS：是否跟随系统静音键（游戏音效设 false，静音键开启时也发声）。 */
    obeyMuteSwitch: boolean;
    play(): void;
    pause(): void;
    stop(): void;
    seek(position: number): void;
    destroy(): void;
    onError(callback: (err?: any) => void): void;
  }
  function createInnerAudioContext(): InnerAudioContext;

  // 文件系统与下载（音频本地缓存）
  interface FileSystemManager {
    /** 同步判断文件是否存在（不存在时抛异常）。 */
    accessSync(path: string): void;
    saveFile(options: {
      tempFilePath: string;
      success?: (res: { savedFilePath: string }) => void;
      fail?: (err: any) => void;
    }): void;
  }
  function getFileSystemManager(): FileSystemManager;
  function downloadFile(options: {
    url: string;
    success?: (res: { tempFilePath: string; statusCode: number }) => void;
    fail?: (err: any) => void;
  }): void;

  // 微信云开发（最小集）
  interface CloudWatch {
    close: () => void;
  }
  interface CloudQuery {
    watch(options: {
      onChange: (snapshot: { docs: any[]; docChanges: any[] }) => void;
      onError: (err: any) => void;
    }): CloudWatch;
    limit(n: number): CloudQuery;
    get(options?: { success?: (res: any) => void; fail?: (err: any) => void }): void;
  }
  interface CloudCollection {
    where(query: Record<string, any>): CloudQuery;
  }
  interface CloudDatabase {
    collection(name: string): CloudCollection;
  }
  const cloud: {
    init(options?: { env?: string; traceUser?: boolean }): void;
    callFunction(options: {
      name: string;
      data?: Record<string, any>;
      success?: (res: { result: any }) => void;
      fail?: (err: any) => void;
      complete?: () => void;
    }): void;
    database(options?: { env?: string }): CloudDatabase;
    getTempFileURL(options: {
      fileList: string[];
      /** 显式指定文件所在云环境（跨环境换取时必传）。 */
      config?: { env: string };
      success?: (res: {
        fileList: Array<{ fileID: string; tempFileURL: string; status: number }>;
      }) => void;
      fail?: (err: any) => void;
    }): void;
  };
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
