// Übungslogik: Notenvorrat, adaptive Auswahl, Statistik, Runden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPool, pickNext, recordAnswer, summarize, itemKey, Trainer, ROUND_LENGTH, STATS_KEY } from '../js/trainer.js';

// Reproduzierbarer Zufall
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}

// Statistik, in der alle Noten gut sitzen (5× richtig, 1,5 s)
function practiced(pool) {
  const stats = {};
  for (const it of pool) for (let i = 0; i < 5; i++) recordAnswer(stats, it, true, 1500);
  return stats;
}

function countPicks(pool, stats, n, seed) {
  const rng = seeded(seed);
  const counts = new Map();
  let prev = null;
  for (let i = 0; i < n; i++) {
    prev = pickNext(pool, stats, prev, rng);
    counts.set(itemKey(prev), (counts.get(itemKey(prev)) || 0) + 1);
  }
  return counts;
}

test('Notenvorrat je Schlüssel und Stufe', () => {
  assert.equal(buildPool('treble', 1).length, 11);
  assert.equal(buildPool('treble', 2).length, 15);
  assert.equal(buildPool('bass', 1).length, 11);
  assert.equal(buildPool('bass', 2).length, 15);
  const mixed = buildPool('mixed', 2);
  assert.equal(mixed.length, 30);
  assert.deepEqual([...new Set(mixed.map((it) => it.clef))].sort(), ['bass', 'treble']);
});

test('nie zweimal dieselbe Note hintereinander', () => {
  for (const mode of ['treble', 'bass', 'mixed']) {
    for (const level of [1, 2]) {
      const pool = buildPool(mode, level);
      const stats = practiced(pool);
      // eine Note extrem schwer machen, damit die Auswahl sie ständig wiederholen „möchte“
      for (let i = 0; i < 10; i++) recordAnswer(stats, pool[0], false, 9000);
      const rng = seeded(7);
      let prev = null;
      for (let i = 0; i < 3000; i++) {
        const next = pickNext(pool, stats, prev, rng);
        if (prev) assert.notEqual(next.note, prev.note, `${mode}/${level}: ${next.note} zweimal hintereinander`);
        prev = next;
      }
    }
  }
});

test('oft falsch beantwortete Noten kommen häufiger dran', () => {
  const pool = buildPool('treble', 2);
  const stats = practiced(pool);
  const hard = pool.find((it) => it.note === 'A5');
  for (let i = 0; i < 3; i++) recordAnswer(stats, hard, false, 1500);
  const counts = countPicks(pool, stats, 20000, 1);
  const others = pool.filter((it) => it !== hard).map((it) => counts.get(itemKey(it)) || 0);
  const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
  assert.ok(counts.get(itemKey(hard)) > 2 * avgOthers, `A5: ${counts.get(itemKey(hard))} vs. Schnitt ${avgOthers}`);
});

test('langsam beantwortete Noten kommen häufiger dran', () => {
  const pool = buildPool('bass', 1);
  const stats = practiced(pool);
  const slow = pool.find((it) => it.note === 'D3');
  for (let i = 0; i < 4; i++) recordAnswer(stats, slow, true, 5000);
  const counts = countPicks(pool, stats, 20000, 2);
  const others = pool.filter((it) => it !== slow).map((it) => counts.get(itemKey(it)) || 0);
  const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
  assert.ok(counts.get(itemKey(slow)) > 1.5 * avgOthers, `D3: ${counts.get(itemKey(slow))} vs. Schnitt ${avgOthers}`);
});

test('noch nie geübte Noten werden eingeführt', () => {
  const pool = buildPool('treble', 2);
  const stats = practiced(pool);
  const fresh = pool.find((it) => it.note === 'C6');
  delete stats[itemKey(fresh)];
  const counts = countPicks(pool, stats, 10000, 3);
  assert.ok(counts.get(itemKey(fresh)) > 10000 / pool.length, 'neue Note überdurchschnittlich oft');
});

