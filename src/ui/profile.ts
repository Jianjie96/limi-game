// ============================================================================
// src/ui/profile.ts — 个人资料与偏好设置（个人中心页的数据层）
// ----------------------------------------------------------------------------
// 昵称、头像（微信头像 / 拍照 / 相册图片 / 元素色兜底）以云端为唯一权威数据源
// （lami_profiles 集合，见 src/cloud/profile.ts）：所有修改云端先行，
// 写入成功才落本地缓存，失败明确提示且不应用变更；本地 storage
// 仅作读取/展示缓存，不再有独立的本地状态。
// 震动反馈、屏幕方向偏好仅本地。音频开关由 audio.ts 自行持久化。
// 历史战绩已落库云端（lami_history），见 src/cloud/game.ts fetchMatchHistory。
// ============================================================================

import { AVATAR_COLORS, FONT_FAMILY } from './constants';
import {
  fetchCloudProfile,
  saveCloudProfile,
  uploadAvatarFile,
  type CloudProfileResult,
} from '../cloud/profile';

const NICK_KEY = 'lami_nickname';
const AVATAR_KEY = 'lami_avatar_index';
/** 自定义头像的永久化本地路径（saveFile 产物）；为空时用元素色兜底。 */
const AVATAR_PATH_KEY = 'lami_avatar_path';
/** 本地头像图片对应的云存储 fileID（与云端档案对比，避免重复下载）。 */
const AVATAR_FILEID_KEY = 'lami_avatar_fileid';
/** 首次启动的资料设置引导弹框只弹一次。 */
const PROFILE_PROMPT_KEY = 'lami_profile_prompted';
const VIBRATE_KEY = 'lami_vibrate_on';
const ORIENTATION_KEY = 'lami_orientation';

export type OrientationPref = 'portrait' | 'landscape';

// ----------------------------------------------------------------------------
// 昵称
// ----------------------------------------------------------------------------

/** 读取昵称；首次使用时生成随机代号并持久化。 */
export function getNickname(): string {
  try {
    const v = wx.getStorageSync(NICK_KEY);
    if (typeof v === 'string' && v.trim()) return v;
  } catch (e) {
    // 落到默认值
  }
  const name = `旅行者${Math.floor(Math.random() * 900) + 100}`;
  setNickname(name);
  return name;
}

