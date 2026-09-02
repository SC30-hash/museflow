// src/pages/capture.js — Studio-One style multi-track arranger (灵感页)
// - 多个录音轨（可随时"加轨"），每个轨有 Mute / Solo / Record-Arm 三个开关
// - 伴奏导入后作为第一条特殊轨，也可 Mute / Solo
// - Transport: ■ 停止 / ▶ 播放 / ● 录音 三个按钮 + 时间显示 + playhead
// - 录音: 所有被 Arm 的轨同时从 playhead 位置开始录（MediaRecorder 多实例复用同麦克风流）
// - 播放: 所有非 Mute（遵循 Solo）的 audio clips 按 startTime/duration 精确定时同步播
// - 每个 clip 可点删除；整条轨可删（除伴奏轨）；保存工程: 所有 Blob 转 base64 持久化

import { refreshIcons, swapIcon } from '../lib/nav.js';
import { captures, lyrics, nowstamp, uid } from '../lib/store.js';
import { Mp3Encoder } from '@breezystack/lamejs';
import { defaultFx, trackFx, isDefaultFx, buildIR, createFxChain, loadAutotune, REVERB_TAIL } from '../lib/fx.js';

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

// 时间读数三态样式：待机暖灰 / 播放微亮(tt-play) / 录音红呼吸(tt-rec)
function syncTransportTimeUI() {
  const el = document.getElementById('transport-time');
  if (!el) return;
  el.classList.toggle('tt-play', transportState === 'play');
  el.classList.toggle('tt-rec', transportState === 'rec');
}

// shared microphone stream (多个 MediaRecorder 复用，避免重复申请权限)
let sharedMicStream = null;
// ================== 蓝牙免提麦识别与自动规避 ==================
// Safari + 蓝牙耳机（AirPods 等）的完整问题链：
// 1) 麦克风一开，系统把蓝牙链路从 A2DP（高音质）切到 HFP 免提（约 16kHz 窄带）；
// 2) 录音期间耳返（伴奏）经由 HFP 链路 → 发闷；
// 3) 人声本身也经蓝牙麦采集 → 录出来的就是 16kHz 电话音质，停录也不会恢复；
// 4) 停止录音、蓝牙麦关闭后，HFP 解除 → 伴奏回放恢复原音质（引擎已锁 48kHz）。
// 规避手段：不用蓝牙麦、改用本机麦克风 → 系统无需免提模式，耳机输出保持 A2DP，
// 耳返和人声都是全音质。Safari 会如实上报 HFP 麦的 16kHz 采样率（可检测），
// 但对 getUserMedia 的 deviceId 指定支持不完整（可能被忽略）→ 换麦后必须验证。
const BT_MIC_RE = /bluetooth|headset|hands[-\s]?free|HFP|airpods?|powerbeats|beats|buds|earbuds|免提|通话|蓝牙/i;
const BUILTIN_MIC_RE = /built[-\s]?in|internal|内置|本机|iPhone|iPad|MacBook|iMac|default|默认/i;
async function acquireMicStream() {
  if (sharedMicStream) return sharedMicStream;
  if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('不支持录音');
  // 音乐录音关掉浏览器默认开启的语音 DSP（AEC / 降噪 / AGC）：
  // 三件套都是语音通话向的处理，会给人声染色（金属感/呼吸感抽吸）。
  // 代价：外放录歌时伴奏会串进麦克风（本来就建议戴耳机）。
  const musicConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: musicConstraints });
  } catch {
    // 个别老浏览器不认非基本约束：退回默认申请（行为与旧版一致）
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  stream = await avoidBluetoothHfpMic(stream, musicConstraints);
  sharedMicStream = stream;
  applyMusicSessionForMic(sharedMicStream);
  return sharedMicStream;
}
// ---- iOS 音频会话路由（Safari 16.4+）----
// 外放录音没声音的第一元凶：Safari 开麦后系统把输出切到听筒
// （WebKit 设 playAndRecord 类别但不带 defaultToSpeaker 选项，bug 218012），
// 大喇叭直接静音，声音全从贴耳小听筒出来——听感就是“外放没声音”。
// navigator.audioSession（W3C 提案，iOS 16.4+ 落地）允许页面声明会话类型：
// 录音期间声明 'playback'，系统保持扬声器正常输出、音量不受压
// （bug 218012 #38 在 iOS 16.4 实测确认，麦克风采集不受影响）。
let micSessionActive = false;
let earpieceTipShown = false;
function applyMusicSessionForMic(stream) {
  const as = navigator.audioSession;
  if (!as) {
    // iOS < 16.4 没有此 API：静音键免疫已由底噪轨兜底；听筒路由无法干预，给一次对症提示
    if (isIOSDevice() && !earpieceTipShown) {
      earpieceTipShown = true;
      window.MFToast('当前 iOS 版本较旧：静音键已不影响播放（已启用兼容模式）；若录音期间外放仍无声（系统把输出切到听筒），升级到 iOS 16.4 以上可彻底解决');
    }
    return;
  }
  try {
    as.type = 'playback';
    micSessionActive = true;
    // 保险：万一个别版本掐掉采集（track 意外结束），退回 'play-and-record'
    // 保住录音能力（输出可能回听筒，但录音优先）
    const tr = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
    if (tr) {
      tr.addEventListener('ended', () => {
        if (!micSessionActive) return; // 我们主动停的（正常释放/换麦）：不算事故
        micSessionActive = false;
        try { as.type = 'play-and-record'; } catch {}
      }, { once: true });
    }
  } catch { /* 赋值被拒：维持浏览器默认行为 */ }
}
// 麦克风释放时会话还原为应用级 'playback'（静音键免疫是常驻的，不交回默认）
function clearMusicSession() {
  micSessionActive = false;
  const as = navigator.audioSession;
  if (!as) return;
  try { as.type = 'playback'; } catch {}
}
// 检测当前音源是否疑似蓝牙免提麦（通话级）。
// Safari/Chrome 在 HFP 下都会如实报 sampleRate=16000；采样率未上报时退回设备名识别。
async function probeVoiceGradeMic(stream) {
  try {
    const tr = stream.getAudioTracks()[0];
    if (!tr) return { voiceGrade: false };
    const s = tr.getSettings() || {};
    const sr = Number(s.sampleRate) || 0;
    if (sr > 0 && sr <= 16000) return { voiceGrade: true, settings: s };
    const devs = await navigator.mediaDevices.enumerateDevices();
    const inputs = devs.filter((d) => d.kind === 'audioinput' && d.deviceId);
    const active = inputs.find((d) => d.deviceId === s.deviceId);
    if (active && BT_MIC_RE.test(active.label || '')) return { voiceGrade: true, settings: s };
    // iOS 盲区兜底：系统只暴露一个输入且名字像蓝牙耳麦（连着 AirPods 时就如此）
    if (inputs.length === 1 && BT_MIC_RE.test(inputs[0].label || '') && !BUILTIN_MIC_RE.test(inputs[0].label || '')) {
      return { voiceGrade: true, settings: s };
    }
    return { voiceGrade: false, settings: s };
  } catch {
    return { voiceGrade: false };
  }
}
// 在设备列表里挑一个非蓝牙麦克风（优先名字像内置麦的）。
async function findNonBluetoothMic(currentStream) {
  try {
    const curId = currentStream?.getAudioTracks?.()[0]?.getSettings?.().deviceId || '';
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cands = devs.filter(
      (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== curId && d.label && !BT_MIC_RE.test(d.label),
    );
    const preferred = cands.find((d) => BUILTIN_MIC_RE.test(d.label));
    return preferred ? preferred.deviceId : (cands[0] ? cands[0].deviceId : null);
  } catch {
    return null;
  }
}
let btAvoidToastShown = false;
async function avoidBluetoothHfpMic(stream, musicConstraints) {
  const probe = await probeVoiceGradeMic(stream);
  // 顺带体检：申请明确关了 AEC，settings 仍报 true → 浏览器忽略了音乐录音设置
  if (!probe.voiceGrade && probe.settings && probe.settings.echoCancellation === true && !btAvoidToastShown) {
    btAvoidToastShown = true;
    window.MFToast('当前浏览器忽略了音乐录音设置（仍强制语音处理），录音听感会被压窄。建议用最新版 Chrome / Safari 打开本页');
    return stream;
  }
  if (!probe.voiceGrade) return stream;
  // 检测到通话级音源（多为蓝牙耳麦）：尝试切换到本机麦克风
  const altId = await findNonBluetoothMic(stream);
  if (altId) {
    try {
      const alt = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: altId }, ...musicConstraints },
      });
      const as = alt.getAudioTracks()[0]?.getSettings() || {};
      const orig = probe.settings || {};
      const sameDev = !!as.deviceId && as.deviceId === orig.deviceId;
      const altSR = Number(as.sampleRate) || 0;
      // 验证：设备确实换了，且没有明确仍是 16k（Safari 可能忽略 deviceId 指定）
      if (!sameDev && (altSR === 0 || altSR > 16000)) {
        stream.getTracks().forEach((t) => t.stop()); // 停掉蓝牙麦 → 系统退出免提模式，耳机回到高音质 A2DP
        window.MFToast('已自动改用本机麦克风录音（蓝牙免提麦会把伴奏和人声都压成通话音质）。现在耳返伴奏是原音质，人声也按全音质收录');
        return alt;
      }
      alt.getTracks().forEach((t) => t.stop()); // Safari 忽略了设备选择：放弃切换
    } catch { /* 切换失败：退回原音源 */ }
  }
  if (!btAvoidToastShown) {
    btAvoidToastShown = true;
    window.MFToast('蓝牙耳机麦克风已启用：录音期间耳返会发闷、人声也会录成通话音质——这是系统行为，网页无法绕过；停止录音后伴奏立即恢复原音质（已录下的人声不变）。想全程原音质：改戴有线耳机，或拔掉蓝牙用本机麦');
  }
  return stream;
}
function releaseMicStream() {
  if (sharedMicStream) {
    clearMusicSession(); // 先置非活动标志再停轨，避免 ended 误判为采集事故
    sharedMicStream.getTracks().forEach((t) => t.stop());
    sharedMicStream = null;
  }
}

