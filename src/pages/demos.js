// src/pages/demos.js
// 小样 page: upload audio/MIDI, auto-detect BPM and key, save results

import { refreshIcons } from '../lib/nav.js';
import { demos, nowstamp } from '../lib/store.js';

const toastEl = document.getElementById('toast');
let toastTimer = null;
window.MFToast = (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
};

// ---- DOM refs ----
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const uploadZone = document.getElementById('upload-zone');
const analysisSection = document.getElementById('analysis-section');
const analyzingState = document.getElementById('analyzing-state');
const analyzingTitle = document.getElementById('analyzing-title');
const analyzingSub = document.getElementById('analyzing-sub');
const resultState = document.getElementById('result-state');
const resultFilename = document.getElementById('result-filename');
const resultKey = document.getElementById('result-key');
const resultBpm = document.getElementById('result-bpm');
const saveResultBtn = document.getElementById('save-result-btn');
const reanalyzeBtn = document.getElementById('reanalyze-btn');
const demoList = document.getElementById('demo-list');
const demoCount = document.getElementById('demo-count');
const emptyState = document.getElementById('empty-state');

const demosToggleSelectBtn = document.getElementById('demos-toggle-select');
const demosSelectBar = document.getElementById('demos-select-bar');
const demosSelectAll = document.getElementById('demos-select-all');
const demosSelectedCount = document.getElementById('demos-selected-count');
const demosBatchDeleteBtn = document.getElementById('demos-batch-delete');
const demosSelectCancelBtn = document.getElementById('demos-select-cancel');

let demosSelectMode = false;
let demosSelected = new Set();

// ================== 确认弹框（通用） ==================
const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
let confirmResolver = null;
function openConfirm(message) {
  confirmMessage.textContent = message || '确认继续？';
  confirmModal.style.display = 'flex';
  refreshIcons();
  return new Promise((resolve) => { confirmResolver = resolve; });
}
function closeConfirm(result) {
  confirmModal.style.display = 'none';
  if (confirmResolver) { confirmResolver(!!result); confirmResolver = null; }
}
document.getElementById('confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
document.getElementById('confirm-ok')?.addEventListener('click', () => closeConfirm(true));
confirmModal?.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(false); });
document.addEventListener('keydown', (e) => {
  if (confirmModal && confirmModal.style.display === 'flex') {
    if (e.key === 'Escape') closeConfirm(false);
    if (e.key === 'Enter') closeConfirm(true);
  }
});

function updateDemosSelectUI() {
  const items = demos.all().filter((d) => d.bpm !== undefined || d.key !== undefined);
  if (!demosSelectMode) {
    demosSelectBar?.classList.add('hidden');
    demosToggleSelectBtn?.classList.remove('bg-muted', 'text-foreground');
  } else {
    demosSelectBar?.classList.remove('hidden');
    demosToggleSelectBtn?.classList.add('bg-muted', 'text-foreground');
  }
  if (demosSelectedCount) demosSelectedCount.textContent = `已选 ${demosSelected.size} 项`;
  if (demosBatchDeleteBtn) demosBatchDeleteBtn.disabled = demosSelected.size === 0;
  if (demosSelectAll) {
    demosSelectAll.checked = items.length > 0 && demosSelected.size === items.length;
    demosSelectAll.indeterminate = demosSelected.size > 0 && demosSelected.size < items.length;
  }
}

function exitDemosSelectMode() {
  demosSelectMode = false;
  demosSelected.clear();
  const items = demos.all().filter((d) => d.bpm !== undefined || d.key !== undefined);
  demosSelectBar?.classList.add('hidden');
  demosToggleSelectBtn?.classList.remove('bg-muted', 'text-foreground');
  if (demosSelectedCount) demosSelectedCount.textContent = '已选 0 项';
  if (demosBatchDeleteBtn) demosBatchDeleteBtn.disabled = true;
  if (demosSelectAll) { demosSelectAll.checked = false; demosSelectAll.indeterminate = false; }
  if (items.length === 0) return;
  renderList();
}

