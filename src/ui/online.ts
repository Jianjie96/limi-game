// ============================================================================
// src/ui/online.ts — 在线对战协调器（OnlineCoordinator）
// ----------------------------------------------------------------------------
// 职责：把云端权威状态（公开状态 + 本人手牌）映射成本机草稿引擎可加载的
// 「mask 状态」——本人手牌真实、其他玩家以占位牌替代（保密）、牌池仅保留数量。
//
// 同步策略：
//   - watch 推送 → version 更新或非本人回合 → loadState 整体覆盖并重绘
//   - 本人回合草稿进行中（已产生操作日志）→ 仅缓存，提交完成后对齐
//   - 出牌：本地克隆引擎预校验（即时反馈）→ sendMove 云端回放校验 →
//     成功用权威状态对齐；失败回滚到回合开始
// ============================================================================

import { RummikubEngine } from '../game/engine';
import type { Tile, TileGroup, PlayerState, GameState } from '../game/types';
import { TurnPhase } from '../game/types';
import {
  initGame,
  sendMove,
  sendPass,
  watchGame,
  type PublicGameState,
  type GameSyncPayload,
  type MoveResponse,
} from '../cloud/game';
import { audio } from './audio';

/** GameScene 暴露给协调器的最小接口（避免循环依赖）。 */
export interface OnlineSceneHost {
  showMessage(msg: string, duration?: number): void;
  /** 辅助提示：仅开发版展示，线上静默。 */
  showTip(msg: string, duration?: number): void;
  /** 发牌动画开关（一次性）：断线重连首次全量加载前置 false，原地全量展示。 */
  setDealAnimEnabled(enabled: boolean): void;
  /** 云端操作进行中：锁定出牌/Pass 按钮并给出「处理中」即时反馈，防止重复点击。
   *  action 标识触发动作，供场景把对应按钮文案显示为「…中」。 */
  setSubmitting(busy: boolean, action?: 'submit' | 'pass'): void;
  /** 短暂高亮指定桌面牌组（他人出牌落点提示，到期自动清除）。 */
  flashBoardGroups(groupIds: string[], duration?: number): void;
}

/** 占位牌：仅用于填充他人牌架数量与牌池数量，不参与任何规则计算。 */
function placeholderTiles(count: number, baseId: number): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    tiles.push({ id: baseId + i, color: 'red', number: 1 });
  }
  return tiles;
}

/** 兼容云端两种响应形态：标准 {payload:{public,hand}} 与旧版扁平 {public,hand}，
 * 避免部署不同步时成功响应被误判为失败。 */
function payloadOf(resp: MoveResponse): GameSyncPayload | null {
  if (resp.payload) return resp.payload;
  if (resp.public) return { public: resp.public, hand: resp.hand || [] };
  return null;
}

function handIdsKey(hand: readonly Tile[]): string {
  return hand
    .map((t) => t.id)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * 由公开状态 + 本人手牌构造完整 GameState JSON（mask 状态）。
 * - 本人牌架：真实手牌；其他玩家：占位牌（仅数量正确）
 * - 牌池：占位牌（仅数量正确，摸牌由云端执行）
 * - 回合上下文：按回合起点重建（摸牌只发生在云端）
 */
export function buildMaskedStateJson(
  pub: PublicGameState,
  hand: readonly Tile[],
  selfIndex: number
): string {
  const players: PlayerState[] = pub.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    hasMadeInitialMeld: p.hasMadeInitialMeld,
    rack:
      i === selfIndex
        ? hand.map((t) => ({ ...t }))
        : placeholderTiles(p.rackCount, 1000 + i * 200),
  }));

  const pool = placeholderTiles(pub.poolCount, 5000);
  const board: TileGroup[] = JSON.parse(JSON.stringify(pub.board));
  const currentRack = players[pub.currentPlayerIndex]?.rack ?? [];

  const state: GameState = {
    phase: pub.phase as GameState['phase'],
    players,
    currentPlayerIndex: pub.currentPlayerIndex,
    board,
    pool,
    turnPhase: TurnPhase.PLAY,
    turnContext: {
      phase: TurnPhase.PLAY,
      boardSnapshot: JSON.parse(JSON.stringify(board)),
      poolSnapshot: [],
      rackAtTurnStart: currentRack.map((t) => ({ ...t })),
      replacedJokers: [],
      hasDrawnFromPool: false,
      drawnTile: null,
      drawnTileId: null,
      hasPlacedFromRack: false,
      rackTilesPlacedThisTurn: [],
      consecutivePasses: 0,
      justDrawnTilePlaced: false,
    },
    turnNumber: pub.turnNumber,
    config: pub.config,
    result: pub.result,
  };
  return JSON.stringify(state);
}

