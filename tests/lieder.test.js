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
  const notes = [...svg.matchAll(/<g class="note[^"]*" data-note="([^"]+)" data-index="([0-9]+)" data-value="([^"]+)" transform="translate[(]([-0-9.]+) ([-0-9.]+)[)]" fill="currentColor">((?:<g class="accidental".*?<\/g>)?.*?)<\/g>/g)].map((m) => ({
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
  assert.equal(start('jakob', 8), 'F4 G4 A4 F4 F4 G4 A4 F4'); // f g a f f g a f (F-Dur)
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
        const exp = expectedStep(POSITION[n.note.replace(/[#b]/, '')]); // b¹ steht wie h¹, fis¹ wie f¹
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

// --- Tonarten und Vorzeichen-Regeln ---

import { keySignatureNotes, accidentalsShown, keyAccidentals } from '../js/score.js';

test('Tonarten: Vorzeichen stehen an der üblichen Stelle (von Hand eingetragen)', () => {
  // Violinschlüssel: Fis auf Linie 5, Cis im 3. Zwischenraum; B auf Linie 3, Es im 4. Zwischenraum
  assert.deepEqual(keySignatureNotes('treble', 'G'), ['F5']);
  assert.deepEqual(keySignatureNotes('treble', 'D'), ['F5', 'C5']);
  assert.deepEqual(keySignatureNotes('treble', 'F'), ['B4']);
  assert.deepEqual(keySignatureNotes('treble', 'Bb'), ['B4', 'E5']);
  // Bassschlüssel: Fis auf Linie 4, Cis im 2. Zwischenraum; B auf Linie 2, Es im 3. Zwischenraum
  assert.deepEqual(keySignatureNotes('bass', 'G'), ['F3']);
  assert.deepEqual(keySignatureNotes('bass', 'D'), ['F3', 'C3']);
  assert.deepEqual(keySignatureNotes('bass', 'F'), ['B2']);
  assert.deepEqual(keySignatureNotes('bass', 'Bb'), ['B2', 'E3']);
  assert.deepEqual(keySignatureNotes('treble', 'C'), []);
  assert.deepEqual(keyAccidentals('D'), { F: '#', C: '#' });
  assert.deepEqual(keyAccidentals('Eb'), { B: 'b', E: 'b', A: 'b' });
});

test('Tonarten: Zeichen der Tonart werden auf Linie bzw. Zwischenraum gezeichnet', () => {
  const svg = renderScoreLine(layoutScore({ melody: 'G4w', time: [4, 4], key: 'D' }), 0);
  const signs = [...svg.matchAll(/<g class="accidental key" data-acc="([#b])" transform="translate[(]([-0-9.]+) ([-0-9.]+)[)]/g)];
  const L1 = parseLine(svg).staff[0];
  assert.equal(signs.length, 2);
  assert.ok(signs.every((m) => m[1] === '#'));
  assert.equal(+signs[0][3], L1 - 8 * 5, 'Fis auf Linie 5');
  assert.equal(+signs[1][3], L1 - 5 * 5, 'Cis im 3. Zwischenraum');
  assert.ok(+signs[1][2] > +signs[0][2], 'nebeneinander von links nach rechts');
});

test('Vorzeichen-Regeln: Tonart gilt, Zeichen gilt bis zum Taktstrich, Abweichung bekommt ♮', () => {
  const shown = (melody, key) => accidentalsShown(parseMelody(melody), key).map((m) => m.map((n) => n.showAcc ?? '-').join(' '));
  // G-Dur: fis ohne Zeichen; f (ohne Kreuz) braucht ♮; danach fis wieder mit #; neuer Takt: Tonart gilt wieder
  assert.deepEqual(shown('F#4q F#4q F4q F#4q | F#4q G4q A4q B4q', 'G'), ['- - n #', '- - - -']);
  // C-Dur: Kreuz gilt im Takt weiter, nur für diese Oktave
  assert.deepEqual(shown('F#4q F#4q F#5q F4q | F4q F#4q F4q F4q', 'C'), ['# - # n', '- # n -']);
  // F-Dur: B ohne Zeichen, H braucht ♮
  assert.deepEqual(shown('Bb4q B4q Bb4q A4q', 'F'), ['- n b -']);
});

test('Bruder Jakob in F-Dur: ein b am Zeilenanfang, die B-Noten ohne eigenes Zeichen', () => {
  const song = SONGS.find((s) => s.id === 'jakob');
  const layout = layoutScore(song);
  const all = layout.lines.map((_, i) => renderScoreLine(layout, i)).join('');
  assert.equal([...all.matchAll(/class="accidental key" data-acc="b"/g)].length, layout.lines.length, 'ein b je Zeile');
  assert.doesNotMatch(all, /<g class="accidental" /, 'keine Zeichen an den Noten');
  assert.ok(parseMelody(song.melody).flat().some((n) => n.note === 'Bb4'), 'enthält B');
});

// --- Pausen und Sechzehntel ---

test('Pausen: Ganze hängt an der 4. Linie, Halbe liegt auf der Mittellinie, zählen nicht als Note', () => {
  const song = { melody: 'C5q zq D5h | zw | E5h zh | F5s F5s G5e. A5q zq. B5s', time: [4, 4] };
  const measures = parseMelody(song.melody);
  measures.forEach((m) => assert.equal(m.reduce((s, n) => s + n.beats, 0), 4, 'Takt mit Pausen vollständig'));
  const layout = layoutScore(song);
  const svg = layout.lines.map((_, i) => renderScoreLine(layout, i)).join('');
  const L1 = parseLine(renderScoreLine(layout, 0)).staff[0];
  const line4 = L1 - 6 * 5;
  const middle = L1 - 4 * 5;
  const rest = (v) => new RegExp(`<g class="rest" data-value="${v.replace('.', '[.]')}" transform="translate[(][-0-9.]+ 0[)]" fill="currentColor"><path d="M-5 ([-0-9.]+)h10v5h-10Z"`).exec(svg);
  assert.equal(+rest('w')[1], line4, 'ganze Pause hängt an der 4. Linie');
  assert.equal(+rest('h')[1] + 5, middle, 'halbe Pause liegt auf der Mittellinie');
  assert.equal([...svg.matchAll(/class="rest"/g)].length, 4);
  assert.equal(parseMelody(song.melody).flat().filter((n) => !n.rest).map((n) => n.index).join(','), '0,1,2,3,4,5,6,7');
  // Sechzehntel mit zwei Fähnchen, punktierte Achtel mit Punkt
  const notes = layout.lines.flatMap((_, i) => parseLine(renderScoreLine(layout, i)).notes);
  const f5 = notes.find((n) => n.value === 's');
  assert.equal([...f5.body.matchAll(/class="flag"/g)].length, 2, 'Sechzehntel: zwei Fähnchen');
  assert.match(notes.find((n) => n.value === 'e.').body, /class="dot"/);
});

test('Tonarten bis 7 Vorzeichen', () => {
  assert.deepEqual(keySignatureNotes('treble', 'C#'), ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4']);
  assert.deepEqual(keySignatureNotes('treble', 'Cb'), ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4']);
  assert.deepEqual(Object.keys(keyAccidentals('B')), ['F', 'C', 'G', 'D', 'A']);
});

import { parseLyrics, songNotes } from '../js/score.js';

test('Liedtext: Silben werden wie in ABC getrennt', () => {
  assert.deepEqual(parseLyrics('Al-le mei-ne Ent-chen'), ['Al-', 'le', 'mei-', 'ne', 'Ent-', 'chen']);
  assert.deepEqual(parseLyrics('bin-den _ wie-der'), ['bin-', 'den', '', 'wie-', 'der']);
  assert.deepEqual(parseLyrics('a * b'), ['a', '', 'b']);
  assert.deepEqual(parseLyrics('  '), []);
});

test('Liedtext: im Liederbuch genau eine Silbe je angeschlagener Note', () => {
  const withText = SONGS.filter((s) => s.lyrics);
  assert.ok(withText.length >= 5);
  for (const song of withText) assert.equal(parseLyrics(song.lyrics).length, songNotes(song).length, song.id);
});

test('Liedtext: steht unter der richtigen Note, mittig, und das Bild wird höher', () => {
  const song = SONGS.find((s) => s.id === 'entchen');
  const layout = layoutScore(song);
  assert.equal(layout.lyrics, true);
  assert.ok(layout.height > layoutScore({ ...song, lyrics: undefined }).height);
  const svg = renderScoreLine(layout, 0);
  assert.match(svg, new RegExp(`viewBox="0 0 ${layout.width} ${layout.height}"`));
  const texts = [...svg.matchAll(/<text class="lyric" data-index="(\d+)" x="([\d.]+)" y="([\d.]+)">([^<]*)<\/text>/g)];
  assert.ok(texts.length > 4);
  for (const [, idx, x, y] of texts) {
    const n = layout.lines[0].notes.find((m) => m.index === Number(idx));
    assert.equal(Number(x), n.x);
    assert.ok(Number(y) > 96, 'unter dem System und unter Hilfslinien');
  }
  assert.deepEqual(texts.slice(0, 4).map((t) => t[4]), ['Al-', 'le', 'mei-', 'ne']);
});

test('Liedtext: lange Silben schieben die Noten auseinander, nichts überlappt', () => {
  for (const song of SONGS.filter((s) => s.lyrics)) {
    const layout = layoutScore(song);
    for (const line of layout.lines) {
      const withText = line.notes.filter((n) => n.lyric);
      for (let i = 1; i < withText.length; i++) {
        const a = withText[i - 1], b = withText[i];
        const half = (t) => (t.length * 8 * 0.52) / 2;
        assert.ok(a.x + half(a.lyric) < b.x - half(b.lyric) + 0.5, `${song.id}: „${a.lyric}“/„${b.lyric}“`);
      }
    }
  }
});

test('Liedtext: Sonderzeichen werden für SVG maskiert', () => {
  const svg = renderScoreLine(layoutScore({ time: [4, 4], melody: 'C4w', lyrics: 'a<b' }), 0);
  assert.match(svg, />a&lt;b</);
});