test('Statistik: Versuche, Fehler und Antwortzeit pro Note', () => {
  const stats = {};
  const item = { clef: 'bass', note: 'F3' };
  recordAnswer(stats, item, true, 1200);
  recordAnswer(stats, item, false, 3000);
  recordAnswer(stats, item, true, 60000); // wird für die Statistik auf 10 s gedeckelt
  const s = stats['bass:F3'];
  assert.equal(s.attempts, 3);
  assert.equal(s.errors, 1);
  assert.equal(s.totalMs, 1200 + 3000 + 10000);
  assert.ok(s.emaErr > 0 && s.emaErr < 1);
});

test('Runde mit 20 Noten und Zusammenfassung', () => {
  const storage = memoryStorage();
  const trainer = new Trainer({ storage, rng: seeded(11) });
  trainer.configure('mixed', 2);
  assert.equal(ROUND_LENGTH, 20);
  const wrongAt = new Set([2, 5, 9]);
  let last;
  for (let i = 0; i < 20; i++) {
    const item = trainer.next();
    const tapped = wrongAt.has(i) ? (item.note === 'C4' ? 'D4' : 'C4') : item.note;
    last = trainer.answer(tapped, 1000 + i * 100);
    assert.equal(last.done, i === 19);
  }
  const sum = trainer.summary();
  assert.equal(sum.total, 20);
  assert.equal(sum.correct, 17);
  assert.equal(sum.rate, 0.85);
  assert.equal(sum.avgMs, 1000 + 9.5 * 100);
  assert.equal(sum.wrong.reduce((a, w) => a + w.count, 0), 3);

  // Statistik liegt im Speicher und wird beim nächsten Start wieder geladen
  const saved = JSON.parse(storage.getItem(STATS_KEY));
  assert.equal(Object.values(saved).reduce((a, s) => a + s.attempts, 0), 20);
  const again = new Trainer({ storage });
  assert.deepEqual(again.stats, saved);
});

test('schwarze Taste zählt als falsch', () => {
  const trainer = new Trainer({ rng: seeded(5) });
  trainer.configure('treble', 1);
  const item = trainer.next();
  const res = trainer.answer(item.note === 'F4' ? 'F#4' : 'C#4', 800);
  assert.equal(res.correct, false);
});

test('Zusammenfassung fasst gleiche falsche Noten zusammen', () => {
  const a = { clef: 'treble', note: 'A5' };
  const b = { clef: 'bass', note: 'E2' };
  const sum = summarize([
    { item: a, tapped: 'G5', correct: false, ms: 2000 },
    { item: b, tapped: 'E2', correct: true, ms: 1000 },
    { item: a, tapped: 'B5', correct: false, ms: 3000 },
  ]);
  assert.deepEqual(sum.wrong, [{ clef: 'treble', note: 'A5', count: 2 }]);
  assert.equal(sum.avgMs, 2000);
});

test('lange Pause verzerrt den Rundenschnitt nicht', () => {
  const item = { clef: 'treble', note: 'C5' };
  const sum = summarize([
    { item, tapped: 'C5', correct: true, ms: 120000 }, // App zwei Minuten liegen gelassen
    { item, tapped: 'C5', correct: true, ms: 2000 },
  ]);
  assert.equal(sum.avgMs, (10000 + 2000) / 2);
});

test('kaputter Speicher bricht nichts', () => {
  const storage = { getItem: () => '{kaputt', setItem: () => { throw new Error('voll'); } };
  const trainer = new Trainer({ storage });
  trainer.configure('bass', 2);
  trainer.next();
  assert.doesNotThrow(() => trainer.answer('C2', 500));
});

// --- Aufbau mit Leitnoten und Übersicht ---

import { AUFBAU_ORDER, AUFBAU_START, AUFBAU_KEY, mastery, readyToUnlock, noteOverview } from '../js/trainer.js';
import { levelNotes } from '../js/notes.js';

test('Aufbau: Reihenfolge enthält jede Note genau einmal und beginnt mit den Leitnoten', () => {
  assert.deepEqual(AUFBAU_ORDER.treble.slice(0, 4), ['C4', 'G4', 'C5', 'G5']); // c¹ g¹ c² g²
  assert.deepEqual(AUFBAU_ORDER.bass.slice(0, 4), ['C4', 'F3', 'C3', 'F2']); // c¹ f c F
  for (const clef of ['treble', 'bass']) {
    assert.deepEqual([...AUFBAU_ORDER[clef]].sort(), [...levelNotes(clef, 2)].sort(), clef);
  }
});