// ================== 录音监听 ==================
// 监听 = 麦克风实时经各 Arm 录音轨的 FX 链（EQ/压缩/混响/自动音准）直达输出，
// 录音时能听到自己——与播放/导出共用同一套链，所听即所得。
// 默认关闭：不戴耳机会经扬声器啸叫。开启后录音结束监听仍保持（用户显式关）。
let monitorOn = false;
let micSrc = null; // MediaStreamAudioSourceNode（所有被监听的轨共用一个源）

function syncMonitorUI() {
  const btn = document.getElementById('transport-monitor');
  if (!btn) return;
  if (monitorOn) {
    btn.classList.remove('bg-muted', 'text-muted-foreground');
    btn.classList.add('bg-primary/15', 'text-primary', 'ring-1', 'ring-primary/50');
  } else {
    btn.classList.add('bg-muted', 'text-muted-foreground');
    btn.classList.remove('bg-primary/15', 'text-primary', 'ring-1', 'ring-primary/50');
  }
  btn.setAttribute('aria-pressed', String(monitorOn));
}

// 接入/重新接入监听：按当前 Arm 的录音轨（无 Arm 时取全部录音轨）。
// 幂等——已连接时先断开旧链再按最新 Arm 重接（切换 Arm、删轨、开始录音时都会调用）。
// silent 用于程序内部重接：不弹提示。
async function startMonitor({ silent = false } = {}) {
  const fail = (msg) => { if (!silent) window.MFToast(msg); return false; };
  let targets = project.tracks.filter((t) => t.kind === 'record' && t.armed);
  if (!targets.length) targets = project.tracks.filter((t) => t.kind === 'record');
  if (!targets.length) return fail('没有录音轨');
  try { await acquireMicStream(); } catch (err) { return fail(err?.message || '无法访问麦克风'); }
  if (!ensureLiveGraph()) return fail('无法创建音频图');
  const results = await Promise.all(targets.map(async (tr) => ({ tr, ch: await getLiveChain(tr).catch(() => null) })));
  if (!micSrc) {
    try { micSrc = _ac.createMediaStreamSource(sharedMicStream); } catch { return false; }
  } else {
    try { micSrc.disconnect(); } catch {}
  }
  results.forEach(({ tr, ch }) => {
    if (!ch) return;
    const dest = tr._trackGain || ch.input; // 经轨道闸门：静音同样作用于监听
    try { micSrc.connect(dest); } catch {}
  });
  if (!silent) window.MFToast('监听已开启（建议戴耳机，避免啸叫）');
  return true;
}

function stopMonitor() {
  if (micSrc) {
    try { micSrc.disconnect(); } catch {}
    micSrc = null;
  }
  // 录音进行中：麦克风归录制用，不释放；空闲时释放（熄指示灯/省电）
  if (transportState !== 'rec') releaseMicStream();
}

