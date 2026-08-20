// ============================================================================
// tools/gen-sfx.js — 离线合成游戏音效（零依赖，输出 WAV 到 assets/audio/）
// ----------------------------------------------------------------------------
// 用法：node tools/gen-sfx.js（或 npm run gen:sfx）
// 生成的文件由使用者手动上传到微信云开发存储，客户端通过 fileID 播放。
//
// 产物清单：
//   bgm.wav     背景音乐（无缝循环，黄昏氛围）
//   deal.wav    发牌级联
//   draw.wav    摸牌
//   pickup.wav  拿牌 / 选中
//   place.wav   牌放桌面 / 合并牌组
//   sort.wav    理牌（牌架/组内重排）
//   submit.wav  出牌成功
//   error.wav   操作失败
//   pass.wav    Pass
//   victory.wav 胜利彩带
//   result.wav  结算（柔和收尾）
// ============================================================================

const fs = require('fs');
const path = require('path');

const SR = 44100;
const TAU = Math.PI * 2;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'audio');

// ----------------------------------------------------------------------------
// 基础合成工具
// ----------------------------------------------------------------------------

function makeBuf(sec) {
  return new Float32Array(Math.max(1, Math.ceil(sec * SR)));
}

/** 白噪声源（2 秒，循环复用） */
const NOISE = (() => {
  const b = new Float32Array(SR * 2);
  for (let i = 0; i < b.length; i++) b[i] = Math.random() * 2 - 1;
  return b;
})();

/** 起音 + 指数衰减包络 */
function envAD(t, attack, tau) {
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  return a * Math.exp(-t / tau);
}

/** 叠加一个振荡器（sine / tri / softSquare），可带线性滑音。 */
function addOsc(buf, opts) {
  const { freq, freqEnd, start = 0, dur, vol = 0.5, attack = 0.004, tau = 0.1, type = 'sine' } = opts;
  const s0 = Math.max(0, Math.floor(start * SR));
  const n = Math.min(Math.ceil(dur * SR), buf.length - s0);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freqEnd ? freq + (freqEnd - freq) * Math.min(1, t / dur) : freq;
    ph += (TAU * f) / SR;
    let s = Math.sin(ph);
    if (type === 'tri') s = (2 / Math.PI) * Math.asin(s);
    else if (type === 'softSquare') s = Math.tanh(2.2 * Math.sin(ph));
    buf[s0 + i] += s * vol * envAD(t, attack, tau);
  }
}

/** 叠加一段白噪声爆发。 */
function addNoiseBurst(buf, opts) {
  const { start = 0, dur, vol = 0.5, attack = 0.002, tau = 0.02 } = opts;
  const s0 = Math.max(0, Math.floor(start * SR));
  const n = Math.min(Math.ceil(dur * SR), buf.length - s0);
  const off = Math.floor(Math.random() * NOISE.length);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    buf[s0 + i] += NOISE[(off + i) % NOISE.length] * vol * envAD(t, attack, tau);
  }
}

/** 扫频噪声（滤波器截止频率随时间线性变化）：风声/滑牌声专用。 */
function sweepNoise(dur, vol, fStart, fEnd, attack, tau) {
  const n = Math.ceil(dur * SR);
  const out = new Float32Array(n);
  let y = 0;
  const off = Math.floor(Math.random() * NOISE.length);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fc = fStart + (fEnd - fStart) * (t / dur);
    const al = 1 / SR / (1 / (TAU * fc) + 1 / SR);
    const x = NOISE[(off + i) % NOISE.length];
    y += al * (x - y);
    out[i] = y * vol * envAD(t, attack, tau);
  }
  return out;
}

function addBuf(dst, src, at, vol = 1) {
  const s0 = Math.max(0, Math.floor(at * SR));
  const n = Math.min(src.length, dst.length - s0);
  for (let i = 0; i < n; i++) dst[s0 + i] += src[i] * vol;
}

