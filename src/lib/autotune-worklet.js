// MuseFlow 自动音准（autotune）AudioWorklet 处理器
// 算法：
//   1) 检测：降采样（x2）+ DC 阻断 → 归一化自相关求基频，倍周期（低八度）纠偏 + 抛物线插值细化
//   2) 吸附：基频换算 MIDI，吸附到最近音阶音（半音阶 / 大调 / 小调 × 十二个根音），按强度插值
//   3) 变调：双抽头交叉淡化颗粒移频（delay-line pitch shifter），比率做 ~12ms 平滑
// 关键设计——周期锁定颗粒（PSOLA 思路）：
//   颗粒长度 G 始终锁定为基频的整数倍周期（G = 2·m·T），两个抽头的延迟差 G/2 = m·T
//   也恒为整数周期 → 两抽头永远同相，不会出现梳状滤波抵消（否则男声区恰好半周期反相，
//   会产生 25dB 的深度振幅调制）。G 只在相位回卷点（抽头被窗函数掩蔽时）更新。
// 无外部依赖；sampleRate 为 AudioWorkletGlobalScope 全局变量。

const SCALE_SETS = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // 0 半音阶：全部十二个半音
  [0, 2, 4, 5, 7, 9, 11], // 1 大调（以 C 为基准）
  [0, 2, 3, 5, 7, 8, 10], // 2 小调（以 C 为基准）
];

