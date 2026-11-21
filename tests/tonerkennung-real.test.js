// Härtere Prüfung der Tonerkennung mit realistischeren Klavierklängen, wie sie ein
// Handy-Mikrofon aufnimmt. Ersetzt keine echte Aufnahme, deckt aber die bekannten Fallen ab:
// fehlender Grundton, Obertonspreizung, Saitenchöre mit Schwebung, Brummen, Nachhall, Rauschen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFrame, NoteListener } from '../js/pitch.js';
import { levelNotes, midiNumber, noteFromMidi, frequency } from '../js/notes.js';

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

// Klavierton: 12 Teiltöne, Spreizung B (tiefe Saiten stärker), je drei leicht verstimmte Saiten,
// Teiltöne verklingen unterschiedlich schnell. fundamental: Stärke des Grundtons (0 = fehlt ganz).
function piano(freq, { B = 0.0004, fundamental = 1, detuneCents = 1.2, seed = 1 } = {}) {
  const rnd = noise(seed);
  const partials = [];
  for (let n = 1; n <= 12; n++) {
    const f = freq * n * Math.sqrt(1 + B * n * n);
    if (f > 6000) break;
    let amp = 1 / n ** 0.9;
    if (n === 1) amp *= fundamental;
    if (freq < 150 && n >= 2 && n <= 4) amp *= 1.6; // Bass: 2.–4. Teilton dominieren
    for (const c of [-detuneCents, 0, detuneCents]) {
      partials.push({ f: f * 2 ** (c / 1200), amp: amp / 3, phase: rnd() * Math.PI, decay: 0.6 + 0.5 * n });
    }
  }
  return (t) => {
    let v = 0;
    for (const p of partials) v += p.amp * Math.sin(2 * Math.PI * p.f * t + p.phase) * Math.exp(-t * p.decay * 0.5);
    return v;
  };
}

// Handy-Mikrofon: Hochpass (2. Ordnung) nimmt Bässe weg
function highpass(signal, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = rc / (rc + 1 / RATE);
  for (let pass = 0; pass < 2; pass++) {
    let prevX = signal[0];
    let prevY = signal[0];
    for (let i = 1; i < signal.length; i++) {
      const x = signal[i];
      const y = a * (prevY + x - prevX);
      prevX = x;
      prevY = y;
      signal[i] = y;
    }
  }
  return signal;
}

function render(hits, seconds, { noiseLevel = 0.004, hum = 0.004, cutoff = 120, gain = 0.25, ...opts } = {}) {
  const total = Math.ceil(seconds * RATE);
  const s = new Float32Array(total);
  const rnd = noise(77);
  for (let i = 0; i < total; i++) s[i] = noiseLevel * rnd() + hum * Math.sin((2 * Math.PI * 50 * i) / RATE);
  hits.forEach(([start, note, velocity = 1], k) => {
    const voice = piano(frequency(note), { seed: midiNumber(note), ...opts, fundamental: frequency(note) < 200 ? opts.fundamental ?? 1 : 1 });
    // ohne Pedal: Taste wird kurz vor dem nächsten Anschlag losgelassen, der Dämpfer stoppt den Ton
    const release = opts.pedal || k === hits.length - 1 ? Infinity : hits[k + 1][0] - 0.05;
    for (let i = Math.floor(start * RATE); i < total; i++) {
      const t = i / RATE - start;
      const damp = i / RATE > release ? Math.exp(-(i / RATE - release) * 25) : 1;
      s[i] += gain * velocity * voice(t) * Math.min(1, t / 0.004) * damp;
    }
  });
  return cutoff ? highpass(s, cutoff) : s;
}

const notes = [...new Set([...levelNotes('bass', 2), ...levelNotes('treble', 2)])];

function detectOne(note, opts) {
  const s = render([[0, note]], 0.4, opts);
  // Ausschnitte kurz nach dem Anschlag, wie die App sie sieht
  const results = [];
  for (const startMs of [40, 90, 140, 190]) {
    const from = Math.floor((startMs / 1000) * RATE);
    results.push(analyseFrame(s.subarray(from, from + FRAME), RATE).midi);
  }
  return results;
}

