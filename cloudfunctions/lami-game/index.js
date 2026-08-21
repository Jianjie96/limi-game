// ============================================================================
// 云函数 lami-game — 拉密在线对战权威裁判（微信云开发）
// ----------------------------------------------------------------------------
// 规则引擎与客户端共用同一份代码（engine-bundle.js 由 src/game 打包而来）。
//
// actions:
//   init — 开局：洗牌发牌在云端完成，写公开状态 + 各人私有手牌
//   move — 出牌提交：回放客户端操作日志 → submitTurn 校验 → 写库推送
//   pass — Pass：摸 1 张并结束回合（回滚本回合桌面操作）
//   end  — 房主主动结束对局（关闭测试房 / 紧急终止）
//   tick — 定时触发器（每分钟）：回收闲置测试房与逾期未开始的等待测试房，
//          清理过期房间数据（第一版回合不限时，无超时托管）
//
// 机器人托管：devFill 填充的测试机器人（openid 形如 bot_*）回合由云端立即代打，
// 回合一旦移交机器人，advanceBots 连续执行 bot.ts 的贪心 AI 直到回到真人回合。
//
// 数据存储（手牌/牌池严格分离，防窥屏）：
//   lami_rooms.game     公开状态（桌面/分数/回合/version；turnDeadline 恒为 0 = 不限时）
//   lami_hands/{id}     私有手牌，_id = `${roomCode}_${openid}`，仅本人可读
//   lami_secrets/{code} 完整引擎状态（含牌池顺序），仅云函数可访问
// ============================================================================

const cloud = require('wx-server-sdk');
const { RummikubEngine, applyOps, findLowestScorePlayer, planBotTurn } = require('./engine-bundle.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const ROOMS = db.collection('lami_rooms');
const HANDS = db.collection('lami_hands');
const SECRETS = db.collection('lami_secrets');

/** 房间数据保留时长：已结束/已废弃的房间超过该时长后由 tick 清理。 */
const ROOM_RETAIN_MS = 3 * 24 * 3600 * 1000;
/** 测试房闲置回收：真人玩家超过该时长无任何操作 → tick 释放房间。 */
const TEST_ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
/** 等待中的测试房：创建后超过该时长仍未开局 → tick 直接回收。 */
const TEST_ROOM_WAIT_MS = 60 * 60 * 1000;

/** 是否测试房（含 devFill 填充的机器人玩家）。 */
function hasBots(room) {
  return Array.isArray(room.players) && room.players.some((p) => String(p.openid || '').startsWith('bot_'));
}

/** 终止并清理房间（结束对局 / 闲置回收共用）：置 finished + 删密态与手牌。 */
async function finishAndCleanup(room) {
  await ROOMS.doc(room.code).update({ data: { status: 'finished' } });
  try { await SECRETS.doc(room.code).remove(); } catch (e) { /* 无密态则忽略 */ }
  try {
    const hands = await HANDS.where({ code: room.code }).limit(10).get();
    for (const h of hands.data) {
      await HANDS.doc(h._id).remove();
    }
  } catch (e) {
    // 清理失败不阻断（tick 会兜底清理）
  }
}

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
  });
  // 洗牌、发牌全部在云端完成，客户端拿不到牌池顺序。
  engine.startGame(room.players.map((p) => p.name));

  const version = 1;
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
        turnDeadline: 0,
        playersOpenid,
        currentPlayerIndex: 0,
        public: buildPublic(engine, version, 0),
        // 开局由房主客户端触发，记为一次真人活跃；供 tick 回收闲置测试房判定。
        lastHumanAt: Date.now(),
      },
    },
  });

  return ok(payloadFor(room, engine, version, 0, openid));
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
  // 回合若移交到机器人 → 云端立即连续代打，真人响应里直接拿到最新状态。
  await advanceBots(room, engine);
  // 真人成功出牌：刷新活跃时间（机器人不会调 move，tick 据此回收闲置测试房）。
  try { await ROOMS.doc(code).update({ data: { 'game.lastHumanAt': Date.now() } }); } catch (e) { /* 忽略 */ }
  // 客户端 MoveResponse 约定成功态携带 payload（与校验失败路径一致）。
  return ok({ payload: payloadFor(room, engine, room.game.version, room.game.turnDeadline, openid) });
}

/** 结束对局：房主主动终止（开发调试关闭测试房 / 紧急终止），
 * 直接置为 finished 并清理密态与手牌数据。 */
async function doEnd(event, openid) {
  const code = normCode(event.code);
  const room = await getDoc(ROOMS, code);
  if (!room) return fail('房间不存在');
  if (room.host !== openid) return fail('只有房主可以结束对局');
  if (room.status === 'finished') return ok({ ended: true });
  await finishAndCleanup(room);
  return ok({ ended: true });
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
  // 回合若移交到机器人 → 云端立即连续代打。
  await advanceBots(room, engine);
  // 真人成功 Pass：刷新活跃时间（机器人不会调 pass）。
  try { await ROOMS.doc(code).update({ data: { 'game.lastHumanAt': Date.now() } }); } catch (e) { /* 忽略 */ }
  return ok({ payload: payloadFor(room, engine, room.game.version, room.game.turnDeadline, openid) });
}