// ----------------------------------------------------------------------------
// OnlineCoordinator
// ----------------------------------------------------------------------------

export class OnlineCoordinator {
  private closeWatch: (() => void) | null = null;
  private latestPublic: PublicGameState | null = null;
  private latestHand: Tile[] | null = null;
  private appliedVersion = 0;
  private appliedHandKey = '';
  /** 本人回合起点快照（提交失败时本地回滚用）。 */
  private turnStartJson = '';
  /** 正在等待云端响应（期间 watch 推送仅缓存）。 */
  private busy = false;
  private hostRetry = 0;
  /** 首次应用云端状态时播放发牌音效（仅真正开局，断线重连跳过）。 */
  private firstApply = true;
  /** 上一次应用的公开状态（对比检测对手出牌/摸牌用）。 */
  private lastApplied: PublicGameState | null = null;

  constructor(
    private engine: RummikubEngine,
    private scene: OnlineSceneHost,
    private code: string,
    private selfOpenid: string,
    private selfIndex: number,
    private isHost: boolean
  ) {}

  /** 启动同步：开局（房主）+ watch 订阅。initialPublic 为轮询拿到的最新公开状态。 */
  begin(initialPublic?: PublicGameState): void {
    if (initialPublic) this.latestPublic = initialPublic;

    this.closeWatch = watchGame(this.code, this.selfOpenid, (pub, hand) => {
      this.latestPublic = pub;
      if (hand) this.latestHand = hand;
      this.tryApply();
    });

    if (this.isHost) {
      this.requestInit();
    } else {
      this.tryApply();
    }
  }

  dispose(): void {
    if (this.closeWatch) {
      this.closeWatch();
      this.closeWatch = null;
    }
  }

  // --------------------------------------------------------------------------
  // 开局
  // --------------------------------------------------------------------------

  private requestInit(): void {
    initGame(this.code)
      .then((payload) => {
        this.latestPublic = payload.public;
        this.latestHand = payload.hand;
        this.tryApply();
      })
      .catch((e: Error) => {
        // 幂等开局偶发竞争（对方正在初始化）：稍后重试，最多 3 次。
        if (this.hostRetry < 3) {
          this.hostRetry++;
          setTimeout(() => this.requestInit(), 1500);
        } else {
          this.scene.showMessage(`开局失败：${e.message}`, 3200);
        }
      });
  }

  // --------------------------------------------------------------------------
  // 出牌 / Pass
  // --------------------------------------------------------------------------

  /** 切换 busy 并同步通知场景锁/解锁按钮（即时反馈，防重复点击）。 */
  private setBusy(v: boolean, action?: 'submit' | 'pass'): void {
    this.busy = v;
    this.scene.setSubmitting(v, action);
  }