const CASES = [
  ['normaler Klavierklang übers Handy', {}],
  ['Grundton fehlt bei Bassnoten ganz (Handy-Mikrofon)', { fundamental: 0, cutoff: 180 }],
  ['starke Obertonspreizung (kleines Klavier)', { B: 0.0012 }],
  ['deutliche Schwebung (verstimmte Saitenchöre)', { detuneCents: 4 }],
  ['leise gespielt mit Rauschen und Brummen', { gain: 0.04, noiseLevel: 0.006, hum: 0.01 }],
];

for (const [name, opts] of CASES) {
  test(`realistisch: ${name} – alle 30 Noten oktavgenau`, () => {
    const wrong = [];
    for (const note of notes) {
      const got = detectOne(note, opts);
      const ok = got.filter((m) => m === midiNumber(note)).length;
      const bad = got.filter((m) => m !== null && m !== midiNumber(note));
      // mindestens 2 von 4 Ausschnitten richtig, keiner mit falscher Note
      if (ok < 2 || bad.length) wrong.push(`${note}: ${got.map((m) => (m === null ? '–' : noteFromMidi(m))).join(' ')}`);
    }
    assert.deepEqual(wrong, [], wrong.join(' | '));
  });
}

function listen(hits, seconds, opts) {
  const s = render(hits, seconds, opts);
  const listener = new NoteListener();
  const heard = [];
  for (let end = FRAME; end <= s.length; end += HOP) {
    const frame = analyseFrame(s.subarray(end - FRAME, end), RATE);
    const { rms, hf, midi } = frame;
    const got = listener.feed(rms, midi, (end / RATE) * 1000, hf, frame);
    if (got !== null) heard.push(noteFromMidi(got));
  }
  return heard;
}

test('realistisch: Noten nacheinander (Taste losgelassen)', () => {
  const heard = listen([[0.2, 'C4'], [0.9, 'D4'], [1.6, 'E4'], [2.3, 'G4'], [3.0, 'C5']], 4.2);
  assert.deepEqual(heard, ['C4', 'D4', 'E4', 'G4', 'C5']);
});

test('realistisch: mit Pedal – alte Töne klingen weiter: nie eine falsche Note, meist die richtige', () => {
  const played = ['C4', 'D4', 'E4', 'G4', 'C5'];
  const heard = listen(played.map((n, i) => [0.2 + 0.7 * i, n]), 4.2, { pedal: true });
  // Was erkannt wird, muss in der gespielten Reihenfolge stimmen; Mischklänge dürfen ausfallen
  let pos = 0;
  for (const n of heard) {
    pos = played.indexOf(n, pos);
    assert.ok(pos >= 0, `falsche Note erkannt: ${n} (gehört: ${heard.join(' ')})`);
    pos++;
  }
  assert.ok(heard.length >= 3, `zu wenig erkannt: ${heard.join(' ')}`);
});

test('realistisch: mit Pedal leise Note unter lauter – lieber nichts als eine falsche', () => {
  const heard = listen([[0.2, 'A3', 1], [1.6, 'B3', 0.35]], 3, { pedal: true });
  assert.ok(heard[0] === 'A3' && heard.slice(1).every((n) => n === 'B3'), heard.join(' '));
});

test('realistisch: gleiche Note zweimal hintereinander zählt zweimal', () => {
  assert.deepEqual(listen([[0.2, 'F3'], [1.4, 'F3']], 2.8), ['F3', 'F3']);
});

test('realistisch: Bassnoten bei fehlendem Grundton im Ablauf', () => {
  assert.deepEqual(listen([[0.2, 'C2'], [1.5, 'E2'], [2.8, 'G2']], 4.2, { fundamental: 0, cutoff: 180 }), ['C2', 'E2', 'G2']);
});

test('realistisch: leiser Anschlag nach lautem wird erkannt', () => {
  assert.deepEqual(listen([[0.2, 'A3', 1], [1.6, 'B3', 0.35]], 3), ['A3', 'B3']);
});

test('realistisch: nur Rauschen und Brummen – keine Fantasie-Noten', () => {
  assert.deepEqual(listen([], 4, { noiseLevel: 0.02, hum: 0.03 }), []);
});
