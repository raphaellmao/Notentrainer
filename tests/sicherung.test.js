// Lernstand sichern und wiederherstellen

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parseBackup, restoreBackup, undoRestore, hasSafetyCopy, SAFETY_KEY, backupFileName } from '../js/backup.js';

// localStorage-Ersatz
function store(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

const STATS = JSON.stringify({ 'treble:C4': { attempts: 5, errors: 1, totalMs: 6000, emaErr: 0.2, emaMs: 1100 }, 'bass:F3': { attempts: 2, errors: 0, totalMs: 2000, emaErr: 0.3, emaMs: 900 } });
const phone = () =>
  store({
    'notentrainer.statistik.v1': STATS,
    'notentrainer.aufbau.v1': JSON.stringify({ treble: 8, bass: 4 }),
    'notentrainer.einstellungen.v1': JSON.stringify({ mode: 'treble', level: 'lieder', sound: true, refA: 431.2, song: 'imp-x' }),
    'notentrainer.lieder.v1': JSON.stringify([{ id: 'imp-x', title: 'Mein Lied', melody: 'C4q D4q E4h', time: [4, 4] }]),
    'andere.app': 'bleibt unberührt',
  });

test('Sicherung enthält alle App-Daten, aber keine fremden Daten', () => {
  const file = JSON.parse(createBackup(phone(), new Date('2026-11-22T10:00:00Z')));
  assert.equal(file.format, 'notentrainer-lernstand');
  assert.equal(file.savedAt, '2026-11-22T10:00:00.000Z');
  assert.deepEqual(Object.keys(file.data), ['notentrainer.aufbau.v1', 'notentrainer.einstellungen.v1', 'notentrainer.lieder.v1', 'notentrainer.statistik.v1']);
  assert.equal(backupFileName(new Date('2026-11-22T10:00:00Z')), 'notentrainer-lernstand-2026-11-22.json');
});

test('Wiederherstellen auf neuem Handy ergibt genau den alten Stand', () => {
  const backup = createBackup(phone());
  const neu = store({ 'andere.app': 'fremd' });
  const { data, summary } = parseBackup(backup);
  assert.deepEqual(summary, { notes: 2, attempts: 7, songs: 1 });
  restoreBackup(neu, data);
  for (const [k, v] of Object.entries(phone().dump())) if (k.startsWith('notentrainer.')) assert.equal(neu.getItem(k), v, k);
  assert.equal(neu.getItem('andere.app'), 'fremd', 'fremde Daten unberührt');
});

test('Vor dem Wiederherstellen wird der bisherige Stand gesichert und lässt sich zurückholen', () => {
  const handy = phone();
  const vorher = handy.dump();
  const alt = store({ 'notentrainer.statistik.v1': JSON.stringify({ 'treble:G4': { attempts: 1, errors: 1, totalMs: 900, emaErr: 0.6, emaMs: 900 } }) });
  restoreBackup(handy, parseBackup(createBackup(alt)).data);
  assert.equal(handy.getItem('notentrainer.lieder.v1'), null, 'ersetzt, nicht gemischt');
  assert.ok(hasSafetyCopy(handy));
  assert.ok(undoRestore(handy));
  assert.deepEqual(handy.dump(), vorher, 'exakt der Stand von vorher');
  assert.equal(handy.getItem(SAFETY_KEY), null);
});

test('Falsche oder beschädigte Dateien werden mit verständlicher Meldung abgelehnt', () => {
  assert.throws(() => parseBackup('Hallo'), /keine Lernstand-Sicherung/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'etwas', data: {} })), /keine Lernstand-Sicherung des Notentrainers/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'notentrainer-lernstand', version: 9, data: {} })), /neueren App-Version/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'notentrainer-lernstand', version: 1, data: { 'notentrainer.statistik.v1': '{kaputt' } })), /beschädigt/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'notentrainer-lernstand', version: 1, data: { 'fremd.key': '{}' } })), /keine Daten/);
});
