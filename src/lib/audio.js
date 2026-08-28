// src/lib/audio.js
// A tiny Web Audio engine powering the 创作 (sketch) page.

let ctx = null;
let master = null;
let masterBoost = null;
let analyser = null;
let _resuming = null;

// 同步创建音频上下文
function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.8;
  masterBoost = ctx.createGain();
  masterBoost.gain.value = 1.0;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  master.connect(masterBoost).connect(analyser).connect(ctx.destination);
  return ctx;
}

// 获取分析器
export function getAnalyser() { return analyser; }

// 设置主音量
export function setMasterVolume(v) {
  ensure();
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

// 恢复上下文（可安全多次调用）。优先同步触发 resume（用户手势内会立即生效），
// 异步 Promise 仅用于后台静默恢复；避免 await 破坏用户手势上下文
function resumeCtx() {
  if (!ctx || ctx.state !== 'suspended') return;
  if (_resuming) return _resuming;
  try {
    // 先直接同步调用 — 许多浏览器在用户手势线程内会同步切到 running
    const p = ctx.resume();
    if (p && typeof p.then === 'function') {
      _resuming = p.catch(() => {}).finally(() => { _resuming = null; });
    }
  } catch (e) { /* ignore */ }
  return _resuming;
}

// 用户手势入口：确保上下文就绪后播放
// 关键：在用户手势内同步创建上下文 + 同步启动振荡器，
// 避免 await 打断用户手势导致浏览器拒绝播放
function readyCtx() {
  const c = ensure();
  if (c) resumeCtx();
  return c;
}

// 同步强制 resume — 在 start/节拍器这类关键路径使用
function forceResumeCtx() {
  const c = ensure();
  if (!c) return null;
  if (c.state === 'suspended') {
    try {
      const p = c.resume();
      if (p && typeof p.then === 'function') {
        _resuming = p.catch(() => {}).finally(() => { _resuming = null; });
      }
    } catch (e) { /* ignore */ }
  }
  return c;
}

export async function resume() {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch {}
  }
}

// ---- Drum voices ----
// Kick — 低频正弦扫频 + 短瞬态点击层
function kick(c, t) {
  // 诊断：直接接 analyser 验证信号流动
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.13);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(1.5, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(g).connect(master);
  o.connect(g).connect(c.destination);
  if (analyser) o.connect(g).connect(analyser); // 诊断直连
  o.start(t); o.stop(t + 0.42);

  // Sub-bass 层
  const sub = c.createOscillator();
  const sg = c.createGain();
  sub.type = 'sine';
  sub.frequency.value = 60;
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.linearRampToValueAtTime(0.8, t + 0.02);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  sub.connect(sg).connect(master);
  sub.connect(sg).connect(c.destination);
  if (analyser) sub.connect(sg).connect(analyser);
  sub.start(t); sub.stop(t + 0.27);

  // 瞬态点击层
  const click = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.008, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  click.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 2000;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.3, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
  click.connect(hp).connect(cg).connect(master);
  click.connect(hp).connect(cg).connect(c.destination);
  if (analyser) click.connect(hp).connect(cg).connect(analyser);
  click.start(t); click.stop(t + 0.012);
}

function snare(c, t) {
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.2, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  noise.connect(bp).connect(g).connect(master);
  noise.connect(bp).connect(g).connect(c.destination);
  if (analyser) noise.connect(bp).connect(g).connect(analyser);
  noise.start(t); noise.stop(t + 0.2);
}

function hat(c, t) {
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.06, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  noise.connect(hp).connect(g).connect(master);
  noise.connect(hp).connect(g).connect(c.destination);
  if (analyser) noise.connect(hp).connect(g).connect(analyser);
  noise.start(t); noise.stop(t + 0.07);
}

function openHat(c, t) {
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.32, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  noise.connect(hp).connect(g).connect(master);
  noise.connect(hp).connect(g).connect(c.destination);
  if (analyser) noise.connect(hp).connect(g).connect(analyser);
  noise.start(t); noise.stop(t + 0.32);
}

const VOICES = [kick, hat, snare, openHat];
const VOICE_NAMES = ['Kick', 'Hi-hat', 'Snare', 'Open Hat'];

export function voiceName(index) {
  return VOICE_NAMES[index] || '';
}

