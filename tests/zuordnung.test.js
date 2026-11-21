// Prüft die beiden Zuordnungen, auf die es ankommt – für alle Noten beider Schlüssel:
//   1. Note → Position im Notensystem (inkl. Hilfslinien), gemessen am fertig gezeichneten SVG
//   2. Note → Taste auf der Klaviatur
// Die Erwartungswerte sind von Hand aus der Musiklehre übertragen, nicht aus dem Code berechnet.
//
// Violinschlüssel: Linien von unten e¹ g¹ h¹ d² f², Zwischenräume f¹ a¹ c² e².
// Bassschlüssel:   Linien von unten G H d f a,      Zwischenräume A c e g.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEFS, levelNotes, helmholtzName, isNatural } from '../js/notes.js';
import { renderStaff, renderSequence } from '../js/staff.js';
import { keyboardLayout, keyAt, keyForNote, renderKeyboard } from '../js/keyboard.js';

// [Note, deutscher Name, Position]
const VIOLIN = [
  ['C4', 'c¹', 'Hilfslinie 1 unten'],
  ['D4', 'd¹', 'unter Linie 1'],
  ['E4', 'e¹', 'Linie 1'],
  ['F4', 'f¹', 'Zwischenraum 1'],
  ['G4', 'g¹', 'Linie 2'],
  ['A4', 'a¹', 'Zwischenraum 2'],
  ['B4', 'h¹', 'Linie 3'],
  ['C5', 'c²', 'Zwischenraum 3'],
  ['D5', 'd²', 'Linie 4'],
  ['E5', 'e²', 'Zwischenraum 4'],
  ['F5', 'f²', 'Linie 5'],
  ['G5', 'g²', 'über Linie 5'],
  ['A5', 'a²', 'Hilfslinie 1 oben'],
  ['B5', 'h²', 'über Hilfslinie 1 oben'],
  ['C6', 'c³', 'Hilfslinie 2 oben'],
];

const BASS = [
  ['C2', 'C', 'Hilfslinie 2 unten'],
  ['D2', 'D', 'unter Hilfslinie 1 unten'],
  ['E2', 'E', 'Hilfslinie 1 unten'],
  ['F2', 'F', 'unter Linie 1'],
  ['G2', 'G', 'Linie 1'],
  ['A2', 'A', 'Zwischenraum 1'],
  ['B2', 'H', 'Linie 2'],
  ['C3', 'c', 'Zwischenraum 2'],
  ['D3', 'd', 'Linie 3'],
  ['E3', 'e', 'Zwischenraum 3'],
  ['F3', 'f', 'Linie 4'],
  ['G3', 'g', 'Zwischenraum 4'],
  ['A3', 'a', 'Linie 5'],
  ['B3', 'h', 'über Linie 5'],
  ['C4', 'c¹', 'Hilfslinie 1 oben'],
];

const REFERENCE = { treble: VIOLIN, bass: BASS };

// Weiße Tasten von links nach rechts
const KEYS = {
  treble: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'],
  bass: ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'],
};
// Schwarze Tasten mit ihren beiden weißen Nachbarn
const BLACK_KEYS = {
  treble: [
    ['C#4', 'C4', 'D4'], ['D#4', 'D4', 'E4'], ['F#4', 'F4', 'G4'], ['G#4', 'G4', 'A4'], ['A#4', 'A4', 'B4'],
    ['C#5', 'C5', 'D5'], ['D#5', 'D5', 'E5'], ['F#5', 'F5', 'G5'], ['G#5', 'G5', 'A5'], ['A#5', 'A5', 'B5'],
  ],
  bass: [
    ['C#2', 'C2', 'D2'], ['D#2', 'D2', 'E2'], ['F#2', 'F2', 'G2'], ['G#2', 'G2', 'A2'], ['A#2', 'A2', 'B2'],
    ['C#3', 'C3', 'D3'], ['D#3', 'D3', 'E3'], ['F#3', 'F3', 'G3'], ['G#3', 'G3', 'A3'], ['A#3', 'A3', 'B3'],
  ],
};

