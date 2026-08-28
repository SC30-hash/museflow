#!/usr/bin/env node
// Generate a 2-bar (8 beats x 16th notes) demo loop WAV matching sketch.js flow
// BPM = 110, 4/4, loop beats = 4, so 1 loop = 4 beats, render 2 loops (8 beats) so user hears the repeat pattern.
//
// Events (step 0..15 per loop, 16 steps/loop, 4 steps per beat):
//   Loop 1 & 2 identical:
//     step 0 (beat 1): pad Kick (0), chord C major (chord idx 0, key C major = C E G)
//     step 4 (beat 2): pad Hat (1)
//     step 8 (beat 3): pad Kick (0)
//     step 12 (beat 4): pad Snare (2), chord F major (chord idx 3, key C major = F A C)
//   Metro clicks on beats (step 0,4,8,12) — accent on step 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'Demo_Loop_110BPM.wav');

const SR = 44100;
const BPM = 110;
const STEP_DUR = (60 / BPM) / 4;            // seconds per 16th note
const LOOP_STEPS = 16;                       // 4 beats x 4 = 16 steps
const NUM_LOOPS = 2;                          // render 2 loop cycles so hear repeat
const TOTAL_SEC = STEP_DUR * LOOP_STEPS * NUM_LOOPS;
const LEN = Math.ceil(TOTAL_SEC * SR);
const lbuf = new Float32Array(LEN);
const rbuf = new Float32Array(LEN);

function addSample(sec, chan) {
  return Math.max(0, Math.min(LEN - 1, Math.floor(sec * SR)));
}
function mix(sec, dur, fn, gain=0.3) {
  const start = addSample(sec, 0);
  const end = Math.min(LEN, Math.ceil((sec + dur) * SR));
  for (let i = start; i < end; i++) {
    const t = (i - start) / SR;
    const [L, R] = fn(t, dur);
    lbuf[i] = (lbuf[i] || 0) + L * gain;
    rbuf[i] = (rbuf[i] || 0) + R * gain;
  }
}
// ADSR helper
function adsr(t, d, att=0.003, dec=0.08, sus=0.4, rel=0.15) {
  if (t < 0) return 0;
  if (t < att) return t / att;
  if (t < att + dec) return 1 - ((1 - sus) * (t - att) / dec);
  if (t < d - rel) return sus;
  if (t < d) return sus * (1 - (t - (d - rel)) / rel);
  return 0;
}

// ======= KICK drum (pad 0) =======
function kick(t) {
  const dur = 0.3;
  const env = Math.exp(-t * 15);
  const f = 150 * Math.exp(-t * 40) + 48;
  const sample = Math.sin(2 * Math.PI * f * t) * env * 1.2;
  // click
  const click = Math.sin(2 * Math.PI * 3500 * t) * Math.exp(-t * 120) * 0.3;
  return [sample + click, sample + click];
}
// ======= HI-HAT (pad 1) =======
function hihat(t) {
  const dur = 0.08;
  // white noise through band pass-ish: square waves with different freq summed
  if (t > dur) return [0, 0];
  const env = Math.exp(-t * 50);
  let s = 0;
  for (let k = 0; k < 6; k++) {
    s += Math.sin(2 * Math.PI * (4000 + k * 1300 + (t*2000)) * t) * 0.15;
  }
  s = (s / 6) * env * 1.1;
  return [s, s];
}
// ======= SNARE (pad 2) =======
function snare(t) {
  const dur = 0.2;
  if (t > dur) return [0, 0];
  const body = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 20) * 0.6;
  // noise component
  let n = 0;
  for (let k = 0; k < 4; k++) n += Math.sin(2 * Math.PI * (1500 + k*700) * t) * (0.5 + 0.5*Math.sin(2*Math.PI*8000*t));
  n = n / 4 * Math.exp(-t * 22) * 0.5;
  return [(body + n) * 0.8, (body + n) * 0.8];
}
// ======= OPEN HAT (pad 3) =======
function openhat(t) {
  const dur = 0.35;
  if (t > dur) return [0, 0];
  const env = Math.exp(-t * 10);
  let s = 0;
  for (let k = 0; k < 5; k++) s += Math.sin(2 * Math.PI * (5000 + k*1500) * t) * 0.2;
  s = (s / 5) * env * 1.0;
  return [s, s];
}
// ======= PIANO chord (major chord, 3 notes + octave) =======
// chord type: major triad
function pianoChord(t, rootHz, dur=1.4, vol=0.4) {
  if (t > dur) return [0, 0];
  const ratios = [1, 1.25, 1.5, 2]; // major-ish
  // true semitone-based notes
  const notes = [
    rootHz,                          // root
    rootHz * Math.pow(2, 4/12),      // major 3rd
    rootHz * Math.pow(2, 7/12),      // fifth
    rootHz * 2,                      // octave
  ];
  const env = adsr(t, dur, 0.005, 0.25, 0.35, 0.8);
  let s = 0;
  for (let i = 0; i < notes.length; i++) {
    const f = notes[i];
    // piano-like: 2 partial sine
    s += Math.sin(2 * Math.PI * f * t) * 0.25;
    s += Math.sin(2 * Math.PI * f * 2 * t) * 0.08;
    s += Math.sin(2 * Math.PI * f * 3 * t) * 0.03;
  }
  s = s * env * vol;
  return [s, s];
}
// ======= METRONOME click =======
function metro(t, accent=false) {
  const dur = 0.07;
  if (t > dur) return [0, 0];
  const f = accent ? 880 : 440;
  const env = Math.exp(-t * 35);
  const s = (Math.sign(Math.sin(2*Math.PI*f*t))) * env * 0.18;
  return [s, s];
}

