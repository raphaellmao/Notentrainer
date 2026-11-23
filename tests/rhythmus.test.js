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