test('Aufbau: Start mit vier Leitnoten je Schlüssel', () => {
  assert.equal(buildPool('treble', 'aufbau', {}).length, AUFBAU_START);
  assert.equal(buildPool('mixed', 'aufbau', { treble: 6, bass: 4 }).length, 10);
});

test('Einstufung: neu, üben, wackelt, sitzt', () => {
  const stats = {};
  const it = { clef: 'treble', note: 'G4' };
  assert.equal(mastery(stats['treble:G4']), 'neu');
  recordAnswer(stats, it, false, 2000);
  recordAnswer(stats, it, false, 2000);
  assert.equal(mastery(stats['treble:G4']), 'ueben');
  for (let i = 0; i < 6; i++) recordAnswer(stats, it, true, 1500);
  assert.equal(mastery(stats['treble:G4']), 'sitzt');
  for (let i = 0; i < 6; i++) recordAnswer(stats, it, true, 6000); // richtig, aber langsam
  assert.equal(mastery(stats['treble:G4']), 'wackelt');
});

test('Aufbau: schaltet erst frei, wenn alle Leitnoten sitzen – und dann paarweise', () => {
  const storage = memoryStorage();
  const trainer = new Trainer({ storage, rng: seeded(21) });
  trainer.configure('treble', 'aufbau');
  const seen = new Set();
  let unlockedAt = null;
  for (let i = 0; i < 200 && unlockedAt === null; i++) {
    const item = trainer.next();
    seen.add(item.note);
    const res = trainer.answer(item.note, 1200);
    if (res.unlocked.length) unlockedAt = res.unlocked.map((u) => u.note);
  }
  assert.deepEqual([...seen].sort(), ['C4', 'C5', 'G4', 'G5'], 'vorher nur Leitnoten');
  assert.deepEqual(unlockedAt, ['F4', 'A4'], 'dann f¹ und a¹');
  assert.equal(trainer.pool.length, 6);
  assert.equal(JSON.parse(storage.getItem(AUFBAU_KEY)).treble, 6, 'Fortschritt gespeichert');
  assert.equal(new Trainer({ storage }).unlocked.treble, 6, 'und wieder geladen');
});

test('Aufbau: keine Freischaltung, solange eine Note auf „üben“ steht', () => {
  const stats = {};
  for (const note of AUFBAU_ORDER.bass.slice(0, 4)) for (let i = 0; i < 5; i++) recordAnswer(stats, { clef: 'bass', note }, true, 1000);
  assert.equal(readyToUnlock('bass', 4, stats), true);
  recordAnswer(stats, { clef: 'bass', note: 'F2' }, false, 1000);
  recordAnswer(stats, { clef: 'bass', note: 'F2' }, false, 1000);
  assert.equal(mastery(stats['bass:F2']), 'ueben');
  assert.equal(readyToUnlock('bass', 4, stats), false);
});

test('Aufbau: läuft bis alle 15 Noten frei sind und nicht darüber hinaus', () => {
  const trainer = new Trainer({ rng: seeded(3) });
  trainer.configure('bass', 'aufbau');
  for (let i = 0; i < 3000; i++) trainer.answer(trainer.next().note, 1000);
  assert.equal(trainer.unlocked.bass, 15);
  assert.equal(trainer.pool.length, 15);
});

test('Übersicht: Status, Quote, Zeit und Sperre je Note', () => {
  const stats = {};
  recordAnswer(stats, { clef: 'treble', note: 'C4' }, true, 1000);
  recordAnswer(stats, { clef: 'treble', note: 'C4' }, false, 3000);
  const ov = noteOverview('treble', stats, 4);
  assert.equal(ov.length, 15);
  const c4 = ov.find((o) => o.note === 'C4');
  assert.equal(c4.attempts, 2);
  assert.equal(c4.rate, 0.5);
  assert.equal(c4.avgMs, 2000);
  assert.equal(c4.locked, false);
  assert.equal(ov.find((o) => o.note === 'D4').locked, true);
  assert.equal(ov.find((o) => o.note === 'D4').status, 'neu');
});

