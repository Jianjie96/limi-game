// ============================================================================
// 云函数 lami-game — 拉密在线对战权威裁判（微信云开发）
// ----------------------------------------------------------------------------
// 规则引擎与客户端共用同一份代码（engine-bundle.js 由 src/game 打包而来）。
//
// actions:
//   init — 开局：洗牌发牌在云端完成，写公开状态 + 各人私有手牌
//   move — 出牌提交：回放客户端操作日志 → submitTurn 校验 → 写库推送
//   pass — Pass：摸 1 张并结束回合（回滚本回合桌面操作）
//   tick — 定时触发器（每分钟）：超时回合执行摸牌惩罚并移交
//
// 数据存储（手牌/牌池严格分离，防窥屏）：
//   lami_rooms.game     公开状态（桌面/分数/回合/version/turnDeadline）
//   lami_hands/{id}     私有手牌，_id = `${roomCode}_${openid}`，仅本人可读
//   lami_secrets/{code} 完整引擎状态（含牌池顺序），仅云函数可访问
// ============================================================================

const cloud = require('wx-server-sdk');
const { RummikubEngine, applyOps, findLowestScorePlayer } = require('./engine-bundle.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const ROOMS = db.collection('lami_rooms');
const HANDS = db.collection('lami_hands');
const SECRETS = db.collection('lami_secrets');

const TURN_MS = 60 * 1000;

function ok(data) {
  return Object.assign({ ok: true }, data);
}

function fail(message) {
  return { ok: false, message };
}

function normCode(code) {
  return String(code || '').trim().toUpperCase();
}

async function getDoc(col, id) {
  try {
    const snap = await col.doc(id).get();
    return snap && snap.data ? snap.data : null;
  } catch (e) {
    return null;
  }
}

// ----------------------------------------------------------------------------
// 状态派生：完整引擎状态 → 公开状态 / 私有手牌
// ----------------------------------------------------------------------------

/** 公开状态：不含任何手牌内容与牌池顺序，仅牌池数量。 */
function buildPublic(engine, version, turnDeadline) {
  const st = engine.getState();
  return {
    version,
    turnDeadline,
    phase: st.phase,
    players: st.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      hasMadeInitialMeld: p.hasMadeInitialMeld,
      rackCount: p.rack.length,
    })),
    currentPlayerIndex: st.currentPlayerIndex,
    board: st.board,
    turnPhase: st.turnPhase,
    turnNumber: st.turnNumber,
    config: st.config,
    result: st.result,
    poolCount: st.pool.length,
  };
}

/** 给指定玩家的响应：公开状态 + 本人手牌。 */
function payloadFor(room, engine, version, deadline, openid) {
  const st = engine.getState();
  const openids =
    (room.game && room.game.playersOpenid) ||
    (room.players || []).map((p) => p.openid);
  const idx = openids.indexOf(openid);
  return {
    public: buildPublic(engine, version, deadline),
    hand: idx >= 0 ? st.players[idx].rack : [],
  };
}

/** 持久化：完整状态(secrets) + 公开状态(room.game) + 全员手牌(hands)。 */
async function persistState(room, engine, version, deadline) {
  const code = room.code;
  await SECRETS.doc(code).set({
    data: { code, fullState: engine.serializeState(), updatedAt: Date.now() },
  });

  await ROOMS.doc(code).update({
    data: {
      'game.version': version,
      'game.turnDeadline': deadline,
      'game.currentPlayerIndex': engine.getState().currentPlayerIndex,
      'game.public': buildPublic(engine, version, deadline),
    },
  });

  const st = engine.getState();
  for (let i = 0; i < st.players.length; i++) {
    const openid = room.game.playersOpenid[i];
    await HANDS.doc(`${code}_${openid}`).set({
      data: { owner: openid, code, rack: st.players[i].rack, updatedAt: Date.now() },
    });
  }
}

/** 死局检测：牌池耗尽且连续 Pass ≥ 玩家数 → 最低分获胜。 */
function checkDeadlock(room, engine) {
  const st = engine.getState();
  if (st.phase !== 'PLAYING' || st.pool.length > 0) return false;
  const ctx = st.turnContext;
  if (!ctx || ctx.consecutivePasses < st.players.length) return false;
  const winnerId = findLowestScorePlayer(st.players);
  // endGame 为引擎私有方法（TS 编译期约束），运行时直接调用完成结算。
  engine.endGame(winnerId, 'lowest_score');
  return true;
}

// ----------------------------------------------------------------------------
// actions
// ----------------------------------------------------------------------------