/** 保存昵称（去空白、限 12 字）；空昵称返回 false。 */
export function setNickname(name: string): boolean {
  const v = name.trim().slice(0, 12);
  if (!v) return false;
  try {
    wx.setStorageSync(NICK_KEY, v);
  } catch (e) {
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// 头像（元素色圆片 + 昵称末字，与房间页头像同一视觉语言）
// ----------------------------------------------------------------------------

/** 头像色在 AVATAR_COLORS 中的下标：未设置时按昵称派生自动取一个（已无手动选色入口）。 */
export function getAvatarIndex(): number {
  try {
    const v = wx.getStorageSync(AVATAR_KEY);
    if (typeof v === 'number' && v >= 0 && v < AVATAR_COLORS.length) return v;
  } catch (e) {
    // 落到默认值
  }
  return getNickname().charCodeAt(0) % AVATAR_COLORS.length;
}

export function getAvatarColor(): string {
  return AVATAR_COLORS[getAvatarIndex() % AVATAR_COLORS.length];
}

// ----------------------------------------------------------------------------
// 自定义头像（微信头像/拍照/相册三选一，支持随时重选）
// ----------------------------------------------------------------------------

/** 读取自定义头像的永久化本地路径；文件丢失时自动清理并返回 null。 */
export function getAvatarPath(): string | null {
  let path = '';
  try {
    const v = wx.getStorageSync(AVATAR_PATH_KEY);
    if (typeof v === 'string' && v) path = v;
  } catch (e) {
    return null;
  }
  if (!path) return null;
  try {
    wx.getFileSystemManager().accessSync(path);
    return path;
  } catch (e) {
    // 文件已失效（清缓存等）：清掉记录，回到色片兜底
    try {
      wx.removeStorageSync(AVATAR_PATH_KEY);
    } catch (e2) {
      // 静默
    }
    return null;
  }
}

function setAvatarPath(path: string | null): void {
  try {
    if (path) wx.setStorageSync(AVATAR_PATH_KEY, path);
    else wx.removeStorageSync(AVATAR_PATH_KEY);
  } catch (e) {
    // 静默
  }
}

/** 选头像结果：tempPath 为选中后持久化的临时路径（尚未启用，
 *  待云端保存成功后由 saveAvatarImageToCloud 生效）；
 *  errorMsg 仅非用户取消的失败才有值。 */
export interface ChooseAvatarResult {
  tempPath?: string;
  errorMsg?: string;
}

/**
 * 头像来源三选一（原生操作菜单）：微信头像 / 拍照 / 从相册选择。
 * 选中后仅返回临时路径（不启用），由调用方先写云端、成功后再生效。
 * 用户取消静默（tempPath/errorMsg 均空）；接口被拒（隐私未授权等）
 * 时返回原始 errMsg，由调用方给出可操作的提示。
 * 拍照/相册分支：隐私授权被拒后不会自动重弹，主动调 requirePrivacyAuthorize
 * 重新拉起授权弹窗并自动重试一次，用户同意后无需再点一次头像。
 */
export function chooseAvatarFromWeChat(): Promise<ChooseAvatarResult> {
  return new Promise<ChooseAvatarResult>((resolve) => {
    if (typeof wx.showActionSheet !== 'function') {
      // 无操作菜单的环境退回旧行为：相册/拍照合并选择器。
      resolve(chooseMediaWithPrivacyRetry(['album', 'camera']));
      return;
    }
    wx.showActionSheet({
      itemList: ['微信头像', '拍照', '从相册选择'],
      success: (res) => {
        if (res.tapIndex === 0) resolve(chooseWeChatAvatar());
        else if (res.tapIndex === 1) resolve(chooseMediaWithPrivacyRetry(['camera']));
        else resolve(chooseMediaWithPrivacyRetry(['album']));
      },
      fail: () => resolve({}), // 取消菜单：静默
    });
  });
}

/** 拍照/相册分支：隐私被拒后重新拉授权弹窗并自动重试一次。 */
function chooseMediaWithPrivacyRetry(sourceType: string[]): Promise<ChooseAvatarResult> {
  return chooseMediaOnce(sourceType).then((result) => {
    const msg = result.errorMsg || '';
    // 仅「用户拒绝过隐私授权」分支可恢复：重新拉起隐私授权弹窗。
    if (!/privacy/i.test(msg) || typeof wx.requirePrivacyAuthorize !== 'function') {
      return result;
    }
    return new Promise<ChooseAvatarResult>((resolve) => {
      try {
        wx.requirePrivacyAuthorize({
          success: () => resolve(chooseMediaOnce(sourceType)),
          fail: () => resolve(result), // 低版本不支持或仍被拒：原样透出提示
        });
      } catch (e) {
        resolve(result);
      }
    });
  });
}

/**
 * 微信头像分支：小游戏无 WXML，用 wx.createUserInfoButton 在屏幕中央创建
 * 原生授权按钮，用户点击后授权并回调头像 URL，再 downloadFile 落为本地临时文件。
 * 返回契约与其余分支一致：成功给 tempPath；取消/拒绝授权静默；接口异常透出 errMsg。
 */
function chooseWeChatAvatar(): Promise<ChooseAvatarResult> {
  return new Promise((resolve) => {
    if (typeof wx.createUserInfoButton !== 'function') {
      resolve({ errorMsg: '当前环境不支持获取微信头像，请用拍照或相册' });
      return;
    }
    let btn: { onTap(cb: any): void; destroy(): void } | null = null;
    try {
      const win = wx.getWindowInfo();
      const bw = Math.min(220, win.windowWidth - 60);
      const bh = 48;
      btn = wx.createUserInfoButton({
        type: 'text',
        text: '点击授权并使用微信头像',
        style: {
          left: (win.windowWidth - bw) / 2,
          top: win.windowHeight * 0.42,
          width: bw,
          height: bh,
          lineHeight: bh,
          fontSize: 16,
          backgroundColor: '#e9c97f',
          color: '#20303c',
          borderRadius: bh / 2,
          textAlign: 'center',
        },
      });
    } catch (e) {
      resolve({ errorMsg: '微信头像按钮创建失败，请重试' });
      return;
    }
    const button = btn;
    button.onTap((res: { errMsg: string; userInfo?: { avatarUrl?: string } }) => {
      try { button.destroy(); } catch (e) { /* 静默 */ }
      const avatarUrl = res.userInfo && res.userInfo.avatarUrl;
      if (res.errMsg && res.errMsg.indexOf(':ok') >= 0 && avatarUrl) {
        wx.downloadFile({
          url: avatarUrl,
          success: (dl) => resolve({ tempPath: dl.tempFilePath }),
          fail: (err) => resolve({ errorMsg: (err && err.errMsg) || '微信头像下载失败，请重试' }),
        });
        return;
      }
      // 用户取消/拒绝授权静默；隐私等异常透出原始 errMsg 供调用方提示。
      const msg = (res && res.errMsg) || '';
      if (/privacy|auth\s*deny|cancel/i.test(msg) || !msg) resolve({});
      else resolve({ errorMsg: msg });
    });
  });
}

function chooseMediaOnce(sourceType: string[]): Promise<ChooseAvatarResult> {
  return new Promise((resolve) => {
    if (typeof wx.chooseMedia !== 'function') {
      resolve({ errorMsg: '当前环境不支持选择头像' });
      return;
    }
    try {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType,
        sizeType: ['compressed'],
        success: (res) => {
          const temp = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
          if (!temp) {
            resolve({});
            return;
          }
          try {
            wx.getFileSystemManager().saveFile({
              tempFilePath: temp,
              success: (r) => resolve({ tempPath: r.savedFilePath }),
              fail: () => resolve({ errorMsg: '头像文件保存失败，请重试' }),
            });
          } catch (e) {
            resolve({ errorMsg: '头像文件保存失败，请重试' });
          }
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          // 用户主动取消保持静默；其余（隐私未声明/相册未授权）透出给调用方提示。
          if (msg.includes('cancel')) {
            resolve({});
          } else {
            resolve({ errorMsg: msg || '相册拉起失败' });
          }
        },
      });
    } catch (e) {
      resolve({ errorMsg: '相册拉起失败' });
    }
  });
}

