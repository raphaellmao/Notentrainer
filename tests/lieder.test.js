// Stufe 4 (Lieder): Liederbuch gültig, Notensatz korrekt.
// Positionen werden gegen eine eigene, von Hand eingetragene Tabelle geprüft (nicht aus dem Code).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SONGS } from '../js/songs.js';
import { parseMelody, measureBeats, layoutScore, renderScoreLine } from '../js/score.js';
import { diatonicIndex } from '../js/notes.js';

// Violinschlüssel: Position jeder Note (Linien von unten e¹ g¹ h¹ d² f²)
const POSITION = {
  C4: 'Hilfslinie 1 unten', D4: 'unter Linie 1', E4: 'Linie 1', F4: 'Zwischenraum 1', G4: 'Linie 2',
  A4: 'Zwischenraum 2', B4: 'Linie 3', C5: 'Zwischenraum 3', D5: 'Linie 4', E5: 'Zwischenraum 4',
  F5: 'Linie 5', G5: 'über Linie 5', A5: 'Hilfslinie 1 oben', B5: 'über Hilfslinie 1 oben', C6: 'Hilfslinie 2 oben',
};
// Position → Schritte über der untersten Linie und Zahl der Hilfslinien
function expectedStep(desc) {
  let m;
  if ((m = /^Linie (\d)$/.exec(desc))) return { step: 2 * (m[1] - 1), ledgers: 0 };
  if ((m = /^Zwischenraum (\d)$/.exec(desc))) return { step: 2 * m[1] - 1, ledgers: 0 };
  if (desc === 'unter Linie 1') return { step: -1, ledgers: 0 };
  if (desc === 'über Linie 5') return { step: 9, ledgers: 0 };
  if ((m = /^Hilfslinie (\d) unten$/.exec(desc))) return { step: -2 * m[1], ledgers: +m[1] };
  if ((m = /^Hilfslinie (\d) oben$/.exec(desc))) return { step: 8 + 2 * m[1], ledgers: +m[1] };
  if ((m = /^über Hilfslinie (\d) oben$/.exec(desc))) return { step: 9 + 2 * m[1], ledgers: +m[1] };
  throw new Error(desc);
}

const NUM = '(-?[0-9.]+)';
function parseLine(svg) {
  const staff = [...svg.matchAll(new RegExp(`<line class="staff-line" x1="${NUM}" y1="${NUM}"`, 'g'))].map((m) => +m[2]).sort((a, b) => b - a);
  const notes = [...svg.matchAll(/<g class="note[^"]*" data-note="([^"]+)" data-index="([0-9]+)" data-value="([^"]+)" transform="translate[(]([-0-9.]+) ([-0-9.]+)[)]" fill="currentColor">(.*?)<\/g>/g)].map((m) => ({
    note: m[1], index: +m[2], value: m[3], x: +m[4], y: +m[5], body: m[6],
  }));
  const ledgers = [...svg.matchAll(new RegExp(`<line class="ledger-line" data-index="([0-9]+)" x1="${NUM}" y1="${NUM}" x2="${NUM}"`, 'g'))].map((m) => ({ index: +m[1], x1: +m[2], y: +m[3], x2: +m[4] }));
  const bars = [...svg.matchAll(/<line class="bar-line( final)?"/g)].length;
  const finals = [...svg.matchAll(/<line class="bar-line final"/g)].length;
  const width = +/viewBox="0 0 ([0-9.]+) /.exec(svg)[1];
  return { staff, notes, ledgers, bars, finals, width };
}

test('Liederbuch: jedes Lied gültig – Taktlängen, nur Stammtöne, alle Noten auf der Klaviatur (c¹–c³)', () => {
  assert.ok(SONGS.length >= 6);
  assert.equal(new Set(SONGS.map((s) => s.id)).size, SONGS.length, 'eindeutige IDs');
  for (const song of SONGS) {
    const measures = parseMelody(song.melody);
    measures.forEach((m, i) => {
      const beats = m.reduce((s, n) => s + n.beats, 0);
      assert.equal(beats, measureBeats(song.time), `${song.title}, Takt ${i + 1}: ${beats} statt ${measureBeats(song.time)} Viertel`);
      for (const n of m) assert.ok(diatonicIndex(n.note) >= diatonicIndex('C4') && diatonicIndex(n.note) <= diatonicIndex('C6'), `${song.title}: ${n.note} außerhalb`);
    });
  }
});

test('Liederbuch: bekannte Melodieanfänge stimmen', () => {
  const start = (id, n) => parseMelody(SONGS.find((s) => s.id === id).melody).flat().slice(0, n).map((x) => x.note).join(' ');
  assert.equal(start('entchen', 6), 'C4 D4 E4 F4 G4 G4'); // c d e f g g
  assert.equal(start('weihnachtsmann', 7), 'C4 C4 G4 G4 A4 A4 G4'); // c c g g a a g
  assert.equal(start('haenschen', 6), 'G4 E4 E4 F4 D4 D4'); // g e e f d d
  assert.equal(start('jakob', 8), 'C5 D5 E5 C5 C5 D5 E5 C5'); // c d e c c d e c
  assert.equal(start('freude', 8), 'E5 E5 F5 G5 G5 F5 E5 D5'); // e e f g g f e d
  assert.equal(start('jinglebells', 7), 'E4 E4 E4 E4 E4 E4 E4');
});