// Trigger a pad (0-3): Kick / Hi-hat / Snare / Clap。
export function hitPad(index) {
  const c = readyCtx();
  if (!c) return;
  const voice = VOICES[index];
  if (!voice) return;
  voice(c, c.currentTime);
}

// ---- Chord pads（根音 + 模式 动态生成调内和弦）----
// 用户选根音（C/C#/D…12 个）+ 模式（大调/小调），
// 按该调的音阶自动生成 6 个常用和弦（I ii iii IV V vi V7 等）。
// 音名 → 频率（C4 = 261.63Hz）
const NOTE_FREQS = {
  'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
  'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
  'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88,
};
// 半音偏移 → 音名（用于给和弦命名）
const SEMI_TO_NAME = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// 大调音阶：I ii iii IV V vi V7（含属七色彩）
// 小调音阶：i iidim III iv v VI VII7
// 每项 = { deg: 调内级数(0-based), type: 和弦类型 }
const MAJOR_DEGREES = [
  { deg: 0, type: 'maj' },   // I
  { deg: 1, type: 'min' },   // ii
  { deg: 2, type: 'min' },   // iii
  { deg: 3, type: 'maj' },   // IV
  { deg: 4, type: 'maj' },   // V
  { deg: 4, type: 'dom7' },  // V7
];
const MINOR_DEGREES = [
  { deg: 0, type: 'min' },    // i
  { deg: 1, type: 'dim' },   // iidim
  { deg: 2, type: 'maj' },   // III
  { deg: 3, type: 'min' },   // iv
  { deg: 4, type: 'min' },   // v
  { deg: 5, type: 'maj' },   // VI
];

// 大调音阶半音：0 2 4 5 7 9 11；小调音阶半音：0 2 3 5 7 8 10
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// 和弦类型 → 音程堆叠（相对根音的半音数）
const CHORD_INTERVALS = {
  maj:  [0, 4, 7],     // 大三和弦
  min:  [0, 3, 7],     // 小三和弦
  dim:  [0, 3, 6],     // 减三和弦
  dom7: [0, 4, 7, 10], // 属七和弦
};

// 生成和弦名：根音名 + 后缀
function chordName(rootIdx, type) {
  const root = SEMI_TO_NAME[rootIdx];
  const suffix = { maj: '', min: 'm', dim: 'dim', dom7: '7' }[type];
  return root + suffix;
}

// 根据根音 + 模式生成 6 个调内和弦
function buildChords(rootNote, isMinor) {
  const scale = isMinor ? MINOR_SCALE : MAJOR_SCALE;
  const degrees = isMinor ? MINOR_DEGREES : MAJOR_DEGREES;
  const rootIdx = SEMI_TO_NAME.indexOf(rootNote);
  const rootFreq = NOTE_FREQS[rootNote];
  return degrees.map(({ deg, type }) => {
    // 和弦根音 = 调内第 deg 级的半音偏移
    const chordRootSemi = scale[deg % scale.length];
    const chordRootIdx = (rootIdx + chordRootSemi) % 12;
    // 和弦各音 = 根音 + 音程堆叠
    const intervals = CHORD_INTERVALS[type];
    const steps = intervals.map((iv) => chordRootSemi + iv);
    const name = chordName(chordRootIdx, type);
    return { name, steps };
  });
}

let currentRoot = 'C';
let currentMode = 'major'; // 'major' | 'minor'
let currentKeyLabelCache = 'C 大调';

function rebuildKey() {
  const isMinor = currentMode === 'minor';
  currentKeyLabelCache = `${currentRoot} ${isMinor ? '小调' : '大调'}`;
}

export function setRoot(note) {
  if (NOTE_FREQS[note]) { currentRoot = note; rebuildKey(); }
}
export function setMode(mode) {
  if (mode === 'major' || mode === 'minor') { currentMode = mode; rebuildKey(); }
}
export function getRoot() { return currentRoot; }
export function getMode() { return currentMode; }
export function currentKeyLabel() { return currentKeyLabelCache; }
export function currentChords() {
  return buildChords(currentRoot, currentMode === 'minor');
}
// 兼容旧调用：返回根音频率
export function rootFreq() { return NOTE_FREQS[currentRoot]; }

// ---- 和弦音色与演奏模式 ----
let currentChordVoice = 'piano'; // piano | pad | guitar | e-guitar
let currentChordStyle = 'block'; // block（柱式） | strum（扫弦）

