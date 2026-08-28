// src/pages/capture.js — Studio-One style multi-track arranger (灵感页)
// - 多个录音轨（可随时"加轨"），每个轨有 Mute / Solo / Record-Arm 三个开关
// - 伴奏导入后作为第一条特殊轨，也可 Mute / Solo
// - Transport: ■ 停止 / ▶ 播放 / ● 录音 三个按钮 + 时间显示 + playhead
// - 录音: 所有被 Arm 的轨同时从 playhead 位置开始录（MediaRecorder 多实例复用同麦克风流）
// - 播放: 所有非 Mute（遵循 Solo）的 audio clips 按 startTime/duration 精确定时同步播
// - 每个 clip 可点删除；整条轨可删（除伴奏轨）；保存工程: 所有 Blob 转 base64 持久化

import { refreshIcons, swapIcon } from '../lib/nav.js';
import { captures, lyrics, nowstamp, uid } from '../lib/store.js';

const REC_MODE = 'rec';
const TEXT_MODE = 'text';
let mode = REC_MODE;

const recordPanel = document.getElementById('record-panel');
const textPanel = document.getElementById('text-panel');
const toggle = document.getElementById('mode-toggle');

// ================== Mode toggle ==================
function setMode(next) {
  mode = next;
  const buttons = toggle.querySelectorAll('button');
  buttons.forEach((b) => {
    const active = b.dataset.mode === next;
    b.setAttribute('aria-pressed', String(active));
    b.className = active
      ? 'flex-1 py-2 text-sm font-medium rounded-lg bg-card text-foreground shadow-sm'
      : 'flex-1 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground transition-colors duration-150';
  });
  recordPanel.style.display = next === REC_MODE ? 'flex' : 'none';
  textPanel.style.display = next === TEXT_MODE ? 'block' : 'none';
  if (next === REC_MODE && transportState === 'rec') {
    // 不打断录音
  }
}
toggle?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (btn) setMode(btn.dataset.mode);
});

// ================== 命名模态框 ==================
const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('name-input');
let nameResolver = null; // Promise resolver for the name dialog

function openNameModal(defaultValue) {
  nameInput.value = defaultValue || '';
  nameModal.style.display = 'flex';
  setTimeout(() => nameInput.focus(), 50);
  return new Promise((resolve) => {
    nameResolver = resolve;
  });
}
function closeNameModal() {
  nameModal.style.display = 'none';
  if (nameResolver) { nameResolver(null); nameResolver = null; }
}
document.getElementById('name-close')?.addEventListener('click', closeNameModal);
document.getElementById('name-cancel')?.addEventListener('click', closeNameModal);
document.getElementById('name-confirm')?.addEventListener('click', () => {
  const val = nameInput.value.trim();
  closeNameModal();
  if (nameResolver) { nameResolver(val); nameResolver = null; }
});
nameModal?.addEventListener('click', (e) => {
  if (e.target === nameModal) closeNameModal();
});
nameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('name-confirm').click();
  if (e.key === 'Escape') closeNameModal();
});

// ================== 确认弹框（通用） ==================
const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
let confirmResolver = null;

function openConfirm(message) {
  confirmMessage.textContent = message || '确认继续？';
  confirmModal.style.display = 'flex';
  if (window.refreshIcons) window.refreshIcons();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}
function closeConfirm(result) {
  confirmModal.style.display = 'none';
  if (confirmResolver) { confirmResolver(!!result); confirmResolver = null; }
}
document.getElementById('confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
document.getElementById('confirm-ok')?.addEventListener('click', () => closeConfirm(true));
confirmModal?.addEventListener('click', (e) => {
  if (e.target === confirmModal) closeConfirm(false);
});
document.addEventListener('keydown', (e) => {
  if (confirmModal.style.display === 'flex') {
    if (e.key === 'Escape') closeConfirm(false);
    if (e.key === 'Enter') closeConfirm(true);
  }
});

// ================== Text capture save ==================
// 文字灵感只保存到「歌词」板块，不混入「最近捕捉」
function saveTextIdea(body, titleOverride) {
  if (!body) return;
  const defaultName = body.split('\n')[0].slice(0, 12) || (body.length > 12 ? body.slice(0, 12) + '…' : body);
  const title = titleOverride || defaultName;
  // 只保存到「歌词」板块
  lyrics.add({ title, body, date: nowstamp() });
  window.MFToast('已保存到歌词');
}

// 文字面板保存按钮（文字模式下的面板）
document.getElementById('save-text-btn')?.addEventListener('click', async () => {
  const ta = document.getElementById('idea-text');
  const body = (ta?.value || '').trim();
  if (!body) { window.MFToast('写点什么再保存'); return; }
  const defaultName = body.split('\n')[0].slice(0, 12) || body.slice(0, 12);
  const name = await openNameModal(defaultName);
  if (name === null) return;
  saveTextIdea(body, name || defaultName);
  ta.value = '';
});

// 快捷文字保存模态框（任意模式下都可用）
const quickTextModal = document.getElementById('quick-text-modal');
const quickTextBtn = document.getElementById('quick-text-btn');
const quickTextClose = document.getElementById('quick-text-close');
const quickTextArea = document.getElementById('quick-text-area');
const quickTextSave = document.getElementById('quick-text-save');

function openQuickTextModal() {
  quickTextArea.value = '';
  quickTextModal.style.display = 'flex';
  setTimeout(() => quickTextArea.focus(), 50);
}
function closeQuickTextModal() {
  quickTextModal.style.display = 'none';
}
if (quickTextBtn) quickTextBtn.addEventListener('click', openQuickTextModal);
quickTextClose?.addEventListener('click', closeQuickTextModal);
quickTextModal?.addEventListener('click', (e) => {
  if (e.target === quickTextModal) closeQuickTextModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && quickTextModal.style.display === 'flex') closeQuickTextModal();
});
quickTextSave?.addEventListener('click', async () => {
  const body = quickTextArea.value.trim();
  if (!body) { window.MFToast('写点什么再保存'); return; }
  const defaultName = body.split('\n')[0].slice(0, 12) || (body.length > 12 ? body.slice(0, 12) + '…' : body);
  const name = await openNameModal(defaultName);
  if (name === null) return;
  saveTextIdea(body, name || defaultName);
  closeQuickTextModal();
});
// Ctrl/Cmd + Enter in quick text area
quickTextArea?.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') quickTextSave.click();
});

// ================== Toast ==================
const toastEl = document.getElementById('toast');
let toastTimer = null;
window.MFToast = (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
};

// ================== Helpers ==================
const PX_PER_SEC = 40;        // arranger 区 40px = 1 秒
const CHANNEL_PX = 140;

// 动态计算时间轴总时长：所有 clip 最大值 + 缓冲，最少 30s
// 录音中：clip 还未加入数组，需用 currentSeconds() 兜底，保证时间轴随录音长度扩展
function getTotalDuration() {
  let maxEnd = 0;
  for (const tr of project.tracks) {
    for (const c of (tr.clips || [])) {
      const end = (c.startTime || 0) + (c.duration || 0);
      if (end > maxEnd) maxEnd = end;
    }
  }
  // 录音中：把当前时间也纳入，否则 clip 未加入时 maxEnd=0 → 总时长固定 30s
  if (transportState === 'rec') {
    const t = currentSeconds();
    if (t > maxEnd) maxEnd = t;
  }
  // 录音中缓冲 5s（滚动跟随），其他场景 10s
  const buffer = transportState === 'rec' ? 5 : 10;
  return Math.max(30, Math.ceil(maxEnd + buffer));
}

// 增量扩展时间轴：只更新宽度和秒线，不重绘 clip/waveform（避免每帧重绘卡顿）
function extendArranger(newTotalDur) {
  const content = document.getElementById('arranger-content');
  if (content) content.style.width = `${CHANNEL_PX + newTotalDur * PX_PER_SEC}px`;
  // 标尺：追加新 tick（保留第一个 TRACKS 标签单元）
  const ruler = document.getElementById('time-ruler');
  if (ruler) {
    const currentTicks = ruler.children.length - 1;
    if (currentTicks < newTotalDur) {
      for (let i = currentTicks; i < newTotalDur; i++) {
        const d = document.createElement('div');
        d.className = 'text-[10px] text-muted-foreground py-1 text-center font-mono tabular-nums border-l border-border/60';
        d.textContent = i % 5 === 0 ? String(i) + 's' : '·';
        ruler.appendChild(d);
      }
      ruler.style.gridTemplateColumns = `${CHANNEL_PX}px repeat(${newTotalDur}, ${PX_PER_SEC}px)`;
    }
  }
  // 所有轨道行：更新宽度 + 追加秒线
  document.querySelectorAll('#tracks-body > div').forEach((row) => {
    row.style.gridTemplateColumns = `${CHANNEL_PX}px ${newTotalDur * PX_PER_SEC}px`;
    const arr = row.children[1];
    if (!arr) return;
    arr.style.width = `${newTotalDur * PX_PER_SEC}px`;
    const existing = arr.querySelectorAll('.sec-line');
    const currentCount = existing.length;
    for (let s = currentCount + 1; s <= newTotalDur; s++) {
      const line = document.createElement('div');
      line.className = `sec-line absolute top-0 bottom-0 border-l ${s % 5 === 0 ? 'border-border/80' : 'border-border/30'}`;
      line.style.left = `${s * PX_PER_SEC}px`;
      arr.appendChild(line);
    }
  });
  // 时长标签 + 滑块
  const label = document.getElementById('arranger-duration-label');
  if (label) label.textContent = `${newTotalDur}s`;
  if (window._updateArrangerSlider) window._updateArrangerSlider();
}