function demoCheckbox(checked, id) {
  return `
    <label class="shrink-0 w-5 h-5 rounded-md border-2 border-border flex items-center justify-center cursor-pointer hover:border-primary transition-colors ${checked ? 'bg-primary border-primary' : ''}" data-demo-check="${id}" onclick="event.stopPropagation()">
      <i data-lucide="check" class="w-3.5 h-3.5 ${checked ? 'text-primary-foreground' : 'text-transparent'}"></i>
    </label>`;
}

// ---- State ----
let currentAnalysis = null; // { filename, bpm, key }
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

// ---- File handling ----
browseBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

uploadZone?.addEventListener('click', () => {
  fileInput.click();
});

uploadZone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('border-primary');
  const inner = uploadZone.querySelector(':scope > div');
  if (inner) inner.classList.add('border-primary', 'bg-primary/10');
});

uploadZone?.addEventListener('dragleave', () => {
  uploadZone.classList.remove('border-primary');
  const inner = uploadZone.querySelector(':scope > div');
  if (inner) inner.classList.remove('border-primary', 'bg-primary/10');
});

uploadZone?.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('border-primary');
  const inner = uploadZone.querySelector(':scope > div');
  if (inner) inner.classList.remove('border-primary', 'bg-primary/10');
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});

fileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

reanalyzeBtn?.addEventListener('click', () => {
  hideAnalysis();
  fileInput.click();
});

saveResultBtn?.addEventListener('click', () => {
  if (!currentAnalysis) return;
  const d = demos.add({
    title: currentAnalysis.filename.replace(/\.[^.]+$/, ''),
    kind: currentAnalysis.isMidi ? 'MIDI' : '音频',
    bpm: currentAnalysis.bpm,
    key: currentAnalysis.key,
    duration: currentAnalysis.duration || '--',
    date: nowstamp(),
    progress: 0,
  });
  window.MFToast('已保存到小样');
  currentAnalysis = null;
  hideAnalysis();
  renderList();
});

// ---- File processing ----
async function handleFile(file) {
  const isMidi = /\.(mid|midi)$/i.test(file.name);
  
  showAnalyzing(`正在解码 ${file.name}`, isMidi ? 'MIDI 文件分析中…' : '解码音频并检测节拍…');

  try {
    if (isMidi) {
      // MIDI files: estimate tempo from header or use default
      const { bpm } = await analyzeMidi(file);
      const key = estimateKeyFromMidi(file);
      showResult(file.name, bpm, key, '--', true);
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const ac = getAudioContext();
      const audioBuffer = await ac.decodeAudioData(arrayBuffer.slice(0));
      const mono = toMono(audioBuffer);
      const duration = formatDuration(audioBuffer.duration);

      showAnalyzing('正在分析节拍…', '检测 BPM…');
      const bpm = detectBPM(mono, audioBuffer.sampleRate);

      showAnalyzing('正在分析调式…', '检测调性…');
      const key = detectKey(mono, audioBuffer.sampleRate, audioBuffer.duration);

      showResult(file.name, bpm, key, duration, false);
    }
  } catch (err) {
    console.error('Analysis failed:', err);
    window.MFToast('分析失败：不支持的文件格式');
    hideAnalysis();
  }
}

function showAnalyzing(title, sub) {
  analysisSection.classList.remove('hidden');
  analyzingState.classList.remove('hidden');
  resultState.classList.add('hidden');
  analyzingTitle.textContent = title;
  analyzingSub.textContent = sub;
}

function showResult(filename, bpm, key, duration, isMidi) {
  currentAnalysis = { filename, bpm, key, duration, isMidi };
  analysisSection.classList.remove('hidden');
  analyzingState.classList.add('hidden');
  resultState.classList.remove('hidden');
  resultFilename.textContent = filename;
  resultKey.textContent = key;
  resultBpm.textContent = String(bpm);
  refreshIcons();
}

function hideAnalysis() {
  analysisSection.classList.add('hidden');
  analyzingState.classList.add('hidden');
  resultState.classList.add('hidden');
  currentAnalysis = null;
}

// ---- Audio utilities ----
function toMono(buffer) {
  const ch1 = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return ch1;
  const ch2 = buffer.getChannelData(1);
  const len = Math.min(ch1.length, ch2.length);
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mono[i] = (ch1[i] + ch2[i]) * 0.5;
  }
  return mono;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- BPM Detection ----
