// Beide Hände: Begleitung der linken Hand, Klaviersystem, Zusammenklänge, Takt und Klaviatur.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SONGS } from '../js/songs.js';
import { parseMelody, measureBeats, layoutScore, renderScoreLine, songEvents, songKeyboard } from '../js/score.js';
import { midiNumber, staffStep, isNatural, keyOf } from '../js/notes.js';
import { schedule } from '../js/rhythm.js';
import { Trainer } from '../js/trainer.js';
import { keysInRange } from '../js/notes.js';

const withLeft = SONGS.filter((s) => s.left);
const byId = (id) => SONGS.find((s) => s.id === id);

test('Begleitung: drei Lieder, Takte passen zur Melodie, nur Stammtöne bzw. Tonart, im Bassschlüssel C–c¹', () => {
  assert.ok(withLeft.length >= 3);
  for (const song of withLeft) {
    const right = parseMelody(song.melody);
    const left = parseMelody(song.left);
    assert.equal(left.length, right.length, `${song.id}: Taktzahl`);
    left.forEach((m, i) => assert.equal(m.reduce((s, n) => s + n.beats, 0), measureBeats(song.time), `${song.id} Takt ${i + 1} links`));
    for (const n of left.flat().filter((x) => !x.rest)) {
      assert.ok(midiNumber(n.note) >= midiNumber('C2') && midiNumber(n.note) <= midiNumber('C4'), `${song.id}: ${n.note}`);
    }
  }
});

test('Ereignisse: gleichzeitige Noten beider Hände bilden einen Zusammenklang (von Hand gezählt)', () => {
  const ev = songEvents(byId('entchen'));
  // Melodie 27 Noten; die linke Hand spielt nur auf der Eins jedes Takts, da spielt die Melodie auch
  assert.equal(ev.length, 27);
  assert.equal(ev.filter((e) => e.notes.length === 2).length, 10);
  assert.deepEqual(ev[0].notes.map((n) => n.note), ['C3', 'C4']); // tief → hoch
  assert.deepEqual(ev[0].notes.map((n) => n.clef), ['bass', 'treble']);
  assert.deepEqual(ev[1].notes.map((n) => n.note), ['D4']);
  assert.deepEqual(ev[4].notes.map((n) => n.note), ['E3', 'G4']); // Takt 2
  assert.equal(ev[4].at, 4);
  // Hänschen Takt 7: links c h, g h – das g fällt mit der dritten Viertel (g¹) zusammen
  const h = songEvents(byId('haenschen'));
  const bar7 = h.filter((e) => e.at >= 24 && e.at < 28);
  assert.deepEqual(bar7.map((e) => e.notes.map((n) => n.note).join('+')), ['C3+C4', 'E4', 'G3+G4', 'G4']);
});

test('Ereignisse: Hände einzeln', () => {
  const s = byId('jakob');
  assert.equal(songEvents(s, 'right').length, 32);
  assert.ok(songEvents(s, 'right').every((e) => e.notes.length === 1 && e.notes[0].clef === 'treble'));
  const left = songEvents(s, 'left');
  assert.equal(left.length, 16);
  assert.deepEqual(left.slice(0, 3).map((e) => [e.notes[0].note, e.at]), [['F3', 0], ['C3', 2], ['F3', 4]]);
  // Lied ohne Begleitung: „links“ gibt es nicht – dann die Melodie
  assert.equal(songEvents(byId('freude'), 'left').length, 62);
});