function getArrangerWidth() {
  return getTotalDuration() * PX_PER_SEC;
}

function pxToSec(px) {
  return Math.max(0, px / PX_PER_SEC);
}

function secToPx(sec) {
  return sec * PX_PER_SEC;
}

function fmtTime(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
async function dataURLToBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/data:(.*?);/) || [, 'audio/webm'])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================== Project data model ==================
// track: { id, name, kind:'backing'|'record', muted: bool, solo: bool, armed: bool,
//          clips: [{ id, url, blob, audio, startTime, duration }],
//          // 录音态: activeRecorder, recChunks
//        }
const project = {
  tracks: [], // backing track 放第一个（如果导入了）
};
// transport
let transportState = 'idle'; // 'idle' | 'play' | 'rec'
let playStartTime = 0;        // performance.now() when transport started (currentTime=0)
let playBaseSec = 0;          // logical seconds at transport start (usually 0; could seek later)
let transportRaf = 0;
// all clip audios currently playing in transport mode (for stopping synchronously)
let activePlaybacks = [];     // [{ audio, clipStartTime, clipDuration, startedAt }]

// shared microphone stream (多个 MediaRecorder 复用，避免重复申请权限)
let sharedMicStream = null;
async function acquireMicStream() {
  if (sharedMicStream) return sharedMicStream;
  if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('不支持录音');
  sharedMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return sharedMicStream;
}
function releaseMicStream() {
  if (sharedMicStream) {
    sharedMicStream.getTracks().forEach((t) => t.stop());
    sharedMicStream = null;
  }
}

// ================== Ruler ==================
function drawRuler() {
  const el = document.getElementById('time-ruler');
  const totalDur = getTotalDuration();
  // 清除旧 tick（保留第一个 TRACKS 标签单元）
  while (el.children.length > 1) el.removeChild(el.lastChild);
  // 每秒一个 tick
  for (let i = 0; i < totalDur; i++) {
    const d = document.createElement('div');
    d.className = 'text-[10px] text-muted-foreground py-1 text-center font-mono tabular-nums border-l border-border/60';
    d.textContent = i % 5 === 0 ? String(i) + 's' : '·';
    el.appendChild(d);
  }
  // 通道条列 + 每秒固定像素列
  el.style.gridTemplateColumns = `${CHANNEL_PX}px repeat(${totalDur}, ${PX_PER_SEC}px)`;
  // 设置内容层总宽度
  const content = document.getElementById('arranger-content');
  if (content) {
    content.style.width = `${CHANNEL_PX + totalDur * PX_PER_SEC}px`;
  }
  // 更新时长标签
  const label = document.getElementById('arranger-duration-label');
  if (label) label.textContent = `${totalDur}s`;
}

// ================== Render tracks ==================
const tracksBody = document.getElementById('tracks-body');
const playheadEl = document.getElementById('playhead');
const transportTimeEl = document.getElementById('transport-time');

function currentSeconds() {
  if (transportState === 'idle') return playBaseSec;
  return playBaseSec + (performance.now() - playStartTime) / 1000;
}

function renderTracks() {
  // 先更新标尺和内容层宽度（根据 clip 总时长动态扩展）
  drawRuler();
  if (!project.tracks.length) {
    tracksBody.innerHTML = `
      <div class="py-6 text-center text-xs text-muted-foreground/70">
        还没有轨道 &mdash; 点上方「导入伴奏」或「加轨」开始
      </div>`;
    refreshIcons();
    return;
  }
  tracksBody.innerHTML = '';
  const totalDur = getTotalDuration();
  project.tracks.forEach((tr, i) => {
    const row = document.createElement('div');
    row.className = 'grid border-b border-border last:border-b-0';
    row.style.gridTemplateColumns = `${CHANNEL_PX}px ${totalDur * PX_PER_SEC}px`;
    row.dataset.trackId = tr.id;

    // --- Channel strip (左列) ---
    const strip = document.createElement('div');
    strip.className = 'px-2 py-1.5 border-r border-border bg-muted/40 flex items-center gap-1.5 min-h-[44px]';
    const icon = tr.kind === 'backing' ? 'music-4' : 'mic';
    const accent = tr.kind === 'backing' ? 'bg-secondary/20 text-secondary-foreground' : 'bg-primary/15 text-primary';
    strip.innerHTML = `
      <div class="w-7 h-7 rounded-full ${accent} flex items-center justify-center shrink-0">
        <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-[12px] font-medium leading-tight truncate">${escapeHtml(tr.name)}</h3>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <button type="button" data-bt="M" class="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${tr.muted ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}" title="静音 (M)">M</button>
        <button type="button" data-bt="S" class="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${tr.solo ? 'bg-muted text-primary' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}" title="独奏 (S)">S</button>
        ${tr.kind === 'record' ? `<button type="button" data-bt="R" class="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${tr.armed ? 'bg-red-500 text-white animate-pulse' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}" title="Arm 录音 (R)">R</button>` : ''}
        <button type="button" data-bt="X" class="w-5 h-5 rounded bg-muted/50 text-muted-foreground flex items-center justify-center hover:text-destructive transition-colors" title="删除该轨"><i data-lucide="x" class="w-3 h-3"></i></button>
      </div>`;
    row.appendChild(strip);

    // --- Arranger clips 区（右列）---
    const arr = document.createElement('div');
    arr.className = 'relative h-[44px] bg-muted/10';
    arr.style.width = `${totalDur * PX_PER_SEC}px`;
    // 垂直秒线（每 5 秒粗线）
    for (let s = 1; s <= totalDur; s++) {
      const line = document.createElement('div');
      line.className = `sec-line absolute top-0 bottom-0 border-l ${s % 5 === 0 ? 'border-border/80' : 'border-border/30'}`;
      line.style.left = `${s * PX_PER_SEC}px`;
      arr.appendChild(line);
    }
    // 该轨所有 clips（绝对 px 定位）
    tr.clips.forEach((cl) => {
      const el = document.createElement('div');
      const isBacking = tr.kind === 'backing';
      el.className = `absolute top-1 bottom-1 rounded-md border ${isBacking ? 'bg-secondary/40 border-secondary/60' : 'bg-primary/40 border-primary/60'} hover:brightness-110 transition-all cursor-pointer overflow-hidden select-none`;
      el.style.left = `${cl.startTime * PX_PER_SEC}px`;
      el.style.width = `${cl.duration * PX_PER_SEC}px`;
      el.dataset.clipId = cl.id;
      el.title = `${fmtTime(cl.startTime)} - ${fmtTime(cl.startTime + cl.duration)} · 拖动移动 · 双击任意位置剪开 · 长按删除`;
      // waveform 容器
      const waveWrap = document.createElement('div');
      waveWrap.className = 'waveform-wrap absolute inset-0 flex items-center justify-center';
      el.appendChild(waveWrap);
      drawWaveform(waveWrap, cl, isBacking);
      arr.appendChild(el);
    });
    row.appendChild(arr);
    tracksBody.appendChild(row);
  });
  refreshIcons();
  // 更新滑块
  if (window._updateArrangerSlider) window._updateArrangerSlider();
}

// ---- Waveform 绘制：解码 blob → 提取峰值 → SVG bars ----
// clip._waveSVG: 之前算好的 SVG 字符串缓存
async function drawWaveform(containerEl, clip, isBacking) {
  // 先放 loading skeleton（一条居中柔和线占位）
  containerEl.innerHTML = `<svg class="w-full h-full" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="15" x2="100" y2="15" stroke="currentColor" stroke-opacity=".2" stroke-width="1"/>
  </svg>`;
  try {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    // 如果还没解码过 blob 成 AudioBuffer：解码 + 缓存波形
    if (!clip._waveSVG) {
      const ab = await clip.blob.arrayBuffer();
      const buf = await _ac.decodeAudioData(ab.slice(0));
      clip._waveSVG = computeWaveSVG(buf, isBacking);
    }
    if (containerEl.isConnected) {
      containerEl.innerHTML = clip._waveSVG;
    }
  } catch (err) {
    // 解码失败：保留占位即可（不影响交互）
    console.warn('waveform decode failed', err);
  }
}
// 取波形左右峰值：把 buf.length 分成 N 份，每份取最大绝对值
function computeWaveSVG(buf, isBacking) {
  const N = 180; // 180 条 bar（视觉已经够细，和 DAW 差不多）
  const chCount = Math.min(buf.numberOfChannels, 2);
  const samplesPerBar = Math.max(1, Math.floor(buf.length / N));
  // bar 的 stroke 颜色：伴奏深灰、录音深红
  const stroke = isBacking ? '#324155' : '#c53030';
  const bars = new Array(N);
  for (let i = 0; i < N; i++) {
    const s0 = i * samplesPerBar;
    const s1 = Math.min(buf.length, s0 + samplesPerBar);
    let peak = 0;
    for (let c = 0; c < chCount; c++) {
      const ch = buf.getChannelData(c);
      for (let s = s0; s < s1; s++) {
        const v = Math.abs(ch[s]);
        if (v > peak) peak = v;
      }
    }
    // 峰值非线性曲线（小音量也看得清）
    const amp = Math.pow(Math.min(1, peak), 0.6);
    bars[i] = amp;
  }
  // viewBox 0..N x 0..30：中线 15，上下各 amp*14
  let d = '';
  for (let i = 0; i < N; i++) {
    const x = i + 0.5;
    const amp = bars[i] * 14;
    const y1 = 15 - amp;
    const y2 = 15 + amp;
    if (y2 - y1 < 0.25) {
      d += `<line x1="${x.toFixed(2)}" y1="14.8" x2="${x.toFixed(2)}" y2="15.2" stroke="${stroke}" stroke-opacity=".55" stroke-width="0.7"/>`;
    } else {
      d += `<line x1="${x.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="0.85" stroke-linecap="round"/>`;
    }
  }
  return `<svg class="w-full h-full wave-bar" viewBox="0 0 ${N} 30" preserveAspectRatio="none" aria-hidden="true">${d}</svg>`;
}