export function setChordVoice(v) {
  if (['piano', 'pad', 'guitar', 'e-guitar'].includes(v)) currentChordVoice = v;
}
export function getChordVoice() { return currentChordVoice; }
export function setChordStyle(s) {
  if (['block', 'strum'].includes(s)) currentChordStyle = s;
}
export function getChordStyle() { return currentChordStyle; }

// 统一的和弦发声：根据音色 + 演奏方式合成
export function hitChord(index) {
  const c = readyCtx();
  if (!c) return;
  const chords = currentChords();
  const chord = chords[index] || chords[0];
  const t = c.currentTime;
  const style = currentChordStyle;

  if (style === 'strum') {
    const strumSpan = 0.035 * (chord.steps.length - 1);
    chord.steps.forEach((semi, i) => {
      const noteTime = t + i * 0.035;
      playChordNote(c, semi, noteTime, i, chord.steps.length, strumSpan);
    });
  } else {
    chord.steps.forEach((semi, i) => {
      playChordNote(c, semi, t, i, chord.steps.length, 0);
    });
  }
}

// 合成单个和弦音符（根据当前音色）
function playChordNote(c, semi, t, voiceIdx, totalVoices, strumSpan) {
  const f = rootFreq() * Math.pow(2, semi / 12);
  // 低音音量稍大，高音递减
  const baseVol = voiceIdx === 0 ? 0.9 : voiceIdx === 1 ? 0.6 : 0.42;

  switch (currentChordVoice) {
    case 'pad':
      synthPadNote(c, t, f, baseVol, strumSpan);
      break;
    case 'guitar':
      synthGuitarNote(c, t, f, baseVol, strumSpan);
      break;
    case 'e-guitar':
      synthEGuitarNote(c, t, f, baseVol, strumSpan);
      break;
    case 'piano':
    default:
      synthPianoNote(c, t, f, baseVol, strumSpan);
      break;
  }
}

// ---- Piano (电钢 Rhodes) ----
function synthPianoNote(c, t, f, vol, strumSpan) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);

  // 正弦波 - 同时连接到 master 和 destination
  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = f;
  o1.connect(g);

  // 泛音增加亮度
  const o2 = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = f * 2;
  const v2 = c.createGain();
  v2.gain.value = 0.3;
  o2.connect(v2).connect(g);

  g.connect(master);
  g.connect(c.destination);
  if (analyser) g.connect(analyser);

  o1.start(t);
  o2.start(t);
  o1.stop(t + 1.5);
  o2.stop(t + 1.5);
}

// ---- Pad (柔和合成垫) ----
function synthPadNote(c, t, f, vol, strumSpan) {
  const attack = 0.04 + strumSpan * 0.6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.55, t + attack);
  g.gain.linearRampToValueAtTime(vol * 0.5, t + attack + 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + 2.5);

  // 主音：sawtooth + sine 叠加
  const o1 = c.createOscillator();
  o1.type = 'sawtooth'; o1.frequency.value = f;
  const v1 = c.createGain(); v1.gain.value = vol * 0.35;
  o1.connect(v1).connect(g);

  const o2 = c.createOscillator();
  o2.type = 'sine'; o2.frequency.value = f;
  const v2 = c.createGain(); v2.gain.value = vol * 0.5;
  o2.connect(v2).connect(g);

  // 轻微 detune
  const o3 = c.createOscillator();
  o3.type = 'sine'; o3.frequency.value = f * 1.005;
  const v3 = c.createGain(); v3.gain.value = vol * 0.3;
  o3.connect(v3).connect(g);

  g.connect(master);
  g.connect(c.destination);
  if (analyser) g.connect(analyser);
  o1.start(t); o2.start(t); o3.start(t);
  o1.stop(t + 3); o2.stop(t + 3); o3.stop(t + 3);
}