/** 出牌/Pass 成功后统一落库；若分出胜负则收尾。
 * 版本号回写 room.game 内存，同一请求内多次落库（机器人连打）版本递增不重复。 */
async function settleAndPersist(room, engine) {
  const st = engine.getState();
  const version = (room.game.version || 0) + 1;
  await persistState(room, engine, version, 0);
  room.game.version = version;
  room.game.turnDeadline = 0;
  room.game.currentPlayerIndex = st.currentPlayerIndex;
  if (st.phase === 'GAME_OVER') {
    await ROOMS.doc(room.code).update({ data: { status: 'finished' } });
  }
}

// ----------------------------------------------------------------------------
// 机器人托管：回合移交 bot_* 玩家后，云端立即用 bot.ts AI 代打
// ----------------------------------------------------------------------------

/** 执行机器人一个回合：planBotTurn 规划落子 → submitTurn 提交；无牌可出或提交被拒则 pass。
 * 异常时回滚到回合开始状态并 pass 兜底，保证密态不损坏。 */
function botPlayOneTurn(engine) {
  const snapshot = engine.serializeState();
  try {
    if (planBotTurn(engine)) {
      const res = engine.submitTurn();
      if (res.valid) return;
    }
    engine.pass();
  } catch (e) {
    try {
      engine.loadState(snapshot);
      engine.pass();
    } catch (e2) { /* 最后兜底：状态已在内存，下次 tick 会再处理 */ }
  }
}

/** 当前回合是机器人时连续代打，直到回到真人回合或对局结束；末尾一次性落库。 */
async function advanceBots(room, engine) {
  const openids = (room.game && room.game.playersOpenid) || [];
  let turns = 0;
  while (turns < 100) {
    const st = engine.getState();
    if (st.phase !== 'PLAYING') break;
    const openid = openids[st.currentPlayerIndex];
    if (!String(openid || '').startsWith('bot_')) break;
    botPlayOneTurn(engine);
    turns++;
  }
  if (turns > 0) {
    await settleAndPersist(room, engine);
  }
  return turns;
}

/** 定时任务：回收闲置测试房、同步已结束状态；顺带清理过期房间数据。 */
async function doTick() {
  const now = Date.now();
  const snap = await ROOMS.where({ status: 'playing' }).limit(50).get();

  let handled = 0;
  for (const room of snap.data) {
    try {
      // 测试房闲置回收：真人长时间无操作 → 直接释放房间，不再陪跑。
      if (hasBots(room)) {
        const lastHuman = (room.game && room.game.lastHumanAt) || room.startedAt || 0;
        if (now - lastHuman > TEST_ROOM_IDLE_MS) {
          await finishAndCleanup(room);
          handled++;
          continue;
        }
      }
      const secret = await getDoc(SECRETS, room.code);
      if (!secret) continue;
      const engine = RummikubEngine.fromState(secret.fullState);
      if (engine.getState().phase !== 'PLAYING') {
        await ROOMS.doc(room.code).update({ data: { status: 'finished' } });
        handled++;
      }
    } catch (e) {
      // 单个房间失败不影响其他房间
    }
  }

  // 清理过期房间，避免集合无限膨胀拖慢查询：
  //   - 已结束超过保留期的对局房间
  //   - 创建后一直没人齐的废弃等待房间
  //   - 卡在 started（房主点开始后未成功开局）的僵尸房间
  const cutoff = now - ROOM_RETAIN_MS;
  const staleFinished = await ROOMS.where({ status: 'finished', startedAt: _.lt(cutoff) }).limit(20).get();

  // 等待中的测试房逾期未开局：不等 3 天保留期，直接回收（普通房间仍走原逻辑）。
  const staleTestWaiting = await ROOMS.where({
    status: 'waiting',
    createdAt: _.lt(now - TEST_ROOM_WAIT_MS),
  }).limit(20).get();
  const staleWaiting = await ROOMS.where({ status: 'waiting', createdAt: _.lt(cutoff) }).limit(20).get();
  const staleStarted = await ROOMS.where({ status: 'started', startedAt: _.lt(cutoff) }).limit(20).get();
  // 测试等待房并入清理列表（只收含机器人的，去重避免与 staleWaiting 重复删）。
  const purgeList = [...staleFinished.data, ...staleWaiting.data, ...staleStarted.data];
  for (const room of staleTestWaiting.data) {
    if (hasBots(room) && !purgeList.some((r) => r.code === room.code)) {
      purgeList.push(room);
    }
  }
  let purged = 0;
  for (const room of purgeList) {
    try {
      await ROOMS.doc(room.code).remove();
      try { await SECRETS.doc(room.code).remove(); } catch (e) { /* 无密态则忽略 */ }
      const hands = await HANDS.where({ code: room.code }).limit(10).get();
      for (const h of hands.data) {
        await HANDS.doc(h._id).remove();
      }
      purged++;
    } catch (e) {
      // 单个房间清理失败不影响其他
    }
  }

  return ok({ handled, purged });
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
      case 'end':
        return await doEnd(event, OPENID);
      default:
        return fail('未知操作');
    }
  } catch (e) {
    return fail('服务繁忙，请稍后再试');
  }
};