// ================== Clip 手势：双击点位置剪切 / 长按删除 ==================
function findClip(cid) {
  for (const tr of project.tracks) {
    const c = tr.clips.find((x) => x.id === cid);
    if (c) return { tr, clip: c };
  }
  return null;
}

// ---- WAV encoder + trimBlob (保留，支持真正二进制剪切) ----
function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const samples = buffer.length;
  const dataLen = samples * numCh * 2;
  const blockAlign = numCh * 2;
  const byteRate = sr * blockAlign;
  const ab = new ArrayBuffer(44 + dataLen);
  const v = new DataView(ab);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, byteRate, true); v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
  writeStr(36, 'data'); v.setUint32(40, dataLen, true);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      o += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
let _ac = null;
async function decodeBlob(blob) {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  const ab = await blob.arrayBuffer();
  return _ac.decodeAudioData(ab.slice(0));
}
// 混音：把多条 clip 按 startTime 叠加到一个 AudioBuffer
async function mixProjectToBuffer(tracks, options = {}) {
  const { sampleRate = 44100 } = options;
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  const anySolo = tracks.some((t) => t.solo);
  const active = tracks.filter((t) => !t.muted && (!anySolo || t.solo));
  const allClips = [];
  for (const tr of active) {
    for (const c of (tr.clips || [])) {
      if (!c.blobDataURL && !c.blob) continue;
      const blob = c.blobDataURL ? await dataURLToBlob(c.blobDataURL) : c.blob;
      const buf = await decodeBlob(blob);
      allClips.push({ buf, startTime: c.startTime || 0 });
    }
  }
  if (!allClips.length) return null;
  let totalSec = 0;
  for (const cl of allClips) {
    const end = cl.startTime + cl.buf.duration;
    if (end > totalSec) totalSec = end;
  }
  const totalLen = Math.ceil(totalSec * sampleRate);
  const chCount = 2;
  const mixed = _ac.createBuffer(chCount, totalLen, sampleRate);
  const mixCh = [mixed.getChannelData(0), mixed.getChannelData(1)];
  for (const cl of allClips) {
    const src = cl.buf;
    const offset = Math.round(cl.startTime * sampleRate);
    const len = Math.min(src.length, totalLen - offset);
    const srcChCount = Math.min(src.numberOfChannels, chCount);
    for (let c = 0; c < srcChCount; c++) {
      const srcCh = src.getChannelData(c);
      const dstCh = mixCh[c];
      for (let i = 0; i < len; i++) {
        dstCh[offset + i] += srcCh[i];
      }
    }
    // 单声道源：同样叠加到右声道
    if (src.numberOfChannels === 1) {
      const srcCh = src.getChannelData(0);
      for (let i = 0; i < len; i++) {
        mixCh[1][offset + i] += srcCh[i];
      }
    }
  }
  // 归一化防止削波
  let peak = 0;
  for (let c = 0; c < chCount; c++) {
    const d = mixCh[c];
    for (let i = 0; i < totalLen; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak > 1) {
    const g = 1 / peak;
    for (let c = 0; c < chCount; c++) {
      const d = mixCh[c];
      for (let i = 0; i < totalLen; i++) d[i] *= g;
    }
  }
  return mixed;
}
// 触发浏览器下载
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// 导出单条音频或工程
async function exportCapture(item, format) {
  const ext = format;
  const safeName = (item.title || 'capture').replace(/[^\w\u4e00-\u9fa5\- ]/g, '').trim() || 'capture';
  window.MFToast('导出处理中…');
  try {
    if (item.kind === 'audio' && item.url) {
      // legacy 音频项：直接 fetch blob
      const resp = await fetch(item.url);
      const blob = await resp.blob();
      if (format === 'wav') {
        const buf = await decodeBlob(blob);
        const wav = audioBufferToWav(buf);
        downloadBlob(wav, `${safeName}.wav`);
      } else {
        // 原始格式导出（webm/ogg 等）
        downloadBlob(blob, `${safeName}.${blob.type.split('/')[1] || 'audio'}`);
      }
    } else if (item.kind === 'project') {
      const tracks = item.project?.tracks || [];
      if (!tracks.length) { window.MFToast('工程为空'); return; }
      const mixed = await mixProjectToBuffer(tracks);
      if (!mixed) { window.MFToast('没有可导出的音频'); return; }
      const wav = audioBufferToWav(mixed);
      downloadBlob(wav, `${safeName}.wav`);
    } else if (item.kind === 'text') {
      const text = new Blob([item.body || item.title || ''], { type: 'text/plain' });
      downloadBlob(text, `${safeName}.txt`);
    } else {
      window.MFToast('不支持导出此类型');
      return;
    }
    window.MFToast('已导出');
  } catch (err) {
    console.error(err);
    window.MFToast('导出失败：' + (err?.message || ''));
  }
}
// 弹出格式选择菜单
function showExportMenu(item, anchorEl) {
  // 移除已有菜单
  document.querySelectorAll('.export-menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'export-menu fixed z-50 bg-card border border-border rounded-lg shadow-lg p-1.5 flex flex-col gap-0.5 text-sm min-w-[140px]';
  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 140)}px`;
  const isAudio = item.kind === 'audio' || item.kind === 'project';
  const formats = isAudio
    ? [{ f: 'wav', label: 'WAV（无损）' }, { f: 'original', label: '原始格式' }]
    : [{ f: 'txt', label: 'TXT 文本' }];
  formats.forEach(({ f, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-3 py-1.5 rounded-md hover:bg-muted text-left text-foreground transition-colors duration-100';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      menu.remove();
      exportCapture(item, f);
    });
    menu.appendChild(btn);
  });
  // 取消
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'px-3 py-1.5 rounded-md hover:bg-muted text-left text-muted-foreground transition-colors duration-100 border-t border-border mt-0.5';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => menu.remove());
  menu.appendChild(cancel);
  document.body.appendChild(menu);
  // 点击外部关闭
  setTimeout(() => {
    const onDocClick = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', onDocClick); }
    };
    document.addEventListener('mousedown', onDocClick);
  }, 0);
}
async function trimBlob(blob, startSec, endSec) {
  if (startSec >= endSec) return null;
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  const ab = await blob.arrayBuffer();
  const decoded = await _ac.decodeAudioData(ab.slice(0));
  const sr = decoded.sampleRate;
  const startFr = Math.max(0, Math.floor(startSec * sr));
  const endFr = Math.min(decoded.length, Math.ceil(endSec * sr));
  const nFr = endFr - startFr;
  if (nFr <= 0) return null;
  const newBuf = _ac.createBuffer(decoded.numberOfChannels, nFr, sr);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const src = decoded.getChannelData(c).subarray(startFr, endFr);
    newBuf.getChannelData(c).set(src);
  }
  return audioBufferToWav(newBuf);
}

// 在 clip 内的 inSec 位置（基于 clip.startTime 的相对秒数）把 clip 切成两块
async function splitClipAtOffset(cid, inSec) {
  if (transportState !== 'idle') { window.MFToast('先停止再剪切'); return; }
  const found = findClip(cid);
  if (!found) return;
  const { tr, clip } = found;
  if (inSec < 0.05 || inSec > clip.duration - 0.05) {
    window.MFToast('切点要在块内，且距两端 > 50ms');
    return;
  }
  window.MFToast('剪切中…');
  try {
    const [leftBlob, rightBlob] = await Promise.all([
      trimBlob(clip.blob, 0, inSec),
      trimBlob(clip.blob, inSec, clip.duration),
    ]);
    if (!leftBlob || !rightBlob) throw new Error('剪切失败');
    const leftUrl = URL.createObjectURL(leftBlob);
    const rightUrl = URL.createObjectURL(rightBlob);
    const leftAudio = new Audio(leftUrl);
    const rightAudio = new Audio(rightUrl);
    leftAudio.preload = rightAudio.preload = 'auto';
    const idx = tr.clips.findIndex((x) => x.id === cid);
    try { clip.audio.pause(); } catch {}
    if (clip.url) try { URL.revokeObjectURL(clip.url); } catch {}
    tr.clips.splice(idx, 1,
      { id: `clip_${uid()}`, url: leftUrl, blob: leftBlob, audio: leftAudio, startTime: clip.startTime, duration: inSec },
      { id: `clip_${uid()}`, url: rightUrl, blob: rightBlob, audio: rightAudio, startTime: clip.startTime + inSec, duration: clip.duration - inSec },
    );
    renderTracks();
    window.MFToast('已剪开');
  } catch (err) {
    console.error(err);
    window.MFToast('剪切失败：' + (err?.message || ''));
  }
}
function deleteClip(cid) {
  const found = findClip(cid);
  if (!found) return;
  const { tr, clip } = found;
  const idx = tr.clips.indexOf(clip);
  if (idx < 0) return;
  tr.clips.splice(idx, 1);
  try { clip.audio.pause(); } catch {}
  if (clip.url) try { URL.revokeObjectURL(clip.url); } catch {}
  renderTracks();
}

// ---- 长按删除 / 拖动移动 / 双击剪切 ----
const LONG_PRESS_MS = 450;   // 超过 450ms 视为长按
const MOVE_TOL_PX = 6;      // 指针位移超过 6px 取消长按 → 进入 drag
let pressState = null;      // { cid, clipEl, timer, startX, startY, triggered, pointerId, arr, origRect, dragMode, deltaX, startSec }
function clearPress() {
  if (!pressState) return;
  clearTimeout(pressState.timer);
  if (pressState.clipEl && pressState.clipEl.isConnected) {
    pressState.clipEl.classList.remove('press-flash');
    pressState.clipEl.style.transform = '';
    pressState.clipEl.style.zIndex = '';
    pressState.clipEl.style.cursor = '';
    pressState.clipEl.style.filter = '';
    pressState.clipEl.style.outline = '';
    pressState.clipEl.style.outlineOffset = '';
  }
  pressState = null;
}

// 根据"相对于 arranger 的 x 像素"换算成 startTime，再对齐到 10ms 格子
function pxToStartTime(arrEl, relXPx, durSec) {
  const totalDur = getTotalDuration();
  const rect = arrEl.getBoundingClientRect();
  const pxPerSec = rect.width / totalDur;
  let sec = relXPx / pxPerSec;
  sec = Math.max(0, Math.min(totalDur - durSec, sec));
  // 10ms 对齐（像 DAW 的 snap）
  return Math.round(sec * 100) / 100;
}

tracksBody.addEventListener('pointerdown', (e) => {
  const clipEl = e.target.closest('[data-clip-id]');
  if (!clipEl) return;
  const cid = clipEl.dataset.clipId;
  if (transportState !== 'idle') { window.MFToast('先停止再编辑片段'); return; }
  const row = clipEl.closest('[data-track-id]');
  const arr = row?.children[1]; // arranger 区
  if (!arr) return;
  const clipRect = clipEl.getBoundingClientRect();
  pressState = {
    cid,
    clipEl,
    startX: e.clientX,
    startY: e.clientY,
    triggered: false,
    pointerId: e.pointerId,
    arr,
    origRect: clipRect,
    dragMode: false,
    deltaX: 0,
    // 记录 clip 当前信息便于撤销/不重复查找
    startSec: 0,
  };
  const found = findClip(cid);
  if (found) pressState.startSec = found.clip.startTime;
  clipEl.classList.add('press-flash');
  pressState.timer = setTimeout(() => {
    if (!pressState || pressState.cid !== cid || pressState.dragMode) return;
    pressState.triggered = true;
    // 长按 = 删除
    clipEl.classList.remove('press-flash');
    clipEl.classList.add('press-shake');
    deleteClip(cid);
    setTimeout(() => { if (clipEl.isConnected) clipEl.classList.remove('press-shake'); }, 300);
    pressState = null;
    window.MFToast('已删除该音频块');
  }, LONG_PRESS_MS);
  try { clipEl.setPointerCapture?.(e.pointerId); } catch {}
});
tracksBody.addEventListener('pointermove', (e) => {
  if (!pressState) return;
  const dx = e.clientX - pressState.startX;
  const dy = e.clientY - pressState.startY;
  const dist = Math.hypot(dx, dy);
  // 首次超过阈值：退出长按 → 进入 drag 模式
  if (!pressState.dragMode && dist > MOVE_TOL_PX) {
    pressState.dragMode = true;
    clearTimeout(pressState.timer);
    pressState.clipEl.classList.remove('press-flash');
    pressState.clipEl.style.zIndex = '20';
    pressState.clipEl.style.cursor = 'grabbing';
  }
  if (pressState.dragMode) {
    // 预览：在 % 基础上叠加 translateX px
    pressState.deltaX = dx;
    pressState.clipEl.style.transform = `translateX(${dx}px)`;
    pressState.clipEl.style.filter = 'brightness(1.2) saturate(1.15)';
    pressState.clipEl.style.outline = '1px dashed rgba(245, 101, 101, .85)';
    pressState.clipEl.style.outlineOffset = '-2px';
  }
});
tracksBody.addEventListener('pointerup', (e) => {
  if (!pressState) return;
  const wasTriggered = pressState.triggered;
  const dragMode = pressState.dragMode;
  const ps = pressState;
  clearPress();
  if (wasTriggered) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (dragMode) {
    // 结束拖动：把 translateX 写入 startTime
    const found = findClip(ps.cid);
    if (found) {
      const arrRect = ps.arr.getBoundingClientRect();
      const origRelX = ps.origRect.left - arrRect.left;
      const newRelX = origRelX + ps.deltaX;
      const newStart = pxToStartTime(ps.arr, newRelX, found.clip.duration);
      if (Math.abs(newStart - found.clip.startTime) > 0.005) {
        found.clip.startTime = newStart;
        renderTracks();
      } else {
        // 没实质移动，清理 transform 即可（clearPress 已经重置样式 transform）
      }
    }
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // 正常短按：什么都不做（只让 click/dblclick 后续处理）
});
tracksBody.addEventListener('pointercancel', clearPress);
tracksBody.addEventListener('lostpointercapture', (e) => {
  if (pressState && pressState.pointerId === e.pointerId) clearPress();
});

// 双击 clip：在点击的 x 位置换算成 clip 内秒数，从此处剪开
tracksBody.addEventListener('dblclick', (e) => {
  const clipEl = e.target.closest('[data-clip-id]');
  if (!clipEl) return;
  if (transportState !== 'idle') { window.MFToast('先停止再剪切'); return; }
  const cid = clipEl.dataset.clipId;
  const found = findClip(cid);
  if (!found) return;
  const { clip } = found;
  const rect = clipEl.getBoundingClientRect();
  const localX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const ratio = rect.width > 0 ? localX / rect.width : 0.5;
  const inSec = ratio * clip.duration;
  // 视觉反馈
  clipEl.classList.add('press-flash');
  setTimeout(() => clipEl.classList.remove('press-flash'), 150);
  splitClipAtOffset(cid, inSec);
});

// 通道条按钮（M / S / R / X）的 click 处理
tracksBody.addEventListener('click', (e) => {
  const row = e.target.closest('[data-track-id]');
  if (!row) return;
  const id = row.dataset.trackId;
  const tr = project.tracks.find((x) => x.id === id);
  if (!tr) return;
  const bt = e.target.closest('button[data-bt]')?.dataset.bt;
  if (!bt) return;
  if (bt === 'M') tr.muted = !tr.muted;
  if (bt === 'S') tr.solo = !tr.solo;
  if (bt === 'R') {
    if (tr.kind !== 'record') return;
    if (transportState !== 'idle') { window.MFToast('先停止再切换录音 Arm'); return; }
    tr.armed = !tr.armed;
  }
  if (bt === 'X') {
    if (transportState !== 'idle') { window.MFToast('先停止再删轨'); return; }
    tr.clips.forEach((c) => { try { c.audio.pause(); } catch {} if (c.url) try { URL.revokeObjectURL(c.url); } catch {} });
    project.tracks = project.tracks.filter((x) => x.id !== id);
  }
  renderTracks();
});

// 单击空白取消 playhead seek 之前的交互仍保留（下面那个 document.click 监听已不再依赖 selectedClip）

// ================== Transport play/stop ==================
// Should this track's clips play right now? (consider mute + solo rules)
function isTrackAudible(tr) {
  if (tr.muted) return false;
  const anySolo = project.tracks.some((t) => t.solo);
  if (anySolo && !tr.solo) return false;
  return true;
}

function stopAllPlaybacks() {
  activePlaybacks.forEach((p) => {
    try { p.audio.pause(); } catch {}
  });
  activePlaybacks = [];
}

function startPlayback(startSec) {
  stopAllPlaybacks();
  // start every audible clip whose [startTime, startTime+duration] overlaps with startSec..∞
  const nowSec = startSec;
  project.tracks.forEach((tr) => {
    if (!isTrackAudible(tr)) return;
    tr.clips.forEach((cl) => {
      const end = cl.startTime + cl.duration;
      if (end <= nowSec) return;
      const offset = Math.max(0, nowSec - cl.startTime);
      const a = new Audio(cl.url);
      a.preload = 'auto';
      try { a.currentTime = offset; } catch {}
      const pb = { audio: a, clip: cl, startedAt: performance.now(), playheadAtStart: nowSec };
      activePlaybacks.push(pb);
      a.play().catch(() => {});
      a.addEventListener('ended', () => {
        activePlaybacks = activePlaybacks.filter((p) => p !== pb);
      });
    });
  });
}

// ================== 时间轴点击 seek ==================
// 点击标尺或 arranger 空白区 → playhead 跳到该时间点
function seekToSeconds(sec) {
  if (transportState !== 'idle') { window.MFToast('先停止再跳转'); return; }
  const totalDur = getTotalDuration();
  sec = Math.max(0, Math.min(totalDur, sec));
  playBaseSec = sec;
  playStartTime = performance.now();
  transportTimeEl.textContent = fmtTime(sec);
  // playhead 用固定 px 定位
  const left = CHANNEL_PX + sec * PX_PER_SEC;
  playheadEl.style.left = `${left}px`;
}

// tick：用固定 px 定位 playhead
function tick() {
  transportRaf = 0;
  const t = currentSeconds();
  transportTimeEl.textContent = fmtTime(t);
  // 录音中：时间轴随录音长度动态扩展（不重绘 clip/waveform）
  if (transportState === 'rec') {
    const newTotalDur = getTotalDuration();
    const content = document.getElementById('arranger-content');
    const currentW = content ? parseInt(content.style.width, 10) || 0 : 0;
    const expectedW = CHANNEL_PX + newTotalDur * PX_PER_SEC;
    // 宽度不足时增量扩展（避免每帧重绘）
    if (currentW < expectedW - 1) {
      extendArranger(newTotalDur);
    }
  }
  const totalDur = getTotalDuration();
  const left = CHANNEL_PX + t * PX_PER_SEC;
  playheadEl.style.left = `${left}px`;
  // 录音中自动滚动到 playhead 位置
  if (transportState === 'rec') {
    const vp = document.getElementById('arranger-viewport');
    if (vp) {
      const playheadX = CHANNEL_PX + t * PX_PER_SEC;
      const viewStart = vp.scrollLeft;
      const viewEnd = viewStart + vp.clientWidth;
      if (playheadX > viewEnd - 50 || playheadX < viewStart) {
        vp.scrollLeft = Math.max(0, playheadX - vp.clientWidth * 0.3);
      }
    }
  }
  // auto-stop: reached end of last clip + 0.3s
  const maxEnd = project.tracks.reduce((m, tr) => {
    if (!tr.clips.length) return m;
    const em = Math.max(...tr.clips.map((c) => c.startTime + c.duration));
    return Math.max(m, em);
  }, 0);
  if (transportState === 'play' && maxEnd > 0 && t > maxEnd + 0.3) {
    transportStop();
    return;
  }
  transportRaf = requestAnimationFrame(tick);
}

// 给 arranger、ruler、每个 arranger 区统一挂 click seek（用事件委托在 body）
document.addEventListener('click', (e) => {
  if (transportState !== 'idle') return;
  const rule = e.target.closest('#time-ruler');
  const hostRow = e.target.closest('#tracks-body > div');
  if (e.target.closest('[data-clip-id]') || e.target.closest('button')) return;
  const totalDur = getTotalDuration();
  if (rule) {
    const rect = rule.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const headW = CHANNEL_PX;
    if (x <= headW) return seekToSeconds(0);
    const sec = Math.max(0, Math.min(totalDur, (x - headW) / PX_PER_SEC));
    return seekToSeconds(sec);
  }
  if (hostRow) {
    const arr = hostRow.children[1];
    if (!arr) return;
    if (!arr.contains(e.target)) return;
    const rect = arr.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const sec = Math.max(0, Math.min(totalDur, x / PX_PER_SEC));
    return seekToSeconds(sec);
  }
});

// （已改用固定 px 定位，支持横向滚动）

function transportPlay() {
  if (transportState === 'rec') {
    // 录音中点"播放图标"=停止录音+运输
    transportStop();
    return;
  }
  if (transportState === 'play') {
    // 播放中点 = 暂停（保留 playBaseSec 当前时间）
    pausePlayback(true);
    return;
  }
  // idle 态：从 playBaseSec 开始继续播放
  project.tracks.forEach((tr) => {
    tr.clips.forEach((c) => { if (c.audio) c.audio.load?.(); });
  });
  transportState = 'play';
  playStartTime = performance.now();
  playBaseSec = playBaseSec || 0;
  startPlayback(playBaseSec);
  swapIcon(document.getElementById('transport-play'), 'pause');
  transportRaf = requestAnimationFrame(tick);
}

// 暂停播放并可选保留当前 playhead
function pausePlayback(keepPosition) {
  stopAllPlaybacks();
  if (keepPosition) {
    // 用 currentSeconds() 存当前进度，让 RAF 停在这个时间点
    const t = currentSeconds();
    playBaseSec = t;
  }
  transportState = 'idle';
  if (transportRaf) cancelAnimationFrame(transportRaf);
  transportRaf = 0;
  swapIcon(document.getElementById('transport-play'), 'play');
  // playhead 用固定 px 定位（与 seekToSeconds 一致，支持横向滚动）
  const left = CHANNEL_PX + playBaseSec * PX_PER_SEC;
  transportTimeEl.textContent = fmtTime(playBaseSec);
  playheadEl.style.left = `${left}px`;
}

function transportStop() {
  // stop any recording first
  if (transportState === 'rec') {
    stopArmRecording();
  }
  transportState = 'idle';
  stopAllPlaybacks();
  swapIcon(document.getElementById('transport-play'), 'play');
  const recBtn = document.getElementById('transport-rec');
  recBtn.classList.remove('bg-red-500', 'text-white', 'animate-pulse');
  recBtn.classList.add('bg-muted', 'text-muted-foreground');
  recBtn.setAttribute('aria-pressed', 'false');
  // 不重置 playBaseSec：保留指针位置，让用户下次录音/播放从这里继续
  playStartTime = 0;
  if (transportRaf) cancelAnimationFrame(transportRaf);
  transportRaf = 0;
  // playhead 用固定 px 定位
  const left = CHANNEL_PX + playBaseSec * PX_PER_SEC;
  transportTimeEl.textContent = fmtTime(playBaseSec);
  playheadEl.style.left = `${left}px`;
}

document.getElementById('transport-stop')?.addEventListener('click', transportStop);
document.getElementById('transport-play')?.addEventListener('click', transportPlay);

// ================== Transport REC ==================
// For every armed track, we create an independent MediaRecorder on the same shared mic stream.
// When record starts, each MR records chunks. When we stop, each MR produces a Blob
// which becomes a new clip at `startTime = transport's t0` (the moment recording began).
const activeRecorders = []; // [{ track, recorder, chunks, startedAtSec }]

async function transportRec() {
  if (transportState === 'rec') {
    transportStop();
    return;
  }
  if (transportState !== 'idle') {
    window.MFToast('先停止再录音');
    return;
  }
  // 如果还没有录音轨，先自动建一条
  let recordTracks = project.tracks.filter((t) => t.kind === 'record');
  if (!recordTracks.length) {
    project.tracks.push({
      id: `track_${uid()}`,
      name: `录音 1`,
      kind: 'record',
      muted: false,
      solo: false,
      armed: true,
      clips: [],
    });
    recordTracks = project.tracks.filter((t) => t.kind === 'record');
  }
  // 如果没有任何录音轨被 Arm，自动把所有录音轨都 Arm
  const anyArmed = recordTracks.some((t) => t.armed);
  if (!anyArmed) {
    recordTracks.forEach((t) => (t.armed = true));
  }
  const armedTracks = project.tracks.filter((t) => t.kind === 'record' && t.armed);
  // (armedTracks 此时至少有一条)
  try {
    await acquireMicStream();
  } catch (err) {
    window.MFToast(err?.message || '无法访问麦克风');
    // 回滚 Arm UI
    armedTracks.forEach((t) => (t.armed = false));
    renderTracks();
    return;
  }
  // UI: 重新渲染把 R 亮的状态展示出来（用户能看见哪些轨在录）
  renderTracks();
  transportState = 'rec';
  playStartTime = performance.now();
  // 录音从当前指针位置开始，不限制在固定范围内
  const recStartSec = playBaseSec;
  // 录音时播放伴奏/已有非静音片段（从 playhead 位置开始叠加）
  startPlayback(recStartSec);
  activeRecorders.length = 0;
  armedTracks.forEach((tr) => {
    const mr = new MediaRecorder(sharedMicStream);
    const ctx = { track: tr, recorder: mr, chunks: [], startedAtSec: recStartSec };
    mr.ondataavailable = (e) => { if (e.data.size) ctx.chunks.push(e.data); };
    mr.onstop = () => finalizeRecClip(ctx);
    mr.start();
    activeRecorders.push(ctx);
  });
  // UI
  const recBtn = document.getElementById('transport-rec');
  recBtn.classList.remove('bg-muted', 'text-muted-foreground');
  recBtn.classList.add('bg-red-500', 'text-white', 'animate-pulse');
  recBtn.setAttribute('aria-pressed', 'true');
  swapIcon(document.getElementById('transport-play'), 'pause');
  transportRaf = requestAnimationFrame(tick);
}

function stopArmRecording() {
  // 停止所有 MediaRecorder（会依次触发 onstop → finalizeRecClip）
  // 最后一个 finalize 完成后 releaseMicStream
  const total = activeRecorders.length;
  activeRecorders._pending = total;
  activeRecorders.forEach((ctx) => {
    try { if (ctx.recorder.state !== 'inactive') ctx.recorder.stop(); } catch {}
  });
}

function finalizeRecClip(ctx) {
  const mime = ctx.recorder.mimeType || 'audio/webm';
  const blob = new Blob(ctx.chunks, { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  // 录音对齐到 startedAtSec（录音开始时指针位置 + 0 偏移）
  const startSec = ctx.startedAtSec;
  const elapsedMs = performance.now() - playStartTime;
  const durationSec = Math.max(0.1, elapsedMs / 1000);
  audio.preload = 'auto';
  const clip = {
    id: `clip_${uid()}`,
    url,
    blob,
    audio,
    startTime: startSec,
    duration: durationSec,
  };
  audio.addEventListener('loadedmetadata', () => {
    clip.duration = audio.duration || durationSec;
    renderTracks();
  });
  ctx.track.clips.push(clip);
  activeRecorders._pending = (activeRecorders._pending || 1) - 1;
  if (activeRecorders._pending <= 0) {
    releaseMicStream();
    activeRecorders.length = 0;
    renderTracks();
  }
}

document.getElementById('transport-rec')?.addEventListener('click', transportRec);

// ================== Wide mode（横屏扩大录音板块）==================
const wideBtn = document.getElementById('wide-toggle-btn');
const wideBtnLabel = wideBtn ? wideBtn.querySelector('span') : null;
let isWide = false;

function toggleWide(on) {
  isWide = on;
  const panel = document.getElementById('record-panel');
  if (on) {
    panel.classList.add('arranger-wide');
    document.body.classList.add('in-wide-mode');
    wideBtn.classList.add('active');
    wideBtn.setAttribute('aria-pressed', 'true');
    swapIcon(wideBtn, 'minimize-2');
    if (wideBtnLabel) wideBtnLabel.textContent = '横屏缩小';
    document.body.style.overflow = 'hidden';
  } else {
    panel.classList.remove('arranger-wide');
    document.body.classList.remove('in-wide-mode');
    wideBtn.classList.remove('active');
    wideBtn.setAttribute('aria-pressed', 'false');
    swapIcon(wideBtn, 'maximize-2');
    if (wideBtnLabel) wideBtnLabel.textContent = '横屏';
    document.body.style.overflow = '';
  }
  // 重新渲染轨道以适应新宽度
  renderTracks();
  // 更新 playhead 位置
  if (transportState === 'idle') seekToSeconds(playBaseSec);
}
wideBtn?.addEventListener('click', () => toggleWide(!isWide));
// ESC 关闭横屏
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isWide) toggleWide(false);
});