document.getElementById('transport-monitor')?.addEventListener('click', async () => {
  monitorOn = !monitorOn;
  syncMonitorUI();
  if (monitorOn) {
    const ok = await startMonitor();
    if (!ok) { monitorOn = false; syncMonitorUI(); }
  } else {
    stopMonitor();
    window.MFToast('监听已关闭');
  }
});

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
        <button type="button" data-bt="M" class="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${tr.muted ? 'bg-primary/20 text-primary' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}" title="静音 (M)">M</button>
        <button type="button" data-bt="S" class="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${tr.solo ? 'bg-muted text-primary' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}" title="独奏 (S)">S</button>
        ${tr.kind === 'record' ? `<button type="button" data-bt="R" class="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${tr.armed ? 'bg-red-500 text-white animate-pulse' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}" title="Arm 录音 (R)">R</button>` : ''}
        <button type="button" data-bt="F" class="w-5 h-5 rounded flex items-center justify-center transition-colors ${(() => { const hasFx = !isDefaultFx(trackFx(tr)); return tr.bypass && hasFx ? 'bg-primary/10 text-primary/60 fx-slash' : hasFx ? 'bg-primary/20 text-primary' : 'bg-muted/50 text-muted-foreground hover:text-foreground'; })()}" title="混音台（长按旁通）"><i data-lucide="sliders-horizontal" class="w-3 h-3"></i></button>
        <button type="button" data-bt="X" class="w-5 h-5 rounded bg-muted/50 text-muted-foreground flex items-center justify-center hover:text-destructive transition-colors" title="删除该轨"><i data-lucide="x" class="w-3 h-3"></i></button>
      </div>`;
    row.appendChild(strip);

    // --- Arranger clips 区（右列）---
    const arr = document.createElement('div');
    // 静音轨整行淡化，状态一眼可见
    arr.className = `relative h-[44px] bg-muted/10 ${tr.muted ? 'opacity-40' : ''}`;
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
      el.title = `${fmtTime(cl.startTime)} - ${fmtTime(cl.startTime + cl.duration)} · 拖动移动（触屏长按提起）· 三击删除 · 剪切模式点按剪开`;
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
    ensureAC(); // 统一 48kHz 入口（旧代码在此处直接 new，可能被锁低采样率）
    // 如果还没解码过 blob 成 AudioBuffer：解码 + 缓存波形（buffer 也缓存，播放复用）
    if (!clip._waveSVG) {
      const buf = await getClipBuffer(clip);
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
// 音频引擎统一入口：采样率强制 48kHz。
// 根因：AudioContext.sampleRate 在创建瞬间永久定格。若引擎恰好在麦克风开启/
// 蓝牙免提生效期间才第一次创建（时序竞态），会被系统锁在 16kHz 通话级——
// 之后整个页面会话里伴奏与录音回放全部是电话音质，即使录音早已结束。
// 锁定 48kHz 后，系统切换只影响当下输出，录音一停立即恢复满血，
// 引擎本身永不被拉低——「录音轨不影响伴奏轨」的引擎级保证。
function ensureAC() {
  if (!_ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      _ac = new AC({ sampleRate: 48000 });
    } catch {
      _ac = new AC(); // 极老浏览器不认 options：退回默认采样率
    }
    // 引擎一旦掉出 running（挂起/被打断）就自动尝试复活；
    // 手势 / 设备变化 / 回前台的兜底监听见 engineKeepAlive
    if (_ac) _ac.onstatechange = () => { if (_ac.state !== 'running') _ac.resume().catch(() => {}); };
  }
  return _ac;
}
// ---- iOS 静音键免疫 ----
// iPhone 侧边静音键默认连 WebAudio 一起静音（WebKit bug 237322）：
// 切了静音，页面里所有伴奏/播放瞬间无声——用户以为「外放坏了」。
// 标准对策是把页面声明成「媒体播放」会话（与系统音乐 App 同类），
// 静音键从此不影响：
//  - iOS 16.4+：navigator.audioSession.type = 'playback'（官方 API）
//  - 旧版 iOS：起一条循环的近无声 <audio> 底噪轨——只要有媒体元素在播，
//    iOS 就把页面当媒体播放对待、走媒体通道，静音键失效
//    （维基百科 / feross/unmute-ios-audio 等通用做法，bug 237322 官方认可）
function isIOSDevice() {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
let silentKeeper = null;
function makeSilentWavUrl() {
  // 0.2s @8kHz 8bit 单声道静音 WAV，运行时拼字节（免内联 base64）；
  // 每 100 个采样埋一个 LSB 抖动，避免被 iOS 优化成「纯静音可忽略」
  const sr = 8000;
  const n = 1600;
  const ab = new ArrayBuffer(44 + n);
  const dv = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  w(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) dv.setUint8(44 + i, i % 100 === 0 ? 129 : 128);
  return URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
}
function startSilentKeeper() {
  try {
    const el = document.createElement('audio');
    el.loop = true;
    el.volume = 0.01; // 非零音量（个别版本把 0 音量当无效媒体），内容本身是静音
    el.src = makeSilentWavUrl();
    silentKeeper = el;
    el.play().catch(() => {}); // 手势外失败：保活逻辑里会重试
  } catch {}
}
// 引擎保活：拔插蓝牙耳机、切换外放、锁屏返回、来电打断等都会让 Safari
// 把引擎挂到 suspended / interrupted（后者为 Safari 特有状态），此后整页
// 静音——切到外放后“伴奏没声音”的第二元凶。旧代码只在首次手势 resume
// 一次（once），打断一次就永远哑掉。现在常驻监听一切复活时机。
(function engineKeepAlive() {
  const revive = () => {
    const c = ensureAC();
    if (c && c.state !== 'running') c.resume().catch(() => {});
    // 旧版 iOS 的静音键免疫底噪轨若被系统暂停（后台返回等）：补播
    if (silentKeeper && silentKeeper.paused) silentKeeper.play().catch(() => {});
  };
  // 首次手势即声明媒体播放会话（静音键免疫），16.4+ 走官方 API、旧版起底噪轨
  let sessionBooted = false;
  const bootSession = () => {
    if (sessionBooted) return;
    sessionBooted = true;
    if (!isIOSDevice()) return;
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch {}
    } else {
      startSilentKeeper();
    }
  };
  document.addEventListener('pointerdown', bootSession, { once: true, capture: true });
  document.addEventListener('keydown', bootSession, { once: true, capture: true });
  // 每次手势都尝试复活（running 时 resume 为幂等空操作，无害）
  document.addEventListener('pointerdown', revive, true);
  document.addEventListener('keydown', revive, true);
  // 音频设备增删（拔蓝牙/切外放）后引擎常被打断：立即 + 延迟各救一次
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    revive();
    setTimeout(revive, 400);
    setTimeout(revive, 1500);
  });
  // 从后台/锁屏回来时恢复
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revive(); });
})();
async function decodeBlob(blob) {
  ensureAC();
  const ab = await blob.arrayBuffer();
  return _ac.decodeAudioData(ab.slice(0));
}
// clip 级解码缓存：波形绘制 / live 播放 / 导出共用同一个 AudioBuffer，
// 每个文件只解码一次（decodeAudioData 是全量解码，最贵的一步）。
async function getClipBuffer(cl) {
  if (!cl._buffer) cl._buffer = await decodeBlob(cl.blob);
  return cl._buffer;
}
// ---- 混音音频图（live 播放用）：master 增益 + 共享混响总线 ----
// 每轨一条 FX 链（EQ/压缩/混响 send），挂在 track._liveChain 上惰性创建/复用
let masterGain = null;
let reverbBusIn = null;
function ensureLiveGraph() {
  try {
    if (!ensureAC()) return false; // 统一 48kHz 入口（旧代码在此处直接 new，可能被锁低采样率）
    if (_ac.state !== 'running') _ac.resume().catch(() => {}); // suspended/interrupted 都救
    if (!masterGain) {
      masterGain = _ac.createGain();
      masterGain.connect(_ac.destination);
      const conv = _ac.createConvolver();
      conv.buffer = buildIR(_ac);
      const wet = _ac.createGain();
      wet.gain.value = 0.9;
      conv.connect(wet);
      wet.connect(masterGain);
      reverbBusIn = conv;
      // 预热自动音准 worklet（异步装入，真正建链前会再 await 确认）
      loadAutotune(_ac).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}
async function getLiveChain(tr) {
  if (!tr._liveChain) {
    if (!ensureLiveGraph()) return null;
    try {
      await loadAutotune(_ac); // 装好 worklet 再建链，保证自动音准可用
      tr._liveChain = createFxChain(_ac, trackFx(tr), reverbBusIn, masterGain);
      tr._liveChain.setBypass(!!tr.bypass);
      // 轨道闸门：所有输入（播放元素 / 监听麦克风）先进增益节点再进 FX 链。
      // 静音/独奏通过拉闸实时生效，不重建链、不打断播放。
      if (!tr._trackGain) {
        tr._trackGain = _ac.createGain();
        tr._trackGain.gain.value = isTrackAudible(tr) ? 1 : 0; // 建闸时就按当前 M/S 状态初始化
        tr._trackGain.connect(tr._liveChain.input);
      }
    } catch {
      return null;
    }
  }
  return tr._liveChain;
}
// M/S 实时生效：拉/放所有轨道闸门 + 直连播放的元素用自身 muted 兜底
function syncTrackGains() {
  project.tracks.forEach((tr) => {
    if (!tr._trackGain || !_ac) return;
    const audible = isTrackAudible(tr);
    try {
      tr._trackGain.gain.setTargetAtTime(audible ? 1 : 0, _ac.currentTime, 0.008); // 短斜坡防咔哒
    } catch {
      tr._trackGain.gain.value = audible ? 1 : 0;
    }
  });
  // 元素降级路径（无 FX 图直连播放）用元素 muted 兜底；bufferSource 路径由上面的闸门管
  activePlaybacks.forEach((p) => {
    if (!p.track || !p.audio) return;
    try { p.audio.muted = !isTrackAudible(p.track); } catch {}
  });
}
// 滑杆调完后同步到 live 链（链不存在说明还没播过，播放时会按当前 fx 建）
function applyLiveFx(tr) {
  if (!tr || !tr._liveChain) return;
  tr._liveChain.update(trackFx(tr));
  tr._liveChain.setBypass(!!tr.bypass);
}
// 混音：所有 clip 经每轨 FX 链（EQ/压缩/混响）渲染到 OfflineAudioContext，
// 与 live 播放共用同一套链构建逻辑，保证「导出的 = 听到的」
async function mixProjectToBuffer(tracks, options = {}) {
  const { sampleRate = 44100 } = options;
  const anySolo = tracks.some((t) => t.solo);
  const active = tracks.filter((t) => !t.muted && (!anySolo || t.solo));
  const allClips = [];
  for (const tr of active) {
    for (const c of (tr.clips || [])) {
      if (!c.blobDataURL && !c.blob) continue;
      const blob = c.blobDataURL ? await dataURLToBlob(c.blobDataURL) : c.blob;
      // 复用 clip 级解码缓存（波形/live 播放时多半已解码过，导出免二次解码）
      if (!c._buffer) c._buffer = await decodeBlob(blob);
      const buf = c._buffer;
      // 旁通的轨按默认参数渲染（等效干声直通），与 live 软旁通行为一致；声像保留
      allClips.push({ buf, startTime: c.startTime || 0, fx: tr.bypass ? { ...defaultFx(), pan: trackFx(tr).pan } : trackFx(tr) });
    }
  }
  if (!allClips.length) return null;
  let totalSec = 0;
  let anyReverb = false;
  for (const cl of allClips) {
    const end = cl.startTime + cl.buf.duration;
    if (end > totalSec) totalSec = end;
    if (cl.fx.reverb > 0) anyReverb = true;
  }
  if (anyReverb) totalSec += REVERB_TAIL; // 混响尾巴也算进导出时长
  const oac = new OfflineAudioContext(2, Math.ceil(totalSec * sampleRate), sampleRate);
  await loadAutotune(oac); // 离线渲染也装上自动音准 worklet，导出与试听一致
  const master = oac.createGain();
  master.connect(oac.destination);
  const conv = oac.createConvolver();
  conv.buffer = buildIR(oac);
  const wet = oac.createGain();
  wet.gain.value = 0.9;
  conv.connect(wet);
  wet.connect(master);
  // 同参数的轨共用一条链；BufferSource 会按目标采样率自动重采样
  const chainCache = new Map();
  for (const cl of allClips) {
    const key = JSON.stringify(cl.fx);
    if (!chainCache.has(key)) chainCache.set(key, createFxChain(oac, cl.fx, conv, master));
    const src = oac.createBufferSource();
    src.buffer = cl.buf;
    src.connect(chainCache.get(key).input);
    src.start(Math.max(0, cl.startTime));
  }
  const mixed = await oac.startRendering();
  // 归一化防止削波（保留原有行为）
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = mixed.getChannelData(c);
    for (let i = 0; i < mixed.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak > 1) {
    const g = 1 / peak;
    for (let c = 0; c < 2; c++) {
      const d = mixed.getChannelData(c);
      for (let i = 0; i < mixed.length; i++) d[i] *= g;
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
  ensureAC(); // 统一 48kHz 入口（旧代码在此处直接 new，可能被锁低采样率）
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

// ---- 三次点击删除 / 拖动移动 ----
// （原"长按删除 + 双击剪切"已移除：长按在移动端容易误触，双击和三次点击冲突。）
const MOVE_TOL_PX = 6;      // 鼠标：位移超过 6px 进入 drag
const TRIPLE_WINDOW_MS = 800; // 三次点击删除的时间窗口
const TOUCH_LIFT_MS = 350;    // 触屏：长按 350ms「提起」音频块
const TOUCH_SLOP_PX = 10;     // 触屏：等待提起期间允许的抖动（超过视为滚动意图）
const EDGE_SCROLL_ZONE = 44;  // 拖动时靠近视口左右边缘 → 时间轴自动滚动
const ROW_SWITCH_INSET = 10;  // 垂直换轨判定：手指需进入目标行内 10px（防误触）
const clipClickTimes = new Map(); // clipId -> { count, last }
let suppressClickUntil = 0;  // 提起/拖动结束后的合成 click 不计入三击删除
let liftHintShown = false;   // 「已提起」提示只弹一次
let dropRowEl = null;        // 跨轨拖动时高亮的目标行
let dragBadgeEl = null;      // 拖动时跟随手指的时间徽标
let edgeScrollRAF = null;    // 边缘自动滚动的 rAF 循环
let pressState = null;      // { cid, clipEl, pointerType, startX, startY, lastX, lastY, pointerId, arr, arrId, origRect, origRowTop, rowRects, viewport, startScrollLeft, liftTimer, lifted, dragMode, deltaX, deltaY, targetRowId, startSec, durSec }
function clearPress() {
  if (!pressState) return;
  clearTimeout(pressState.liftTimer);
  if (pressState.clipEl && pressState.clipEl.isConnected) {
    pressState.clipEl.classList.remove('press-flash');
    pressState.clipEl.style.transform = '';
    pressState.clipEl.style.zIndex = '';
    pressState.clipEl.style.cursor = '';
    pressState.clipEl.style.filter = '';
    pressState.clipEl.style.outline = '';
    pressState.clipEl.style.outlineOffset = '';
    pressState.clipEl.style.boxShadow = '';
  }
  hideDragBadge();
  highlightDropRow(null);
  pressState = null;
  // edgeScrollRAF 循环下一帧检测到 pressState 为空会自行停止
}

// ---- 拖动视觉：跟随手指的时间徽标 + 目标轨道高亮 ----
function ensureDragBadge() {
  if (dragBadgeEl && dragBadgeEl.isConnected) return dragBadgeEl;
  dragBadgeEl = document.createElement('div');
  dragBadgeEl.id = 'drag-badge';
  dragBadgeEl.style.display = 'none';
  document.body.appendChild(dragBadgeEl);
  return dragBadgeEl;
}
function hideDragBadge() {
  if (dragBadgeEl) dragBadgeEl.style.display = 'none';
}
function highlightDropRow(rowId) {
  if (dropRowEl) dropRowEl.classList.remove('drop-target');
  dropRowEl = null;
  if (!rowId) return;
  const el = tracksBody.querySelector(`[data-track-id="${rowId}"]`);
  if (el) { el.classList.add('drop-target'); dropRowEl = el; }
}

// ---- 触屏：长按「提起」音频块 ----
function liftClip() {
  if (!pressState || pressState.lifted) return;
  pressState.lifted = true;
  pressState.liftTimer = null;
  const el = pressState.clipEl;
  el.classList.remove('press-flash');
  el.style.zIndex = '30';
  el.style.cursor = 'grabbing';
  el.style.transform = 'scale(1.05)';
  el.style.filter = 'brightness(1.2) saturate(1.15)';
  el.style.outline = '1px dashed rgba(245, 101, 101, .9)';
  el.style.outlineOffset = '-2px';
  el.style.boxShadow = '0 6px 18px rgba(0, 0, 0, .45)';
  try { navigator.vibrate?.(12); } catch {}
  if (!liftHintShown) {
    liftHintShown = true;
    window.MFToast('已提起 · 拖动调整位置，松手放下');
  }
}

// ---- 拖动预览：水平跟随（补偿自动滚动）+ 垂直换轨 + 时间徽标 ----
function applyDragPreview() {
  const ps = pressState;
  if (!ps || !ps.dragMode) return;
  const scrollDelta = (ps.viewport ? ps.viewport.scrollLeft : 0) - ps.startScrollLeft;
  const tx = ps.deltaX - scrollDelta;

  // 垂直换轨：手指当前 y 落在哪一行（行内留边距防误触）
  let ty = 0;
  let target = null;
  for (const r of ps.rowRects) {
    if (ps.lastY > r.top + ROW_SWITCH_INSET && ps.lastY < r.top + r.h - ROW_SWITCH_INSET) { target = r; break; }
  }
  const tgt = target || ps.rowRects.find((r) => r.id === ps.arrId) || null;
  if (tgt && tgt.id !== ps.arrId) {
    ty = tgt.top - ps.origRowTop;
    if (ps.targetRowId !== tgt.id) {
      ps.targetRowId = tgt.id;
      highlightDropRow(tgt.id);
      try { navigator.vibrate?.(8); } catch {}
    }
  } else if (ps.targetRowId) {
    ps.targetRowId = null;
    highlightDropRow(null);
  }
  ps.clipEl.style.transform = `translate(${tx}px, ${ty}px) scale(1.05)`;

  // 时间徽标：抓点相对块的偏移保持不变 → 实时换算落点时间
  const arrNow = ps.arr.getBoundingClientRect();
  const grabOff = ps.startX - ps.origRect.left;
  const newStart = pxToStartTime(ps.arr, (ps.lastX - arrNow.left) - grabOff, ps.durSec || 0);
  const badge = ensureDragBadge();
  badge.style.display = 'block';
  badge.style.left = `${ps.lastX}px`;
  badge.style.top = `${ps.lastY}px`;
  let label = fmtTime(newStart);
  if (ps.targetRowId) {
    const t = project.tracks.find((x) => x.id === ps.targetRowId);
    if (t) label += ` → ${t.name.slice(0, 8)}`;
  }
  badge.textContent = label;
}

// ---- 拖到视口左右边缘：时间轴自动滚动（越深越快）----
function startEdgeScrollLoop() {
  if (edgeScrollRAF != null) return;
  const step = () => {
    const ps = pressState;
    if (!ps || !ps.dragMode || !ps.viewport) { edgeScrollRAF = null; return; }
    const vr = ps.viewport.getBoundingClientRect();
    let v = 0;
    if (ps.lastX < vr.left + EDGE_SCROLL_ZONE) v = -(vr.left + EDGE_SCROLL_ZONE - ps.lastX) * 0.25;
    else if (ps.lastX > vr.right - EDGE_SCROLL_ZONE) v = (ps.lastX - (vr.right - EDGE_SCROLL_ZONE)) * 0.25;
    if (v !== 0) {
      ps.viewport.scrollLeft += Math.max(-18, Math.min(18, v));
      applyDragPreview();
    }
    edgeScrollRAF = requestAnimationFrame(step);
  };
  edgeScrollRAF = requestAnimationFrame(step);
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
  if (splitMode) return;                                  // 剪切模式：点按剪开，不进入拖动
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (pressState) return;                                 // 已有手势进行中（多指），忽略
  const cid = clipEl.dataset.clipId;
  if (transportState !== 'idle') { window.MFToast('先停止再编辑片段'); return; }
  const row = clipEl.closest('[data-track-id]');
  if (!row) return;
  const arr = row.children[1]; // arranger 区
  if (!arr) return;
  const clipRect = clipEl.getBoundingClientRect();
  const viewport = document.getElementById('arranger-viewport');
  pressState = {
    cid,
    clipEl,
    pointerType: e.pointerType,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    pointerId: e.pointerId,
    arr,
    arrId: row.dataset.trackId,
    origRect: clipRect,
    origRowTop: row.getBoundingClientRect().top,
    rowRects: [...tracksBody.querySelectorAll('[data-track-id]')].map((r) => {
      const rc = r.getBoundingClientRect();
      return { id: r.dataset.trackId, top: rc.top, h: rc.height };
    }),
    viewport,
    startScrollLeft: viewport ? viewport.scrollLeft : 0,
    liftTimer: null,
    lifted: false,
    dragMode: false,
    deltaX: 0,
    deltaY: 0,
    targetRowId: null,
    // 记录 clip 当前信息便于撤销/不重复查找
    startSec: 0,
    durSec: 0,
  };
  const found = findClip(cid);
  if (found) {
    pressState.startSec = found.clip.startTime;
    pressState.durSec = found.clip.duration;
  }
  clipEl.classList.add('press-flash');
  try { clipEl.setPointerCapture?.(e.pointerId); } catch {}
  // 触屏：长按「提起」后才能拖（先滑动 = 滚动，归浏览器）
  if (e.pointerType === 'touch') {
    pressState.liftTimer = setTimeout(liftClip, TOUCH_LIFT_MS);
  }
});
tracksBody.addEventListener('pointermove', (e) => {
  if (!pressState || e.pointerId !== pressState.pointerId) return;
  pressState.lastX = e.clientX;
  pressState.lastY = e.clientY;
  const dx = e.clientX - pressState.startX;
  const dy = e.clientY - pressState.startY;
  const dist = Math.hypot(dx, dy);
  // 触屏：还没「提起」就大幅移动 → 滚动意图，取消长按计时，让浏览器接管
  if (pressState.pointerType === 'touch' && !pressState.lifted && !pressState.dragMode) {
    if (dist > TOUCH_SLOP_PX && pressState.liftTimer) {
      clearTimeout(pressState.liftTimer);
      pressState.liftTimer = null;
    }
    return;
  }
  // 鼠标：超过阈值即可拖；触屏：必须已「提起」
  const canDrag = pressState.pointerType === 'mouse' ? dist > MOVE_TOL_PX : pressState.lifted;
  if (!pressState.dragMode && canDrag) {
    pressState.dragMode = true;
    pressState.clipEl.classList.remove('press-flash');
    pressState.clipEl.style.zIndex = '30';
    pressState.clipEl.style.cursor = 'grabbing';
    startEdgeScrollLoop();
  }
  if (pressState.dragMode) {
    // 预览：在原位基础上叠加 translate（水平分量要扣掉边缘自动滚动的位移）
    pressState.deltaX = dx;
    pressState.deltaY = dy;
    applyDragPreview();
  }
});
tracksBody.addEventListener('pointerup', (e) => {
  if (!pressState || e.pointerId !== pressState.pointerId) return;
  const ps = pressState;
  ps.lastX = e.clientX;
  ps.lastY = e.clientY;
  const dragMode = ps.dragMode;
  clearPress();
  if (dragMode || ps.lifted) {
    // 提起/拖动结束：随后的合成 click 不计入三击删除
    suppressClickUntil = Date.now() + 600;
  }
  if (!dragMode) return; // 未拖动（含「提起后没动就松手」）：放回原位即可
  // 结束拖动：把视觉位移写入 startTime（公式基于最终指针位置，天然免疫边缘自动滚动）
  const found = findClip(ps.cid);
  if (found) {
    const arrNow = ps.arr.getBoundingClientRect();
    const grabOff = ps.startX - ps.origRect.left; // 抓点在块内的偏移（滚动无关）
    const newRelX = (ps.lastX - arrNow.left) - grabOff;
    const newStart = pxToStartTime(ps.arr, newRelX, found.clip.duration);
    const crossTrack = ps.targetRowId && ps.targetRowId !== ps.arrId;
    const moved = crossTrack || Math.abs(newStart - found.clip.startTime) > 0.005;
    if (moved) {
      if (crossTrack) {
        const dstTr = project.tracks.find((t) => t.id === ps.targetRowId);
        const srcTr = found.tr;
        if (dstTr && srcTr && dstTr !== srcTr) {
          const i = srcTr.clips.indexOf(found.clip);
          if (i >= 0) srcTr.clips.splice(i, 1);
          found.clip.startTime = newStart;
          dstTr.clips.push(found.clip);
          window.MFToast(`已移到「${dstTr.name.slice(0, 10)}」`);
        }
      } else {
        found.clip.startTime = newStart;
      }
      renderTracks();
    }
  }
  e.preventDefault();
  e.stopPropagation();
});
tracksBody.addEventListener('pointercancel', clearPress);
tracksBody.addEventListener('lostpointercapture', (e) => {
  if (pressState && pressState.pointerId === e.pointerId) clearPress();
});
// 触屏关键：块「提起」后接管手势，阻止浏览器把拖动变成滚动
// （首个 touchmove preventDefault 即可取消平移；未提起时不拦截，滚动照常）
tracksBody.addEventListener('touchmove', (e) => {
  if (pressState && (pressState.lifted || pressState.dragMode)) e.preventDefault();
}, { passive: false });

// 双击剪切已移除（和三次点击删除冲突，浏览器三次连点会触发 dblclick）。
// splitClipAtOffset 函数保留备用，未来如需恢复剪切可重新挂 dblclick 监听器。

// 通道条按钮（M / S / R / X）+ 三次点击删除 clip + 剪切模式 的 click 处理
tracksBody.addEventListener('click', (e) => {
  // === 剪切模式优先处理：点击 clip 在点击位置剪开，保持剪切模式以便连续剪切 ===
  // 退出方式：再点一次剪切按钮 或 按 ESC
  if (splitMode) {
    const splitClipEl = e.target.closest('[data-clip-id]');
    if (!splitClipEl) return;  // 点击空白处：保持剪切模式，不退出
    if (transportState !== 'idle') { setSplitMode(false); window.MFToast('先停止再剪切'); return; }
    const splitCid = splitClipEl.dataset.clipId;
    const splitFound = findClip(splitCid);
    if (!splitFound) return;
    const { clip: splitClip } = splitFound;
    const splitRect = splitClipEl.getBoundingClientRect();
    const localX = Math.max(0, Math.min(splitRect.width, e.clientX - splitRect.left));
    const ratio = splitRect.width > 0 ? localX / splitRect.width : 0.5;
    const inSec = ratio * splitClip.duration;
    splitClipEl.classList.add('press-flash');
    setTimeout(() => { if (splitClipEl.isConnected) splitClipEl.classList.remove('press-flash'); }, 150);
    splitClipAtOffset(splitCid, inSec);
    window.MFToast('已剪开（继续点 clip 剪切，或按 ESC 退出）');
    return;
  }

  // === 三次点击删除 clip（替代原长按删除） ===
  // 三次连续点击同一个 clip（间隔 < TRIPLE_WINDOW_MS）即触发删除
  const clipEl = e.target.closest('[data-clip-id]');
  if (clipEl && Date.now() < suppressClickUntil) return; // 拖动/提起结束后的合成 click 不计入三击
  if (clipEl) {
    const cid = clipEl.dataset.clipId;
    const now = Date.now();
    const st = clipClickTimes.get(cid);
    if (!st || now - st.last > TRIPLE_WINDOW_MS) {
      clipClickTimes.set(cid, { count: 1, last: now });
      // 视觉提示：第一次点击时闪一下，提示用户继续点击可删除
      clipEl.classList.add('press-flash');
      setTimeout(() => { if (clipEl.isConnected) clipEl.classList.remove('press-flash'); }, 120);
    } else {
      st.count += 1;
      st.last = now;
      if (st.count >= 3) {
        clipClickTimes.delete(cid);
        if (transportState !== 'idle') { window.MFToast('先停止再删除片段'); return; }
        clipEl.classList.add('press-shake');
        deleteClip(cid);
        setTimeout(() => { if (clipEl.isConnected) clipEl.classList.remove('press-shake'); }, 300);
        window.MFToast('已删除该音频块');
        return;
      }
      // 第二次点击：再闪一下
      clipEl.classList.add('press-flash');
      setTimeout(() => { if (clipEl.isConnected) clipEl.classList.remove('press-flash'); }, 120);
    }
  }

  const row = e.target.closest('[data-track-id]');
  if (!row) return;
  const id = row.dataset.trackId;
  const tr = project.tracks.find((x) => x.id === id);
  if (!tr) return;
  const bt = e.target.closest('button[data-bt]')?.dataset.bt;
  if (!bt) return;
  if (bt === 'M') tr.muted = !tr.muted;
  if (bt === 'S') tr.solo = !tr.solo;
  // M/S 播放/录音中实时生效：拉/放轨道闸门 + 同步直连元素
  if (bt === 'M' || bt === 'S') syncTrackGains();
  if (bt === 'R') {
    if (tr.kind !== 'record') return;
    if (transportState !== 'idle') { window.MFToast('先停止再切换录音 Arm'); return; }
    tr.armed = !tr.armed;
    // 监听开着时跟着 Arm 变化重新接入（异步幂等，失败静默）
    if (monitorOn) startMonitor({ silent: true }).catch(() => {});
  }
  if (bt === 'F') {
    // 长按已触发旁通切换，跳过紧随其后的 click，避免误开混音台
    if (fxLongPressFired) { fxLongPressFired = false; return; }
    openMixer(tr);
    return; // 打开混音台不需要重绘轨道
  }
  if (bt === 'X') {
    if (transportState !== 'idle') { window.MFToast('先停止再删轨'); return; }
    tr.clips.forEach((c) => { try { c.audio.pause(); } catch {} if (c.url) try { URL.revokeObjectURL(c.url); } catch {} });
    if (tr._liveChain) { tr._liveChain.dispose(); tr._liveChain = null; }
    if (tr._trackGain) { try { tr._trackGain.disconnect(); } catch {} tr._trackGain = null; }
    project.tracks = project.tracks.filter((x) => x.id !== id);
    // 监听开着时：被删轨的链已断，按剩余轨重新接入
    if (monitorOn) startMonitor({ silent: true }).catch(() => {});
  }
  renderTracks();
});

// ================== 长按轨道 F 按钮：快速旁通/启用该轨效果器 ==================
// 点按 F = 打开混音台（原有行为）；长按 350ms = 旁通切换，方便 A/B 对比听干湿
let fxLongPressFired = false; // 长按触发后置 true，click 里消费掉以防误开混音台
let fxBypassTimer = null;
document.addEventListener('pointerdown', (e) => {
  const btn = e.target?.closest?.('button[data-bt="F"]');
  if (!btn) return;
  fxLongPressFired = false; // 清掉上一次可能残留的标记（长按后滑走未产生 click 的情况）
  const row = btn.closest('[data-track-id]');
  const tr = row && project.tracks.find((x) => x.id === row.dataset.trackId);
  if (!tr) return;
  fxBypassTimer = setTimeout(() => {
    fxBypassTimer = null;
    fxLongPressFired = true;
    toggleTrackBypass(tr);
  }, 350);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
  document.addEventListener(
    ev,
    () => {
      if (fxBypassTimer) {
        clearTimeout(fxBypassTimer);
        fxBypassTimer = null;
      }
    },
    true
  );
});
// 移动端长按避免触发系统上下文菜单
document.addEventListener('contextmenu', (e) => {
  if (e.target?.closest?.('button[data-bt="F"]')) e.preventDefault();
});

// 单击空白取消 playhead seek 之前的交互仍保留（下面那个 document.click 监听已不再依赖 selectedClip）

// ================== Mixer：每轨 EQ / 压缩 / 混响 ==================
const mixerModal = document.getElementById('mixer-modal');
let mixerTrack = null; // 当前正在调参的轨道
const MIXER_FIELDS = [
  { key: 'eqSub', min: -12, max: 12, step: 0.5, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'eqLow', min: -12, max: 12, step: 0.5, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'eqMid', min: -12, max: 12, step: 0.5, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'eqHigh', min: -12, max: 12, step: 0.5, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'eqAir', min: -12, max: 12, step: 0.5, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'autotune', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)}%` },
  { key: 'deess', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)}%` },
  { key: 'sat', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)}%` },
  { key: 'comp', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)}%` },
  { key: 'reverb', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)}%` },
  { key: 'pan', min: -100, max: 100, step: 1, fmt: (v) => (Math.round(v) === 0 ? '居中' : v < 0 ? `左 ${Math.round(-v)}` : `右 ${Math.round(v)}`) },
];
// 快捷预设：一键到位常见场景/音色（不含声像——摆位属于编排，应用预设时保留当前声像）
const MIXER_PRESETS = [
  // 基础场景
  { label: '人声', fx: { eqSub: -3, eqLow: -1, eqMid: 1.5, eqHigh: 2, eqAir: 2, deess: 40, sat: 12, comp: 55, reverb: 18 } },
  { label: '伴奏', fx: { eqSub: 1, eqLow: 1, eqMid: -1, eqHigh: 1, eqAir: 0.5, deess: 0, sat: 18, comp: 30, reverb: 8 } },
  { label: '空间感', fx: { eqSub: 0, eqLow: 0, eqMid: 0, eqHigh: 1.5, eqAir: 2, deess: 25, sat: 0, comp: 0, reverb: 55 } },
  // 音色向
  { label: '磁性', fx: { eqSub: -4, eqLow: 3, eqMid: 1, eqHigh: 1.5, eqAir: 0, deess: 30, sat: 45, comp: 45, reverb: 10 } },
  { label: '温暖', fx: { eqSub: 1, eqLow: 2.5, eqMid: -0.5, eqHigh: -1.5, eqAir: -1, deess: 20, sat: 35, comp: 25, reverb: 15 } },
  { label: '明亮', fx: { eqSub: -2, eqLow: -1, eqMid: 0, eqHigh: 3, eqAir: 3.5, deess: 45, sat: 10, comp: 25, reverb: 8 } },
];
function openMixer(tr) {
  mixerTrack = tr;
  if (!tr.fx) tr.fx = defaultFx();
  const nameEl = document.getElementById('mixer-track-name');
  if (nameEl) nameEl.textContent = tr.name || '轨道';
  syncMixerUI();
  syncBypassUI();
  mixerModal?.classList.remove('hidden');
  mixerModal?.classList.add('flex');
}
function closeMixer() {
  mixerModal?.classList.add('hidden');
  mixerModal?.classList.remove('flex');
  mixerTrack = null;
  renderTracks(); // 刷新 F 按钮高亮（有非默认 fx 时点亮）
}
function syncMixerUI() {
  if (!mixerTrack) return;
  const fx = trackFx(mixerTrack);
  MIXER_FIELDS.forEach((f) => {
    const el = document.getElementById(`mix-${f.key}`);
    const val = document.getElementById(`mix-${f.key}-val`);
    if (el) el.value = fx[f.key];
    if (val) val.textContent = f.fmt(fx[f.key]);
  });
  syncAtScaleUI(fx.atScale);
  syncAtRootUI(fx.atRoot);
  syncAtHint(fx.atScale, fx.atRoot);
}
// 自动音准的音阶切换按钮（0 半音阶 / 1 大调 / 2 小调）与根音（0=C … 11=B）
const AT_SCALES = ['半音阶', '大调', '小调'];
const AT_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function syncAtScaleUI(cur) {
  AT_SCALES.forEach((_, i) => {
    const el = document.getElementById(`mix-atScale-${i}`);
    if (!el) return;
    const active = i === cur;
    el.className = `at-scale-btn px-2.5 py-1 rounded-full text-xs transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
    }`;
    el.setAttribute('aria-pressed', String(active));
  });
}
function syncAtRootUI(cur) {
  AT_ROOTS.forEach((_, i) => {
    const el = document.getElementById(`mix-atRoot-${i}`);
    if (!el) return;
    const active = i === cur;
    el.className = `at-root-btn px-2 py-1 rounded-full text-xs transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
    }`;
    el.setAttribute('aria-pressed', String(active));
  });
}
// 底部提示随音阶 + 根音动态变化：直白显示当前调性（如「F 大调」）
function syncAtHint(scale, root) {
  const el = document.getElementById('mix-at-hint');
  if (!el) return;
  const keyName = AT_ROOTS[root] || AT_ROOTS[0];
  const text =
    scale <= 0
      ? '半音阶包含全部十二个半音，根音不影响；调到 100% 就是电音那种硬性校准'
      : `把唱偏的音自动吸附到 ${keyName} ${AT_SCALES[scale]}；调到 100% 就是电音那种硬性校准`;
  el.textContent = text;
}
// 旁通开关 UI：开关亮 = 效果启用；点灭 = 旁通（三个效果区变暗提示当前不生效）
function syncBypassUI() {
  if (!mixerTrack) return;
  const on = !mixerTrack.bypass;
  const sw = document.getElementById('mix-bypass');
  if (sw) {
    sw.dataset.on = String(on);
    sw.setAttribute('aria-checked', String(on));
  }
  const stateEl = document.getElementById('mix-bypass-state');
  if (stateEl) stateEl.textContent = on ? '' : '（旁通中）';
  // 声像区不变暗：摆位不属于「效果」，旁通时依然生效
  ['mix-sec-eq', 'mix-sec-at', 'mix-sec-deess', 'mix-sec-sat', 'mix-sec-comp', 'mix-sec-reverb'].forEach((id) => {
    document.getElementById(id)?.classList.toggle('opacity-50', !on);
  });
}
// 统一的旁通切换入口（长按 F / 混音台开关都走这里）
function toggleTrackBypass(tr, opts = {}) {
  tr.bypass = !tr.bypass;
  applyLiveFx(tr); // 播放中实时生效
  if (opts.fromMixer) syncBypassUI();
  else renderTracks(); // 刷新轨道 F 按钮斜杠状态
  window.MFToast(tr.bypass ? '已旁通效果器' : '已启用效果器');
}
// 混音台里的旁通总开关
document.getElementById('mix-bypass')?.addEventListener('click', () => {
  if (!mixerTrack) return;
  toggleTrackBypass(mixerTrack, { fromMixer: true });
});
MIXER_FIELDS.forEach((f) => {
  document.getElementById(`mix-${f.key}`)?.addEventListener('input', (e) => {
    if (!mixerTrack) return;
    if (!mixerTrack.fx) mixerTrack.fx = defaultFx();
    const v = Number(e.target.value);
    mixerTrack.fx[f.key] = v;
    const val = document.getElementById(`mix-${f.key}-val`);
    if (val) val.textContent = f.fmt(v);
    applyLiveFx(mixerTrack); // 播放中实时生效
  });
});
// 预设 / 重置
MIXER_PRESETS.forEach((p, i) => {
  document.getElementById(`mix-preset-${i}`)?.addEventListener('click', () => {
    if (!mixerTrack) return;
    // 声像是摆位、自动音准是音高行为，都不属于「音色」——应用预设时保留
    const cur = trackFx(mixerTrack);
    mixerTrack.fx = { ...defaultFx(), ...p.fx, pan: cur.pan, autotune: cur.autotune, atScale: cur.atScale, atRoot: cur.atRoot };
    syncMixerUI();
    applyLiveFx(mixerTrack);
    window.MFToast(`已应用「${p.label}」预设`);
  });
});
// 音阶 / 根音切换（实时生效）
AT_SCALES.forEach((_, i) => {
  document.getElementById(`mix-atScale-${i}`)?.addEventListener('click', () => {
    if (!mixerTrack) return;
    if (!mixerTrack.fx) mixerTrack.fx = defaultFx();
    mixerTrack.fx.atScale = i;
    syncAtScaleUI(i);
    syncAtHint(i, mixerTrack.fx.atRoot);
    applyLiveFx(mixerTrack);
  });
});
AT_ROOTS.forEach((_, i) => {
  document.getElementById(`mix-atRoot-${i}`)?.addEventListener('click', () => {
    if (!mixerTrack) return;
    if (!mixerTrack.fx) mixerTrack.fx = defaultFx();
    mixerTrack.fx.atRoot = i;
    syncAtRootUI(i);
    syncAtHint(mixerTrack.fx.atScale, i);
    applyLiveFx(mixerTrack);
  });
});
document.getElementById('mix-preset-reset')?.addEventListener('click', () => {
  if (!mixerTrack) return;
  mixerTrack.fx = defaultFx();
  syncMixerUI();
  applyLiveFx(mixerTrack);
  window.MFToast('已重置');
});
document.getElementById('mixer-done')?.addEventListener('click', closeMixer);
mixerModal?.querySelectorAll('[data-close-mixer]').forEach((el) => {
  el.addEventListener('click', closeMixer);
});
// ESC 关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mixerModal && !mixerModal.classList.contains('hidden')) closeMixer();
});


