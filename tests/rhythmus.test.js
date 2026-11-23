// Rhythmus: Zeitplan und Bewertung

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, judge, tolerance, missedAfter, metronomeBeat, summarizeRhythm } from '../js/rhythm.js';
import { SONGS } from '../js/songs.js';

test('Zeitplan: „Alle meine Entchen“ bei Tempo 100 (Viertel = 600 ms)', () => {
  const s = schedule(SONGS.find((x) => x.id === 'entchen'));
  assert.equal(s.quarterMs, 600);
  // c d e f (Viertel) | g g (Halbe) | a a a a | g (Ganze)
  assert.deepEqual(s.notes.slice(0, 11).map((n) => n.at), [0, 600, 1200, 1800, 2400, 3600, 4800, 5400, 6000, 6600, 7200]);
  assert.equal(s.notes[10].durMs, 2400);
  assert.equal(s.totalMs, 10 * 2400);
  assert.equal(s.perBar, 4);
});

test('Zeitplan: Pausen, Punktierungen, Achtel und Haltebögen', () => {
  const s = schedule({ melody: 'C4q. D4e zq E4q | F4h- F4q G4q', time: [4, 4], tempo: 120 }); // Viertel = 500 ms
  assert.deepEqual(s.notes.map((n) => [n.note, n.at, n.durMs]), [
    ['C4', 0, 750],
    ['D4', 750, 250],
    ['E4', 1500, 500],
    ['F4', 2000, 1500], // Halbe + Viertel durch Haltebogen
    ['G4', 3500, 500],
  ]);
});

test('Langsameres Tempo dehnt alles gleichmäßig', () => {
  const song = SONGS.find((x) => x.id === 'jakob');
  const normal = schedule(song);
  const slow = schedule(song, 0.5);
  slow.notes.forEach((n, i) => assert.equal(n.at, normal.notes[i].at * 2));
});

test('Metronom: Schlag je Taktart', () => {
  assert.deepEqual(metronomeBeat([4, 4]), { beatQuarters: 1, perBar: 4 });
  assert.deepEqual(metronomeBeat([3, 4]), { beatQuarters: 1, perBar: 3 });
  assert.deepEqual(metronomeBeat([6, 8]), { beatQuarters: 1.5, perBar: 2 });
  assert.deepEqual(metronomeBeat([2, 2]), { beatQuarters: 2, perBar: 2 });
  assert.deepEqual(metronomeBeat([3, 8]), { beatQuarters: 0.5, perBar: 3 });
});

test('Bewertung: im Takt, zu früh, zu spät – Spielraum hängt vom Tempo ab', () => {
  assert.equal(tolerance(600), 120);
  assert.equal(tolerance(300), 90, 'mindestens 90 ms');
  assert.equal(tolerance(1500), 180, 'höchstens 180 ms');
  assert.equal(judge(0, 600), 'ok');
  assert.equal(judge(-110, 600), 'ok');
  assert.equal(judge(-130, 600), 'early');
  assert.equal(judge(200, 600), 'late');
});

test('Verpasst: nach dem Spielraum, bei langen Noten bis zur Hälfte ihrer Dauer', () => {
  assert.equal(missedAfter({ at: 1000, durMs: 200 }, 600), 1120, 'kurze Note: Spielraum');
  assert.equal(missedAfter({ at: 1000, durMs: 300 }, 600), 1150, 'halbe Notenlänge ist größer als der Spielraum');
  assert.equal(missedAfter({ at: 1000, durMs: 2400 }, 600), 2200);
});

test('Zusammenfassung', () => {
  const r = summarizeRhythm([
    { timing: 'ok', delta: 20 },
    { timing: 'early', delta: -200 },
    { timing: 'late', delta: 300 },
    { timing: 'missed', delta: null },
  ]);
  assert.deepEqual(r, { total: 4, ok: 1, early: 1, late: 1, missed: 1, avgAbsMs: 173 });
});

import { estimateOffset, cleanOffsets, systematicShift, SYNC } from '../js/rhythm.js';

test('Takt-Abgleich: gleichmäßig 120 ms zu spät → Verzögerung 120 ms, gleichmäßig', () => {
  const clicks = Array.from({ length: 12 }, (_, k) => 1000 + k * 600);
  const jitter = [5, -8, 12, -3, 0, 7, -10, 4, -6, 9, -2, 3];
  const r = estimateOffset(clicks.map((c, k) => c + 120 + jitter[k]), clicks, 600);
  assert.equal(r.count, 12);
  assert.ok(Math.abs(r.offset - 121) <= 2, String(r.offset));
  assert.ok(r.steady && r.spread < 10);
});

test('Takt-Abgleich: Ausreißer, Doppeltipper und Tipps beim Einzählen verfälschen nichts', () => {
  const clicks = Array.from({ length: 12 }, (_, k) => 3000 + k * 600);
  const taps = clicks.map((c) => c - 40);
  taps.push(1000, 1600, 2200); // beim Einzählen (keine gemessenen Klicks) – zu weit weg
  taps.push(clicks[3] + 200); // Doppeltipper: zählt nicht, der nähere gewinnt
  taps[5] = clicks[5] + 250; // ein Ausreißer
  const r = estimateOffset(taps, clicks, 600);
  assert.equal(r.offset, -40);
  assert.equal(r.count, 12);
});

test('Takt-Abgleich: zu wenige Tipps → kein Ergebnis; Unregelmäßigkeit wird erkannt; Grenze ±300 ms', () => {
  const clicks = Array.from({ length: 12 }, (_, k) => k * 600);
  assert.equal(estimateOffset(clicks.slice(0, SYNC.min - 1).map((c) => c + 50), clicks, 600), null);
  const wild = estimateOffset(clicks.map((c, k) => c + (k % 2 ? 160 : -120)), clicks, 600);
  assert.equal(wild.steady, false);
  const slow = Array.from({ length: 12 }, (_, k) => k * 1000); // langsamer Klick, damit 330 ms noch eindeutig sind
  const far = estimateOffset(slow.map((c) => c + 330), slow, 1000);
  assert.equal(far.offset, 300);
});

test('Takt-Abgleich: gespeicherte Werte werden geprüft', () => {
  assert.deepEqual(cleanOffsets({ touch: 80.4, mic: -999 }), { touch: 80, mic: 0 });
  assert.deepEqual(cleanOffsets(null), { touch: 0, mic: 0 });
  assert.deepEqual(cleanOffsets({ touch: 'x', mic: 150 }), { touch: 0, mic: 150 });
});

test('Hinweis auf Verzögerung nur bei gleichmäßiger Verschiebung', () => {
  const late = Array.from({ length: 10 }, (_, k) => ({ timing: 'late', delta: 150 + (k % 3) * 10 }));
  assert.equal(systematicShift(late, 600), 160);
  const mixed = Array.from({ length: 10 }, (_, k) => ({ timing: 'ok', delta: k % 2 ? 120 : -110 }));
  assert.equal(systematicShift(mixed, 600), 0);
  const fine = Array.from({ length: 10 }, () => ({ timing: 'ok', delta: 30 }));
  assert.equal(systematicShift(fine, 600), 0);
  assert.equal(systematicShift(late.slice(0, 4), 600), 0);
});