test('Klaviersystem: Zusammenklänge stehen genau übereinander, linke Hand im Bassschlüssel', () => {
  for (const song of withLeft) {
    const layout = layoutScore(song);
    assert.equal(layout.grand, true);
    const events = songEvents(song);
    const seen = new Set();
    for (const line of layout.lines) {
      for (const n of line.notes.filter((x) => x.index !== undefined)) {
        seen.add(n.index);
        const others = line.notes.filter((m) => m.index === n.index);
        assert.ok(others.every((m) => m.x === n.x), `${song.id}: Ereignis ${n.index} nicht übereinander`);
        assert.equal(n.step, staffStep(n.staff, n.note));
        assert.equal(n.staff, n.noteIndex !== undefined && parseMelody(song.left).flat().includes(n) ? 'bass' : n.staff);
      }
      // Notenköpfe in einem System überlappen nicht (mind. 12 Einheiten Abstand)
      for (const staff of ['treble', 'bass']) {
        const xs = line.notes.filter((n) => n.staff === staff).map((n) => n.x);
        for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 12, `${song.id} ${staff}: ${xs[i - 1]} / ${xs[i]}`);
      }
    }
    assert.equal(seen.size, events.length, `${song.id}: jedes Ereignis ist zu sehen`);
  }
});

test('Klaviersystem: nicht gespielte Hand ist blass und ohne Nummer', () => {
  const layout = layoutScore(byId('entchen'), 'right');
  const notes = layout.lines.flatMap((l) => l.notes);
  assert.ok(notes.filter((n) => n.staff === 'bass').every((n) => n.passive && n.index === undefined));
  assert.ok(notes.filter((n) => n.staff === 'treble').every((n) => !n.passive && Number.isInteger(n.index)));
  const svg = renderScoreLine(layout, 0, { states: { 0: 'right' }, current: 1 });
  assert.match(svg, /class="note passive" data-note="C3"/);
  assert.match(svg, /class="note right" data-note="C4"/);
});

const attr = (el, name) => Number(new RegExp(`${name}="([-\\d.]+)"`).exec(el)[1]);

