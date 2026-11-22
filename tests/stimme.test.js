// Klavier-Filter: Singen und Sprechen sollen keine Antwort auslösen, Klaviertöne schon.
// Künstliche Stimmen: Obertöne mit Vokal-Formanten, weicher Einsatz, Vibrato bzw. gleitende Tonhöhe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFrame, attackRise, NoteListener } from '../js/pitch.js';
import { frequency, noteFromMidi } from '../js/notes.js';

const RATE = 48000;
const FRAME = 4096;
const HOP = 1600;

function noise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

// Stimme: f0(t) liefert die Grundfrequenz, Formanten wie beim Vokal „a“ (ca. 800 und 1200 Hz)
function addVoice(s, start, dur, f0, { attack = 0.1, level = 0.2 } = {}) {
  let phase = 0;
  const formant = (f) => Math.exp(-(((f - 800) / 300) ** 2)) + 0.7 * Math.exp(-(((f - 1200) / 350) ** 2)) + 0.15;
  for (let i = Math.floor(start * RATE); i < Math.min(s.length, Math.floor((start + dur) * RATE)); i++) {
    const t = i / RATE - start;
    const f = f0(t);
    phase += (2 * Math.PI * f) / RATE;
    let v = 0;
    for (let n = 1; n <= 12; n++) v += formant(n * f) * Math.sin(n * phase) / n ** 0.5;
    const env = Math.min(1, t / attack) * Math.min(1, (start + dur - i / RATE) / 0.08);
    s[i] += level * 0.25 * v * env;
  }
}

function addPiano(s, start, note) {
  const f = frequency(note);
  for (let i = Math.floor(start * RATE); i < s.length; i++) {
    const t = i / RATE - start;
    let v = 0;
    for (let n = 1; n <= 8; n++) v += (1 / n) * Math.sin(2 * Math.PI * f * n * Math.sqrt(1 + 0.0004 * n * n) * t + n) * Math.exp((-t * n) / 3);
    s[i] += 0.22 * v * Math.min(1, t / 0.004) * Math.exp(-t * 1.2);
  }
}

function listen(build, seconds) {
  const s = new Float32Array(Math.ceil(seconds * RATE));
  const rnd = noise(3);
  for (let i = 0; i < s.length; i++) s[i] = 0.003 * rnd();
  build(s);
  const listener = new NoteListener();
  const heard = [];
  for (let end = FRAME; end <= s.length; end += HOP) {
    const frame = analyseFrame(s.subarray(end - FRAME, end), RATE);
    const got = listener.feed(frame.rms, frame.midi, (end / RATE) * 1000, frame.hf, frame);
    if (got !== null) heard.push(noteFromMidi(got));
  }
  return heard;
}

const vibrato = (f, cents = 40, rate = 5.5) => (t) => f * 2 ** ((cents * Math.sin(2 * Math.PI * rate * t)) / 1200);

test('Stimme: gesungene Töne mit Vibrato lösen nichts aus', () => {
  for (const note of ['A3', 'C4', 'E4', 'G4', 'C5']) {
    assert.deepEqual(listen((s) => addVoice(s, 0.3, 1.4, vibrato(frequency(note))), 2.2), [], `gesungenes ${note}`);
  }
});

test('Stimme: gerade gesungener Ton mit weichem Einsatz löst nichts aus', () => {
  for (const note of ['D4', 'A4']) {
    assert.deepEqual(listen((s) => addVoice(s, 0.3, 1.2, () => frequency(note), { attack: 0.12 }), 2), [], `gesungenes ${note}`);
  }
});

test('Stimme: Sprechen (Silben mit gleitender Tonhöhe) löst nichts aus', () => {
  const heard = listen((s) => {
    for (let k = 0; k < 8; k++) {
      const from = 150 + 40 * Math.sin(k * 1.7);
      addVoice(s, 0.2 + k * 0.35, 0.25, (t) => from * (1 - 0.6 * t), { attack: 0.03, level: 0.25 });
    }
  }, 3.4);
  assert.deepEqual(heard, []);
});

test('Klavier wird trotz Stimme davor erkannt', () => {
  const heard = listen((s) => {
    addVoice(s, 0.2, 0.9, vibrato(frequency('A3')));
    addPiano(s, 1.5, 'C4');
    addPiano(s, 2.8, 'G4');
  }, 4);
  assert.deepEqual(heard, ['C4', 'G4']);
});

test('Anstiegszeit: Klavier kurz, Stimme lang', () => {
  const piano = new Float32Array(FRAME);
  addPiano(piano, 0.03, 'C4');
  const voice = new Float32Array(FRAME);
  addVoice(voice, 0.005, 0.5, () => frequency('C4'), { attack: 0.1 });
  assert.ok(attackRise(piano, RATE) <= 15, `Klavier ${attackRise(piano, RATE)} ms`);
  assert.ok(attackRise(voice, RATE) >= 45, `Stimme ${attackRise(voice, RATE)} ms`);
});
