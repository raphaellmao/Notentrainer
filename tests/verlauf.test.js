// Übungsverlauf: Tage zählen, Wochenvergleich, Aufräumen, Säulenbild.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, recordNote, recordRound, lastDays, weekSummary, loadHistory, saveHistory, renderHistoryChart, prune, HISTORY_KEY, KEEP_DAYS } from '../js/history.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const at = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h);

test('Tag in Ortszeit, auch kurz vor Mitternacht', () => {
  assert.equal(dayKey(at(2026, 11, 26, 23)), '2026-11-26');
  assert.equal(dayKey(at(2026, 1, 5, 0)), '2026-01-05');
});

test('Noten und Runden je Tag zählen, Antwortzeit höchstens 10 s', () => {
  const h = {};
  recordNote(h, true, 1200, at(2026, 11, 26));
  recordNote(h, false, 2500, at(2026, 11, 26));
  recordNote(h, true, 60000, at(2026, 11, 26)); // Handy weggelegt: zählt nur 10 s
  recordRound(h, at(2026, 11, 26));
  recordNote(h, true, 800, at(2026, 11, 27, 0));
  assert.deepEqual(h['2026-11-26'], { notes: 3, right: 2, ms: 13700, rounds: 1 });
  assert.deepEqual(h['2026-11-27'], { notes: 1, right: 1, ms: 800, rounds: 0 });
});

test('letzte 14 Tage mit Lücken, ältester zuerst, heute markiert', () => {
  const h = {};
  recordNote(h, true, 1000, at(2026, 11, 20));
  recordNote(h, true, 1000, at(2026, 11, 26));
  const days = lastDays(h, 14, at(2026, 11, 26));
  assert.equal(days.length, 14);
  assert.equal(days[0].day, '2026-11-13');
  assert.equal(days[13].day, '2026-11-26');
  assert.equal(days[13].today, true);
  assert.equal(days[13].weekday, 'Do'); // 26.11.2026 ist ein Donnerstag
  assert.equal(days[7].notes, 1); // 20.11.
  assert.equal(days.filter((d) => d.notes).length, 2);
});

test('Monatswechsel und Zeitumstellung (29.03.2026) ohne doppelte oder fehlende Tage', () => {
  const days = lastDays({}, 10, at(2026, 4, 2));
  assert.deepEqual(days.map((d) => d.day), ['2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']);
});

test('Wochenvergleich: letzte 7 Tage gegen die 7 davor', () => {
  const h = {};
  for (let i = 0; i < 10; i++) recordNote(h, i < 9, 3000, at(2026, 11, 26)); // diese Woche 9/10
  for (let i = 0; i < 10; i++) recordNote(h, i < 6, 3000, at(2026, 11, 24)); // diese Woche
  for (let i = 0; i < 20; i++) recordNote(h, i < 14, 3000, at(2026, 11, 15)); // Vorwoche 14/20
  const s = weekSummary(h, at(2026, 11, 26));
  assert.equal(s.week.notes, 20);
  assert.equal(s.week.right, 15);
  assert.equal(s.week.rate, 0.75);
  assert.equal(s.week.active, 2);
  assert.equal(s.week.minutes, 1); // 20 × 3 s
  assert.equal(s.previous.notes, 20);
  assert.equal(s.previous.rate, 0.7);
  assert.equal(s.total.notes, 40);
  assert.equal(s.first, '2026-11-15');
  assert.equal(weekSummary({}, at(2026, 11, 26)).week.rate, null);
});

test('alte Tage werden nach gut einem Jahr verworfen', () => {
  const h = { '2025-01-01': { notes: 5, right: 5, ms: 0, rounds: 1 }, '2026-11-01': { notes: 1, right: 1, ms: 0, rounds: 0 } };
  prune(h, at(2026, 11, 26));
  assert.deepEqual(Object.keys(h), ['2026-11-01']);
  assert.ok(KEEP_DAYS >= 365);
});

test('Speichern und Laden; kaputte Einträge werden übergangen', () => {
  const s = memory();
  const h = {};
  recordNote(h, true, 1000, at(2026, 11, 26));
  assert.equal(saveHistory(s, h), true);
  assert.deepEqual(loadHistory(s), h);
  s.setItem(HISTORY_KEY, JSON.stringify({ '2026-11-26': { notes: 2, right: 1, ms: 5, rounds: 0 }, kaputt: { notes: 1 }, '2026-11-25': { notes: 1, right: 3, ms: 0, rounds: 0 } }));
  assert.deepEqual(Object.keys(loadHistory(s)), ['2026-11-26']);
  s.setItem(HISTORY_KEY, '{nicht json');
  assert.deepEqual(loadHistory(s), {});
  assert.deepEqual(loadHistory(null), {});
});

test('Säulenbild: eine Säule je Tag, Höhe passt zur Notenzahl, grüner Teil = richtig', () => {
  const h = {};
  for (let i = 0; i < 40; i++) recordNote(h, i < 30, 1000, at(2026, 11, 26));
  for (let i = 0; i < 20; i++) recordNote(h, true, 1000, at(2026, 11, 25));
  const svg = renderHistoryChart(lastDays(h, 14, at(2026, 11, 26)));
  assert.equal((svg.match(/<g class="day/g) ?? []).length, 14);
  assert.equal((svg.match(/class="bar-none"/g) ?? []).length, 12);
  const hOf = (cls, day) => Number(new RegExp(`data-day="${day}"[^]*?class="${cls}"[^>]*height="([\\d.]+)"`).exec(svg)[1]);
  assert.equal(hOf('bar-all', '2026-11-26'), 82); // höchste Säule = volle Höhe (96 − 14)
  assert.equal(hOf('bar-right', '2026-11-26'), 61.5); // 30 von 40
  assert.equal(hOf('bar-all', '2026-11-25'), 41); // halb so viele Noten
  assert.match(svg, /class="day today" data-day="2026-11-26"/);
  assert.match(svg, /<title>Do 26\.: 40 Noten, 30 richtig<\/title>/);
});
