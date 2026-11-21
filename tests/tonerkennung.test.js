// Tonerkennung fürs Mikrofon: mit künstlichen Klaviertönen geprüft (echte Aufnahmen gibt es im Test nicht).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFrame, detectPitch, NoteListener } from '../js/pitch.js';
import { CLEFS, levelNotes, midiNumber, noteFromMidi, frequency } from '../js/notes.js';

const RATE = 48000;
const FRAME = 4096;
const HOP = 1600; // ≈ 33 ms, wie ein Bildschirm-Durchlauf

// Reproduzierbares Rauschen
function noise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

// Klavierähnlicher Ton: Obertöne mit Spreizung, bei tiefen Tönen ist der Grundton schwach
// (so klingt ein Klavier durchs Handy-Mikrofon)
function pianoSample(freq, t, phaseSeed = 0) {
  let v = 0;
  for (let n = 1; n <= 8; n++) {
    const f = freq * n * Math.sqrt(1 + 0.0004 * n * n);
    let amp = 1 / n;
    if (n === 1 && freq < 130) amp = 0.25;
    v += amp * Math.sin(2 * Math.PI * f * t + n * phaseSeed) * Math.exp((-t * n) / 3);
  }
  return v * 0.25;
}

function frameOf(freq, { noiseLevel = 0.01, seed = 1 } = {}) {
  const rnd = noise(seed);
  const buf = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) buf[i] = pianoSample(freq, 0.05 + i / RATE, seed) + noiseLevel * rnd();
  return buf;
}

const allNotes = [...new Set([...levelNotes('treble', 2), ...levelNotes('bass', 2)])];

test('noteFromMidi ist die Umkehrung von midiNumber', () => {
  for (let m = 36; m <= 96; m++) assert.equal(midiNumber(noteFromMidi(m)), m);
  assert.equal(noteFromMidi(60), 'C4');
  assert.equal(noteFromMidi(61), 'C#4');
  assert.equal(noteFromMidi(59), 'B3');
});

test('erkennt jede Note beider Schlüssel (C bis c³) auf die Oktave genau', () => {
  for (const note of allNotes) {
    for (const seed of [1, 2, 3]) {
      const { midi } = analyseFrame(frameOf(frequency(note), { seed }), RATE);
      assert.equal(midi, midiNumber(note), `${note} (Variante ${seed}): erkannt ${midi === null ? 'nichts' : noteFromMidi(midi)}`);
    }
  }
});

test('erkennt schwarze Tasten als solche', () => {
  for (const note of ['C#2', 'F#3', 'A#4', 'D#5']) {
    assert.equal(analyseFrame(frameOf(frequency(note)), RATE).midi, midiNumber(note), note);
  }
});

test('verträgt ein leicht verstimmtes Klavier (±30 Cent)', () => {
  for (const cents of [-30, 30]) {
    const f = frequency('A4') * 2 ** (cents / 1200);
    assert.equal(analyseFrame(frameOf(f), RATE).midi, 69, `${cents} Cent`);
  }
});

test('erkennt auch bei 44,1 kHz (andere Handys)', () => {
  const rate = 44100;
  const buf = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) buf[i] = pianoSample(frequency('E2'), 0.05 + i / rate);
  assert.equal(analyseFrame(buf, rate).midi, midiNumber('E2'));
});

test('Stille und reines Rauschen ergeben keinen Ton', () => {
  assert.equal(analyseFrame(new Float32Array(FRAME), RATE).midi, null);
  const rnd = noise(9);
  const buf = new Float32Array(FRAME).map(() => 0.2 * rnd());
  assert.equal(analyseFrame(buf, RATE).midi, null);
});

test('reiner Sinuston wird erkannt', () => {
  const buf = new Float32Array(FRAME).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE));
  assert.ok(Math.abs(detectPitch(buf, RATE).freq - 440) < 1);
});

// Simuliert das Mikrofon über eine Zeitspanne: Anschläge [Startzeit s, Note], jeder Ton klingt aus
function simulate(hits, seconds, { noiseLevel = 0.003 } = {}) {
  const total = Math.ceil(seconds * RATE);
  const signal = new Float32Array(total);
  const rnd = noise(4);
  for (let i = 0; i < total; i++) signal[i] = noiseLevel * rnd();
  for (const [start, note] of hits) {
    const f = frequency(note);
    for (let i = Math.floor(start * RATE); i < total; i++) {
      const t = i / RATE - start;
      signal[i] += pianoSample(f, t) * Math.min(1, t / 0.005) * Math.exp(-t * 1.5);
    }
  }
  const listener = new NoteListener();
  const heard = [];
  for (let end = FRAME; end <= total; end += HOP) {
    const frame = analyseFrame(signal.subarray(end - FRAME, end), RATE);
    const { rms, hf, midi } = frame;
    const t = (end / RATE) * 1000;
    const got = listener.feed(rms, midi, t, hf, frame);
    if (got !== null) heard.push({ t: Math.round(t), note: noteFromMidi(got) });
  }
  return heard;
}

test('Anschläge: jede gespielte Note genau einmal, Nachklang zählt nicht', () => {
  const heard = simulate([[0.3, 'A4'], [1.6, 'C5'], [2.9, 'C5'], [4.2, 'E2']], 6);
  assert.deepEqual(heard.map((h) => h.note), ['A4', 'C5', 'C5', 'E2']);
  // schnell genug: höchstens 250 ms nach dem Anschlag
  [0.3, 1.6, 2.9, 4.2].forEach((start, i) => assert.ok(heard[i].t - start * 1000 < 250, `Anschlag ${i + 1}: ${heard[i].t - start * 1000} ms`));
});

test('Anschläge: nachklingender Ton allein löst nichts aus', () => {
  const heard = simulate([[0.2, 'G3']], 4);
  assert.equal(heard.length, 1);
});

test('Rechenzeit pro Ausschnitt reicht für flüssige Erkennung', () => {
  const buf = frameOf(frequency('C2'));
  const runs = 50;
  const start = performance.now();
  for (let i = 0; i < runs; i++) analyseFrame(buf, RATE);
  const ms = (performance.now() - start) / runs;
  assert.ok(ms < 8, `${ms.toFixed(2)} ms pro Ausschnitt`);
});

test('Klaviaturbereiche liegen im Erkennungsbereich', () => {
  for (const clef of ['treble', 'bass']) for (const n of CLEFS[clef].keyboard) assert.ok(frequency(n) > 60 && frequency(n) < 1400);
});