function lowpass(buf, fc) {
  const out = new Float32Array(buf.length);
  const al = 1 / SR / (1 / (TAU * fc) + 1 / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += al * (buf[i] - y);
    out[i] = y;
  }
  return out;
}

function highpass(buf, fc) {
  const lp = lowpass(buf, fc);
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] - lp[i];
  return out;
}

function normalize(buf, peak = 0.85) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) {
    const g = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

/** 首尾微淡变，消除硬切爆音。 */
function fadeEdges(buf, fadeIn = 0.003, fadeOut = 0.02) {
  const a = Math.floor(fadeIn * SR);
  const b = Math.floor(fadeOut * SR);
  for (let i = 0; i < a && i < buf.length; i++) buf[i] *= i / a;
  for (let i = 0; i < b && i < buf.length; i++) buf[buf.length - 1 - i] *= i / b;
}

/** 拉密牌（密胺材质）的「咔哒」碰撞声：明亮瞬态 + 低频闷响。 */
function clack(buf, at, vol = 1, pitch = 1) {
  const burst = makeBuf(0.04);
  addNoiseBurst(burst, { dur: 0.04, vol: 1, tau: 0.008 });
  const bp = highpass(lowpass(burst, 7000), 1400);
  addBuf(buf, bp, at, 0.75 * vol);
  addOsc(buf, { freq: 320 * pitch, start: at, dur: 0.1, vol: 0.5 * vol, tau: 0.028 });
  addOsc(buf, { freq: 128 * pitch, start: at, dur: 0.14, vol: 0.6 * vol, tau: 0.05 });
}

// ----------------------------------------------------------------------------
// WAV 输出
// ----------------------------------------------------------------------------

function writeWav(file, buf) {
  const n = buf.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, data);
  return data.length;
}

// ----------------------------------------------------------------------------
// 各音效构建
// ----------------------------------------------------------------------------

/**
 * 发牌：与渲染层逐张发牌动画对齐（14 张 × 160ms 错峰 ≈ 2.6s）。
 * 每张牌两段声音：起飞的轻柔「唰」（拱形起飞）+ 延迟约 0.12s 的落牌「嗒」
 * （对应飞行动画落位）；音高随张数缓升、音量递增，堆叠期待感，
 * 最后一张落点加重收尾。
 */
function buildDeal() {
  const COUNT = 14;
  const STAGGER = 0.16;
  const LAND_DELAY = 0.12;
  const b = makeBuf(0.06 + (COUNT - 1) * STAGGER + LAND_DELAY + 0.3);
  for (let i = 0; i < COUNT; i++) {
    const takeoff = 0.03 + i * STAGGER;
    const p = 0.95 + i * 0.03;
    // 起飞：短促上扬扫频噪声，像牌从牌堆抽出的轻风。
    addBuf(b, sweepNoise(0.09, 0.16 + 0.22 * (i / (COUNT - 1)), 900, 2600, 0.01, 0.026), takeoff);
    // 落牌：带音高变化的咔哒，随飞行时长滞后于起飞。
    clack(b, takeoff + LAND_DELAY, 0.5 + 0.42 * (i / (COUNT - 1)), p);
  }
  // 末张收尾加重：仪式感句号。
  const lastLand = 0.03 + (COUNT - 1) * STAGGER + LAND_DELAY;
  addOsc(b, { freq: 98, start: lastLand, dur: 0.14, vol: 0.4, tau: 0.05 });
  return normalize(b, 0.8);
}

/** 摸牌：上扬风声 + 落点轻响。 */
function buildDraw() {
  const b = makeBuf(0.42);
  addBuf(b, sweepNoise(0.36, 0.8, 500, 3200, 0.07, 0.11), 0);
  clack(b, 0.3, 0.5, 1.2);
  return normalize(b, 0.75);
}