/** 恢复默认头像（清除自定义图片，回到元素色圆片）。 */
export function resetAvatar(): void {
  const path = getAvatarPath();
  setAvatarPath(null);
  setAvatarFileId(''); // 与云端「已恢复默认」状态对齐
  if (path) unlinkQuiet(path);
}

// ----------------------------------------------------------------------------
// 云端同步（云端为唯一权威源：写云端成功才落本地缓存，失败不应用变更）
// ----------------------------------------------------------------------------

function getAvatarFileId(): string {
  try {
    const v = wx.getStorageSync(AVATAR_FILEID_KEY);
    return typeof v === 'string' ? v : '';
  } catch (e) {
    return '';
  }
}

function setAvatarFileId(id: string): void {
  try {
    if (id) wx.setStorageSync(AVATAR_FILEID_KEY, id);
    else wx.removeStorageSync(AVATAR_FILEID_KEY);
  } catch (e) {
    // 静默
  }
}

/** 静默删除本地文件（清旧头像/作废临时文件用）。 */
function unlinkQuiet(path: string): void {
  try {
    (wx.getFileSystemManager() as any).unlink?.({ filePath: path, fail: () => undefined });
  } catch (e) {
    // 静默
  }
}

/**
 * 保存昵称（云端先行）：写云端成功才更新本地缓存并返回 true；
 * 失败返回 false，本地保持原值，由调用方提示用户。
 */
export function saveNicknameToCloud(name: string): Promise<boolean> {
  const v = name.trim().slice(0, 12);
  if (!v) return Promise.resolve(false);
  return saveCloudProfile({ name: v })
    .then(() => {
      setNickname(v);
      return true;
    })
    .catch(() => false);
}

/**
 * 保存自定义头像图片（云端先行）：先 uploadFile 拿 fileID，再写档案；
 * 成功后本地启用新图并删除旧图；失败删除临时文件并返回错误信息，
 * 由调用方提示用户（本地头像保持不变）。
 */
export function saveAvatarImageToCloud(tempPath: string): Promise<{ ok: boolean; errorMsg?: string }> {
  return uploadAvatarFile(tempPath)
    .then((fileId) =>
      saveCloudProfile({ avatarFileId: fileId }).then(() => {
        const old = getAvatarPath();
        setAvatarPath(tempPath);
        setAvatarFileId(fileId);
        if (old && old !== tempPath) unlinkQuiet(old);
        return { ok: true };
      }),
    )
    .catch((e: any) => {
      unlinkQuiet(tempPath);
      return { ok: false, errorMsg: (e && e.message) || '头像保存失败，请重试' };
    });
}

/**
 * 启动时用云端档案覆盖本地（云端是权威源）：
 * 昵称/头像底色直接写入；头像图片按 fileID 比对，不同则下载替换。
 * 档案为 null（从未设置）时不动本地，由调用方引导授权。
 */
export function applyCloudProfile(result: CloudProfileResult): void {
  const p = result.profile;
  if (!p) return;
  if (typeof p.name === 'string' && p.name.trim()) {
    try {
      wx.setStorageSync(NICK_KEY, p.name.trim().slice(0, 12));
    } catch (e) {
      // 静默
    }
  }
  if (typeof p.avatarIndex === 'number' && p.avatarIndex >= 0 && p.avatarIndex < AVATAR_COLORS.length) {
    try {
      wx.setStorageSync(AVATAR_KEY, p.avatarIndex);
    } catch (e) {
      // 静默
    }
  }
  const cloudFileId = p.avatarFileId || '';
  const localFileId = getAvatarFileId();
  if (cloudFileId === localFileId && (cloudFileId === '') === !getAvatarPath()) return;
  if (!cloudFileId) {
    // 其他设备已恢复默认头像：本地同步清除。
    resetAvatar();
    return;
  }
  if (!result.avatarTempUrl) return; // 临时链接换取失败：下次启动再试
  wx.downloadFile({
    url: result.avatarTempUrl,
    success: (res) => {
      if (res.statusCode !== 200) return;
      try {
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFilePath,
          success: (r) => {
            setAvatarPath(r.savedFilePath);
            setAvatarFileId(cloudFileId);
          },
          fail: () => undefined,
        });
      } catch (e) {
        // 静默：下次启动重试
      }
    },
    fail: () => undefined,
  });
}

