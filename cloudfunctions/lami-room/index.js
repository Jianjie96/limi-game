// ============================================================================
// 云函数 lami-room — 拉密房间服务（微信云开发）
// ----------------------------------------------------------------------------
// 单函数多 action 设计，客户端通过 event.action 分发：
//   create  — 创建房间（2/3/4 人），房主自动成为第一个玩家
//   join    — 通过房号加入房间（分享链接进入时调用）
//   get     — 查询房间最新状态（客户端轮询用）
//   start   — 房主在人齐后开始游戏
//   addBot  — 房主逐个添加机器人补位（真人+机器人混战）
//   leave   — 非房主在等待中退出房间（移出座位，避免幽灵座占位）
//   disband — 房主解散等待中的房间（删除文档）
//   myRoom  — 查询本人进行中的房间（断线重连的云端兼容，本地缓存被清也可恢复）
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

      // 房主逐个添加机器人（仅等待中且未满员）：真人+机器人混战，凑满即可开局。
      // openid 以 bot_ 开头，lami-game 的 advanceBots 据此识别并代打。
      case 'addBot': {
        const code = normalizeCode(event.code);
        const room = await getRoomDoc(code);
        if (!room) return fail('房间不存在');
        if (room.host !== OPENID) return fail('只有房主可以添加机器人');
        if (room.status !== 'waiting') return fail('房间不在等待状态');
        if (room.players.length >= room.capacity) return fail('房间已满员');
        const i = room.players.length;
        const bot = { openid: `bot_${code}_${i}`, name: `机器人${i}` };
        await COL.doc(code).update({
          data: { players: db.command.push([bot]) },
        });
        room.players.push(bot);
        return ok({ room, self: OPENID });
      }

      // 非房主退出等待中的房间：把自己移出 players（幂等，不在房内直接返回）。
      // 房主不可退出（应走 disband）；开局后不可退出（对局中请用 end 收尾）。
      case 'leave': {
        const code = normalizeCode(event.code);
        const room = await getRoomDoc(code);
        if (!room) return ok({ room: null, self: OPENID });
        if (room.host === OPENID) return fail('房主不能退出，请解散房间');
        if (room.status !== 'waiting') return fail('对局已开始，无法退出');
        const players = room.players.filter((p) => p.openid !== OPENID);
        if (players.length === room.players.length) return ok({ room, self: OPENID });
        await COL.doc(code).update({ data: { players } });
        room.players = players;
        return ok({ room, self: OPENID });
      }

      // 房主解散房间（仅限等待中；开局后请用 lami-game 的 end 收尾）。
      case 'disband': {
        const code = normalizeCode(event.code);
        const room = await getRoomDoc(code);
        if (!room) return ok({ room: null, self: OPENID }); // 已被解散，幂等
        if (room.host !== OPENID) return fail('只有房主可以解散房间');
        if (room.status !== 'waiting') return fail('对局已开始，无法解散');
        await COL.doc(code).remove();
        return ok({ room: null, self: OPENID });
      }

      // 查询本人进行中的房间（等待中/已开始/对局中）：本地房间记忆被清后的云端兼容。
      case 'myRoom': {
        const snap = await COL.where({
          'players.openid': OPENID,
          status: db.command.in(['waiting', 'started', 'playing']),
        })
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        const room = snap && snap.data && snap.data.length > 0 ? snap.data[0] : null;
        return ok({ room, self: OPENID });
      }

      default:
        return fail('未知操作');
    }
  } catch (e) {
    return fail('服务繁忙，请稍后再试');
  }
};
