// ============================================================================
// 云函数 lami-room — 拉密房间服务（微信云开发）
// ----------------------------------------------------------------------------
// 单函数多 action 设计，客户端通过 event.action 分发：
//   create — 创建房间（2/3/4 人），房主自动成为第一个玩家
//   join   — 通过房号加入房间（分享链接进入时调用）
//   get    — 查询房间最新状态（客户端轮询用）
//   start  — 房主在人齐后开始游戏
// 数据集合：lami_rooms（以 5 位房号作为文档 _id）
// ============================================================================

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = db.collection('lami_rooms');

/** 房号字符集：去掉易混淆的 0/O/1/I */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;

function genCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

function ok(data) {
  return Object.assign({ ok: true }, data);
}

function fail(message) {
  return { ok: false, message };
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

async function getRoomDoc(code) {
  try {
    const snap = await COL.doc(code).get();
    return snap && snap.data ? snap.data : null;
  } catch (e) {
    return null;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    switch (action) {
      // 创建房间：房主自动入座
      case 'create': {
        const capacity = Math.min(4, Math.max(2, Number(event.capacity) || 4));
        const name = String(event.name || '玩家');
        const self = { openid: OPENID, name };

        // 房号冲突时重试
        for (let i = 0; i < 5; i++) {
          const code = genCode();
          const room = {
            code,
            host: OPENID,
            capacity,
            players: [self],
            status: 'waiting',
            createdAt: Date.now(),
          };
          try {
            await COL.doc(code).set({ data: room });
            return ok({ room, self: OPENID });
          } catch (e) {
            // _id 已存在，换一个房号重试
          }
        }
        return fail('创建房间失败，请重试');
      }

      // 加入房间：已在房内视为重进；已满/已开局则拒绝。
      // 断线重连：对局进行中/已结束时，房内玩家可重新进入继续对局，陌生人不可中途加入。
      case 'join': {
        const code = normalizeCode(event.code);
        const name = String(event.name || '玩家');
        const room = await getRoomDoc(code);
        if (!room) return fail('房间不存在，请检查房号');
        const isMember = room.players.some((p) => p.openid === OPENID);

        if (room.status !== 'waiting') {
          if (isMember) return ok({ room, self: OPENID });
          return fail(room.status === 'finished' ? '该房间对局已结束' : '该房间已开始游戏');
        }

        if (isMember) {
          return ok({ room, self: OPENID });
        }
        if (room.players.length >= room.capacity) return fail('房间已满员');

        const player = { openid: OPENID, name };
        await COL.doc(code).update({
          data: { players: db.command.push([player]) },
        });
        room.players.push(player);
        return ok({ room, self: OPENID });
      }

      // 查询房间状态（客户端轮询）
      case 'get': {
        const code = normalizeCode(event.code);
        const room = await getRoomDoc(code);
        if (!room) return fail('房间不存在');
        return ok({ room, self: OPENID });
      }

      // 开始游戏：仅房主、仅人齐时可开始
      case 'start': {
        const code = normalizeCode(event.code);
        const room = await getRoomDoc(code);
        if (!room) return fail('房间不存在');
        if (room.host !== OPENID) return fail('只有房主可以开始游戏');
        if (room.status === 'started') return ok({ room, self: OPENID });
        if (room.players.length < room.capacity) {
          return fail(`玩家未到齐（${room.players.length}/${room.capacity}），还不能开始`);
        }
        await COL.doc(code).update({
          data: {
            status: 'started',
            startedAt: Date.now(),
            // 预先写入座位映射：lami-game 开局/校验依赖它，且可避免并发开局竞态。
            game: {
              playersOpenid: room.players.map((p) => p.openid),
              version: 0,
            },
          },
        });
        room.status = 'started';
        return ok({ room, self: OPENID });
      }

      default:
        return fail('未知操作');
    }
  } catch (e) {
    return fail('服务繁忙，请稍后再试');
  }
};