// ================== Add track ==================
document.getElementById('add-track-btn')?.addEventListener('click', () => {
  const n = project.tracks.filter((t) => t.kind === 'record').length + 1;
  project.tracks.push({
    id: `track_${uid()}`,
    name: `录音 ${n}`,
    kind: 'record',
    muted: false,
    solo: false,
    armed: false,
    clips: [],
  });
  renderTracks();
});

// ================== Backing import（支持多文件 / 多伴奏轨，每条伴奏 = 一条独立轨）==================
document.getElementById('import-backing-btn')?.addEventListener('click', () => document.getElementById('backing-file')?.click());
document.getElementById('backing-file')?.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const startAt = playBaseSec || 0; // 从当前 playhead 位置插入（默认 0）
  let imported = 0;
  files.forEach((f, idx) => {
    const url = URL.createObjectURL(f);
    const audio = new Audio(url);
    audio.preload = 'auto';
    // 每条伴奏 = 一条独立的 backing 轨，不再覆盖已有
    const clip = {
      id: `clip_${uid()}`,
      url,
      blob: f,
      audio,
      startTime: startAt,
      duration: 0,
    };
    audio.addEventListener('loadedmetadata', () => {
      clip.duration = audio.duration || 30;
      renderTracks();
    });
    const displayName = f.name.length > 22 ? f.name.slice(0, 22) + '…' : f.name;
    const existSameName = project.tracks.some((t) => t.name === displayName);
    const finalName = existSameName
      ? `${displayName} · ${project.tracks.filter((t) => t.kind === 'backing').length + 1}`
      : displayName;
    const newTrack = {
      id: `track_${uid()}`,
      name: finalName,
      kind: 'backing',
      muted: false,
      solo: false,
      armed: false,
      clips: [clip],
    };
    // 伴奏追加到所有 backing 轨之后、record 轨之前；纯记录轨工程则放到最上面
    const firstRecIdx = project.tracks.findIndex((t) => t.kind === 'record');
    if (firstRecIdx === -1) project.tracks.push(newTrack);
    else project.tracks.splice(firstRecIdx + idx, 0, newTrack);
    imported++;
  });
  if (imported > 0) {
    window.MFToast(imported === 1 ? '伴奏已导入' : `已导入 ${imported} 条伴奏`);
    renderTracks();
  }
});