const NUM = '(-?[\\d.]+)';
function parseStaff(svg) {
  const lineRe = (cls) => new RegExp(`<line class="${cls}" x1="${NUM}" y1="${NUM}" x2="${NUM}" y2="${NUM}"/>`, 'g');
  const lines = (cls) => [...svg.matchAll(lineRe(cls))].map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
  const note = new RegExp(`<g class="note" data-note="([^"]+)" transform="translate\\(${NUM} ${NUM}\\)"`).exec(svg);
  const clef = new RegExp(`<g class="clef" data-clef="(\\w+)" transform="translate\\(${NUM} ${NUM}\\) scale\\(${NUM}\\)"`).exec(svg);
  const dots = [...svg.matchAll(new RegExp(`<circle class="clef-dot" cx="${NUM}" cy="${NUM}" r="${NUM}"/>`, 'g'))];
  return {
    staff: lines('staff-line'),
    ledgers: lines('ledger-line'),
    note: { id: note[1], x: +note[2], y: +note[3] },
    clef: { id: clef[1], x: +clef[2], y: +clef[3], scale: +clef[4] },
    dots: dots.map((m) => ({ cx: +m[1], cy: +m[2] })),
  };
}

// Aus der Positionsbeschreibung die erwartete Notenhöhe und die Hilfslinien ableiten.
// L: y der fünf Notenlinien von unten nach oben, d: Linienabstand
function expected(desc, L, d) {
  const below = (k) => Array.from({ length: k }, (_, j) => L[0] + (j + 1) * d);
  const above = (k) => Array.from({ length: k }, (_, j) => L[4] - (j + 1) * d);
  let m;
  if ((m = /^Linie (\d)$/.exec(desc))) return { y: L[m[1] - 1], ledgers: [] };
  if ((m = /^Zwischenraum (\d)$/.exec(desc))) return { y: (L[m[1] - 1] + L[m[1]]) / 2, ledgers: [] };
  if (desc === 'unter Linie 1') return { y: L[0] + d / 2, ledgers: [] };
  if (desc === 'über Linie 5') return { y: L[4] - d / 2, ledgers: [] };
  if ((m = /^(unter )?Hilfslinie (\d) unten$/.exec(desc))) {
    const k = Number(m[2]);
    return { y: L[0] + k * d + (m[1] ? d / 2 : 0), ledgers: below(k) };
  }
  if ((m = /^(über )?Hilfslinie (\d) oben$/.exec(desc))) {
    const k = Number(m[2]);
    return { y: L[4] - k * d - (m[1] ? d / 2 : 0), ledgers: above(k) };
  }
  throw new Error(`Unbekannte Positionsbeschreibung: ${desc}`);
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const sortNum = (arr) => [...arr].sort((a, b) => a - b);

for (const clef of ['treble', 'bass']) {
  const clefName = CLEFS[clef].name;

  test(`${clefName}: jede Note sitzt an der richtigen Stelle (inkl. Hilfslinien)`, () => {
    for (const [note, name, desc] of REFERENCE[clef]) {
      const s = parseStaff(renderStaff(clef, note));
      const where = `${clefName} ${name} (${note}, „${desc}“)`;

      assert.equal(s.staff.length, 5, `${where}: fünf Notenlinien`);
      const L = s.staff.map((l) => l.y1).sort((a, b) => b - a); // von unten nach oben
      const d = L[0] - L[1];
      assert.ok(d > 0, 'Linienabstand positiv');
      for (let i = 0; i < 4; i++) close(L[i] - L[i + 1], d, `${where}: gleiche Linienabstände`);

      const exp = expected(desc, L, d);
      assert.equal(s.note.id, note);
      close(s.note.y, exp.y, `${where}: Höhe der Note`);

      assert.equal(s.ledgers.length, exp.ledgers.length, `${where}: Anzahl Hilfslinien`);
      const got = sortNum(s.ledgers.map((l) => l.y1));
      sortNum(exp.ledgers).forEach((y, i) => close(got[i], y, `${where}: Hilfslinie ${i + 1}`));
      for (const l of s.ledgers) {
        close(l.y1, l.y2, `${where}: Hilfslinie waagerecht`);
        close((l.x1 + l.x2) / 2, s.note.x, `${where}: Hilfslinie mittig unter der Note`);
        assert.ok(l.x2 - l.x1 > 2 * 8.2, `${where}: Hilfslinie breiter als der Notenkopf`);
      }
    }
  });

  test(`${clefName}: deutsche Notennamen (H statt B)`, () => {
    for (const [note, name] of REFERENCE[clef]) assert.equal(helmholtzName(note), name, note);
  });

  test(`${clefName}: Schlüssel sitzt auf der richtigen Linie`, () => {
    const s = parseStaff(renderStaff(clef, REFERENCE[clef][7][0]));
    const L = s.staff.map((l) => l.y1).sort((a, b) => b - a);
    assert.equal(s.clef.id, clef);
    if (clef === 'treble') {
      close(s.clef.y, L[1], 'Violinschlüssel: Schnecke auf der G-Linie (2. Linie von unten)');
    } else {
      close(s.clef.y, L[3], 'Bassschlüssel: Kugel auf der F-Linie (4. Linie von unten)');
      const dotYs = sortNum(s.dots.map((p) => s.clef.y + p.cy * s.clef.scale));
      assert.equal(dotYs.length, 2, 'zwei Punkte');
      close(dotYs[0], (L[3] + L[4]) / 2, 'oberer Punkt im Zwischenraum über der F-Linie');
      close(dotYs[1], (L[2] + L[3]) / 2, 'unterer Punkt im Zwischenraum unter der F-Linie');
    }
  });

  test(`${clefName}: Stufen haben den richtigen Notenvorrat`, () => {
    const all = REFERENCE[clef].map(([note]) => note);
    assert.deepEqual(levelNotes(clef, 2), all, 'Stufe 2 = alle Noten');
    const level1 = levelNotes(clef, 1);
    assert.deepEqual(level1, clef === 'treble' ? all.slice(1, 12) : all.slice(3, 14));
    for (const [note, , desc] of REFERENCE[clef]) {
      const ledgers = parseStaff(renderStaff(clef, note)).ledgers.length;
      if (level1.includes(note)) assert.equal(ledgers, 0, `Stufe 1 ohne Hilfslinien: ${note}`);
      else assert.ok(ledgers > 0 && /Hilfslinie/.test(desc), `Stufe 2 zusätzlich mit Hilfslinie: ${note}`);
    }
  });

  for (const width of [320, 375, 812]) {
    test(`${clefName}: jede Note trifft ihre Taste (Klaviatur ${width} px breit)`, () => {
      const height = 200;
      const layout = keyboardLayout(CLEFS[clef].keyboard, width, height);
      const whites = layout.keys.filter((k) => !k.black);
      assert.deepEqual(whites.map((k) => k.note), KEYS[clef], 'weiße Tasten in der richtigen Reihenfolge');
      const ww = width / KEYS[clef].length;

      for (const [note] of REFERENCE[clef]) {
        const key = keyForNote(layout, note);
        assert.ok(key && !key.black, `${note}: weiße Taste vorhanden`);
        close(key.x, KEYS[clef].indexOf(note) * ww, `${note}: Taste an der richtigen Stelle`);
        assert.equal(keyAt(layout, key.x + key.w / 2, height * 0.85), note, `${note}: Antippen unten`);
        assert.equal(keyAt(layout, key.x + key.w / 2, height * 0.2), note, `${note}: Antippen oben in Tastenmitte`);
      }

      for (const [black, left, right] of BLACK_KEYS[clef]) {
        const key = keyForNote(layout, black);
        const l = keyForNote(layout, left);
        const r = keyForNote(layout, right);
        assert.ok(key && key.black && !isNatural(black), `${black}: schwarze Taste`);
        const center = key.x + key.w / 2;
        assert.ok(center > l.x + l.w / 2 && center < r.x + r.w / 2, `${black}: liegt zwischen ${left} und ${right}`);
        assert.equal(keyAt(layout, center, height * 0.3), black, `${black}: Antippen trifft die schwarze Taste`);
      }
      assert.equal(layout.keys.filter((k) => k.black).length, 10, 'zehn schwarze Tasten');

      // Punkt fürs mittlere C liegt auf der C4-Taste (Violin: ganz links, Bass: ganz rechts)
      const svg = renderKeyboard(layout);
      const dot = /<circle class="middle-c" cx="([\d.]+)" cy="([\d.]+)"/.exec(svg);
      assert.ok(dot, 'Punkt fürs mittlere C vorhanden');
      assert.equal(keyAt(layout, +dot[1], +dot[2]), 'C4', 'Punkt sitzt auf c¹');
      assert.equal(KEYS[clef].indexOf('C4'), clef === 'treble' ? 0 : 14);

      // Gezeichnete Tasten tragen dieselben Noten wie das Layout
      const drawn = [...svg.matchAll(/<path class="key white[^"]*" data-note="([^"]+)" d="M([\d.]+) /g)];
      assert.deepEqual(drawn.map((m) => m[1]), KEYS[clef]);
      drawn.forEach((m, i) => assert.ok(Math.abs(+m[2] - i * ww) < 2, `${m[1]} gezeichnet an der richtigen Stelle`));
    });
  }
}

test('Klaviaturbereiche: Violin c¹–c³, Bass C–c¹ (unabhängig von der Stufe)', () => {
  assert.deepEqual(CLEFS.treble.keyboard, ['C4', 'C6']);
  assert.deepEqual(CLEFS.bass.keyboard, ['C2', 'C4']);
  for (const clef of ['treble', 'bass']) {
    for (const level of [1, 2]) {
      const layout = keyboardLayout(CLEFS[clef].keyboard, 375, 200);
      for (const note of levelNotes(clef, level)) assert.ok(keyForNote(layout, note), `${note} auf der Klaviatur`);
    }
  }
});

// --- Stufe 3: Notenfolgen – jede Note in der Folge sitzt genauso richtig wie einzeln ---

function parseSequence(svg) {
  const lines = (cls, extra = '') =>
    [...svg.matchAll(new RegExp(`<line class="${cls}"${extra} x1="${NUM}" y1="${NUM}" x2="${NUM}" y2="${NUM}"/>`, 'g'))];
  const staff = lines('staff-line').map((m) => +m[2]);
  const ledgers = lines('ledger-line', ' data-index="([0-9]+)"').map((m) => ({ i: +m[1], x1: +m[2], y: +m[3], x2: +m[4] }));
  const notes = [...svg.matchAll(new RegExp(`<g class="note[^"]*" data-note="([^"]+)" data-index="([0-9]+)" transform="translate[(]${NUM} ${NUM}[)]"`, 'g'))].map(
    (m) => ({ note: m[1], i: +m[2], x: +m[3], y: +m[4] }),
  );
  return { staff, ledgers, notes };
}

for (const clef of ['treble', 'bass']) {
  test(`${CLEFS[clef].name}: in Notenfolgen sitzt jede Note an der richtigen Stelle`, () => {
    const ref = REFERENCE[clef];
    // alle 15 Noten in Folgen zu je 5, einmal vorwärts und einmal gemischt
    const orders = [ref, [...ref].reverse(), ref.filter((_, i) => i % 2).concat(ref.filter((_, i) => !(i % 2)))];
    for (const order of orders) {
      for (let k = 0; k < order.length; k += 5) {
        const chunk = order.slice(k, k + 5);
        const s = parseSequence(renderSequence(clef, chunk.map(([n]) => n)));
        assert.equal(s.staff.length, 5);
        const L = [...s.staff].sort((a, b) => b - a);
        const d = L[0] - L[1];
        assert.equal(s.notes.length, chunk.length);
        chunk.forEach(([note, name, desc], i) => {
          const n = s.notes.find((x) => x.i === i);
          assert.equal(n.note, note);
          const exp = expected(desc, L, d);
          close(n.y, exp.y, `Folge: ${name} („${desc}“) Höhe`);
          const mine = s.ledgers.filter((l) => l.i === i);
          assert.equal(mine.length, exp.ledgers.length, `Folge: ${name} Anzahl Hilfslinien`);
          sortNum(mine.map((l) => l.y)).forEach((y, j) => close(y, sortNum(exp.ledgers)[j], `Folge: ${name} Hilfslinie`));
          for (const l of mine) close((l.x1 + l.x2) / 2, n.x, `Folge: ${name} Hilfslinie mittig`);
          if (i > 0) assert.ok(n.x > s.notes.find((x) => x.i === i - 1).x, 'Noten von links nach rechts');
        });
        // Hilfslinien benachbarter Noten berühren sich nicht
        for (const a of s.ledgers) for (const b of s.ledgers) if (a.i + 1 === b.i) assert.ok(a.x2 < b.x1, 'Hilfslinien überlappen nicht');
      }
    }
  });
}
