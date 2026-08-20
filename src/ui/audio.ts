// ============================================================================
// src/ui/audio.ts — 音频管理器（背景音乐 + 操作音效）
// ----------------------------------------------------------------------------
// 音频托管在另一个小程序的付费云环境 COS（audio/ 目录），直接 HTTPS 链接播放：
// 小游戏免费云存储无法改文件权限，且 wx.cloud 不能跨账号环境换取 fileID，
// 故不走 getTempFileURL，直接拼链接给 InnerAudioContext。
//
// 设计要点：
//   - 全部 API 静默失败：音频任何异常都不允许影响游戏主流程
//   - 开局预缓存：首次启动下载到本地持久存储，之后秒播且可离线；
//     下载完成前先用远程直链兜底，不阻塞出声
//   - BGM 单实例循环播放；音效每个名字懒创建一个实例复用（seek 回零重播）
//   - 静音开关持久化到本地存储（lami_sound_on）
// ============================================================================

export type SfxName =
  | 'bgm'
  | 'deal'
  | 'draw'
  | 'pickup'
  | 'place'
  | 'sort'
  | 'submit'
  | 'error'
  | 'pass'
  | 'victory'
  | 'result';

/** COS 音频目录：目录前缀 + 文件名即完整播放链接（需对象设为公有读）。 */
const AUDIO_BASE =
  'https://636c-cloudbase-8ghks1chd7279bc6-1328430449.cos.ap-shanghai.myqcloud.com/audio/';

const SFX_FILES: SfxName[] = [
  'bgm', 'deal', 'draw', 'pickup', 'place', 'sort',
  'submit', 'error', 'pass', 'victory', 'result',
];

/** 本地缓存索引（名称 → savedFilePath）的存储键。 */
const CACHE_KEY = 'lami_audio_cache';

const MUTE_KEY = 'lami_sound_on';

class AudioManager {
  /** 名称 → 当前播放源（先用远程直链，缓存就绪后逐个替换为本地路径）。 */
  private urls = new Map<SfxName, string>();
  /** 名称 → 复用的播放实例（懒创建）。 */
  private contexts = new Map<SfxName, any>();
  /** 链接是否就绪（COS 直链，init 后即就绪）。 */
  private ready = false;
  private muted = false;
  /** BGM 是否已启动过（解除静音时用于恢复）。 */
  private bgmWanted = false;

  constructor() {
    try {
      this.muted = wx.getStorageSync(MUTE_KEY) === false;
    } catch (e) {
      this.muted = false;
    }
  }

  /** 启动入口：先用远程直链兜底并标记就绪，再异步预热本地缓存。 */
  init(): void {
    for (const n of SFX_FILES) this.urls.set(n, AUDIO_BASE + n + '.wav');
    this.ready = true;
    this.loadCache();
    // 就绪前若已请求过 BGM，此时补播。
    if (this.bgmWanted && !this.muted) this.playBgmInternal();
  }

  // --------------------------------------------------------------------------
  // 本地缓存（开局预热）
  // --------------------------------------------------------------------------

  /** 命中本地缓存直接用；未命中的逐个下载落盘，失败继续用远程链接。 */
  private loadCache(): void {
    let cached: Partial<Record<SfxName, string>> = {};
    try {
      cached = wx.getStorageSync(CACHE_KEY) || {};
    } catch (e) {
      cached = {};
    }
    let fs: any;
    try {
      fs = wx.getFileSystemManager();
    } catch (e) {
      return; // 文件系统不可用：全程远程链接
    }
    let hit = 0;
    for (const n of SFX_FILES) {
      const p = cached[n];
      if (p && this.fileExists(fs, p)) {
        this.urls.set(n, p);
        hit++;
      } else {
        this.downloadAndSave(n);
      }
    }
    if (hit < SFX_FILES.length) {
      console.log(`[audio] 本地缓存 ${hit}/${SFX_FILES.length}，后台下载 ${SFX_FILES.length - hit} 个`);
    }
  }

  private fileExists(fs: any, path: string): boolean {
    try {
      fs.accessSync(path);
      return true;
    } catch (e) {
      return false;
    }
  }

  private downloadAndSave(name: SfxName): void {
    wx.downloadFile({
      url: AUDIO_BASE + name + '.wav',
      success: (res) => {
        if (res.statusCode !== 200) {
          console.warn(`[audio] 下载 ${name} 失败: HTTP ${res.statusCode}`);
          return;
        }
        try {
          wx.getFileSystemManager().saveFile({
            tempFilePath: res.tempFilePath,
            success: (r) => {
              this.urls.set(name, r.savedFilePath);
              this.persistCache(name, r.savedFilePath);
            },
            fail: (err) => console.warn(`[audio] 保存 ${name} 失败:`, err),
          });
        } catch (e) {
          /* 保持远程链接 */
        }
      },
      fail: () => {
        /* 保持远程链接，不影响播放 */
      },
    });
  }

  private persistCache(name: SfxName, path: string): void {
    try {
      const cached = wx.getStorageSync(CACHE_KEY) || {};
      cached[name] = path;
      wx.setStorageSync(CACHE_KEY, cached);
    } catch (e) {
      /* 静默：下次启动重新下载即可 */
    }
  }

  // --------------------------------------------------------------------------
  // 播放
  // --------------------------------------------------------------------------

  /** 播放一次性音效（静音或未就绪时忽略）。 */
  play(name: Exclude<SfxName, 'bgm'>): void {
    if (this.muted || !this.ready) return;
    const url = this.urls.get(name);
    if (!url) return;
    try {
      let ctx = this.contexts.get(name);
      if (!ctx) {
        ctx = this.createContext(url);
        this.contexts.set(name, ctx);
      }
      ctx.stop();
      ctx.seek(0);
      ctx.play();
    } catch (e) {
      console.warn(`[audio] 播放 ${name} 异常:`, e);
    }
  }

  /** 创建播放实例：不跟随系统静音键（游戏音效应始终可闻），并挂错误日志。 */
  private createContext(url: string): any {
    const ctx = wx.createInnerAudioContext();
    ctx.src = url;
    ctx.obeyMuteSwitch = false;
    if (typeof ctx.onError === 'function') {
      ctx.onError((err: any) => {
        console.warn('[audio] 播放错误:', ctx.src, err);
      });
    }
    return ctx;
  }

  /** 启动背景音乐（循环）。通常在用户首次交互后调用。 */
  startBgm(): void {
    this.bgmWanted = true;
    if (!this.muted) this.playBgmInternal();
  }

  private playBgmInternal(): void {
    const url = this.urls.get('bgm');
    if (!url) return;
    try {
      let ctx = this.contexts.get('bgm');
      if (!ctx) {
        ctx = this.createContext(url);
        ctx.loop = true;
        ctx.volume = 0.55;
        this.contexts.set('bgm', ctx);
      }
      ctx.play();
    } catch (e) {
      console.warn('[audio] BGM 播放异常:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 静音开关（持久化）
  // --------------------------------------------------------------------------

  isMuted(): boolean {
    return this.muted;
  }

  /** 切换静音；返回切换后的静音状态。 */
  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      wx.setStorageSync(MUTE_KEY, !this.muted);
    } catch (e) {
      /* 静默 */
    }
    if (this.muted) {
      for (const ctx of this.contexts.values()) {
        try { ctx.stop(); } catch (e) { /* 静默 */ }
      }
    } else if (this.bgmWanted) {
      this.playBgmInternal();
    }
    return this.muted;
  }
}

/** 全局单例。 */
export const audio = new AudioManager();