// 吸附到最近音阶音。root 为根音（0=C, 1=C#, …, 11=B）：
// 先把 MIDI 平移到「以根音为 C」的域里吸附，再平移回来。
// 半音阶与根音无关（十二个半音全集），直接四舍五入。
function snapMidi(midi, scaleIdx, root) {
  if (scaleIdx <= 0) return Math.round(midi);
  const m = midi - root;
  const set = SCALE_SETS[scaleIdx] || SCALE_SETS[0];
  let best = Math.round(m);
  let bestD = Infinity;
  for (let si = 0; si < set.length; si++) {
    const pc = set[si];
    const cand = 12 * Math.round((m - pc) / 12) + pc;
    const d = Math.abs(cand - m);
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best + root;
}

class MfAutotuneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'scale', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'root', defaultValue: 0, minValue: 0, maxValue: 11, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    // ---- 检测（降采样域）----
    this.dec = 2; // 降采样倍数
    this.dsr = sr / this.dec;
    this.detN = 1024; // 检测窗 ~46ms
    this.detBuf = new Float32Array(this.detN); // 环形
    this.detLinear = new Float32Array(this.detN);
    this.detPrefix = new Float32Array(this.detN + 1); // 平方前缀和，加速归一化
    this.detW = 0;
    this.detFilled = 0;
    this.detCount = 0;
    this.detInterval = 512; // 每 ~23ms 检测一次
    this.feedTick = 0;
    this.minLag = Math.max(2, Math.floor(this.dsr / 550)); // 550Hz 上限
    this.maxLag = Math.min(this.detN - 64, Math.ceil(this.dsr / 70)); // 70Hz 下限
    this.vals = new Float32Array(this.maxLag + 2);
    this.f0 = 0;
    this.conf = 0;
    this.dcPrev = 0; // DC 阻断状态
    this.dcHp = 0;
    // ---- 变调（原始采样域）----
    this.G0 = 2048; // 目标颗粒长度（~46ms）
    this.G = 2048; // 当前颗粒长度（周期锁定，随检测微调）
    this.pendingG = 0; // 待应用的 G（等相位回卷点再生效）
    this.dl = 4096; // 环形缓冲，2 的幂 → 位与取模（≥ 最大 G + 余量）
    this.bufs = [new Float32Array(this.dl), new Float32Array(this.dl)];
    this.w = 0;
    this.phase = 0.25;
    this.ratio = 1;
    this.k = 1 - Math.exp(-1 / (sr * 0.012)); // ~12ms 比率平滑（T-Pain 式快 retune）
  }

  feedDetect(x) {
    // 一阶 DC 阻断后写入降采样环形缓冲（按 2 抽 1 取样）
    this.dcHp = x - this.dcPrev + 0.995 * this.dcHp;
    this.dcPrev = x;
    this.detBuf[this.detW] = this.dcHp;
    this.detW = (this.detW + 1) % this.detN;
    if (this.detFilled < this.detN) this.detFilled++;
    this.detCount++;
  }

  detect() {
    const N = this.detN;
    const b = this.detBuf;
    const lin = this.detLinear;
    const w = this.detW;
    for (let i = 0; i < N; i++) lin[i] = b[(w + i) % N];
    const minLag = this.minLag;
    const maxLag = this.maxLag;
    const pref = this.detPrefix;
    pref[0] = 0;
    for (let i = 0; i < N; i++) pref[i + 1] = pref[i] + lin[i] * lin[i];
    const vals = this.vals;
    let best = 0;
    let bestLag = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = lag; i < N; i++) s += lin[i] * lin[i - lag];
      const e1 = pref[N] - pref[lag];
      const e2 = pref[N - lag] - pref[0];
      const v = s / Math.sqrt(Math.max(e1 * e2, 1e-12));
      vals[lag] = v;
      if (v > best) { best = v; bestLag = lag; }
    }
    if (bestLag < 0 || best < 0.35) { this.conf = 0; return; } // 无周期性（噪音/静音）
    // 八度纠偏：优先取更小的合格局部峰（基频），避免锁到倍周期
    for (let lag = minLag; lag < bestLag; lag++) {
      if (vals[lag] > 0.85 * best && vals[lag] >= vals[lag - 1] && vals[lag] >= vals[lag + 1]) {
        bestLag = lag;
        best = vals[lag];
        break;
      }
    }
    // 抛物线插值细化到分数滞后
    let lagF = bestLag;
    const vm = vals[bestLag - 1] || 0;
    const v0 = vals[bestLag];
    const vp = vals[bestLag + 1] || 0;
    const den = vm - 2 * v0 + vp;
    if (Math.abs(den) > 1e-9) {
      let d = (0.5 * (vm - vp)) / den;
      if (d > 0.5) d = 0.5;
      if (d < -0.5) d = -0.5;
      lagF = bestLag + d;
    }
    this.f0 = this.dsr / lagF;
    this.conf = best;
    // ---- 周期锁定颗粒：G = 2·m·T，两个抽头的延迟差 m·T 恒为整数周期 ----
    if (this.f0 >= 70 && this.f0 <= 550) {
      const T = sampleRate / this.f0; // 当前周期（全采样率域）
      const m = Math.max(1, Math.round(this.G0 / (2 * T)));
      this.pendingG = 2 * m * T;
    }
  }

  readTap(buf, pos) {
    // 线性插值读取环形缓冲（pos 可为负、可为分数）
    const dl = this.dl;
    const mask = dl - 1;
    let i0 = Math.floor(pos);
    const frac = pos - i0;
    i0 = ((i0 % dl) + dl) % dl;
    const i1 = (i0 + 1) & mask;
    return buf[i0] + (buf[i1] - buf[i0]) * frac;
  }

  process(inputs, outputs, params) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const input = inputs[0];
    if (!input || !input.length) {
      for (let c = 0; c < output.length; c++) if (output[c]) output[c].fill(0);
      return true;
    }
    const n = input[0].length;
    if (!n) return true;
    const nChIn = Math.min(input.length, 2);
    const nChOut = Math.min(output.length, 2);
    const amount = (params.amount.length ? params.amount[0] : params.amount) / 100;
    const scale = params.scale.length ? params.scale[0] : params.scale;
    const root = params.root.length ? params.root[0] : params.root;
    // 强度 0：真·直通（不经颗粒链，零延迟零染色）
    if (amount <= 0.001) {
      for (let c = 0; c < nChOut; c++) {
        const src = c < nChIn ? input[c] : input[0];
        output[c].set(src);
      }
      this.ratio = 1;
      return true;
    }
    // 喂检测缓冲（用第 0 通道，每 dec 个样本取 1 个）
    for (let i = 0; i < n; i++) {
      this.feedTick++;
      if (this.feedTick >= this.dec) {
        this.feedTick = 0;
        this.feedDetect(input[0][i]);
      }
    }
    if (this.detCount >= this.detInterval && this.detFilled >= this.detN) {
      this.detCount = 0;
      this.detect();
    }
    // 计算目标比率：无周期性 / 静音 → 1（不移调）
    let ratioT = 1;
    if (this.conf > 0.35 && this.f0 >= 70 && this.f0 <= 550) {
      const midi = 69 + 12 * Math.log2(this.f0 / 440);
      const snapped = snapMidi(midi, scale, root);
      ratioT = Math.pow(2, ((snapped - midi) / 12) * amount);
      if (ratioT > 1.6) ratioT = 1.6;
      else if (ratioT < 0.63) ratioT = 0.63;
    }
    // 逐样本处理：共享的 w/phase/ratio 每个样本只前进一次，
    // 各通道写各自缓冲、读各自缓冲——立体声左右严格一致，不会错位
    const G = this.G;
    const mask = this.dl - 1;
    const k = this.k;
    const TWO_PI = Math.PI * 2;
    for (let i = 0; i < n; i++) {
      this.w++;
      this.ratio += (ratioT - this.ratio) * k; // 平滑追踪目标比率
      this.phase += (1 - this.ratio) / G; // 读指针相对写指针的速度差
      let wrapped = false;
      if (this.phase >= 1) { this.phase -= 1; wrapped = true; }
      else if (this.phase < 0) { this.phase += 1; wrapped = true; }
      // 相位回卷点（抽头被窗掩蔽）才应用周期锁定的新颗粒
      if (wrapped && this.pendingG > 0 && this.pendingG < this.dl - 64) {
        this.G = this.pendingG;
        this.pendingG = 0;
      }
      const gNow = this.G;
      const p2raw = this.phase + 0.5;
      const phase2 = p2raw >= 1 ? p2raw - 1 : p2raw;
      const w1 = 0.5 - 0.5 * Math.cos(TWO_PI * this.phase); // Hann，两窗之和恒为 1
      const w2 = 1 - w1;
      const r1 = this.w - 1 - this.phase * gNow;
      const r2 = this.w - 1 - phase2 * gNow;
      for (let c = 0; c < nChOut; c++) {
        const buf = this.bufs[Math.min(c, 1)];
        buf[this.w & mask] = (c < nChIn ? input[c] : input[0])[i];
        output[c][i] = w1 * this.readTap(buf, r1) + w2 * this.readTap(buf, r2);
      }
    }
    return true;
  }
}

registerProcessor('mf-autotune', MfAutotuneProcessor);