  /** 出牌：本地克隆预校验（即时反馈）→ 乐观提交 → 云端回放校验（权威裁决）。 */
  submit(): void {
    if (this.busy) return;
    const st = this.engine.getState();
    if (st.phase !== 'PLAYING' || st.currentPlayerIndex !== this.selfIndex) return;

    // ops 必须在本地预校验之前取出（submitTurn 成功会清空日志）。
    const ops = [...this.engine.getTurnOps()];

    try {
      const clone = RummikubEngine.fromState(this.engine.serializeState());
      const res = clone.submitTurn();
      if (!res.valid) {
        // 与本地模式一致：失败即回滚到回合开始。
        if (this.turnStartJson) this.engine.loadState(this.turnStartJson);
        audio.play('error');
        const msg = res.errors.map((er) => er.message).join('; ');
        this.scene.showMessage(`出牌失败: ${msg}`, 3000);
        return;
      }
    } catch (e: any) {
      audio.play('error');
      this.scene.showMessage(e.message || '操作失败', 3000);
      return;
    }

    this.setBusy(true, 'submit');

    // 乐观提交：本地已校验通过，立即在可见引擎上确认回合——牌落桌面、回合移交，
    // 用户无需等待云端往返即看到结果（消除卡顿感）。云端响应到达后 loadState
    // 整体对齐（成功/否决带权威态）或回滚（网络失败）；引擎 turnEnd/turnStart
    // 事件已触发音效与提示，此处不再重复。
    try {
      const opt = this.engine.submitTurn();
      if (!opt.valid) {
        // 复核未通过（理论上与克隆一致）→ 回滚并放弃提交。
        this.setBusy(false);
        if (this.turnStartJson) this.engine.loadState(this.turnStartJson);
        audio.play('error');
        this.scene.showMessage('出牌失败', 2400);
        return;
      }
    } catch (e) {
      // 异常同样回滚并放弃提交。
      this.setBusy(false);
      if (this.turnStartJson) this.engine.loadState(this.turnStartJson);
      audio.play('error');
      this.scene.showMessage('出牌失败', 2400);
      return;
    }

    sendMove(this.code, ops)
      .then((resp) => {
        this.setBusy(false);
        const pl = payloadOf(resp);
        if (resp.ok && pl) {
          // 云端确认：用权威状态对齐（通常与乐观态一致）。
          this.applyPayload(pl.public, pl.hand);
        } else {
          const msg =
            resp.errors?.map((er) => er.message).join('; ') ||
            resp.message ||
            '出牌失败';
          if (pl) {
            // 云端否决并返回权威状态 → 按其对齐（等价于回滚乐观提交）。
            this.applyPayload(pl.public, pl.hand);
          } else if (this.turnStartJson) {
            this.engine.loadState(this.turnStartJson);
          }
          audio.play('error');
          this.scene.showMessage(msg, 3000);
        }
        this.tryApply(); // 消费 busy 期间缓存的推送
      })
      .catch((e: Error) => {
        this.setBusy(false);
        // 网络失败：回滚乐观提交到回合开始，保留草稿可重试。
        if (this.turnStartJson) this.engine.loadState(this.turnStartJson);
        audio.play('error');
        this.scene.showMessage(e.message || '网络异常，请重试', 3000);
      });
  }

  /** Pass：摸一张并结束回合（云端执行）。摸到的牌云端才可知，故不做乐观提交，
   *  仅以按钮锁定 + 「摸牌中…」给出即时反馈并防重复点击。 */
  pass(): void {
    if (this.busy) return;
    const st = this.engine.getState();
    if (st.phase !== 'PLAYING' || st.currentPlayerIndex !== this.selfIndex) return;

    this.setBusy(true, 'pass');
    sendPass(this.code)
      .then((resp) => {
        this.setBusy(false);
        const pl = payloadOf(resp);
        if (resp.ok && pl) {
          this.applyPayload(pl.public, pl.hand);
          audio.play('pass');
          this.scene.showTip('Pass 成功，摸牌 1 张');
        } else {
          audio.play('error');
          this.scene.showMessage(resp.message || '操作失败', 3000);
        }
        this.tryApply();
      })
      .catch((e: Error) => {
        this.setBusy(false);
        audio.play('error');
        this.scene.showMessage(e.message || '网络异常，请重试', 3000);
      });
  }

  // --------------------------------------------------------------------------
  // 状态对齐
  // --------------------------------------------------------------------------

  private applyPayload(pub: PublicGameState, hand: Tile[]): void {
    this.latestPublic = pub;
    this.latestHand = hand;
    this.apply(pub, hand);
  }