for (const song of SONGS) {
  test(`Notensatz „${song.title}“: Position, Hilfslinien, Hälse, Punkte, Köpfe, Taktstriche`, () => {
    const layout = layoutScore(song);
    const measures = parseMelody(song.melody);
    const total = measures.flat().length;
    let seen = 0;
    let barsSeen = 0;
    layout.lines.forEach((line, li) => {
      const s = parseLine(renderScoreLine(layout, li));
      assert.equal(s.staff.length, 5);
      const [L1] = s.staff;
      const d = s.staff[0] - s.staff[1];
      const middle = s.staff[2];
      s.notes.forEach((n, k) => {
        const where = `${song.title} Note ${n.index + 1} (${n.note}${n.value})`;
        const exp = expectedStep(POSITION[n.note]);
        assert.ok(Math.abs(n.y - (L1 - (exp.step * d) / 2)) < 1e-6, `${where}: Höhe`);
        const ledgers = s.ledgers.filter((l) => l.index === n.index);
        assert.equal(ledgers.length, exp.ledgers, `${where}: Hilfslinien`);
        for (const l of ledgers) assert.ok(Math.abs((l.x1 + l.x2) / 2 - n.x) < 1e-6, `${where}: Hilfslinie mittig`);
        // Kopf: Ganze/Halbe hohl, Viertel/Achtel gefüllt
        const hollow = /fill-rule="evenodd" d="[^"]*Z[^"]*M/.test(n.body);
        assert.equal(hollow, /^[wh]/.test(n.value), `${where}: Kopf ${hollow ? 'hohl' : 'gefüllt'}`);
        // Hals: keiner bei Ganzen; unter der Mittellinie nach oben, ab der Mittellinie nach unten; reicht bis zur Mittellinie
        const stem = /<line class="stem" x1="([-0-9.]+)" y1="([-0-9.]+)" x2="[-0-9.]+" y2="([-0-9.]+)"/.exec(n.body);
        if (n.value.startsWith('w')) assert.equal(stem, null, `${where}: Ganze ohne Hals`);
        else {
          const up = +stem[3] < +stem[2];
          assert.equal(up, exp.step < 4, `${where}: Hals ${up ? 'oben' : 'unten'}`);
          assert.equal(+stem[1] > 0, up, `${where}: Hals rechts bei oben, links bei unten`);
          const endY = n.y + +stem[3];
          assert.ok(up ? endY <= middle + 1e-6 : endY >= middle - 1e-6, `${where}: Hals reicht bis zur Mittellinie`);
          assert.ok(Math.abs(+stem[3] - +stem[2]) >= 3.5 * d - 1e-6, `${where}: Hals mind. 3,5 Abstände lang`);
        }
        assert.equal(/class="flag"/.test(n.body), n.value.startsWith('e'), `${where}: Fähnchen nur bei Achteln`);
        const dot = /<circle class="dot" cx="[-0-9.]+" cy="([-0-9.]+)"/.exec(n.body);
        assert.equal(!!dot, n.value.endsWith('.'), `${where}: Punkt`);
        if (dot) assert.ok(Math.abs(((L1 - (n.y + +dot[1])) / (d / 2)) % 2) === 1, `${where}: Punkt im Zwischenraum`);
        if (k > 0) assert.ok(n.x - s.notes[k - 1].x >= 15, `${where}: genug Abstand zur vorigen Note`);
        assert.ok(n.x > 40 && n.x < s.width - 6, `${where}: innerhalb der Zeile`);
      });
      // Hilfslinien benachbarter Noten berühren sich nicht
      for (const a of s.ledgers) for (const b of s.ledgers) if (b.index === a.index + 1) assert.ok(a.x2 < b.x1, `${song.title}: Hilfslinien überlappen`);
      seen += s.notes.length;
      barsSeen += s.bars - s.finals; // Doppelstrich am Ende zählt als ein Taktstrich
      assert.equal(s.finals, line.last ? 1 : 0, 'Schlussstrich nur am Ende');
    });
    assert.equal(seen, total, 'alle Noten gezeichnet');
    assert.equal(barsSeen, measures.length, 'ein Taktstrich pro Takt');
  });
}

test('Notensatz: Taktart nur in der ersten Zeile', () => {
  const layout = layoutScore(SONGS[0]);
  assert.match(renderScoreLine(layout, 0), /<g class="time"/);
  assert.doesNotMatch(renderScoreLine(layout, 1), /<g class="time"/);
});

import { Trainer } from '../js/trainer.js';

test('Stufe 4: ein Lied wird Note für Note gespielt, die Runde ist so lang wie das Lied', () => {
  const song = SONGS.find((s) => s.id === 'entchen');
  const notes = parseMelody(song.melody).flat().map((n) => n.note);
  const trainer = new Trainer();
  trainer.configure('mixed', 'lieder');
  assert.equal(trainer.isSequence, true);
  trainer.startSong(notes);
  let res;
  notes.forEach((note, i) => {
    assert.equal(trainer.current.note, note);
    assert.equal(trainer.current.clef, 'treble');
    res = trainer.answer(i === 4 ? 'A4' : note, 700);
    assert.equal(res.done, i === notes.length - 1);
    trainer.advance();
  });
  const sum = trainer.summary();
  assert.equal(sum.total, notes.length);
  assert.equal(sum.correct, notes.length - 1);
  // danach wieder normale Runden mit 20 Noten
  trainer.configure('treble', 1);
  assert.equal(trainer.progress.total, 20);
});
