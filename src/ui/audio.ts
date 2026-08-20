// ============================================================================
// src/ui/audio.ts — 音频管理器（背景音乐 + 操作音效）
// ----------------------------------------------------------------------------
// 音频托管在另一个小程序的付费云环境 COS（audio/ 目录），直接 HTTPS 链接播放：
// 小游戏免费云存储无法改文件权限，且 wx.cloud 不能跨账号环境换取 fileID，
// 故不走 getTempFileURL，直接拼链接给 InnerAudioContext。
//
// 设计要点：
//   - 全部 API 静默失败：音频任何异常都不允许影响游戏主流程
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

const MUTE_KEY = 'lami_sound_on';

class AudioManager {
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

  /** 启动入口：COS 直链无需换取，直接标记就绪（保留原调用时序）。 */
  init(): void {
    this.ready = true;
    // 就绪前若已请求过 BGM，此时补播。
    if (this.bgmWanted && !this.muted) this.playBgmInternal();
  }

  // --------------------------------------------------------------------------
  // 播放
  // --------------------------------------------------------------------------

  /** 播放一次性音效（静音或未就绪时忽略）。 */
  play(name: Exclude<SfxName, 'bgm'>): void {
    if (this.muted || !this.ready) return;
    const url = AUDIO_BASE + name + '.wav';
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
    const url = AUDIO_BASE + 'bgm.wav';
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