// ================== Transport play/stop ==================
// Should this track's clips play right now? (consider mute + solo rules)
function isTrackAudible(tr) {
  if (tr.muted) return false;
  const anySolo = project.tracks.some((t) => t.solo);
  if (anySolo && !tr.solo) return false;
  return true;
}

let playbackGen = 0; // 停止代数：异步建链期间若用户又停了，等待恢复后不再开播
function stopAllPlaybacks() {
  playbackGen++;
  activePlaybacks.forEach((p) => {
    if (p.src) { // AudioBufferSource：停掉并断线
      try { p.src.stop(); } catch {}
      try { p.src.disconnect(); } catch {}
    }
    if (p.audio) { try { p.audio.pause(); } catch {} } // 元素降级路径
  });
  activePlaybacks = [];
}

async function startPlayback(startSec) {
  stopAllPlaybacks();
  const gen = playbackGen;
  // start every clip whose [startTime, startTime+duration] overlaps with startSec..∞
  const nowSec = startSec;
  // 全部轨都建链建元素（静音/被独奏压掉的轨哑着跑），
  // 播放中切 M/S 才能实时开/关声音——闸门由 syncTrackGains 控制
  const tracks = project.tracks;
  // 先建好全部 FX 链（含自动音准 worklet 装载），再统一开播，避免各轨延迟不一致
  await Promise.all(tracks.map((tr) => getLiveChain(tr).catch(() => null)));
  if (gen !== playbackGen) return; // 等待期间已被停止
  // 收集本批要播的 clip，并行预解码（波形绘制时多半已缓存，这里通常瞬间完成）
  const jobs = [];
  for (const tr of tracks) {
    for (const cl of tr.clips) {
      if (cl.startTime + cl.duration <= nowSec) continue;
      if (!cl._buffer) jobs.push(getClipBuffer(cl).catch(() => { cl._buffer = null; }));
    }
  }
  if (jobs.length) await Promise.all(jobs);
  if (gen !== playbackGen) return; // 解码期间已被停止
  for (const tr of tracks) {
    const audible = isTrackAudible(tr);
    tr.clips.forEach((cl) => {
      const end = cl.startTime + cl.duration;
      if (end <= nowSec) return;
      const offset = Math.max(0, nowSec - cl.startTime);
      if (cl._buffer && (tr._trackGain || masterGain)) {
        // 首选：AudioBufferSourceNode 精准开播（采样级 offset，启动零延迟）。
        // 不用 <audio>+MediaElementSource 的原因：
        // 1) iOS Safari 的 MediaElementSource 会把立体声下混成单声道（老 bug），
        //    伴奏声场塌、side 信号丢失，听感明显"变闷/不对"；
        // 2) 元素 currentTime seek 不精准（webm 尤甚），录歌对位会漂。
        // 与导出（mixProjectToBuffer）同一条 AudioBuffer 路径——所听即所得。
        const src = _ac.createBufferSource();
        src.buffer = cl._buffer;
        src.connect(tr._trackGain || masterGain);
        src.start(0, offset, Math.max(0, cl._buffer.duration - offset));
        const pb = { src, clip: cl, track: tr, startedAt: performance.now(), playheadAtStart: nowSec };
        activePlaybacks.push(pb);
        src.addEventListener('ended', () => {
          activePlaybacks = activePlaybacks.filter((p) => p !== pb);
        });
      } else {
        // 降级：该格式 decodeAudioData 解不了（极少数），退回 <audio> 元素直连（旧版行为）
        const a = new Audio(cl.url);
        a.preload = 'auto';
        try { a.currentTime = offset; } catch {}
        a.muted = !audible; // 静音轨元素照常跑（哑的），播放中取消静音立即出声
        const chain = tr._liveChain || null;
        if (chain && tr._trackGain) {
          try { _ac.createMediaElementSource(a).connect(tr._trackGain); } catch {}
        }
        const pb = { audio: a, clip: cl, track: tr, startedAt: performance.now(), playheadAtStart: nowSec };
        activePlaybacks.push(pb);
        a.play().catch(() => {});
        a.addEventListener('ended', () => {
          activePlaybacks = activePlaybacks.filter((p) => p !== pb);
        });
      }
    });
  }
  syncTrackGains(); // 闸门状态对齐（防建链期间状态变化）
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
  syncTransportTimeUI();
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
  syncTransportTimeUI();
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
  syncTransportTimeUI();
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
      fx: defaultFx(),
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
  // 预解码伴奏（与麦克风权限申请并行跑）：bufferSource 开播是同步零延迟的，
  // 前提是 buffer 已就绪。预热保证按下录音键那一刻伴奏准时起播（对位不漂）。
  const warmup = Promise.all(
    project.tracks.flatMap((tr) => tr.clips)
      .filter((cl) => cl.blob && !cl._buffer)
      .map((cl) => getClipBuffer(cl).catch(() => { cl._buffer = null; }))
  );
  try {
    await acquireMicStream();
  } catch (err) {
    window.MFToast(err?.message || '无法访问麦克风');
    // 回滚 Arm UI
    armedTracks.forEach((t) => (t.armed = false));
    renderTracks();
    return;
  }
  await warmup; // 等预热收尾（通常已与权限申请重叠完成，几乎不额外等待）
  // UI: 重新渲染把 R 亮的状态展示出来（用户能看见哪些轨在录）
  renderTracks();
  // 监听开启时：按当前 Arm 的轨重新接入（Arm 可能在开监听后换过）。
  // 放在 playStartTime 之前完成，避免给录音起始对齐引入额外延迟。
  if (monitorOn) await startMonitor({ silent: true });
  transportState = 'rec';
  syncTransportTimeUI();
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
    if (!monitorOn) releaseMicStream(); // 监听还开着时保留麦克风，关监听时再释放
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
    fx: defaultFx(),
    clips: [],
  });
  renderTracks();
});

