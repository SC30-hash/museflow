// ================== 每轨混音链 ==================
// 信号流：自动音准（AudioWorklet，可用时）→ EQ（超低/低/中/高/空气感 五段）→ 压缩 → 去齿音（LR4 分频压缩）→ 饱和（tanh 软削波）→ 声像 → 干声 + 混响 send
// live 播放（AudioContext）与导出（OfflineAudioContext）共用同一套构建逻辑，
// 保证「听到的 = 导出的」。

// worklet 代码以文本形式打进主包，用 Blob URL 加载——不依赖部署子路径
import autotuneWorkletCode from './autotune-worklet.js?raw';

const _atLoading = new WeakMap(); // ctx → Promise<boolean>
// 把自动音准 worklet 模块装进指定 ctx（每个 ctx 只装一次）。
// 建链前必须 await 它；失败（老浏览器）时返回 false，链路自动退化为无 autotune。
export function loadAutotune(ctx) {
  if (!ctx || !ctx.audioWorklet) return Promise.resolve(false);
  let p = _atLoading.get(ctx);
  if (p) return p;
  p = (async () => {
    if (ctx.__mfAtReady) return true;
    try {
      const url = URL.createObjectURL(new Blob([autotuneWorkletCode], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      ctx.__mfAtReady = true;
      return true;
    } catch (err) {
      console.warn('[MuseFlow] 自动音准 worklet 加载失败，已跳过该效果', err);
      return false;
    }
  })();
  _atLoading.set(ctx, p);
  return p;
}
// 已加载成功时创建 autotune 节点，否则返回 null（直通）
function atNodeFor(ctx) {
  if (!ctx.__mfAtReady) return null;
  try {
    return new AudioWorkletNode(ctx, 'mf-autotune');
  } catch {
    return null;
  }
}

export function defaultFx() {
  return { eqSub: 0, eqLow: 0, eqMid: 0, eqHigh: 0, eqAir: 0, autotune: 0, atScale: 0, deess: 0, sat: 0, comp: 0, reverb: 0, pan: 0 };
}

const clampDb = (v) => (Number.isFinite(v) ? Math.max(-12, Math.min(12, Number(v))) : 0);
const clampPct = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, Number(v))) : 0);
const clampPan = (v) => (Number.isFinite(v) ? Math.max(-100, Math.min(100, Number(v))) : 0);

// 从 track 对象取规范化 fx（老工程缺省字段自动补 0，完全兼容）
export function trackFx(tr) {
  const f = tr && tr.fx;
  if (!f || typeof f !== 'object') return defaultFx();
  return {
    eqSub: clampDb(f.eqSub),
    eqLow: clampDb(f.eqLow),
    eqMid: clampDb(f.eqMid),
    eqHigh: clampDb(f.eqHigh),
    eqAir: clampDb(f.eqAir),
    autotune: clampPct(f.autotune),
    atScale: Number.isFinite(f.atScale) ? Math.max(0, Math.min(2, Math.round(f.atScale))) : 0,
    deess: clampPct(f.deess),
    sat: clampPct(f.sat),
    comp: clampPct(f.comp),
    reverb: clampPct(f.reverb),
    pan: clampPan(f.pan),
  };
}

export function isDefaultFx(fx) {
  return (
    !fx ||
    (fx.eqSub === 0 &&
      fx.eqLow === 0 &&
      fx.eqMid === 0 &&
      fx.eqHigh === 0 &&
      fx.eqAir === 0 &&
      fx.autotune === 0 &&
      fx.deess === 0 &&
      fx.sat === 0 &&
      fx.comp === 0 &&
      fx.reverb === 0 &&
      fx.pan === 0)
  );
}

// 生成的混响脉冲响应：指数衰减白噪声 + 一阶低通柔化高频
export function buildIR(ctx, seconds = 2.4, decay = 2.6) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decay);
      const white = Math.random() * 2 - 1;
      lp += 0.55 * (white - lp);
      d[i] = lp * env;
    }
  }
  return ir;
}

// 主压缩参数映射：0 = 透传（ratio 1:1 / threshold 0dB），100 = 重度
function compParams(amount) {
  const t = amount / 100;
  return {
    threshold: -6 - 28 * t, // -6 → -34 dB
    ratio: 1 + 5 * t, // 1:1 → 6:1
    knee: 8,
    attack: 0.006,
    release: 0.22,
    makeupDb: 4.5 * t, // 0 → +4.5 dB 补偿增益
  };
}

// ---- 去齿音 ----
// 分频点：5.6kHz 附近的「嘶/咝/呲」气声区
const DEESS_FREQ = 5600;
// 压缩参数：0 = 透传（ratio 1:1），100 = 重度
function deessParams(amount) {
  const t = amount / 100;
  return {
    threshold: -2 - 38 * t, // -2 → -40 dB
    ratio: 1 + 7 * t, // 1:1 → 8:1
    knee: 6,
    attack: 0.002, // 齿音来得快，attack 要短
    release: 0.09,
  };
}

// ---- 饱和 ----
// tanh 软削波曲线：t=0 恒等直通；t=1 全量 tanh（峰值归一、小信号抬升 → 更厚更响）
// 4x 过采样减少高频混叠
const SAT_DRIVE = 1.5;
const satCurveCache = new Map();
function satCurveFor(amount) {
  const amt = Math.max(0, Math.min(100, Math.round(amount)));
  let c = satCurveCache.get(amt);
  if (!c) {
    const t = amt / 100;
    const norm = Math.tanh(SAT_DRIVE);
    const n = 4096;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * 2 - 1; // [-1, 1]
      c[i] = (1 - t) * u + t * (Math.tanh(SAT_DRIVE * u) / norm);
    }
    satCurveCache.set(amt, c);
  }
  return c;
}