// ---- Guitar (木吉他拨弦) ----
function synthGuitarNote(c, t, f, vol, strumSpan) {
  const attack = 0.003 + strumSpan * 0.3;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.55, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + 0.35);

  // 主体：三角波 + pitch 下滑
  const o1 = c.createOscillator();
  o1.type = 'triangle'; o1.frequency.setValueAtTime(f, t);
  o1.frequency.exponentialRampToValueAtTime(f * 0.98, t + 0.08);
  const v1 = c.createGain(); v1.gain.value = vol;
  o1.connect(v1).connect(g);

  // 高频拨弦瞬态
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.015, c.sampleRate);
  const nd = buf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
  noise.buffer = buf;
  const ng = c.createGain();
  ng.gain.setValueAtTime(vol * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.01);
  noise.connect(ng).connect(g);
  noise.start(t); noise.stop(t + 0.02);

  g.connect(master);
  g.connect(c.destination);
  if (analyser) g.connect(analyser);
  o1.start(t); o1.stop(t + 0.4);
}

// ---- E-guitar (电吉他失真) ----
function synthEGuitarNote(c, t, f, vol, strumSpan) {
  const attack = 0.002 + strumSpan * 0.3;
  // 简化版失真：直接用 sawtooth + 轻微削波
  const shaper = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 512) - 1;
    curve[i] = Math.tanh(x * 3);
  }
  shaper.curve = curve;
  shaper.oversample = '4x';

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.45, t + attack);
  g.gain.exponentialRampToValueAtTime(vol * 0.2, t + attack + 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + 0.6);

  const o1 = c.createOscillator();
  o1.type = 'sawtooth'; o1.frequency.setValueAtTime(f, t);
  o1.frequency.exponentialRampToValueAtTime(f * 0.985, t + 0.1);
  const v1 = c.createGain(); v1.gain.value = vol * 0.55;
  o1.connect(v1).connect(g);

  const o2 = c.createOscillator();
  o2.type = 'square'; o2.frequency.setValueAtTime(f * 2, t);
  o2.frequency.exponentialRampToValueAtTime(f * 2 * 0.98, t + 0.08);
  const v2 = c.createGain(); v2.gain.value = vol * 0.12;
  o2.connect(v2).connect(g);

  g.connect(shaper).connect(master);
  shaper.connect(c.destination);
  if (analyser) shaper.connect(analyser);
  o1.start(t); o2.start(t);
  o1.stop(t + 0.7); o2.stop(t + 0.2);
}

// ---- Transport / metronome ----
// 序列器以 16 分音符为最小单位。一个 4 拍 loop = 16 步。
let timer = null;
let stepIndex = 0;
let stepsPerLoop = 16; // 4 拍 × 4 个 16 分
let bpm = 110;
let onStep = () => {};
let metroOn = true;

export function setBpm(v) { bpm = Math.max(40, Math.min(200, v)); }
export function setBeats(n) { stepsPerLoop = Math.max(1, Math.min(16, n)) * 4; }
export function onBeatEvent(cb) { onStep = cb; }
export function setMetronome(on) { metroOn = !!on; }

// 多音轨 loop：每个音色 = 一条音轨（FL Studio 步进音序器风格）。
// Kick 一条轨、Snare 一条轨…同一音色的所有命中步位都放在该轨内。
// 可整轨删除、可拖动单步改位置、可点击单步删除。
let tracks = []; // [{id, type:'pad'|'chord', idx, steps:Set<number>}, ...]
let isRecording = false;
let isLooping = false;
// 支持多个订阅者（按钮同步 + 轨道重渲染都需要监听状态变化）
let loopStateCbs = [];
const emitLoopState = () => { loopStateCbs.forEach((cb) => cb()); };