// ================== Split clip (剪刀按钮模式) ==================
// 点击"剪切"按钮启用剪切模式：arranger 光标变剪刀，按钮高亮；
// 下次点击 clip 时按点击位置剪开，然后自动退出剪切模式；
// 点击空白处或 ESC 也退出剪切模式。
let splitMode = false;
const splitBtn = document.getElementById('split-clip-btn');
const arrangerEl = document.getElementById('arranger');

function setSplitMode(on) {
  splitMode = on;
  if (splitBtn) {
    splitBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    splitBtn.classList.toggle('bg-primary', on);
    splitBtn.classList.toggle('text-primary-foreground', on);
    splitBtn.classList.toggle('text-muted-foreground', !on);
  }
  if (arrangerEl) {
    arrangerEl.classList.toggle('split-cursor', on);
  }
  if (on) {
    window.MFToast('剪切模式：点击 clip 在点击位置剪开');
  }
}

splitBtn?.addEventListener('click', () => {
  if (transportState !== 'idle') { window.MFToast('先停止再剪切'); return; }
  setSplitMode(!splitMode);
});

// ESC 退出剪切模式
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && splitMode) setSplitMode(false);
});

// ================== Backing import（支持多文件 / 多伴奏轨，每条伴奏 = 一条独立轨）==================
// 全部常见音频扩展名：audio/* 覆盖 MIME 检测正常的情况；
// 显式扩展名兜底移动端 MIME 误报/缺失（如 .flac 被报成 application/octet-stream）
const AUDIO_EXT_SET = new Set([
  'mp3', 'wav', 'wave', 'ogg', 'oga', 'flac', 'm4a', 'm4b', 'm4p', 'm4r',
  'aac', 'wma', 'aiff', 'aif', 'aifc', 'alac', 'opus', 'caf', 'amr',
  '3gp', '3g2', 'mp2', 'mpga', 'weba', 'webm', 'dsf', 'ape',
]);
function isAudioFile(f) {
  if (typeof f === 'string') return true; // 拖拽等场景由浏览器保证
  if (f.type && f.type.startsWith('audio/')) return true;
  // .ogg 在部分系统上被报成 application/ogg 或 video/ogg，仍视为音频
  if (f.type === 'application/ogg' || f.type === 'video/ogg') return true;
  const ext = (f.name || '').split('.').pop().toLowerCase();
  return AUDIO_EXT_SET.has(ext);
}

