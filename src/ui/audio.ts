// ============================================================================
// src/ui/audio.ts — 音频管理器（背景音乐 + 操作音效）
// ----------------------------------------------------------------------------
// 音频资源存放在微信云开发存储（audio/ 目录），启动时通过
// getTempFileURL 批量换取临时链接并缓存，播放走 InnerAudioContext。
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

/** 云开发存储中的音频目录（fileID 前缀 + 文件名即完整 fileID）。 */
const CLOUD_AUDIO_PREFIX =
  'cloud://cloud1-d1gkc2ovn71b7d2e3.636c-cloud1-d1gkc2ovn71b7d2e3-1470908906/audio/';

const SFX_FILES: SfxName[] = [
  'bgm', 'deal', 'draw', 'pickup', 'place', 'sort',
  'submit', 'error', 'pass', 'victory', 'result',
];

const MUTE_KEY = 'lami_sound_on';

class AudioManager {
  /** 名称 → 临时播放链接（getTempFileURL 换取）。 */
  private urls = new Map<SfxName, string>();
  /** 名称 → 复用的播放实例（懒创建）。 */
  private contexts = new Map<SfxName, any>();
  /** 临时链接是否已就绪。 */
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

  /** 启动时调用：批量换取全部音频的临时链接（失败静默）。 */
  init(): void {
    try {
      const fileList = SFX_FILES.map((n) => CLOUD_AUDIO_PREFIX + n + '.wav');
      wx.cloud.getTempFileURL({
        fileList,
        success: (res) => {
          for (const item of res.fileList || []) {
            if (!item.tempFileURL || item.status !== 0) continue;
            const name = this.nameOfFileID(item.fileID);
            if (name) this.urls.set(name, item.tempFileURL);
          }
          this.ready = true;
          // 换取完成前若已请求过 BGM，此时补播。
          if (this.bgmWanted && !this.muted) this.playBgmInternal();
        },
        fail: () => {
          /* 静默：无音频不影响游戏 */
        },
      });
    } catch (e) {
      /* 静默 */
    }
  }

  // --------------------------------------------------------------------------
  // 播放
  // --------------------------------------------------------------------------

  /** 播放一次性音效（静音或链接未就绪时忽略）。 */
  play(name: Exclude<SfxName, 'bgm'>): void {
    if (this.muted || !this.ready) return;
    const url = this.urls.get(name);
    if (!url) return;
    try {
      let ctx = this.contexts.get(name);
      if (!ctx) {
        ctx = wx.createInnerAudioContext();
        ctx.src = url;
        ctx.volume = 1;
        this.contexts.set(name, ctx);
      }
      ctx.stop();
      ctx.seek(0);
      ctx.play();
    } catch (e) {
      /* 静默 */
    }
  }

  /** 启动背景音乐（循环）。通常在用户首次交互后调用。 */
  startBgm(): void {
    this.bgmWanted = true;
    if (!this.muted) this.playBgmInternal();
  }

  private playBgmInternal(): void {
    const url = this.urls.get('bgm');
    if (!url) return; // 链接未就绪：init 成功回调里会重试
    try {
      let ctx = this.contexts.get('bgm');
      if (!ctx) {
        ctx = wx.createInnerAudioContext();
        ctx.src = url;
        ctx.loop = true;
        ctx.volume = 0.55;
        this.contexts.set('bgm', ctx);
      }
      ctx.play();
    } catch (e) {
      /* 静默 */
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

  private nameOfFileID(fileID: string): SfxName | null {
    for (const n of SFX_FILES) {
      if (fileID.endsWith('/' + n + '.wav')) return n;
    }
    return null;
  }
}

/** 全局单例。 */
export const audio = new AudioManager();
