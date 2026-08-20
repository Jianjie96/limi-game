// ============================================================================
// src/server/engine-entry.ts — 云函数打包入口
// ----------------------------------------------------------------------------
// esbuild 将本文件（连同 src/game 全部规则逻辑）打包为
// cloudfunctions/lami-game/engine-bundle.js，供云函数作为权威裁判使用。
// 规则逻辑与客户端共用同一份代码，杜绝双份校验漂移。
// ============================================================================

export { RummikubEngine, applyOps } from '../game/engine';
export { planBotTurn } from '../game/bot';
export { findLowestScorePlayer } from '../game/scoring';
export type { EngineOp, GameState } from '../game/types';