// 按音色查找或创建音轨：同一种声音（type+idx）共用一条轨。
function getOrCreateTrack(type, idx) {
  let t = tracks.find((tr) => tr.type === type && tr.idx === idx);
  if (!t) {
    t = { id: `trk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type, idx, steps: new Set() };
    tracks.push(t);
  }
  return t;
}
function resizeTracks() {
  // 步数变化时，把超出范围的步从各轨剔除。
  tracks.forEach((t) => {
    [...t.steps].forEach((s) => { if (s >= stepsPerLoop) t.steps.delete(s); });
  });
}

export function setLoopLength(beats) {
  setBeats(beats);
  resizeTracks();
}
export function getTracks() {
  // 返回可序列化视图：步集合转数组
  return tracks.map((t) => ({ ...t, steps: [...t.steps].sort((a, b) => a - b) }));
}
// 按 id 查单轨（UI 触发音色用）
export function getTrack(trackId) {
  const t = tracks.find((tr) => tr.id === trackId);
  return t ? { type: t.type, idx: t.idx } : null;
}
// 删除整条音轨（= 删除该音色全部命中）
export function removeTrack(trackId) {
  tracks = tracks.filter((t) => t.id !== trackId);
  emitLoopState();
}
// 删除某轨内某个命中步
export function removeTrackHit(trackId, step) {
  const t = tracks.find((tr) => tr.id === trackId);
  if (t) { t.steps.delete(step); emitLoopState(); }
}
// 添加某轨内某个命中步（点击空白格直接添加）
export function addTrackHit(trackId, step) {
  const t = tracks.find((tr) => tr.id === trackId);
  if (t && step >= 0 && step < stepsPerLoop) { t.steps.add(step); emitLoopState(); }
}
// 移动某轨内某个命中步到新位置（FL Studio 风格拖动改位置）
export function moveTrackHit(trackId, oldStep, newStep) {
  const t = tracks.find((tr) => tr.id === trackId);
  if (t && newStep >= 0 && newStep < stepsPerLoop) {
    t.steps.delete(oldStep);
    t.steps.add(newStep);
    emitLoopState();
  }
}
export function isRecOn() { return isRecording; }
export function isLoopOn() { return isLooping; }
export function onLoopState(cb) { loopStateCbs.push(cb); }

export function startRecording() {
  isRecording = true;
  tracks = []; // 开始录制清空旧 loop
  // 录制起点：transport 未启动时按首次点击的相对时间量化，
  // 启动时则复用 loopCycleStart 与节拍器对齐（tick 里会刷新）。
  const c = ensure();
  recStart = c ? c.currentTime : 0;
  emitLoopState();
}
export function stopRecording() {
  isRecording = false;
  emitLoopState();
}
export function clearLoop() {
  tracks = [];
  emitLoopState();
}

// 手动触发（点垫/和弦）时，若正在录制，记入对应音色轨。
// 用 ctx.currentTime 精确计算步位，量化到最近步。
// 录制不依赖播放：transport 未启动时，首次点击即开始计时。
let loopCycleStart = 0;
let recStart = 0; // 录制起点（currentTime）

export function recordHit(type, idx) {
  if (!isRecording) return;
  const c = ensure();
  if (!c) return;
  const stepDur = 60 / bpm / 4;
  // 用录制起点计时：transport 跑时复用 loopCycleStart（与节拍器对齐），
  // 否则用 recStart（首次点击时刻）按相对时间量化。
  const base = timer ? loopCycleStart : recStart;
  const elapsed = c.currentTime - base;
  let stepPos = Math.round(elapsed / stepDur);
  const i = ((stepPos % stepsPerLoop) + stepsPerLoop) % stepsPerLoop;
  const t = getOrCreateTrack(type, idx);
  t.steps.add(i);
  emitLoopState();
}

function tick() {
  const c = readyCtx();
  if (!c) return;
  // 如果 ctx 仍 suspended（少见），强制 resume
  if (c.state === 'suspended') { try { c.resume(); } catch {} }
  const t = Math.max(c.currentTime, c.currentTime + 0.001); // 确保在"现在或稍后"调度，避免 -Infinity 异常
  if (stepIndex === 0) loopCycleStart = c.currentTime;
  // 节拍器：每拍第 1 个 16 分音符响一次
  // 录制时需要节拍器做参考，但播放循环段时不要响（避免被误认为录进了 loop）
  if (stepIndex % 4 === 0 && metroOn && (isRecording || !isLooping)) {
    const accent = stepIndex === 0;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 880 : 440;
    const vol = accent ? 0.3 : 0.18;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(master);
    o.connect(g).connect(c.destination);
    if (analyser) o.connect(g).connect(analyser);
    try { o.start(t); o.stop(t + 0.09); } catch (e) {}
  }
  // Loop 回放
  if (isLooping) {
    for (const tr of tracks) {
      if (tr.steps.has(stepIndex)) {
        if (tr.type === 'pad') hitPad(tr.idx);
        else if (tr.type === 'chord') hitChord(tr.idx);
      }
    }
    if (stepIndex === 0 && micTracks.length) triggerMicPlayback(c, t);
  }
  onStep(stepIndex);
  stepIndex = (stepIndex + 1) % stepsPerLoop;
}

export function start() {
  const c = forceResumeCtx();
  if (!c) return;
  stepIndex = 0;
  loopCycleStart = c.currentTime;
  if (tracks.length && !isRecording) {
    isLooping = true;
    emitLoopState();
  }
  const interval = 60 / bpm / 4;
  tick();
  timer = setInterval(tick, interval * 1000);
}

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  // 停掉所有活跃的麦克风回放 source
  micSources.forEach((s) => { try { s.stop(); } catch {} });
  micSources = [];
}

export function isRunning() { return timer !== null; }
export function getStep() { return stepIndex; }
export function getStepsPerLoop() { return stepsPerLoop; }

export function setLooping(on) {
  isLooping = on;
  emitLoopState();
}

// ---- 麦克风录音轨：录人声/乐器，叠加到循环段一起回放 ----
// 与步进音轨（kick/snare…）不同，麦克风轨是连续音频 buffer。
// 回放时每个 loop 周期起点（stepIndex === 0）重新触发一次该 buffer。
let micTracks = []; // [{id, buffer, name}]
let micSources = []; // 当前活跃的回放 source（下一周期会先停掉）
let micRecorder = null;
let micStream = null;
let micChunks = [];
let isMicRecording = false;

export function isMicRecOn() { return isMicRecording; }
export function getMicTracks() {
  return micTracks.map((t) => ({ id: t.id, name: t.name, duration: t.buffer.duration }));
}
export function removeMicTrack(id) {
  micTracks = micTracks.filter((t) => t.id !== id);
  emitLoopState();
}

// 开始麦克风录音（异步获取麦克风权限 + MediaRecorder）
export async function startMicRecording() {
  const c = ensure();
  if (!c || micRecorder) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream = stream;
    micChunks = [];
    // 优先用 audio/webm，回退到默认
    let mime = '';
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported(m)) { mime = m; break; }
    }
    micRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    micRecorder.ondataavailable = (e) => { if (e.data && e.data.size) micChunks.push(e.data); };
    micRecorder.start();
    isMicRecording = true;
    emitLoopState();
    return true;
  } catch (e) {
    micStream = null;
    micRecorder = null;
    isMicRecording = false;
    return false;
  }
}

// 停止录音 → 把数据转成 AudioBuffer 存为一条麦克风轨
export function stopMicRecording() {
  if (!micRecorder) return Promise.resolve(null);
  return new Promise((resolve) => {
    micRecorder.onstop = async () => {
      try {
        const blob = new Blob(micChunks, { type: micRecorder.mimeType || 'audio/webm' });
        const arr = await blob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arr);
        const track = {
          id: `mic_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          buffer: audioBuf,
          name: `麦克风 ${micTracks.length + 1}`,
        };
        micTracks.push(track);
        resolve(track.id);
      } catch (e) {
        resolve(null);
      } finally {
        // 关掉麦克风
        if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
        micRecorder = null;
        micChunks = [];
        isMicRecording = false;
        emitLoopState();
      }
    };
    micRecorder.stop();
  });
}