// ---- 视频文件（MP4/MOV/MKV 等）→ 提取音轨编码为 MP3 导入 ----
// 原理：decodeAudioData 只解码视频容器的音频轨道（Chrome/Safari 支持
// MP4/AAC、WebM/Opus 等），再用 lamejs 在浏览器内编码 MP3，全程离线。
const VIDEO_EXT_SET = new Set(['mp4', 'm4v', 'mov', 'avi', 'mkv', 'mpg', 'mpeg', 'flv', 'ts', 'wmv', 'vob']);
function isVideoFile(f) {
  if (typeof f === 'string') return false;
  if (f.type && f.type.startsWith('video/')) {
    // .webm/.ogg 的 audio-only 变体也带 video/ MIME，但能被 audio 元素直接播放，走音频路径
    const ext = (f.name || '').split('.').pop().toLowerCase();
    if (AUDIO_EXT_SET.has(ext)) return false;
    return true;
  }
  const ext = (f.name || '').split('.').pop().toLowerCase();
  return VIDEO_EXT_SET.has(ext);
}
function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
// 视频文件 → MP3 File（192kbps，保留声道数，采样率跟随源）
async function videoFileToMp3File(f, onProgress) {
  const buf = await decodeBlob(f); // 提取音频轨道并解码为 PCM
  const ch = Math.min(buf.numberOfChannels, 2);
  const enc = new Mp3Encoder(ch, buf.sampleRate, 192);
  const left = floatToInt16(buf.getChannelData(0));
  const right = ch === 2 ? floatToInt16(buf.getChannelData(1)) : null;
  const chunks = [];
  const BLOCK = 1152;
  const total = left.length;
  let lastReported = -1;
  for (let i = 0; i < total; i += BLOCK) {
    const b = right !== null
      ? enc.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK))
      : enc.encodeBuffer(left.subarray(i, i + BLOCK));
    if (b.length) chunks.push(new Uint8Array(b));
    const pct = Math.floor((i / total) * 100);
    if (pct % 10 === 0 && pct !== lastReported) {
      lastReported = pct;
      onProgress?.(pct);
      // 让出主线程，长视频转换时不卡 UI
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const fin = enc.flush();
  if (fin.length) chunks.push(new Uint8Array(fin));
  const base = (f.name || 'audio').replace(/\.[^.]+$/, '');
  return new File([new Blob(chunks, { type: 'audio/mpeg' })], `${base}.mp3`, { type: 'audio/mpeg' });
}