// ================== Save project ==================
document.getElementById('save-project-btn')?.addEventListener('click', async () => {
  if (!project.tracks.length || !project.tracks.some((t) => t.clips.length)) {
    window.MFToast('工程是空的');
    return;
  }
  if (transportState !== 'idle') transportStop();
  try {
    const serialClips = async (clips) => {
      const out = [];
      for (const c of clips) {
        out.push({
          id: c.id,
          startTime: c.startTime,
          duration: c.duration,
          blobDataURL: await blobToDataURL(c.blob),
        });
      }
      return out;
    };
    const tracks = [];
    for (const tr of project.tracks) {
      tracks.push({
        id: tr.id,
        name: tr.name,
        kind: tr.kind,
        muted: tr.muted,
        solo: tr.solo,
        armed: false, // 保存后默认不 arm
        clips: await serialClips(tr.clips),
      });
    }
    const maxDur = project.tracks.reduce((m, tr) => {
      if (!tr.clips.length) return m;
      return Math.max(m, ...tr.clips.map((c) => c.startTime + c.duration));
    }, 0);
    captures.add({
      kind: 'project',
      title: `多轨工程 #${String(captures.all().length + 1).padStart(2, '0')}`,
      stamp: nowstamp(),
      duration: fmtTime(maxDur),
      project: { format: 'studioOne', tracks, maxDur },
    });
    window.MFToast('工程已保存到最近捕捉');
    renderList();
  } catch (err) {
    console.error(err);
    window.MFToast('保存失败：' + (err?.message || '存储超限'));
  }
});