// 在 tick() 中调用：loop 回到起点时，重新触发所有麦克风轨回放。
function triggerMicPlayback(c, t) {
  // 先停掉上一轮还在响的 source
  micSources.forEach((s) => { try { s.stop(); } catch {} });
  micSources = [];
  for (const mt of micTracks) {
    const src = c.createBufferSource();
    src.buffer = mt.buffer;
    src.connect(master);
    src.start(t);
    micSources.push(src);
  }
}

// ---- Loop 导出（录音 → WAV 文件）----
// 录制一个完整的循环周期（步进音轨 + 麦克风轨）到 OfflineAudioContext，
// 生成 WAV Blob 供下载。需要 ctx（主 AudioContext）获取 sampleRate。
export async function exportLoopAsWav() {
  const c = ensure();
  if (!c) return null;
  const sampleRate = c.sampleRate;
  const stepDur = 60 / bpm / 4;
  const loopSec = stepsPerLoop * stepDur;
  const chCount = 2; // 立体声

  // Offline 渲染器：录一个 loop 长度
  const off = new OfflineAudioContext(chCount, Math.ceil(loopSec * sampleRate), sampleRate);

  // 每个音色对应一个声音合成函数（复用实时引擎的逻辑），
  // 但直接写到 Offline 输出而非 master 总线。
  // 我们简化为：为每条步进音轨在对应步位触发声音，写到一个临时增益，
  // 再通过一个主增益 → Offline 输出。
  const offMaster = off.createGain();
  offMaster.gain.value = 0.9;
  offMaster.connect(off.destination);

  // 步进音轨回放
  for (const tr of tracks) {
    for (const step of tr.steps) {
      const t = step * stepDur;
      if (tr.type === 'pad') {
        // 合成鼓声到 offline context
        voiceToOffline(off, tr.idx, t, offMaster);
      } else if (tr.type === 'chord') {
        chordToOffline(off, tr.idx, t, offMaster);
      }
    }
  }

  // 麦克风轨：如果 buffer 比 loop 短，就用它的实际长度；长则截断。
  for (const mt of micTracks) {
    const dur = Math.min(mt.buffer.duration, loopSec);
    // 用 BufferSource 把音频写入 offline
    const src = off.createBufferSource();
    src.buffer = mt.buffer;
    const srcGain = off.createGain();
    srcGain.gain.value = 0.9;
    src.connect(srcGain).connect(offMaster);
    src.start(0);
    src.stop(dur || loopSec);
  }

  // 渲染整段
  const rendered = await off.startRendering();

  // 编码为 WAV
  return audioBufferToWav(rendered);
}