document.getElementById('import-backing-btn')?.addEventListener('click', () => document.getElementById('backing-file')?.click());
document.getElementById('backing-file')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const startAt = playBaseSec || 0; // 从当前 playhead 位置插入（默认 0）
  let imported = 0;
  let skipped = 0;
  let converted = 0;
  let failed = 0;

  // 创建一条 backing 轨并挂载加载/失败处理，返回该轨（格式不支持时自行移除）
  const insertBackingTrack = (f, idx) => {
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
      fx: defaultFx(),
      clips: [clip],
    };
    // 伴奏追加到所有 backing 轨之后、record 轨之前；纯记录轨工程则放到最上面
    const firstRecIdx = project.tracks.findIndex((t) => t.kind === 'record');
    if (firstRecIdx === -1) project.tracks.push(newTrack);
    else project.tracks.splice(firstRecIdx + idx, 0, newTrack);

    // 格式不受浏览器支持时（如桌面 Chrome 的 WMA/AIFF）：移除该轨并明确提示，
    // 不再留下一个时长为 0 的"空块"静默失败
    let loadFailed = false;
    const failLoad = () => {
      if (loadFailed) return;
      loadFailed = true;
      clearTimeout(metaTimer);
      project.tracks = project.tracks.filter((t) => t !== newTrack);
      try { URL.revokeObjectURL(url); } catch {}
      renderTracks();
      window.MFToast(`无法播放「${f.name}」：浏览器不支持该格式`);
    };
    audio.addEventListener('error', failLoad);
    // 兜底超时：个别设备上既不触发 error 也不触发 loadedmetadata
    const metaTimer = setTimeout(failLoad, 12000);
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(metaTimer);
      // 流式/未知时长（Infinity）回退到 30s，与旧版行为一致
      clip.duration = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : 30;
      renderTracks();
    });
    return newTrack;
  };

  for (let idx = 0; idx < files.length; idx++) {
    const f = files[idx];
    if (isVideoFile(f)) {
      try {
        window.MFToast(`正在从「${f.name}」提取音轨转 MP3…`);
        const mp3 = await videoFileToMp3File(f, (pct) => {
          if (pct > 0 && pct < 100) window.MFToast(`MP3 编码中 ${pct}%`);
        });
        insertBackingTrack(mp3, idx);
        imported++;
        converted++;
      } catch (err) {
        failed++;
        window.MFToast(`「${f.name}」无法提取音轨（视频编码不受浏览器支持）`);
      }
      continue;
    }
    if (!isAudioFile(f)) {
      skipped++;
      window.MFToast(`「${f.name}」不是音频文件，已跳过`);
      continue;
    }
    insertBackingTrack(f, idx);
    imported++;
  }
  if (imported > 0) {
    const parts = [`已导入 ${imported} 条伴奏`];
    if (converted > 0) parts.push(`${converted} 个视频已转 MP3`);
    if (failed > 0) parts.push(`${failed} 个转换失败`);
    if (skipped > 0) parts.push(`跳过 ${skipped} 个非音频文件`);
    window.MFToast(imported === 1 && converted === 0 && skipped === 0 && failed === 0
      ? '伴奏已导入'
      : parts.join('，'));
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
        fx: trackFx(tr), // 混音参数（EQ/压缩/混响）随工程保存
        bypass: !!tr.bypass, // 旁通状态随工程保存
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

const projectPlayers = new Map(); // id -> { node, buffer, playing }
const renderingProjects = new Set(); // 正在离线渲染试听的工程 id（防并发渲染）
function releaseProjectPlayer(id) {
  const p = projectPlayers.get(id);
  if (!p) return;
  if (p.node) {
    try { p.node.stop(); } catch {}
    try { p.node.disconnect(); } catch {}
  }
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
      // 先释放当前 project 的资源（含 FX 链与轨道闸门，防节点泄漏）
      project.tracks.forEach((tr) => tr.clips.forEach((c) => {
        try { c.audio.pause(); } catch {}
        if (c.url) try { URL.revokeObjectURL(c.url); } catch {}
      }));
      project.tracks.forEach((tr) => {
        if (tr._liveChain) { try { tr._liveChain.dispose(); } catch {} tr._liveChain = null; }
        if (tr._trackGain) { try { tr._trackGain.disconnect(); } catch {} tr._trackGain = null; }
      });
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
          fx: trackFx(tr), // 恢复混音参数（老工程缺省时为全默认）
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
        try { existing.node.stop(); } catch {}
        existing.playing = false;
      } else {
        // 暂停后重播：bufferSource 停了不能复用，用渲染缓存重建一个从头播
        const node = _ac.createBufferSource();
        node.buffer = existing.buffer;
        node.connect(masterGain || _ac.destination);
        node.addEventListener('ended', () => { releaseProjectPlayer(id); renderList(); });
        node.start();
        existing.node = node;
        existing.playing = true;
      }
      renderList();
      return;
    }
    // 工程试听：先离线渲染成单个 AudioBuffer（与导出同一条链、同一套 FX），
    // 再用一个 bufferSource 播放。
    // 旧实现 <audio>+MediaElementSource 逐 clip 调度的问题：
    // 1) iOS 的 MediaElementSource 把立体声下混成单声道，伴奏声场塌；
    // 2) setTimeout 调度漂移，各轨起播不齐。
    const tracks = item.project?.tracks || [];
    if (renderingProjects.has(id)) return; // 渲染中重复点击：忽略，防止并发渲染两遍
    renderingProjects.add(id);
    try {
      if (!ensureLiveGraph()) throw new Error('无法创建音频图');
      window.MFToast('工程渲染中…');
      const rendered = await mixProjectToBuffer(tracks);
      if (!rendered) { window.MFToast('该工程没有可播放的内容'); return; }
      const node = _ac.createBufferSource();
      node.buffer = rendered;
      node.connect(masterGain || _ac.destination);
      node.addEventListener('ended', () => { releaseProjectPlayer(id); renderList(); });
      node.start();
      projectPlayers.set(id, { node, buffer: rendered, playing: true });
      renderList();
    } catch (err) {
      console.error(err);
      window.MFToast('工程回放失败');
    } finally {
      renderingProjects.delete(id);
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

// ================== Search (global modal) ==================
const searchModal = document.getElementById('search-modal');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear');
const searchResults = document.getElementById('search-results');
const searchEmpty = document.getElementById('search-empty');

let searchDebounce = null;

function openSearchModal() {
  searchModal.classList.remove('hidden');
  searchModal.classList.add('flex'); // 容器才有 items-center justify-center 布局，弹窗居中显示
  setTimeout(() => searchInput.focus(), 80);
  refreshIcons();
}
function closeSearchModal() {
  searchModal.classList.add('hidden');
  searchModal.classList.remove('flex');
  searchInput.value = '';
  renderSearchResults('', []);
}

// Highlight matched substrings with <mark>
function hl(text, query) {
  if (!query) return escapeHtml(text);
  const safe = escapeHtml(text);
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(re, '<mark class="bg-primary/30 text-primary rounded px-0.5">$1</mark>');
}

function renderSearchResults(query, hits) {
  if (!query) {
    searchResults.innerHTML = `<div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <i data-lucide="search" class="w-5 h-5 text-muted-foreground"></i>
      </div>
      <p class="text-sm text-muted-foreground">输入关键词开始搜索</p>
      <p class="text-xs text-muted-foreground mt-1">匹配灵感标题和歌词内容</p>
    </div>`;
    refreshIcons();
    return;
  }
  if (hits.length === 0) {
    searchResults.innerHTML = `<div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <i data-lucide="search-x" class="w-5 h-5 text-muted-foreground"></i>
      </div>
      <p class="text-sm text-muted-foreground">没有找到 "${query}"</p>
    </div>`;
    refreshIcons();
    return;
  }

  const capHits = hits.filter((h) => h.source === 'capture');
  const lyrHits = hits.filter((h) => h.source === 'lyric');

  let html = '';
  if (capHits.length) {
    html += `<div class="mb-4">
      <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">灵感 (${capHits.length})</h4>
      <div class="space-y-2">${capHits.map(h => `
        <button type="button" class="w-full text-left bg-card border border-border rounded-xl p-3 flex items-center gap-3 hover:border-primary/50 hover:bg-muted/50 transition-colors" data-search-hit data-source="capture" data-id="${h.id}" data-kind="${h.kind}">
          <div class="w-10 h-10 rounded-full ${h.kind === 'project' ? 'bg-accent/20' : 'bg-primary/10'} flex items-center justify-center shrink-0">
            <i data-lucide="${h.kind === 'project' ? 'sliders' : 'mic'}" class="w-5 h-5"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${hl(h.title || '(未命名)', query)}</div>
            <div class="text-xs text-muted-foreground truncate">${hl(h.body || '', query) || '无描述'} · ${h.stamp}</div>
          </div>
        </button>`).join('')}</div>
    </div>`;
  }
  if (lyrHits.length) {
    html += `<div>
      <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">歌词 (${lyrHits.length})</h4>
      <div class="space-y-2">${lyrHits.map(h => `
        <button type="button" class="w-full text-left bg-card border border-border rounded-xl p-3 flex items-start gap-3 hover:border-primary/50 hover:bg-muted/50 transition-colors" data-search-hit data-source="lyric" data-id="${h.id}">
          <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
            <i data-lucide="file-text" class="w-5 h-5"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${hl(h.title || '(无标题)', query)}</div>
            <div class="text-xs text-muted-foreground line-clamp-2">${hl(h.body || '', query)}</div>
          </div>
        </button>`).join('')}</div>
    </div>`;
  }
  searchResults.innerHTML = html;
  refreshIcons();
}

function doSearchLive() {
  const q = searchInput.value.trim();
  searchClearBtn.classList.toggle('hidden', !q);

  if (!q) {
    renderSearchResults('', []);
    return;
  }
  const query = q.toLowerCase();

  const hits = [];
  // captures (audio + project, skip text-only kinds)
  captures.all().forEach((it) => {
    if (it.kind === 'text') return;
    const t = (it.title || '').toLowerCase();
    const b = (it.body || '').toLowerCase();
    if (t.includes(query) || b.includes(query)) {
      hits.push({ source: 'capture', id: it.id, kind: it.kind || '', title: it.title, body: it.body, stamp: it.stamp || '' });
    }
  });
  // lyrics
  lyrics.all().forEach((it) => {
    const t = (it.title || '').toLowerCase();
    const b = (it.body || '').toLowerCase();
    if (t.includes(query) || b.includes(query)) {
      hits.push({ source: 'lyric', id: it.id, title: it.title, body: it.body, date: it.date || '' });
    }
  });

  renderSearchResults(q, hits);
}

// --- search event wiring ---
document.addEventListener('click', (e) => {
  if (e.target.closest('#search-btn')) openSearchModal();
  if (e.target.closest('[data-close-search]')) closeSearchModal();
  if (e.target.closest('#search-clear')) { searchInput.value = ''; doSearchLive(); searchInput.focus(); }
  // click a result hit
  const hit = e.target.closest('[data-search-hit]');
  if (hit) {
    const source = hit.dataset.source;
    const id = hit.dataset.id;
    closeSearchModal();
    if (source === 'capture') {
      window.MFNavigate('capture');
      window.MFToast('已跳转到灵感页');
      // highlight the matching card briefly
      setTimeout(() => {
        const card = document.querySelector(`#captures-list article[data-id="${id}"]`);
        if (card) { card.classList.add('ring-2', 'ring-primary'); setTimeout(() => card.classList.remove('ring-2', 'ring-primary'), 1500); }
      }, 80);
    } else if (source === 'lyric') {
      window.MFNavigate('lyrics');
      window.MFToast('已跳转到歌词页');
      // highlight the matching card briefly
      setTimeout(() => {
        const card = document.querySelector(`#lyrics-list article[data-id="${id}"]`);
        if (card) { card.classList.add('ring-2', 'ring-primary'); setTimeout(() => card.classList.remove('ring-2', 'ring-primary'), 1500); }
      }, 80);
    }
  }
});

searchInput?.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(doSearchLive, 120);
});
searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSearchModal();
  if (e.key === 'Enter') { /* live search already shows results */ }
});
document.addEventListener('keydown', (e) => {
  if (searchModal && !searchModal.classList.contains('hidden') && e.key === 'Escape') closeSearchModal();
  // Ctrl/Cmd + K to open search anywhere
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (searchModal && searchModal.classList.contains('hidden')) openSearchModal();
    else closeSearchModal();
  }
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
    fx: defaultFx(),
    clips: [],
  });
}
renderTracks();
renderList();
// mountNav is called by app.js
setMode(REC_MODE);

// 数据从 IndexedDB 加载完成后重新渲染（异步初始化时缓存可能还空）
window.addEventListener('storeready', () => {
  renderList();
  renderTracks();
});

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