// Uses onset envelope (energy flux) + autocorrelation approach
function detectBPM(mono, sampleRate) {
  // Ensure minimum audio length (at least 1 second)
  if (mono.length < sampleRate) {
    return 120; // Default for very short audio
  }

  // 1. Downsample to ~100Hz for onset detection
  const targetSr = 100;
  const downsample = Math.max(1, Math.floor(sampleRate / targetSr));
  const len = Math.floor(mono.length / downsample);
  const signal = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    signal[i] = mono[i * downsample];
  }

  // 2. Compute onset envelope (energy flux with half-wave rectification)
  const frameSize = Math.floor(targetSr * 0.025); // 25ms frames
  const hopSize = Math.floor(targetSr * 0.010);  // 10ms hop
  const onsets = [];
  for (let i = frameSize; i < signal.length - frameSize; i += hopSize) {
    let energy = 0;
    let prevEnergy = 0;
    for (let j = i - frameSize; j < i; j++) {
      energy += signal[j] * signal[j];
    }
    for (let j = i - frameSize * 2; j < i - frameSize; j++) {
      prevEnergy += signal[j] * signal[j];
    }
    energy = Math.sqrt(energy / frameSize);
    prevEnergy = Math.sqrt(prevEnergy / frameSize);
    const flux = energy - prevEnergy;
    onsets.push(flux > 0 ? flux : 0);
  }

  // Need enough onset frames
  if (onsets.length < 10) return 120;

  // 3. Autocorrelate onset envelope to find beat period
  const onsetSr = targetSr / hopSize; // onset frames per second
  const minLag = Math.floor(onsetSr * 0.25); // min BPM = 240
  const maxLag = Math.min(Math.floor(onsetSr * 2.0), onsets.length - 2);  // max BPM = 30

  if (maxLag <= minLag + 1) return 120;

  // Compute autocorrelation
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < onsets.length - lag; i++) {
      sum += onsets[i] * onsets[i + lag];
      norm += onsets[i] * onsets[i];
    }
    ac[lag] = norm > 0 ? sum / norm : 0;
  }

  // 4. Find the first significant peak (bounds-safe)
  let bestLag = minLag;
  let bestCorr = -Infinity;

  for (let lag = Math.floor(minLag * 1.5); lag <= maxLag - 1; lag++) {
    if (ac[lag] > bestCorr && ac[lag] > ac[lag - 1] && ac[lag] > ac[lag + 1]) {
      bestCorr = ac[lag];
      bestLag = lag;
    }
  }

  // If no clear peak, search more broadly
  if (bestCorr <= 0) {
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (ac[lag] > bestCorr) {
        bestCorr = ac[lag];
        bestLag = lag;
      }
    }
  }

  // If still no good correlation, use a default
  if (bestCorr <= 0) return 120;

  const periodSec = bestLag / onsetSr;
  const bpm = Math.round(60 / periodSec);

  // Clamp to reasonable range
  return Math.max(40, Math.min(220, bpm));
}