/** 拉取云端档案（供启动流程：覆盖本地 + 判断是否需要引导授权）。 */
export function loadCloudProfile(): Promise<CloudProfileResult> {
  return fetchCloudProfile();
}

// ----------------------------------------------------------------------------
// 首次启动资料设置引导（微信已不提供头像昵称授权接口，改为引导自助设置）
// ----------------------------------------------------------------------------

export function hasPromptedProfileSetup(): boolean {
  try {
    return wx.getStorageSync(PROFILE_PROMPT_KEY) === true;
  } catch (e) {
    return true; // 存储异常时不弹，避免反复打扰
  }
}

export function markProfileSetupPrompted(): void {
  try {
    wx.setStorageSync(PROFILE_PROMPT_KEY, true);
  } catch (e) {
    // 静默
  }
}

// ----------------------------------------------------------------------------
// 头像 Image 加载缓存（Canvas 绘制用）
// ----------------------------------------------------------------------------

let avatarImgCache: { path: string; img: any; ready: boolean } | null = null;
const avatarImgListeners = new Set<() => void>();

/**
 * 获取自定义头像的 Image 对象；未设置/未加载完返回 null。
 * 加载完成时回调所有等待方（用于触发重绘）。
 */
export function getAvatarImage(onReady?: () => void): any | null {
  const path = getAvatarPath();
  if (!path) return null;
  if (!avatarImgCache || avatarImgCache.path !== path) {
    const img = wx.createImage();
    const entry = { path, img, ready: false };
    avatarImgCache = entry;
    img.onload = () => {
      entry.ready = true;
      for (const cb of [...avatarImgListeners]) cb();
      avatarImgListeners.clear();
    };
    img.onerror = () => {
      if (avatarImgCache === entry) avatarImgCache = null;
    };
    img.src = path;
  }
  if (avatarImgCache.ready) return avatarImgCache.img;
  if (onReady) avatarImgListeners.add(onReady);
  return null;
}

/**
 * 绘制圆形头像：优先微信自定义图片（cover 裁切），
 * 未设置/未加载完时用元素色圆片 + 昵称末字兜底。
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  onImageReady?: () => void,
): void {
  const ringW = r >= 24 ? 2 : 1.5;
  const img = getAvatarImage(onImageReady);
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const iw = img.width || 1;
    const ih = img.height || 1;
    const s = Math.max((r * 2) / iw, (r * 2) / ih);
    ctx.drawImage(img, cx - (iw * s) / 2, cy - (ih * s) / 2, iw * s, ih * s);
    ctx.restore();
  } else {
    const name = getNickname();
    ctx.fillStyle = getAvatarColor();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.font = `bold ${Math.round(r * 0.8)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(name.charAt(name.length - 1), cx, cy + 1);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = ringW;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// ----------------------------------------------------------------------------
// 震动反馈
// ----------------------------------------------------------------------------

export function isVibrateEnabled(): boolean {
  try {
    return wx.getStorageSync(VIBRATE_KEY) !== false; // 默认开
  } catch (e) {
    return true;
  }
}

export function setVibrateEnabled(on: boolean): void {
  try {
    wx.setStorageSync(VIBRATE_KEY, on);
  } catch (e) {
    // 静默
  }
}

/** 按设置触发短震动；关闭或 API 不可用时静默忽略。 */
export function vibrateIfEnabled(): void {
  if (!isVibrateEnabled()) return;
  try {
    wx.vibrateShort({});
  } catch (e) {
    // 不支持则忽略
  }
}

// ----------------------------------------------------------------------------
// 屏幕方向偏好
// ----------------------------------------------------------------------------

export function getPreferredOrientation(): OrientationPref {
  try {
    return wx.getStorageSync(ORIENTATION_KEY) === 'landscape' ? 'landscape' : 'portrait';
  } catch (e) {
    return 'portrait';
  }
}

export function setPreferredOrientation(pref: OrientationPref): void {
  try {
    wx.setStorageSync(ORIENTATION_KEY, pref);
  } catch (e) {
    // 静默
  }
}