// 构建一条 FX 链并挂到总线：
// input → sub(80 lowshelf) → low(250 peak) → mid(1k peak) → high(4k peak) → air(10k highshelf)
//        → comp（主压缩）
//        → [去齿音分频] LR4 低通路（直通）+ LR4 高通路 → deessComp（只压齿音频段）
//        → satShaper（饱和）→ makeup ┬ pan → dry → dest
//                                 └ send → reverbBusIn
// LR4 分频（每侧两个 Q=0.707 的 Butterworth 串联）高低两路相加为平直响应，无相位挖坑。
// bypass = 软旁通：不重接线，直接把效果参数归零（EQ 0dB / 压缩 1:1 / 无混响 / 无饱和），
// 避免实时播放时断线重连产生爆音；声像不属于「效果」，旁通时保留。
// 返回 { input, update(fx), setBypass(bool), dispose() }
export function createFxChain(ctx, fx, reverbBusIn, dest) {
  // --- EQ 五段 ---
  const sub = ctx.createBiquadFilter();
  sub.type = 'lowshelf';
  sub.frequency.value = 80;
  const low = ctx.createBiquadFilter();
  low.type = 'peaking';
  low.frequency.value = 250;
  low.Q.value = 0.9;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter();
  high.type = 'peaking';
  high.frequency.value = 4000;
  high.Q.value = 0.8;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 10000;
  // --- 主压缩 ---
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  // --- 去齿音：LR4 分频（低路不动，高路单独压缩再合回）---
  const lp1 = ctx.createBiquadFilter();
  lp1.type = 'lowpass';
  lp1.frequency.value = DEESS_FREQ;
  lp1.Q.value = Math.SQRT1_2;
  const lp2 = ctx.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = DEESS_FREQ;
  lp2.Q.value = Math.SQRT1_2;
  const hp1 = ctx.createBiquadFilter();
  hp1.type = 'highpass';
  hp1.frequency.value = DEESS_FREQ;
  hp1.Q.value = Math.SQRT1_2;
  const hp2 = ctx.createBiquadFilter();
  hp2.type = 'highpass';
  hp2.frequency.value = DEESS_FREQ;
  hp2.Q.value = Math.SQRT1_2;
  const deessComp = ctx.createDynamicsCompressor();
  // --- 饱和 ---
  const satShaper = ctx.createWaveShaper();
  satShaper.oversample = '4x';
  // --- 声像（老 Safari 无 StereoPanner 时退化为直通 Gain）---
  let pan;
  try {
    pan = ctx.createStereoPanner();
  } catch {
    pan = ctx.createGain();
  }
  const dry = ctx.createGain();
  const send = ctx.createGain();
  // --- 自动音准（worklet 已装好才创建；否则直通）---
  const atNode = atNodeFor(ctx);

  // 接线
  if (atNode) atNode.connect(sub);
  sub.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(air);
  air.connect(comp);
  comp.connect(lp1);
  lp1.connect(lp2);
  comp.connect(hp1);
  hp1.connect(hp2);
  hp2.connect(deessComp);
  lp2.connect(satShaper);
  deessComp.connect(satShaper);
  satShaper.connect(makeup);
  makeup.connect(pan);
  pan.connect(dry);
  dry.connect(dest);
  makeup.connect(send);
  if (reverbBusIn) send.connect(reverbBusIn);

  let currentFx = fx || defaultFx();
  let bypassed = false;
  const applyParams = () => {
    // 旁通时按默认参数跑（等效直通），原始参数保留在 currentFx 里随时可恢复；
    // 声像是摆位不是音色处理，旁通时保持
    const f = bypassed ? { ...defaultFx(), pan: currentFx.pan } : currentFx;
    sub.gain.value = f.eqSub;
    low.gain.value = f.eqLow;
    mid.gain.value = f.eqMid;
    high.gain.value = f.eqHigh;
    air.gain.value = f.eqAir;
    const p = compParams(f.comp);
    comp.threshold.value = p.threshold;
    comp.ratio.value = p.ratio;
    comp.knee.value = p.knee;
    comp.attack.value = p.attack;
    comp.release.value = p.release;
    makeup.gain.value = Math.pow(10, p.makeupDb / 20);
    const dp = deessParams(f.deess);
    deessComp.threshold.value = dp.threshold;
    deessComp.ratio.value = dp.ratio;
    deessComp.knee.value = dp.knee;
    deessComp.attack.value = dp.attack;
    deessComp.release.value = dp.release;
    satShaper.curve = satCurveFor(f.sat);
    if (pan.pan) pan.pan.value = f.pan / 100;
    // 自动音准：强度 0 时 worklet 内部直通
    if (atNode) {
      const pa = atNode.parameters.get('amount');
      const ps = atNode.parameters.get('scale');
      if (pa) pa.value = f.autotune;
      if (ps) ps.value = f.atScale;
    }
    // send 曲线取平方：小值更细腻，100% 时约 -1dB 进入混响总线
    send.gain.value = Math.pow(f.reverb / 100, 2) * 0.9;
  };

  const chain = {
    input: atNode || sub,
    update(f) {
      currentFx = f || defaultFx();
      applyParams();
    },
    setBypass(b) {
      const nb = !!b;
      if (nb === bypassed) return;
      bypassed = nb;
      applyParams();
    },
    dispose() {
      [atNode, sub, low, mid, high, air, comp, lp1, lp2, hp1, hp2, deessComp, satShaper, pan, makeup, dry, send].forEach((n) => {
        try { if (n) n.disconnect(); } catch {}
      });
    },
  };
  applyParams();
  return chain;
}

// 混响尾长（秒）——导出时若有轨开了混响，总时长按此延长
export const REVERB_TAIL = 2.4;