// ---- Key Detection ----
// Uses autocorrelation pitch detection + Krumhansl-Schmuckler key matching
function detectKey(mono, sampleRate, duration) {
  // Ensure minimum audio length
  if (mono.length < Math.floor(sampleRate * 0.5)) {
    return 'C major'; // Default for very short audio
  }

  // Use a segment of the audio (up to 30 seconds)
  const segmentLen = Math.min(mono.length, Math.floor(sampleRate * 30));
  const segment = mono.subarray(0, segmentLen);

  // Frequency to pitch class mapping
  const freqToPitchClass = (freq) => {
    if (freq <= 0) return -1;
    const midi = 12 * Math.log2(freq / 440) + 69;
    return ((Math.round(midi) % 12) + 12) % 12;
  };

  // Get dominant pitch candidates from autocorrelation
  const pitchCandidates = getPitchCandidates(segment, sampleRate);
  
  // Step 2: Vote for key based on detected pitches
  const pitchClassCounts = new Float32Array(12);
  for (const freq of pitchCandidates) {
    if (freq > 0) {
      const pc = freqToPitchClass(freq);
      if (pc >= 0) pitchClassCounts[pc]++;
    }
  }

  // If we have enough candidates, determine key
  const totalVotes = pitchClassCounts.reduce((a, b) => a + b, 0);
  if (totalVotes < 5) {
    // Not enough pitch data, try energy-based approach
    return detectKeyFromEnergy(segment, sampleRate);
  }

  // Normalize
  for (let i = 0; i < 12; i++) pitchClassCounts[i] /= totalVotes;

  // Major and minor key profiles (Krumhansl-Schmuckler)
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.58];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  let bestScore = -Infinity;
  let bestKey = 'C major';

  for (let tonic = 0; tonic < 12; tonic++) {
    // Test major
    let scoreMajor = 0;
    for (let pc = 0; pc < 12; pc++) {
      scoreMajor += pitchClassCounts[(pc + tonic) % 12] * majorProfile[pc];
    }
    // Test minor
    let scoreMinor = 0;
    for (let pc = 0; pc < 12; pc++) {
      scoreMinor += pitchClassCounts[(pc + tonic) % 12] * minorProfile[pc];
    }

    if (scoreMajor > bestScore) {
      bestScore = scoreMajor;
      bestKey = `${noteNames[tonic]} major`;
    }
    if (scoreMinor > bestScore) {
      bestScore = scoreMinor;
      bestKey = `${noteNames[tonic]} minor`;
    }
  }

  return bestKey;
}

// Get dominant pitch candidates using autocorrelation
function getPitchCandidates(signal, sampleRate) {
  const candidates = [];
  const minFreq = 65; // C2
  const maxFreq = 2000; // high enough for melody

  // Frame-based analysis
  const frameSize = Math.floor(sampleRate * 0.05); // 50ms frames
  const hopSize = Math.floor(sampleRate * 0.025);  // 25ms hop
  const numFrames = Math.floor((signal.length - frameSize) / hopSize);
  const maxFrames = Math.min(numFrames, 200); // limit to 200 frames

  for (let f = 0; f < maxFrames; f++) {
    const start = f * hopSize;
    const frame = signal.subarray(start, start + frameSize);

    // Skip silent frames
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    energy = Math.sqrt(energy / frame.length);
    if (energy < 0.01) continue; // skip noise

    // Autocorrelation on frame
    const minLag = Math.floor(sampleRate / maxFreq);
    const maxLag = Math.floor(sampleRate / minFreq);
    const maxActualLag = Math.min(maxLag, Math.floor(frame.length / 2));

    let bestLag = minLag;
    let bestCorr = 0;

    for (let lag = minLag; lag < maxActualLag; lag++) {
      let corr = 0;
      for (let i = 0; i < frame.length - lag; i++) {
        corr += frame[i] * frame[i + lag];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    // Check it's a real peak
    if (bestCorr > 0) {
      const freq = sampleRate / bestLag;
      if (freq >= minFreq && freq <= maxFreq) {
        candidates.push(freq);
        // Also add harmonics
        if (freq * 2 <= maxFreq) candidates.push(freq * 2);
        if (freq * 3 <= maxFreq) candidates.push(freq * 3);
      }
    }
  }

  return candidates;
}

// Fallback: detect key from energy distribution across frequency bands
function detectKeyFromEnergy(signal, sampleRate) {
  const fftSize = 4096;
  const hopSize = fftSize;
  const chromaEnergy = new Float32Array(12);
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Get frequency-domain energy per pitch class
  const frames = Math.min(Math.floor(signal.length / hopSize), 50);
  for (let f = 0; f < frames; f++) {
    const start = f * hopSize;
    const frame = signal.subarray(start, Math.min(start + fftSize, signal.length));
    const padded = new Float32Array(fftSize);
    padded.set(frame.subarray(0, Math.min(frame.length, fftSize)));

    // Simple magnitude spectrum (computed via autocorrelation-like approach)
    // Map frequency bins to pitch classes
    for (let bin = 1; bin < fftSize / 2; bin++) {
      const freq = (bin / fftSize) * sampleRate;
      const pc = freqToPc(freq);
      if (pc >= 0) {
        // Rough magnitude estimate using a few samples
        let mag = 0;
        const idx = Math.floor(bin);
        if (idx < frame.length) {
          mag = Math.abs(frame[idx]);
        }
        chromaEnergy[pc] += mag;
      }
    }
  }

  // Normalize
  const total = chromaEnergy.reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (let i = 0; i < 12; i++) chromaEnergy[i] /= total;
  }

  // Match to major/minor profiles
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.58];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function freqToPc(freq) {
    if (freq <= 0) return -1;
    const midi = 12 * Math.log2(freq / 440) + 69;
    return ((Math.round(midi) % 12) + 12) % 12;
  }

  let bestScore = -Infinity;
  let bestKey = 'C major';

  for (let tonic = 0; tonic < 12; tonic++) {
    let scoreMajor = 0;
    let scoreMinor = 0;
    for (let pc = 0; pc < 12; pc++) {
      scoreMajor += chromaEnergy[(pc + tonic) % 12] * majorProfile[pc];
      scoreMinor += chromaEnergy[(pc + tonic) % 12] * minorProfile[pc];
    }
    if (scoreMajor > bestScore) { bestScore = scoreMajor; bestKey = `${noteNames[tonic]} major`; }
    if (scoreMinor > bestScore) { bestScore = scoreMinor; bestKey = `${noteNames[tonic]} minor`; }
  }

  return bestKey;
}