// 把当前 Voice（kick/snare/hat/openHat）合成到 offline context
function voiceToOffline(offCtx, idx, t, dest) {
  // 复用 kick/snare/hat/openHat 函数，但输出到 dest 而非 master
  const voices = [offKick, offHat, offSnare, offOpenHat];
  const fn = voices[idx];
  if (fn) fn(offCtx, t, dest);
}

function chordToOffline(offCtx, idx, t, dest) {
  const chords = currentChords();
  const chord = chords[idx] || chords[0];
  const style = currentChordStyle;

  if (style === 'strum') {
    chord.steps.forEach((semi, i) => {
      const noteTime = t + i * 0.035;
      playChordNoteTo(offCtx, semi, noteTime, i, chord.steps.length, 0.035 * (chord.steps.length - 1), dest);
    });
  } else {
    chord.steps.forEach((semi, i) => {
      playChordNoteTo(offCtx, semi, t, i, chord.steps.length, 0, dest);
    });
  }
}

// 与 playChordNote 相同，但输出到指定 destination（offline master）
function playChordNoteTo(c, semi, t, voiceIdx, totalVoices, strumSpan, dest) {
  const f = rootFreq() * Math.pow(2, semi / 12);
  const baseVol = voiceIdx === 0 ? 0.9 : voiceIdx === 1 ? 0.6 : 0.42;

  switch (currentChordVoice) {
    case 'pad':
      padNoteTo(c, t, f, baseVol, strumSpan, dest);
      break;
    case 'guitar':
      guitarNoteTo(c, t, f, baseVol, strumSpan, dest);
      break;
    case 'e-guitar':
      eGuitarNoteTo(c, t, f, baseVol, strumSpan, dest);
      break;
    case 'piano':
    default:
      pianoNoteTo(c, t, f, baseVol, strumSpan, dest);
      break;
  }
}

function pianoNoteTo(c, t, f, vol, strumSpan, dest) {
  const attack = 0.008 + strumSpan * 0.5;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 3200;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.38, t + attack);
  g.gain.exponentialRampToValueAtTime(vol * 0.24, t + attack + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + 1.6);
  g.connect(lp).connect(dest);
  const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
  const v1 = c.createGain(); v1.gain.value = vol;
  o1.connect(v1).connect(g);
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
  const v2 = c.createGain(); v2.gain.value = vol * 0.5;
  o2.connect(v2).connect(g);
  const o3 = c.createOscillator(); o3.type = 'sine'; o3.frequency.value = f * 3.5;
  const v3 = c.createGain();
  v3.gain.setValueAtTime(vol * 0.28, t);
  v3.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o3.connect(v3).connect(g);
  o1.start(t); o2.start(t); o3.start(t);
  o1.stop(t + 2); o2.stop(t + 2); o3.stop(t + 0.15);
}