/** 拿牌 / 选中：轻巧高频「嗒」。 */
function buildPickup() {
  const b = makeBuf(0.12);
  const burst = makeBuf(0.02);
  addNoiseBurst(burst, { dur: 0.02, vol: 1, tau: 0.005 });
  addBuf(b, highpass(burst, 2500), 0, 0.5);
  addOsc(b, { freq: 1900, dur: 0.06, vol: 0.35, tau: 0.02 });
  return normalize(b, 0.6);
}

/** 牌放桌面 / 合并牌组：结实的落牌声。 */
function buildPlace() {
  const b = makeBuf(0.3);
  clack(b, 0, 1, 0.95);
  addOsc(b, { freq: 92, dur: 0.16, vol: 0.4, tau: 0.06 });
  return normalize(b, 0.85);
}

/** 理牌：两段轻滑 + 微咔哒（整理牌序的「唰嗒」感）。 */
function buildSort() {
  const b = makeBuf(0.32);
  for (const t of [0, 0.11]) {
    addBuf(b, sweepNoise(0.08, 0.55, 1800, 3600, 0.008, 0.03), t);
    clack(b, t + 0.05, 0.32, 1.3);
  }
  return normalize(b, 0.65);
}

/** 出牌成功：明亮的三连琶音。 */
function buildSubmit() {
  const b = makeBuf(0.9);
  for (const [t, f] of [[0, 440], [0.09, 554.37], [0.18, 659.25]]) {
    addOsc(b, { freq: f, start: t, dur: 0.5, vol: 0.4, tau: 0.18, type: 'tri' });
    addOsc(b, { freq: f * 2, start: t, dur: 0.3, vol: 0.1, tau: 0.12 });
  }
  addOsc(b, { freq: 1318.5, start: 0.28, dur: 0.4, vol: 0.13, tau: 0.2 });
  return normalize(b, 0.7);
}

/** 操作失败：低沉两声提示。 */
function buildError() {
  const b = makeBuf(0.45);
  addOsc(b, { freq: 150, start: 0, dur: 0.13, vol: 0.55, tau: 0.05, type: 'softSquare' });
  addOsc(b, { freq: 122, start: 0.17, dur: 0.16, vol: 0.55, tau: 0.06, type: 'softSquare' });
  return normalize(lowpass(b, 700), 0.7);
}

/** Pass：下坠的轻风声。 */
function buildPass() {
  const b = makeBuf(0.38);
  addBuf(b, sweepNoise(0.34, 0.7, 2600, 500, 0.05, 0.1), 0);
  addOsc(b, { freq: 180, start: 0.27, dur: 0.08, vol: 0.3, tau: 0.04 });
  return normalize(b, 0.65);
}

/** 胜利：上行琶音 + 和弦垫 + 高音星光。 */
function buildVictory() {
  const b = makeBuf(1.7);
  for (const [t, f] of [[0, 440], [0.12, 554.37], [0.24, 659.25], [0.36, 880]]) {
    addOsc(b, { freq: f, start: t, dur: 0.7, vol: 0.38, tau: 0.28, type: 'tri' });
  }
  for (const f of [440, 554.37, 659.25]) {
    addOsc(b, { freq: f, start: 0.52, dur: 1.1, vol: 0.16, attack: 0.12, tau: 0.5 });
  }
  addOsc(b, { freq: 1760, start: 0.52, dur: 0.6, vol: 0.09, tau: 0.25 });
  return normalize(b, 0.75);
}

/** 结算：柔和的大调和弦收尾（输赢通用）。 */
function buildResult() {
  const b = makeBuf(2.1);
  for (const f of [174.61, 220, 261.63, 329.63]) {
    addOsc(b, { freq: f, dur: 2.0, vol: 0.16, attack: 0.25, tau: 1.1 });
  }
  addOsc(b, { freq: 698.46, start: 0.4, dur: 1.2, vol: 0.11, attack: 0.05, tau: 0.6, type: 'tri' });
  return normalize(b, 0.6);
}