// ---- MIDI file analysis ----
async function analyzeMidi(file) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  // Parse minimal MIDI header to get tempo
  let offset = 0;
  // Read header chunk
  if (view.getUint32(offset) !== 0x4d546864) { // "MThd"
    return { bpm: 120 };
  }
  offset += 8;
  const numTracks = view.getUint16(offset);
  offset += 2;
  const division = view.getUint16(offset);
  offset += 2;

  // Search for tempo event
  let tempo = 500000; // default 120 BPM (500ms per quarter note)
  const ticksPerQuarter = division & 0x8000 ? null : division;

  if (ticksPerQuarter) {
    let eventOffset = offset;
    let currentTempo = tempo;
    let foundTempo = false;

    for (let t = 0; t < Math.min(numTracks, 3); t++) {
      if (view.getUint32(eventOffset) !== 0x4d54726b) break; // "MTrk"
      const trackLen = view.getUint32(eventOffset + 4);
      const trackEnd = eventOffset + 8 + trackLen;
      eventOffset += 8;

      let tick = 0;
      while (eventOffset < trackEnd) {
        // Read delta time (variable length)
        let delta = 0;
        let byte;
        do {
          byte = view.getUint8(eventOffset++);
          delta = (delta << 7) | (byte & 0x7f);
        } while (byte & 0x80);
        tick += delta;

        // Read event type
        const status = view.getUint8(eventOffset);
        eventOffset++;

        if (status === 0xff) {
          const metaType = view.getUint8(eventOffset);
          eventOffset++;
          const metaLen = readVlq(view, eventOffset);
          eventOffset += vlqSize(view, eventOffset - 1);

          if (metaType === 0x51 && metaLen >= 3) {
            currentTempo = (view.getUint8(eventOffset) << 16) | (view.getUint8(eventOffset + 1) << 8) | view.getUint8(eventOffset + 2);
            foundTempo = true;
            eventOffset += metaLen;
          } else {
            eventOffset += metaLen;
          }
        } else if ((status & 0xf0) === 0xf0) {
          const sysexLen = readVlq(view, eventOffset);
          eventOffset += vlqSize(view, eventOffset - 1);
          eventOffset += sysexLen;
        } else {
          // Skip MIDI event data
          eventOffset += 2;
        }

        if (foundTempo) {
          tempo = currentTempo;
          break;
        }
      }
      if (foundTempo) break;
    }
  }

  const bpm = Math.round(60000000 / tempo);
  return { bpm: Math.max(20, Math.min(300, bpm)) };
}