// ================== Captures list ==================
const listEl = document.getElementById('captures-list');
const countEl = document.getElementById('captures-count');
const capturesSelectBar = document.getElementById('captures-select-bar');
const capturesToggleSelectBtn = document.getElementById('captures-toggle-select');
const capturesSelectAll = document.getElementById('captures-select-all');
const capturesSelectedCount = document.getElementById('captures-selected-count');
const capturesBatchDeleteBtn = document.getElementById('captures-batch-delete');
const capturesSelectCancelBtn = document.getElementById('captures-select-cancel');

let capturesSelectMode = false;
let capturesSelected = new Set();

function updateCapturesSelectUI() {
  const items = captures.all().filter((it) => it.kind !== 'text');
  if (!capturesSelectMode) {
    capturesSelectBar.classList.add('hidden');
    capturesToggleSelectBtn.classList.remove('bg-muted', 'text-foreground');
  } else {
    capturesSelectBar.classList.remove('hidden');
    capturesToggleSelectBtn.classList.add('bg-muted', 'text-foreground');
  }
  capturesSelectedCount.textContent = `已选 ${capturesSelected.size} 项`;
  capturesBatchDeleteBtn.disabled = capturesSelected.size === 0;
  if (capturesSelectAll) {
    capturesSelectAll.checked = items.length > 0 && capturesSelected.size === items.length;
    capturesSelectAll.indeterminate = capturesSelected.size > 0 && capturesSelected.size < items.length;
  }
}

function exitCapturesSelectMode() {
  capturesSelectMode = false;
  capturesSelected.clear();
  // 不调用 renderList，避免与 renderList → exitCapturesSelectMode 递归
  const items = captures.all().filter((it) => it.kind !== 'text');
  if (!capturesSelectMode) {
    capturesSelectBar.classList.add('hidden');
    capturesToggleSelectBtn.classList.remove('bg-muted', 'text-foreground');
  }
  capturesSelectedCount.textContent = `已选 0 项`;
  capturesBatchDeleteBtn.disabled = true;
  if (capturesSelectAll) { capturesSelectAll.checked = false; capturesSelectAll.indeterminate = false; }
  if (items.length === 0) return; // 空列表不重渲染
  renderList();
}

function captureCardCheckbox(checked, id) {
  return `
    <label class="captures-select-box shrink-0 w-5 h-5 rounded-md border-2 border-border flex items-center justify-center cursor-pointer hover:border-primary transition-colors ${checked ? 'bg-primary border-primary' : ''}" data-capture-check="${id}" onclick="event.stopPropagation()">
      <i data-lucide="check" class="w-3.5 h-3.5 ${checked ? 'text-primary-foreground' : 'text-transparent'}"></i>
    </label>`;
}

const projectPlayers = new Map(); // id -> { audios:[], playing }
function releaseProjectPlayer(id) {
  const p = projectPlayers.get(id);
  if (!p) return;
  (p.audios || []).forEach((a) => { try { a.pause(); } catch {} });
  projectPlayers.delete(id);
}
let currentlyPlaying = null; // legacy single-audio