test('Klaviersystem zeichnen: zwei Systeme mit Schlüssel, Klammer, Taktstriche durch beide, Text dazwischen', () => {
  const layout = layoutScore(byId('entchen'));
  const svg = renderScoreLine(layout, 0, { current: 0 });
  assert.match(svg, /<svg class="staff seq score grand"/);
  assert.equal((svg.match(/class="staff-block"/g) ?? []).length, 2);
  assert.match(svg, /data-clef="treble" transform="translate\(0 0\)"/);
  assert.match(svg, new RegExp(`data-clef="bass" transform="translate\\(0 ${layout.dyBass}\\)"`));
  assert.equal((svg.match(/<g class="clef" data-clef="(treble|bass)"/g) ?? []).length, 2);
  assert.match(svg, /class="brace"/);
  assert.equal((svg.match(/class="staff-line"/g) ?? []).length, 10);
  // Taktstriche von der obersten Linie oben (28) bis zur untersten unten (dy + 68)
  const bars = svg.match(/<line class="bar-line[^>]*>/g);
  assert.ok(bars.length >= 1);
  for (const b of bars) {
    assert.equal(attr(b, 'y1'), 28);
    assert.equal(attr(b, 'y2'), layout.dyBass + 68);
  }
  // Liedtext zwischen den Systemen: unter c¹-Hilfslinie oben (78), über dem oberen Rand unten
  const texts = svg.match(/<text class="lyric"[^>]*>/g);
  assert.ok(texts.length >= 4);
  for (const t of texts) assert.ok(attr(t, 'y') > 78 + 8 && attr(t, 'y') < layout.dyBass + 18 - 4, t);
  // Cursor umfasst beide Systeme
  const cur = /<rect class="cursor"[^>]*>/.exec(svg)[0];
  assert.ok(attr(cur, 'height') > layout.dyBass + 68 - 28);
  // Zusammenklang C3 + C4: gleiche x-Position, C3 im Bassschlüssel 2. Zwischenraum (Schritt 3), c¹ unten mit Hilfslinie
  const c3 = /data-note="C3" data-index="0" data-staff="bass"[^>]*translate\(([\d.]+) ([\d.]+)\)/.exec(svg);
  const c4 = /data-note="C4" data-index="0" data-staff="treble"[^>]*translate\(([\d.]+) ([\d.]+)\)/.exec(svg);
  assert.equal(c3[1], c4[1]);
  assert.equal(Number(c3[2]), 68 - 3 * 5);
  assert.equal(Number(c4[2]), 78);
});

test('Klaviatur für Lieder mit Begleitung: von C der tiefsten Oktave, mindestens zwei Oktaven', () => {
  assert.deepEqual(songKeyboard(byId('entchen')), ['C3', 'C5']);
  assert.deepEqual(songKeyboard(byId('jakob')), ['C3', 'E5']); // höchster Ton d²
  assert.deepEqual(songKeyboard(byId('freude')), ['C4', 'C6']); // ohne Begleitung wie bisher
  for (const song of withLeft) {
    const [lo, hi] = songKeyboard(song);
    const keys = keysInRange(lo, hi);
    for (const e of songEvents(song)) for (const n of e.notes) assert.ok(keys.includes(keyOf(n.note)), `${song.id}: ${n.note} fehlt`);
    assert.ok(keys.filter(isNatural).length <= 17, `${song.id}: zu viele Tasten fürs Handy`);
  }
});

test('Takt: Zusammenklänge sind ein Zeitpunkt, Hände einzeln wählbar', () => {
  const s = schedule(byId('entchen'), 1);
  assert.equal(s.notes.length, 27);
  assert.deepEqual(s.notes[0].notes, ['C3', 'C4']);
  assert.equal(s.notes[4].at, 4 * s.quarterMs);
  assert.equal(s.notes[0].durMs, 4 * s.quarterMs); // die ganze Note links bestimmt die Dauer
  assert.equal(schedule(byId('entchen'), 1, 'left').notes.length, 10);
  assert.equal(s.totalMs, 40 * s.quarterMs);
});

function songTrainer(song, hands = 'both') {
  const t = new Trainer({ storage: null, rng: () => 0.5 });
  t.configure('treble', 'lieder');
  t.startSong(songEvents(song, hands).map((e) => ({ clef: e.notes[0].clef, note: e.notes[0].note, notes: e.notes.length > 1 ? e.notes : undefined })));
  return t;
}

test('Zusammenklang antippen: beide Tasten nötig, Reihenfolge egal, doppelt tippen schadet nicht', () => {
  const t = songTrainer(byId('entchen'));
  let r = t.answer('C4', 500);
  assert.equal(r.partial, true);
  assert.deepEqual(r.missing.map((n) => n.note), ['C3']);
  r = t.answer('C4', 520);
  assert.equal(r.ignored, true);
  r = t.answer('C3', 600);
  assert.equal(r.correct, true);
  assert.equal(r.partial, undefined);
  assert.equal(t.progress.answered, 1);
  assert.deepEqual(r.notes, ['C3', 'C4']);
  // Statistik zählt jede Hand einzeln
  assert.equal(t.stats['bass:C3'].attempts, 1);
  assert.equal(t.stats['treble:C4'].attempts, 2 - 1);
});

test('Zusammenklang: falsche Taste beendet ihn als Fehler, fehlende Note wird genannt', () => {
  const t = songTrainer(byId('entchen'));
  t.answer('C3', 400);
  const r = t.answer('D3', 500);
  assert.equal(r.correct, false);
  assert.equal(r.item.note, 'C4');
  assert.equal(r.item.clef, 'treble');
  assert.deepEqual(r.missing.map((n) => n.note), ['C4']);
  assert.equal(t.progress.answered, 1);
  t.advance();
  assert.equal(t.answer('D4', 300).correct, true); // nächstes Ereignis ist eine Einzelnote
});

test('Zusammenklang mit Mikrofon: ein erkannter Ton genügt', () => {
  const t = songTrainer(byId('entchen'));
  const r = t.answer('C4', 400, { anyOf: true });
  assert.equal(r.correct, true);
  assert.equal(r.partial, undefined);
});

test('Nur linke Hand: Runde so lang wie die Begleitung, Noten im Bassschlüssel', () => {
  const t = songTrainer(byId('haenschen'), 'left');
  assert.equal(t.progress.total, 18);
  assert.equal(t.current.clef, 'bass');
  assert.equal(t.answer('C3', 300).correct, true);
});