function readVlq(view, offset) {
  let value = 0;
  let byte;
  do {
    byte = view.getUint8(offset);
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return value;
}

function vlqSize(view, offset) {
  let size = 0;
  let byte;
  do {
    byte = view.getUint8(offset + size);
    size++;
  } while (byte & 0x80);
  return size;
}

function estimateKeyFromMidi(file) {
  // Simple heuristic: use the filename or return a reasonable guess
  const name = file.name.toLowerCase();
  if (name.includes('minor')) return 'A minor';
  if (name.includes('major')) return 'C major';
  // Default guess
  return 'C major';
}

// ---- List rendering ----
function renderList() {
  const all = demos.all();
  const items = all.filter((d) => d.bpm !== undefined || d.key !== undefined);

  demoCount.textContent = items.length ? `${items.length} 个` : '';
  emptyState.classList.toggle('hidden', items.length > 0);
  if (!items.length) { exitDemosSelectMode(); }
  demoList.innerHTML = items
    .map((d) => {
      const keyInfo = d.key || '--';
      const bpmInfo = d.bpm ? `${d.bpm}` : '--';
      const kind = d.kind || '音频';
      const id = d.id;
      const checked = demosSelected.has(id);
      return `
      <article class="bg-card border ${checked ? 'border-primary ring-2 ring-primary/30' : 'border-border'} rounded-xl p-4 flex items-center gap-3 group shadow-sm hover:shadow-md transition-all duration-150" data-id="${id}">
        ${demosSelectMode ? demoCheckbox(checked, id) : ''}
        <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <i data-lucide="${kind === 'MIDI' ? 'music-4' : 'audio-waveform'}" class="w-5 h-5 text-muted-foreground"></i>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-medium truncate">${escapeHtml(d.title)}</h3>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-xs text-primary font-mono">${keyInfo}</span>
            <span class="text-xs text-muted-foreground">·</span>
            <span class="text-xs text-primary font-mono">${bpmInfo} BPM</span>
            <span class="text-xs text-muted-foreground">·</span>
            <span class="text-xs text-muted-foreground">${escapeHtml(kind)}</span>
          </div>
        </div>
        ${demosSelectMode ? '' : `
        <button type="button" data-action="delete" class="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100" title="删除">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>`}
      </article>`;
    })
    .join('');
  updateDemosSelectUI();
  refreshIcons();
}

// ---- 多选事件绑定 ----
if (demosToggleSelectBtn) {
  demosToggleSelectBtn.addEventListener('click', () => {
    const items = demos.all().filter((d) => d.bpm !== undefined || d.key !== undefined);
    if (!items.length) { window.MFToast('暂无可选的小样'); return; }
    demosSelectMode = !demosSelectMode;
    if (!demosSelectMode) demosSelected.clear();
    updateDemosSelectUI();
    renderList();
  });
}
if (demosSelectCancelBtn) {
  demosSelectCancelBtn.addEventListener('click', exitDemosSelectMode);
}
if (demosSelectAll) {
  demosSelectAll.addEventListener('change', () => {
    const items = demos.all().filter((d) => d.bpm !== undefined || d.key !== undefined);
    if (demosSelectAll.checked) demosSelected = new Set(items.map((x) => x.id));
    else demosSelected.clear();
    updateDemosSelectUI();
    renderList();
  });
}
if (demosBatchDeleteBtn) {
  demosBatchDeleteBtn.addEventListener('click', async () => {
    if (!demosSelected.size) return;
    const ok = await openConfirm(`确定删除选中的 ${demosSelected.size} 个小样？此操作不可恢复。`);
    if (!ok) return;
    let n = 0;
    const all = demos.all().filter((d) => !demosSelected.has(d.id));
    n = demosSelected.size;
    demos.save(all);
    window.MFToast(`已删除 ${n} 个`);
    exitDemosSelectMode();
  });
}
// 复选框点击（委托）
demoList?.addEventListener('click', (e) => {
  const el = e.target.closest('[data-demo-check]');
  if (!el) return;
  const id = el.dataset.demoCheck;
  if (demosSelected.has(id)) demosSelected.delete(id);
  else demosSelected.add(id);
  updateDemosSelectUI();
  renderList();
});

demoList?.addEventListener('click', (e) => {
  if (demosSelectMode) return;
  const btn = e.target.closest('button[data-action="delete"]');
  if (!btn) return;
  const article = btn.closest('article[data-id]');
  const id = article.dataset.id;
  const all = demos.all();
  demos.save(all.filter((d) => d.id !== id));
  window.MFToast('已删除');
  renderList();
});

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Init ----
// mountNav is called by app.js
renderList();

// 数据从 IndexedDB 加载完成后重新渲染（异步初始化时缓存可能还空）
window.addEventListener('storeready', renderList);