function renderList() {
  // 过滤掉文字条目，最近捕捉只保留音频和工程
  const items = captures.all().filter((it) => it.kind !== 'text');
  countEl.textContent = items.length ? `${items.length} 条` : '';
  if (!items.length) {
    exitCapturesSelectMode();
    listEl.innerHTML = `
      <div class="py-10 flex flex-col items-center text-center text-muted-foreground">
        <div class="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
          <i data-lucide="sparkles" class="w-7 h-7"></i>
        </div>
        <p class="text-sm">还没有捕捉，先录点东西再保存工程</p>
      </div>`;
    refreshIcons();
    return;
  }
  listEl.innerHTML = items.map((it) => {
    const checked = capturesSelected.has(it.id);
    if (it.kind === 'project') {
      const tracks = it.project?.tracks || [];
      const back = tracks.find((t) => t.kind === 'backing');
      const recs = tracks.filter((t) => t.kind === 'record');
      const clips = tracks.reduce((n, t) => n + (t.clips?.length || 0), 0);
      const isPlaying = !!projectPlayers.get(it.id)?.playing;
      const icon = 'sliders';
      const accent = 'bg-accent/20 text-accent-foreground';
      const sub = `${it.stamp || ''} · ${back ? '伴奏+' : ''}${recs.length}轨 ${clips}片段 · ${it.duration || ''}`;
      const actionIcon = isPlaying ? 'pause' : 'play';
      return `
        <article class="bg-card border ${checked ? 'border-primary ring-2 ring-primary/30' : 'border-border'} rounded-xl p-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-all duration-150" data-id="${it.id}" data-kind="project">
          ${capturesSelectMode ? captureCardCheckbox(checked, it.id) : ''}
          <div class="w-10 h-10 rounded-full ${accent} flex items-center justify-center shrink-0">
            <i data-lucide="${icon}" class="w-5 h-5"></i>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-medium truncate">${escapeHtml(it.title)}</h3>
            <p class="text-xs text-muted-foreground">${escapeHtml(sub)}</p>
          </div>
          ${capturesSelectMode ? '' : `
          <button type="button" data-action="load" class="px-2 py-1 rounded-md bg-primary/15 text-primary text-[11px] font-medium hover:bg-primary/25 transition-colors duration-150 whitespace-nowrap">载入</button>
          <button type="button" data-action="play" class="p-2 rounded-full hover:bg-muted transition-colors duration-150">
            <i data-lucide="${actionIcon}" class="w-5 h-5 ${isPlaying ? 'text-primary' : 'text-muted-foreground'}"></i>
          </button>
          <button type="button" data-action="rename" class="p-2 rounded-full hover:bg-muted transition-colors duration-150" title="重命名">
            <i data-lucide="pencil" class="w-4 h-4 text-muted-foreground"></i>
          </button>
          <button type="button" data-action="export" class="p-2 rounded-full hover:bg-muted transition-colors duration-150" title="导出">
            <i data-lucide="download" class="w-4 h-4 text-muted-foreground"></i>
          </button>
          <button type="button" data-action="delete" class="p-2 rounded-full hover:bg-muted transition-colors duration-150">
            <i data-lucide="trash-2" class="w-4 h-4 text-muted-foreground"></i>
          </button>`}
        </article>`;
    }
    // legacy audio / text
    const isAudio = it.kind === 'audio';
    const icon = isAudio ? 'mic' : 'type';
    const accent = isAudio ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground';
    const playingId = currentlyPlaying?.closest?.('article[data-id]')?.dataset.id;
    const isThisPlaying = isAudio && playingId === it.id;
    const actionIcon = isAudio ? (isThisPlaying ? 'pause' : 'play') : 'chevron-right';
    const sub = isAudio ? `${it.stamp || ''} · ${it.duration || ''}` : `${it.stamp || ''} · 文字`;
    return `
      <article class="bg-card border ${checked ? 'border-primary ring-2 ring-primary/30' : 'border-border'} rounded-xl p-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-all duration-150" data-id="${it.id}" data-kind="${it.kind}">
        ${capturesSelectMode ? captureCardCheckbox(checked, it.id) : ''}
        <div class="w-10 h-10 rounded-full ${accent} flex items-center justify-center shrink-0">
          <i data-lucide="${icon}" class="w-5 h-5"></i>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-medium truncate">${escapeHtml(it.title)}</h3>
          <p class="text-xs text-muted-foreground">${escapeHtml(sub)}</p>
        </div>
        ${isAudio ? `<audio data-audio src="${it.url || ''}" preload="metadata"></audio>` : ''}
        ${capturesSelectMode ? '' : `
        <button type="button" data-action="play" class="p-2 rounded-full hover:bg-muted transition-colors duration-150">
          <i data-lucide="${actionIcon}" class="w-5 h-5 ${isThisPlaying ? 'text-primary' : 'text-muted-foreground'}"></i>
        </button>
        <button type="button" data-action="rename" class="p-2 rounded-full hover:bg-muted transition-colors duration-150" title="重命名">
          <i data-lucide="pencil" class="w-4 h-4 text-muted-foreground"></i>
        </button>
        <button type="button" data-action="export" class="p-2 rounded-full hover:bg-muted transition-colors duration-150" title="导出">
          <i data-lucide="download" class="w-4 h-4 text-muted-foreground"></i>
        </button>
        <button type="button" data-action="delete" class="p-2 rounded-full hover:bg-muted transition-colors duration-150">
          <i data-lucide="trash-2" class="w-4 h-4 text-muted-foreground"></i>
        </button>`}
      </article>`;
  }).join('');
  updateCapturesSelectUI();
  refreshIcons();
}

// ---- 多选事件绑定 ----
if (capturesToggleSelectBtn) {
  capturesToggleSelectBtn.addEventListener('click', () => {
    const items = captures.all().filter((it) => it.kind !== 'text');
    if (!items.length) { window.MFToast('暂无可选的捕捉项'); return; }
    capturesSelectMode = !capturesSelectMode;
    if (!capturesSelectMode) capturesSelected.clear();
    updateCapturesSelectUI();
    renderList();
  });
}
if (capturesSelectCancelBtn) {
  capturesSelectCancelBtn.addEventListener('click', exitCapturesSelectMode);
}
if (capturesSelectAll) {
  capturesSelectAll.addEventListener('change', () => {
    const items = captures.all().filter((it) => it.kind !== 'text');
    if (capturesSelectAll.checked) {
      capturesSelected = new Set(items.map((x) => x.id));
    } else {
      capturesSelected.clear();
    }
    updateCapturesSelectUI();
    renderList();
  });
}
if (capturesBatchDeleteBtn) {
  capturesBatchDeleteBtn.addEventListener('click', async () => {
    if (!capturesSelected.size) return;
    const ok = await openConfirm(`确定删除选中的 ${capturesSelected.size} 项？此操作不可恢复。`);
    if (!ok) return;
    let n = 0;
    capturesSelected.forEach((id) => {
      captures.remove(id);
      releaseProjectPlayer(id);
      n++;
    });
    window.MFToast(`已删除 ${n} 项`);
    exitCapturesSelectMode();
  });
}

// 点击卡片上的复选框（事件委托）
listEl?.addEventListener('click', (e) => {
  const checkEl = e.target.closest('[data-capture-check]');
  if (!checkEl) return;
  const id = checkEl.dataset.captureCheck;
  if (capturesSelected.has(id)) capturesSelected.delete(id);
  else capturesSelected.add(id);
  updateCapturesSelectUI();
  renderList();
});