// --- Stufe 3: Notenfolgen ---

import { pickSequence, SEQUENCE_LENGTH } from '../js/trainer.js';
import { diatonicIndex } from '../js/notes.js';

test('Folgen: 5 Noten, ein Schlüssel, kleine Schritte, nie dieselbe Note hintereinander', () => {
  for (const mode of ['treble', 'bass', 'mixed']) {
    const pool = buildPool(mode, 'folgen');
    assert.equal(pool.length, mode === 'mixed' ? 30 : 15, 'voller Vorrat von Stufe 2');
    const rng = seeded(31);
    let prev = null;
    for (let k = 0; k < 400; k++) {
      const seq = pickSequence(pool, {}, prev, SEQUENCE_LENGTH, rng);
      assert.equal(seq.length, 5);
      assert.equal(new Set(seq.map((it) => it.clef)).size, 1, 'ein Schlüssel pro Folge');
      for (let i = 0; i < seq.length; i++) {
        assert.ok(pool.some((p) => p.clef === seq[i].clef && p.note === seq[i].note), 'aus dem Vorrat');
        const before = i === 0 ? prev : seq[i - 1];
        if (before) assert.notEqual(seq[i].note, before.note, 'nie zweimal hintereinander (auch über Folgen hinweg)');
        if (i > 0) assert.ok(Math.abs(diatonicIndex(seq[i].note) - diatonicIndex(seq[i - 1].note)) <= 4, 'höchstens eine Quinte');
      }
      prev = seq[seq.length - 1];
    }
  }
});

test('Folgen: schwache Noten kommen häufiger vor', () => {
  const pool = buildPool('treble', 'folgen');
  const stats = practiced(pool);
  const hard = pool.find((it) => it.note === 'E5');
  for (let i = 0; i < 3; i++) recordAnswer(stats, hard, false, 1500);
  const rng = seeded(8);
  const counts = new Map();
  let prev = null;
  for (let k = 0; k < 3000; k++) {
    const seq = pickSequence(pool, stats, prev, 5, rng);
    for (const it of seq) counts.set(it.note, (counts.get(it.note) || 0) + 1);
    prev = seq[4];
  }
  const avg = [...counts.values()].reduce((a, b) => a + b, 0) / counts.size;
  assert.ok(counts.get('E5') > 1.5 * avg, `e²: ${counts.get('E5')} vs. Schnitt ${avg.toFixed(0)}`);
});

test('Folgen: Runde mit 20 Noten = 4 Folgen, jede Note zählt einzeln', () => {
  const trainer = new Trainer({ rng: seeded(12) });
  trainer.configure('mixed', 'folgen');
  assert.equal(trainer.isSequence, true);
  let sequences = 0;
  let res;
  do {
    const seq = trainer.nextSequence();
    sequences++;
    for (let i = 0; i < seq.length; i++) {
      assert.equal(trainer.current, seq[i]);
      res = trainer.answer(i === 2 ? 'C#4' : seq[i].note, 900);
      trainer.advance();
    }
    assert.equal(trainer.current, null, 'nach der letzten Note ist die Folge zu Ende');
  } while (!res.done);
  assert.equal(sequences, 4);
  const sum = trainer.summary();
  assert.equal(sum.total, 20);
  assert.equal(sum.correct, 16);
});

import { accidentalNotes } from '../js/trainer.js';
import { isNatural } from '../js/notes.js';

test('Stufe „Vorzeichen“: Stammtöne plus Kreuz- und b-Noten, nur übliche Schreibweisen', () => {
  const treble = accidentalNotes('treble');
  assert.ok(treble.includes('F#4') && treble.includes('Gb4') && treble.includes('Bb4') && treble.includes('Eb5') && treble.includes('D4'));
  for (const bad of ['E#4', 'B#4', 'Cb5', 'Fb4']) assert.ok(!treble.includes(bad), bad);
  const withSign = treble.filter((n) => !isNatural(n)).length;
  assert.ok(withSign / treble.length > 0.55, 'überwiegend Noten mit Zeichen');
  assert.equal(buildPool('mixed', 'vorzeichen').length, treble.length + accidentalNotes('bass').length);
});