function padNoteTo(c, t, f, vol, strumSpan, dest) {
  const attack = 0.04 + strumSpan * 0.6;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.55, t + attack);
  g.gain.linearRampToValueAtTime(vol * 0.5, t + attack + 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + 2.5);
  g.connect(lp).connect(dest);
  const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
  const v1 = c.createGain(); v1.gain.value = vol * 0.35;
  o1.connect(v1).connect(g);
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
  const v2 = c.createGain(); v2.gain.value = vol * 0.5;
  o2.connect(v2).connect(g);
  const o3 = c.createOscillator(); o3.type = 'sine'; o3.frequency.value = f * 1.005;
  const v3 = c.createGain(); v3.gain.value = vol * 0.3;
  o3.connect(v3).connect(g);
  o1.start(t); o2.start(t); o3.start(t);
  o1.stop(t + 3); o2.stop(t + 3); o3.stop(t + 3);
}

function guitarNoteTo(c, t, f, vol, strumSpan, dest) {
  const attack = 0.003 + strumSpan * 0.3;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.55, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + 0.35);
  g.connect(bp).connect(dest);
  const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.setValueAtTime(f, t);
  o1.frequency.exponentialRampToValueAtTime(f * 0.98, t + 0.08);
  const v1 = c.createGain(); v1.gain.value = vol;
  o1.connect(v1).connect(g);
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.015, c.sampleRate);
  const nd = buf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
  noise.buffer = buf;
  const nhp = c.createBiquadFilter(); nhp.type = 'highpass'; nhp.frequency.value = 3000;
  const ng = c.createGain();
  ng.gain.setValueAtTime(vol * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.01);
  noise.connect(nhp).connect(ng).connect(g);
  noise.start(t); noise.stop(t + 0.02);
  o1.start(t); o1.stop(t + 0.4);
}

function eGuitarNoteTo(c, t, f, vol, strumSpan, dest) {
  const attack = 0.002 + strumSpan * 0.3;
  const shaper = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 512) - 1;
    curve[i] = Math.tanh(x * 3);
  }
  shaper.curve = curve; shaper.oversample = '4x';
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.45, t + attack);
  g.gain.exponentialRampToValueAtTime(vol * 0.2, t + attack + 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + 0.6);
  g.connect(shaper).connect(lp).connect(dest);
  const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(f, t);
  o1.frequency.exponentialRampToValueAtTime(f * 0.985, t + 0.1);
  const v1 = c.createGain(); v1.gain.value = vol * 0.55;
  o1.connect(v1).connect(g);
  const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(f * 2, t);
  o2.frequency.exponentialRampToValueAtTime(f * 2 * 0.98, t + 0.08);
  const v2 = c.createGain(); v2.gain.value = vol * 0.12;
  o2.connect(v2).connect(g);
  o1.start(t); o2.start(t);
  o1.stop(t + 0.7); o2.stop(t + 0.2);
}

// Offline 版 kick / snare / hat / openHat — 结构同实时版，输出到 dest
function offKick(c, t, dest) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.13);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(1.5, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + 0.42);

  const sub = c.createOscillator();
  const sg = c.createGain();
  sub.type = 'sine';
  sub.frequency.value = 60;
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.linearRampToValueAtTime(0.8, t + 0.02);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  sub.connect(sg).connect(dest);
  sub.start(t); sub.stop(t + 0.27);

  const click = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.008, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  click.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 2000;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.3, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
  click.connect(hp).connect(cg).connect(dest);
  click.start(t); click.stop(t + 0.012);
}

function offSnare(c, t, dest) {
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.2, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  noise.connect(bp).connect(g).connect(dest);
  noise.start(t); noise.stop(t + 0.2);
}

function offHat(c, t, dest) {
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.06, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  noise.connect(hp).connect(g).connect(dest);
  noise.start(t); noise.stop(t + 0.07);
}

function offOpenHat(c, t, dest) {
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.32, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  noise.connect(hp).connect(g).connect(dest);
  noise.start(t); noise.stop(t + 0.32);
}

// AudioBuffer → WAV Blob（PCM 16-bit）
function audioBufferToWav(buf) {
  const numCh = buf.numberOfChannels;
  const sampleRate = buf.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const length = buf.length * numCh * (bitDepth / 8) + 44;
  const ab = new ArrayBuffer(length);
  const view = new DataView(ab);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, length - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * (bitDepth / 8), true);
  view.setUint16(32, numCh * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length - 44, true);

  // 交错写入 PCM 样本
  const channels = [];
  for (let i = 0; i < numCh; i++) channels.push(buf.getChannelData(i));

  let offset = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