  /** 尝试把最新推送应用到引擎（带去重与草稿保护）。 */
  private tryApply(): void {
    const pub = this.latestPublic;
    const hand = this.latestHand;
    if (!pub || !hand || this.busy) return;

    const handKey = handIdsKey(hand);
    if (pub.version < this.appliedVersion) return;
    if (pub.version === this.appliedVersion && handKey === this.appliedHandKey) return;

    // 本人回合草稿进行中且版本未变 → 不打断操作，latest* 已缓存，稍后对齐。
    const myTurn = pub.phase === 'PLAYING' && pub.currentPlayerIndex === this.selfIndex;
    const drafting = this.engine.getTurnOps().length > 0;
    if (myTurn && drafting && pub.version === this.appliedVersion) return;

    this.apply(pub, hand);
  }

  /** loadState 整体覆盖草稿引擎（mask 状态）。 */
  private apply(pub: PublicGameState, hand: Tile[]): void {
    const prev = this.lastApplied;
    this.appliedVersion = pub.version;
    this.appliedHandKey = handIdsKey(hand);

    // 首次加载是否为「真正开局」：第 1 回合且桌面为空。
    // 断线重连/中途进局不满足 → 跳过发牌仪式，全量原地展示。
    const freshDeal =
      pub.phase === 'PLAYING' && pub.turnNumber <= 1 && pub.board.length === 0;
    if (this.firstApply && !freshDeal) this.scene.setDealAnimEnabled(false);

    const json = buildMaskedStateJson(pub, hand, this.selfIndex);
    this.engine.loadState(json);

    // 首次拿到云端状态：开局发牌音效（重连跳过）。
    if (this.firstApply) {
      this.firstApply = false;
      if (freshDeal) audio.play('deal');
    }

    const myTurn = pub.phase === 'PLAYING' && pub.currentPlayerIndex === this.selfIndex;
    this.turnStartJson = myTurn ? json : '';

    // 对手行动感知：机器人/对手在云端行棋，本地只有 loadState 静默覆盖；
    // 对比前后状态给出「消息 + 音效 + 牌组高亮」反馈（须晚于 loadState，
    // 避免被 stateLoaded 的清除逻辑抹掉）。
    this.notifyOthersAction(prev, pub);

    if (pub.phase === 'GAME_OVER' && pub.result) {
      const winner = pub.result.playerResults.find((r) => r.isWinner);
      // 本人获胜用胜利彩带，否则用柔和结算音。
      audio.play(pub.result.playerResults[this.selfIndex]?.isWinner ? 'victory' : 'result');
      this.scene.showMessage(`游戏结束! ${winner?.playerName ?? ''} 获胜!`, 3200);
    }
  }

  /** 对比相邻两次云端状态，提示非本人玩家的动作（出牌/摸牌）。
   *  依据：手牌数量变化（出牌减少/摸牌增加）与桌面新增牌所属牌组。 */
  private notifyOthersAction(prev: PublicGameState | null, pub: PublicGameState): void {
    this.lastApplied = pub;
    if (!prev || prev.phase !== 'PLAYING' || pub.phase !== 'PLAYING') return;

    const parts: string[] = [];
    let placed = false;
    let drawn = false;
    for (let i = 0; i < pub.players.length; i++) {
      if (i === this.selfIndex) continue;
      const before = prev.players[i];
      const after = pub.players[i];
      if (!before || !after) continue;
      const delta = before.rackCount - after.rackCount;
      if (delta > 0) {
        parts.push(`${after.name} 出牌 ${delta} 张`);
        placed = true;
      } else if (delta < 0) {
        parts.push(`${after.name} 摸牌`);
        drawn = true;
      }
    }
    if (parts.length === 0) return;

    if (placed) {
      // 高亮含新增牌的牌组（对手出牌落点），到期自动清除。
      const prevIds = new Set<number>();
      for (const g of prev.board) for (const t of g.tiles) prevIds.add(t.originalTile.id);
      const flashIds: string[] = [];
      for (const g of pub.board) {
        if (g.tiles.some((t) => !prevIds.has(t.originalTile.id))) flashIds.push(g.id);
      }
      if (flashIds.length > 0) this.scene.flashBoardGroups(flashIds);
      audio.play('place');
    } else if (drawn) {
      audio.play('pass');
    }
    this.scene.showMessage(parts.join('；'), 2800);
  }
}
