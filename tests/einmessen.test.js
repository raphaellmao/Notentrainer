// Einmessen: Stimmung des Klaviers bestimmen und bei der Erkennung herausrechnen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFrame } from '../js/pitch.js';
import { estimateTuning } from '../js/tuning.js';
import { frequency, midiNumber } from '../js/notes.js';

const RATE = 48000;
const FRAME = 4096;

// Klavierton (Obertöne mit Spreizung) als ein Messfenster kurz nach dem Anschlag
function frame(freq) {
  const buf = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = 0.06 + i / RATE;
    let v = 0;
    for (let n = 1; n <= 8; n++) v += (1 / n) * Math.sin(2 * Math.PI * freq * n * Math.sqrt(1 + 0.0004 * n * n) * t + n);
    buf[i] = 0.2 * v;
  }
  return buf;
}

// gemessene Frequenz eines Klaviertons, der um cents verstimmt ist
const measure = (note, cents) => analyseFrame(frame(frequency(note) * 2 ** (cents / 1200)), RATE).freq;

const WHITE = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

for (const offset of [0, -15, -35, -60, -85, 25, 70]) {
  test(`Einmessen: Klavier ${offset > 0 ? '+' : ''}${offset} Cent wird erkannt`, () => {
    // jede Taste etwas anders verstimmt (±6 Cent), wie bei einem echten Klavier
    const samples = WHITE.map((n, i) => measure(n, offset + ((i * 7) % 13) - 6));
    const t = estimateTuning(samples);
    // Anzeige auf etwa ±10 Cent genau (gespreizte Obertöne ziehen die Messung leicht nach oben)
    assert.ok(Math.abs(t.cents - offset) <= 10, `gemessen ${t.cents} statt ${offset}`);
    assert.deepEqual(t.notes.map((n) => n.note), WHITE, 'jede gespielte Taste richtig zugeordnet');
    if (Math.abs(offset) >= 40) assert.equal(t.rating, "deutlich");
    if (offset === 0) assert.notEqual(t.rating, "deutlich");
  });
}

test('Einmessen: mit gemessener Stimmung erkennt die App die Tasten wieder richtig', () => {
  const offset = -60; // Klavier über einen halben Halbton zu tief
  const samples = WHITE.map((n) => measure(n, offset));
  const { refA } = estimateTuning(samples);
  for (const note of ['C4', 'F4', 'B4', 'E5', 'A5']) {
    const buf = frame(frequency(note) * 2 ** (offset / 1200));
    assert.notEqual(analyseFrame(buf, RATE).midi, midiNumber(note), `${note} ohne Einmessen falsch (so soll der Test zeigen, warum es nötig ist)`);
    assert.equal(analyseFrame(buf, RATE, refA).midi, midiNumber(note), `${note} mit Einmessen richtig`);
  }
});

test('Einmessen: zu wenige Töne ergeben noch kein Ergebnis', () => {
  assert.equal(estimateTuning([440, 494]), null);
});

test('Einmessen: unterschiedlich verstimmte Töne werden als Streuung gemeldet', () => {
  const samples = WHITE.map((n, i) => measure(n, i % 2 ? 25 : -25));
  assert.ok(estimateTuning(samples).spread >= 20);
});

import { TuningSession, nearestNote } from '../js/tuning.js';

test('Einmessen: Live-Anzeige nutzt ab dem 2. Ton die laufende Schätzung', () => {
  const session = new TuningSession();
  const play = (note) => {
    const f = measure(note, -60);
    session.feed({ freq: f, clarity: 1 }, true);
    for (let i = 0; i < 5; i++) session.feed({ freq: f, clarity: 1 }, false);
    return f;
  };
  const f1 = play('C4');
  assert.equal(nearestNote(f1).note, 'B3', 'ohne Schätzung: zu tiefes c¹ sieht aus wie h');
  play('E4');
  play('G4');
  assert.equal(nearestNote(f1, session.refA).note, 'C4', 'mit Schätzung: c¹');
  assert.equal(session.samples.length, 3);
});