// ======= SCHEDULE EVENTS =======
// Map chord index to root Hz (key = C major). Sketch chord buttons: idx 0..5 = C Dm Em F G Am.
// We used C (idx 0) and F (idx 3)
const CHORD_ROOTS_HZ = { 'C': 261.63, 'D': 293.66, 'E': 329.63, 'F': 349.23, 'G': 392.00, 'A': 440.00, 'B': 493.88 };
function schedulePad(idx, tStart) {
  switch(idx) {
    case 0: mix(tStart, 0.4, kick, 0.85); break;
    case 1: mix(tStart, 0.12, hihat, 0.55); break;
    case 2: mix(tStart, 0.25, snare, 0.8); break;
    case 3: mix(tStart, 0.4, openhat, 0.55); break;
  }
}
function scheduleChord(idx, tStart, dur=1.2) {
  const ROOT_KEY = 'C';
  const roman = ['C','D','E','F','G','A']; // idx 0..5 => C maj, D min, E min, F maj, G maj, A min (we approximate by root only — not perfect but OK)
  const rootHz = CHORD_ROOTS_HZ[roman[idx]];
  mix(tStart, dur, (t,d)=>pianoChord(t, rootHz, d, 0.45), 1.0);
}
function scheduleMetro(tStart, accent) {
  mix(tStart, 0.08, (t)=>metro(t, accent), 0.8);
}

for (let loop = 0; loop < NUM_LOOPS; loop++) {
  const loopStart = loop * LOOP_STEPS * STEP_DUR;
  for (let step = 0; step < LOOP_STEPS; step++) {
    const t = loopStart + step * STEP_DUR;
    // Metronome: every 4 steps
    if (step % 4 === 0) {
      scheduleMetro(t, step === 0);
    }
    // Kick on step 0 and 8
    if (step === 0 || step === 8) schedulePad(0, t);
    // Hihat on step 4
    if (step === 4) schedulePad(1, t);
    // Snare on step 12
    if (step === 12) schedulePad(2, t);
    // Chord C on step 0 (every loop)
    if (step === 0) scheduleChord(0, t, STEP_DUR*8); // hold ~2 beats
    // Chord F on step 12 (every loop) slightly delayed
    if (step === 12) scheduleChord(3, t, STEP_DUR*8);
  }
}

// Normalize: find peak
let peak = 0;
for (let i = 0; i < LEN; i++) {
  const a = Math.abs(lbuf[i]); if (a > peak) peak = a;
  const b = Math.abs(rbuf[i]); if (b > peak) peak = b;
}
const headroom = 0.93;
const norm = peak > 0 ? (headroom / peak) : 1;

// Build 16-bit PCM stereo WAV
function writeString(buf, off, str) {
  for (let i = 0; i < str.length; i++) buf[off + i] = str.charCodeAt(i);
}
function writeU16LE(buf, off, v) {
  buf[off] = v & 0xff;
  buf[off+1] = (v>>8) & 0xff;
}
function writeU32LE(buf, off, v) {
  buf[off] = v & 0xff;
  buf[off+1] = (v>>8) & 0xff;
  buf[off+2] = (v>>16) & 0xff;
  buf[off+3] = (v>>24) & 0xff;
}

const dataBytes = LEN * 2 * 2; // samples × channels × bytesPerSample (16-bit)
const fileSize = 44 + dataBytes;
const wav = new Uint8Array(fileSize);

writeString(wav, 0, 'RIFF');
writeU32LE(wav, 4, fileSize - 8);
writeString(wav, 8, 'WAVE');
writeString(wav, 12, 'fmt ');
writeU32LE(wav, 16, 16); // fmt chunk size
writeU16LE(wav, 20, 1); // PCM
writeU16LE(wav, 22, 2); // channels
writeU32LE(wav, 24, SR); // sample rate
writeU32LE(wav, 28, SR * 2 * 2); // byte rate
writeU16LE(wav, 32, 4); // block align
writeU16LE(wav, 34, 16); // bits per sample
writeString(wav, 36, 'data');
writeU32LE(wav, 40, dataBytes);

let off = 44;
for (let i = 0; i < LEN; i++) {
  const L = Math.max(-1, Math.min(1, lbuf[i] * norm));
  const R = Math.max(-1, Math.min(1, rbuf[i] * norm));
  const sl = Math.round(L * 32767);
  const sr = Math.round(R * 32767);
  writeU16LE(wav, off, sl); off += 2;
  writeU16LE(wav, off, sr); off += 2;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(wav));
const stats = fs.statSync(OUT);
console.log(`Wrote ${OUT}`);
console.log(`Size: ${stats.size} bytes (${(stats.size/1024).toFixed(1)} KB)`);
console.log(`Duration: ${TOTAL_SEC.toFixed(2)} sec, SR ${SR}, BPM ${BPM}`);