/**
 * 背景音乐：黄昏氛围无缝循环（75 BPM × 4 小节 ≈ 12.8s）。
 * Fmaj7 → Em7 → Am7 → Cmaj7 柔和垫底 + 稀疏五声音阶拨弦 + 轻微黑胶底噪；
 * 循环点用 2.4s 尾部交叉淡化，保证首尾无缝。
 */
function buildBgm() {
  const bar = (60 / 75) * 4; // 3.2s
  const L = bar * 4; // 12.8s 循环长度
  const X = 2.4; // 循环点交叉淡化长度
  const buf = makeBuf(L + X);

  const chords = [
    [174.61, 220.0, 261.63, 329.63], // Fmaj7
    [164.81, 196.0, 246.94, 293.66], // Em7
    [220.0, 261.63, 329.63, 392.0], // Am7
    [261.63, 329.63, 392.0, 493.88], // Cmaj7
  ];

  const addPad = (f, start, dur, vol) => {
    const s0 = Math.floor(start * SR);
    const n = Math.min(Math.ceil(dur * SR), buf.length - s0);
    let ph = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (TAU * f) / SR;
      const a = Math.min(1, t / 0.9); // 慢起音
      const r = Math.min(1, Math.max(0, (dur - t) / 1.1)); // 慢收尾
      buf[s0 + i] += Math.sin(ph) * vol * a * r;
    }
  };

  chords.forEach((chord, ci) => {
    const t0 = ci * bar;
    chord.forEach((f, vi) => {
      addPad(f * (vi === 0 ? 0.998 : 1.003), t0, bar + 0.7, 0.075);
    });
  });

  // 稀疏拨弦（五声音阶点缀，全部落在 L-1.5s 之前，避免循环点切尾）
  const plucks = [
    [0.4, 440], [1.3, 523.25], [2.3, 659.25],
    [3.6, 392], [4.7, 493.88], [5.7, 587.33],
    [6.8, 523.25], [7.9, 440], [8.9, 659.25],
    [10.0, 587.33], [11.0, 523.25],
  ];
  for (const [t, f] of plucks) {
    const p = makeBuf(0.8);
    addOsc(p, { freq: f, dur: 0.8, vol: 0.5, tau: 0.22, type: 'tri' });
    addBuf(buf, lowpass(p, 3200), t, 0.2);
  }

  // 黑胶底噪（极轻，增加暖意）
  const hiss = makeBuf(L + X);
  addNoiseBurst(hiss, { dur: L + X, vol: 0.014, attack: 0.5, tau: 100 });
  addBuf(buf, lowpass(hiss, 900), 0);

  // 循环点交叉淡化：尾段与越过循环点的延续内容互相过渡
  const out = makeBuf(L);
  const Ls = Math.floor(L * SR);
  const Xs = Math.floor(X * SR);
  for (let i = 0; i < Ls; i++) {
    if (i < Ls - Xs) {
      out[i] = buf[i];
    } else {
      const j = i - (Ls - Xs);
      const a = j / Xs;
      out[i] = buf[i] * (1 - a) + buf[Ls + j] * a;
    }
  }
  return normalize(out, 0.5);
}

// ----------------------------------------------------------------------------
// 主流程
// ----------------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });

const sounds = [
  ['bgm.wav', buildBgm],
  ['deal.wav', buildDeal],
  ['draw.wav', buildDraw],
  ['pickup.wav', buildPickup],
  ['place.wav', buildPlace],
  ['sort.wav', buildSort],
  ['submit.wav', buildSubmit],
  ['error.wav', buildError],
  ['pass.wav', buildPass],
  ['victory.wav', buildVictory],
  ['result.wav', buildResult],
];

for (const [name, build] of sounds) {
  const buf = build();
  if (name !== 'bgm.wav') fadeEdges(buf);
  const bytes = writeWav(path.join(OUT_DIR, name), buf);
  console.log(`✓ ${name.padEnd(12)} ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${(buf.length / SR).toFixed(2)}s`);
}
console.log(`\n输出目录: ${OUT_DIR}`);