/** 开局（幂等：已开局直接返回当前状态）。 */
async function doInit(event, openid) {
  const code = normCode(event.code);
  const room = await getDoc(ROOMS, code);
  if (!room) return fail('房间不存在');
  if (room.status === 'waiting') return fail('玩家未到齐，还不能开局');

  // 幂等：已开局则直接返回现状；他人正在初始化（已有座位映射但还没写入密态）则提示稍后重试。
  if (room.game && room.game.playersOpenid) {
    const secret = await getDoc(SECRETS, code);
    if (secret) {
      const engine = RummikubEngine.fromState(secret.fullState);
      return ok(payloadFor(room, engine, room.game.version, room.game.turnDeadline, openid));
    }
    if (room.game.version > 0) {
      return fail('对局正在初始化，请稍后重试');
    }
  }

  const playersOpenid = room.players.map((p) => p.openid);
  const engine = new RummikubEngine({
    playerCount: room.players.length,
    initialHandSize: 14,
    initialMeldMinScore: 30,
    turnTimeLimit: 60,
  });
  // 洗牌、发牌全部在云端完成，客户端拿不到牌池顺序。
  engine.startGame(room.players.map((p) => p.name));

  const version = 1;
  const deadline = Date.now() + TURN_MS;
  await SECRETS.doc(code).set({
    data: { code, fullState: engine.serializeState(), updatedAt: Date.now() },
  });
  const st = engine.getState();
  for (let i = 0; i < st.players.length; i++) {
    await HANDS.doc(`${code}_${playersOpenid[i]}`).set({
      data: {
        owner: playersOpenid[i],
        code,
        rack: st.players[i].rack,
        updatedAt: Date.now(),
      },
    });
  }
  await ROOMS.doc(code).update({
    data: {
      status: 'playing',
      game: {
        version,
        turnDeadline: deadline,
        playersOpenid,
        currentPlayerIndex: 0,
        public: buildPublic(engine, version, deadline),
      },
    },
  });

  return ok(payloadFor(room, engine, version, deadline, openid));
}

/** 出牌提交：回放操作日志 → submitTurn 校验。 */
async function doMove(event, openid) {
  const code = normCode(event.code);
  const ops = Array.isArray(event.ops) ? event.ops : [];
  const room = await getDoc(ROOMS, code);
  if (!room || !room.game) return fail('对局不存在');

  const idx = room.game.playersOpenid.indexOf(openid);
  if (idx < 0) return fail('你不在该房间中');
  if (room.game.currentPlayerIndex !== idx) return fail('还没轮到你出牌');

  const secret = await getDoc(SECRETS, code);
  if (!secret) return fail('对局数据缺失');
  const engine = RummikubEngine.fromState(secret.fullState);

  // 超时兜底：回合已过期 → 先执行惩罚并移交，再拒绝本次提交。
  if (Date.now() > room.game.turnDeadline) {
    engine.handleTimeout();
    await settleAndPersist(room, engine);
    return fail('回合已超时，已自动摸牌并移交回合');
  }

  try {
    applyOps(engine, ops);
  } catch (e) {
    return fail('操作序列不合法：' + (e && e.message ? e.message : String(e)));
  }

  const res = engine.submitTurn();
  if (!res.valid) {
    // 校验失败不落库：返回权威公开状态 + 本人手牌，客户端据此回滚。
    const payload = payloadFor(room, engine, room.game.version, room.game.turnDeadline, openid);
    return Object.assign(fail('出牌校验未通过'), { errors: res.errors, payload });
  }

  await settleAndPersist(room, engine);
  const version = room.game.version + 1;
  const deadline = Date.now() + TURN_MS;
  return ok(payloadFor(room, engine, version, deadline, openid));
}

/** Pass：摸 1 张并结束回合（引擎内部回滚本回合桌面操作）。 */
async function doPass(event, openid) {
  const code = normCode(event.code);
  const room = await getDoc(ROOMS, code);
  if (!room || !room.game) return fail('对局不存在');

  const idx = room.game.playersOpenid.indexOf(openid);
  if (idx < 0) return fail('你不在该房间中');
  if (room.game.currentPlayerIndex !== idx) return fail('还没轮到你操作');

  const secret = await getDoc(SECRETS, code);
  if (!secret) return fail('对局数据缺失');
  const engine = RummikubEngine.fromState(secret.fullState);

  engine.pass();
  await settleAndPersist(room, engine);
  const version = room.game.version + 1;
  const deadline = Date.now() + TURN_MS;
  return ok(payloadFor(room, engine, version, deadline, openid));
}

/** 出牌/Pass 成功后统一落库；若分出胜负则收尾。 */
async function settleAndPersist(room, engine) {
  const st = engine.getState();
  const version = room.game.version + 1;
  const deadline = Date.now() + TURN_MS;
  await persistState(room, engine, version, deadline);
  if (st.phase === 'GAME_OVER') {
    await ROOMS.doc(room.code).update({ data: { status: 'finished' } });
  }
}

/** 定时任务：扫描超时回合，执行摸牌惩罚并移交。 */
async function doTick() {
  const now = Date.now();
  const snap = await ROOMS.where({
    status: 'playing',
    'game.turnDeadline': _.lt(now),
  }).limit(50).get();

  let handled = 0;
  for (const room of snap.data) {
    try {
      const secret = await getDoc(SECRETS, room.code);
      if (!secret) continue;
      const engine = RummikubEngine.fromState(secret.fullState);
      if (engine.getState().phase !== 'PLAYING') {
        await ROOMS.doc(room.code).update({ data: { status: 'finished' } });
        continue;
      }
      engine.handleTimeout();
      await settleAndPersist(room, engine);
      handled++;
    } catch (e) {
      // 单个房间失败不影响其他房间
    }
  }
  return ok({ handled });
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    // 定时触发器调用（无 action）
    if (event.Source === 'tcb_trigger' || event.action === 'tick') {
      return await doTick();
    }
    switch (event.action) {
      case 'init':
        return await doInit(event, OPENID);
      case 'move':
        return await doMove(event, OPENID);
      case 'pass':
        return await doPass(event, OPENID);
      default:
        return fail('未知操作');
    }
  } catch (e) {
    return fail('服务繁忙，请稍后再试');
  }
};
