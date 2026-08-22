// ============================================================================
// src/cloud/profile.ts — 微信云开发客户端封装（玩家资料服务）
// ----------------------------------------------------------------------------
// 对接云函数 lami-room 的 profileGet / profileSet：昵称与头像落库云端
// （lami_profiles，以 openid 为 _id），跨设备同步；自定义头像图片本体
// 由 wx.cloud.uploadFile 上传到云存储，档案里只存 fileID。
// ============================================================================

const ROOM_FUNCTION = 'lami-room';

export interface CloudProfile {
  name?: string;
  avatarIndex?: number;
  /** 云存储 fileID；空串/缺省 = 元素色默认头像。 */
  avatarFileId?: string;
  updatedAt?: number;
}

export interface CloudProfileResult {
  /** 云端档案；从未设置过资料时为 null（客户端据此引导授权）。 */
  profile: CloudProfile | null;
  /** 头像 fileID 换来的临时下载链接；无头像或换取失败时为空串。 */
  avatarTempUrl?: string;
  self: string;
}

function callProfile<T extends { ok: boolean }>(
  action: string,
  data: Record<string, any> = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: ROOM_FUNCTION,
      data: { action, ...data },
      success: (res) => {
        const result = res.result;
        if (result && result.ok) {
          resolve(result as T);
        } else {
          reject(new Error((result && result.message) || '请求失败'));
        }
      },
      fail: (err) => {
        reject(new Error((err && err.errMsg) || '网络异常，请检查网络后重试'));
      },
    });
  });
}

/** 读取本人云端档案（首次使用返回 profile: null）。 */
export function fetchCloudProfile(): Promise<CloudProfileResult> {
  return callProfile<CloudProfileResult & { ok: boolean }>('profileGet');
}

/** 保存本人档案（幂等 upsert；仅更新传入的字段）。 */
export function saveCloudProfile(patch: {
  name?: string;
  avatarIndex?: number;
  /** 传空串表示恢复默认头像。 */
  avatarFileId?: string;
}): Promise<void> {
  return callProfile<{ ok: boolean }>('profileSet', patch).then(() => undefined);
}

/**
 * 上传头像图片到云存储，返回 fileID。
 * cloudPath 带 openid 前缀避免冲突；同名覆盖上传（同路径直接替换）。
 */
export function uploadAvatarFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = filePath.split('.').pop() || 'jpg';
    const cloudPath = `avatars/${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        if (res.fileID) resolve(res.fileID);
        else reject(new Error('头像上传失败'));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '头像上传失败')),
    });
  });
}