listEl?.addEventListener('click', async (e) => {
  // 多选模式下跳过操作按钮逻辑
  if (capturesSelectMode && !e.target.closest('button[data-action]')) return;
  const article = e.target.closest('article[data-id]');
  if (!article) return;
  const id = article.dataset.id;
  const kind = article.dataset.kind;
  const action = e.target.closest('button[data-action]')?.dataset.action;
  // 多选模式下没有操作按钮显示；若 action 存在则允许执行（兼容搜索结果）
  if (capturesSelectMode && !action) return;

  // 处理搜索结果中的歌词删除
  if (action === 'delete-lyric') {
    lyrics.remove(id);
    window.MFToast('歌词已删除');
    // 重新执行搜索刷新结果
    if (searchModal.style.display === 'flex') {
      doSearch();
    } else {
      renderList();
    }
    return;
  }

  const item = captures.all().find((x) => x.id === id);
  if (!item) return;
  if (action === 'delete') {
    captures.remove(id);
    releaseProjectPlayer(id);
    window.MFToast('已删除');
    renderList();
    return;
  }
  if (action === 'export') {
    const btn = e.target.closest('button[data-action="export"]');
    showExportMenu(item, btn || article);
    return;
  }
  // === 重命名：contentEditable 内联编辑 ===
  if (action === 'rename') {
    const h3 = article.querySelector('h3');
    if (!h3 || h3.isContentEditable) return;
    const oldTitle = h3.textContent.trim();
    h3.contentEditable = 'true';
    h3.classList.remove('truncate');
    h3.classList.add('outline-none', 'border-b', 'border-primary', 'cursor-text');
    h3.focus();
    const range = document.createRange();
    range.selectNodeContents(h3);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      h3.contentEditable = 'false';
      h3.classList.remove('outline-none', 'border-b', 'border-primary', 'cursor-text');
      h3.classList.add('truncate');
      const newTitle = h3.textContent.trim();
      h3.removeEventListener('keydown', onKey);
      h3.removeEventListener('blur', onBlur);
      if (save && newTitle && newTitle !== oldTitle) {
        captures.update(id, { title: newTitle });
        window.MFToast('已重命名');
      }
      renderList();
    };
    const onKey = (kev) => {
      if (kev.key === 'Enter') { kev.preventDefault(); finish(true); }
      else if (kev.key === 'Escape') { kev.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    h3.addEventListener('keydown', onKey);
    setTimeout(() => h3.addEventListener('blur', onBlur), 200);
    return;
  }
  // === 载入工程：把保存的 track/clip/startTime 摆回编辑器时间轴 ===
  if (action === 'load' && kind === 'project') {
    if (transportState !== 'idle') transportStop();
    const tracks = item.project?.tracks || [];
    if (!tracks.length) { window.MFToast('工程为空'); return; }
    try {
      // 先释放当前 project 的资源
      project.tracks.forEach((tr) => tr.clips.forEach((c) => {
        try { c.audio.pause(); } catch {}
        if (c.url) try { URL.revokeObjectURL(c.url); } catch {}
      }));
      project.tracks = [];
      for (const tr of tracks) {
        const liveClips = [];
        for (const c of (tr.clips || [])) {
          const blob = await dataURLToBlob(c.blobDataURL);
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.preload = 'auto';
          // 确保 duration 与保存时一致（loadedmetadata 可能异步，兜底值为保存值）
          const clip = {
            id: c.id || `clip_${uid()}`,
            url,
            blob,
            audio,
            startTime: Number(c.startTime) || 0,  // ★ 严格用保存的 time position 摆位
            duration: Number(c.duration) || 0,
          };
          audio.addEventListener('loadedmetadata', () => {
            if (!clip.duration) clip.duration = audio.duration || 30;
            renderTracks();
          });
          liveClips.push(clip);
        }
        project.tracks.push({
          id: tr.id || `track_${uid()}`,
          name: tr.name || (tr.kind === 'backing' ? '伴奏' : '录音轨'),
          kind: tr.kind === 'backing' ? 'backing' : 'record',
          muted: !!tr.muted,
          solo: !!tr.solo,
          armed: false, // 载入后默认不 arm
          clips: liveClips,
        });
      }
      renderTracks();
      window.MFToast(`已载入工程 · ${project.tracks.length} 轨`);
    } catch (err) {
      console.error(err);
      window.MFToast('载入失败：' + (err?.message || '格式错误'));
    }
    return;
  }
  if (action !== 'play') return;
  if (kind === 'project') {
    const existing = projectPlayers.get(id);
    if (existing) {
      if (existing.playing) {
        existing.audios.forEach((a) => a.pause());
        existing.playing = false;
      } else {
        existing.audios.forEach((a) => { try { a.currentTime = 0; a.play(); } catch {} });
        existing.playing = true;
      }
      renderList();
      return;
    }
    // restore from base64
    const audios = [];
    const tracks = item.project?.tracks || [];
    // 简单规则：所有 clips startTime=0 都一起从头播；按 clip.startTime 调度（setTimeout 相对偏移）
    const anySolo = tracks.some((t) => t.solo);
    try {
      for (const tr of tracks) {
        if (tr.muted) continue;
        if (anySolo && !tr.solo) continue;
        for (const c of (tr.clips || [])) {
          const a = new Audio(URL.createObjectURL(await dataURLToBlob(c.blobDataURL)));
          const delayMs = (c.startTime || 0) * 1000;
          if (delayMs > 0) {
            setTimeout(() => a.play().catch(() => {}), delayMs);
          } else {
            a.play().catch(() => {});
          }
          audios.push(a);
        }
      }
      const checkEnded = () => {
        const allDone = audios.every((a) => a.ended || a.paused);
        if (allDone) {
          releaseProjectPlayer(id);
          renderList();
        }
      };
      audios.forEach((a) => {
        a.addEventListener('ended', checkEnded);
        a.addEventListener('pause', checkEnded);
      });
      projectPlayers.set(id, { audios, playing: true });
      renderList();
    } catch (err) {
      console.error(err);
      window.MFToast('工程回放失败');
    }
    return;
  }
  // legacy audio/text
  if (item.kind === 'audio') {
    const audio = article.querySelector('audio[data-audio]');
    if (!audio) return;
    if (currentlyPlaying && currentlyPlaying !== audio) currentlyPlaying.pause();
    if (currentlyPlaying === audio) {
      audio.pause();
      currentlyPlaying = null;
    } else {
      audio.play().catch(() => window.MFToast('无法播放该录音'));
      currentlyPlaying = audio;
      audio.onended = () => { currentlyPlaying = null; renderList(); };
    }
    renderList();
  } else {
    window.MFToast(item.body ? item.body.slice(0, 40) + (item.body.length > 40 ? '…' : '') : item.title);
  }
});

// ================== Search ==================
// 自定义搜索模态框，匹配应用设计风格
const searchModal = document.getElementById('search-modal');
const searchInput = document.getElementById('search-input');

function openSearchModal() {
  searchInput.value = '';
  searchModal.style.display = 'flex';
  setTimeout(() => searchInput.focus(), 50);
}
function closeSearchModal() {
  searchModal.style.display = 'none';
}
function doSearch() {
  const q = searchInput.value.trim();
  closeSearchModal();
  if (!q) { renderList(); return; }

  const query = q.toLowerCase();

  // 搜捕捉（灵感：音频 / 工程，不含文字）
  const capHits = captures.all().filter((it) => {
    if (it.kind === 'text') return false;
    const t = (it.title || '').toLowerCase();
    const b = (it.body || '').toLowerCase();
    return t.includes(query) || b.includes(query);
  }).map((it) => {
    const isProj = it.kind === 'project';
    const isAudio = it.kind === 'audio';
    const icon = isProj ? 'sliders' : isAudio ? 'mic' : 'type';
    const accent = isProj ? 'bg-accent/20' : isAudio ? 'bg-primary/10' : 'bg-muted';
    return `<article class="bg-card border border-border rounded-xl p-3 flex items-center gap-3 shadow-sm" data-id="${it.id}" data-kind="${it.kind || ''}">
      <div class="w-10 h-10 rounded-full ${accent} flex items-center justify-center shrink-0"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
      <div class="flex-1 min-w-0"><h3 class="text-sm font-medium truncate">${escapeHtml(it.title)}</h3><p class="text-xs text-muted-foreground">${escapeHtml(it.stamp || '')} · 灵感</p></div>
    </article>`;
  });

  // 搜歌词
  const lyrHits = lyrics.all().filter((it) => {
    const t = (it.title || '').toLowerCase();
    const b = (it.body || '').toLowerCase();
    return t.includes(query) || b.includes(query);
  }).map((it) => `<article class="bg-card border border-border rounded-xl p-3 flex items-center gap-3 shadow-sm group" data-id="${it.id}" data-kind="lyric">
      <div class="w-10 h-10 rounded-full bg-muted text-foreground/80 flex items-center justify-center shrink-0"><i data-lucide="type" class="w-5 h-5"></i></div>
      <div class="flex-1 min-w-0"><h3 class="text-sm font-medium truncate">${escapeHtml(it.title)}</h3><p class="text-xs text-muted-foreground">${escapeHtml(it.date || '')} · 歌词</p></div>
      <button type="button" data-action="delete-lyric" class="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="删除">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </article>`);

  const total = capHits.length + lyrHits.length;
  if (!total) {
    window.MFToast('没有匹配');
    renderList();
    return;
  }
  window.MFToast(`找到 ${total} 条结果`);
  listEl.innerHTML = capHits.concat(lyrHits).join('');
  refreshIcons();
}

document.getElementById('search-btn')?.addEventListener('click', openSearchModal);
document.getElementById('search-close')?.addEventListener('click', closeSearchModal);
document.getElementById('search-cancel')?.addEventListener('click', closeSearchModal);
document.getElementById('search-confirm')?.addEventListener('click', doSearch);
searchModal?.addEventListener('click', (e) => {
  if (e.target === searchModal) closeSearchModal();
});
searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
  if (e.key === 'Escape') closeSearchModal();
});
document.addEventListener('keydown', (e) => {
  if (searchModal && e.key === 'Escape' && searchModal.style.display === 'flex') closeSearchModal();
});

// ================== Init ==================
// 默认创建 1 条录音轨，避免 arranger 空得什么都看不到
if (project.tracks.length === 0) {
  project.tracks.push({
    id: `track_${uid()}`,
    name: '录音 1',
    kind: 'record',
    muted: false,
    solo: false,
    armed: false,
    clips: [],
  });
}
renderTracks();
renderList();
// mountNav is called by app.js
setMode(REC_MODE);

// ================== Arranger 滑块同步 ==================
function setupArrangerSlider() {
  const viewport = document.getElementById('arranger-viewport');
  const slider = document.getElementById('arranger-slider');
  const thumb = document.getElementById('arranger-slider-thumb');
  if (!viewport || !slider || !thumb) return;

  // 可见宽度 / 总宽度 的比例 = thumb 宽度
  function updateSlider() {
    const totalW = viewport.scrollWidth;
    const viewW = viewport.clientWidth;
    if (totalW <= viewW) {
      // 不需要滚动
      thumb.style.left = '0';
      thumb.style.width = '100%';
      slider.style.opacity = '0.4';
      return;
    }
    slider.style.opacity = '1';
    const thumbW = (viewW / totalW) * 100;
    const maxThumbLeft = 100 - thumbW;
    const scrollRatio = viewport.scrollLeft / (totalW - viewW);
    thumb.style.width = `${thumbW}%`;
    thumb.style.left = `${scrollRatio * maxThumbLeft}%`;
  }

  // 滚动时更新滑块
  viewport.addEventListener('scroll', updateSlider, { passive: true });

  // 拖动滑块
  let dragging = false;
  function setScrollFromEvent(e) {
    const rect = slider.getBoundingClientRect();
    const totalW = viewport.scrollWidth;
    const viewW = viewport.clientWidth;
    const canScroll = totalW > viewW;
    if (!canScroll) return;
    const thumbW = (viewW / totalW) * rect.width;
    const maxThumbLeft = rect.width - thumbW;
    const clientX = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const thumbCenter = Math.max(thumbW / 2, Math.min(maxThumbLeft + thumbW / 2, clientX));
    const thumbLeft = thumbCenter - thumbW / 2;
    const ratio = maxThumbLeft > 0 ? thumbLeft / maxThumbLeft : 0;
    viewport.scrollLeft = ratio * (totalW - viewW);
  }

  slider.addEventListener('mousedown', (e) => {
    dragging = true;
    setScrollFromEvent(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (dragging) setScrollFromEvent(e);
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // 点击滑块跳转
  slider.addEventListener('click', (e) => {
    if (e.target === thumb) return;
    setScrollFromEvent(e);
  });

  // 触摸支持
  slider.addEventListener('touchstart', (e) => {
    dragging = true;
    setScrollFromEvent(e);
  }, { passive: true });
  slider.addEventListener('touchmove', (e) => {
    if (dragging) setScrollFromEvent(e);
  }, { passive: true });
  document.addEventListener('touchend', () => { dragging = false; });

  // 内容变化时更新
  const ro = new ResizeObserver(updateSlider);
  ro.observe(viewport);

  // 暴露给 renderTracks 调用
  window._updateArrangerSlider = updateSlider;
  updateSlider();
}

setupArrangerSlider();
