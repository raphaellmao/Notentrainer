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
