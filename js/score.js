// Notensatz für Lieder (Stufe 4): Notenwerte, Hälse, Fähnchen, Punkte, Taktstriche, Taktart.
// Liefert SVG-Text zeilenweise, damit sich alles in Node prüfen lässt.
//
// Liedschreibweise: Note + Wert, Takte durch „|“ getrennt, z. B. "C4q D4q E4h | G4w".
// Werte: w = Ganze, h = Halbe, q = Viertel, e = Achtel; ein Punkt dahinter verlängert um die Hälfte.
// Noten werden mit ihrer tatsächlichen Tonhöhe geschrieben ("Bb4q", "F#4h"); ob vor der Note ein
// Zeichen steht, ergibt sich aus Tonart und Takt (siehe accidentalsShown).

import { staffStep, ledgerSteps, parseNote } from './notes.js';
import { GEOMETRY, SPACE, stepY, WHOLE_NOTE } from './staff.js';
import { CLEF_SHAPES, accidentalSvg } from './clefs.js';

// Tonarten: Anzahl Kreuze bzw. b. Reihenfolge der Zeichen: Kreuze F C G D A E H, b: B E A D G C F
export const KEYS = {
  C: ['', 0], G: ['#', 1], D: ['#', 2], A: ['#', 3], E: ['#', 4], B: ['#', 5], 'F#': ['#', 6], 'C#': ['#', 7],
  F: ['b', 1], Bb: ['b', 2], Eb: ['b', 3], Ab: ['b', 4], Db: ['b', 5], Gb: ['b', 6], Cb: ['b', 7],
};
const SHARP_ORDER = 'FCGDAEB';
const FLAT_ORDER = 'BEADGCF';
// Wo die Zeichen der Tonart im System stehen (übliche Lage)
const KEY_POSITIONS = {
  treble: { '#': ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'], b: ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'] },
  bass: { '#': ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'], b: ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2'] },
};

// Vorzeichen der Tonart je Stammton, z. B. G-Dur → { F: '#' }
export function keyAccidentals(key = 'C') {
  const [type, count] = KEYS[key];
  const order = type === '#' ? SHARP_ORDER : FLAT_ORDER;
  return Object.fromEntries([...order.slice(0, count)].map((letter) => [letter, type]));
}

// Noten, auf denen die Zeichen der Tonart stehen (für die Zeichnung am Zeilenanfang)
export function keySignatureNotes(clef, key = 'C') {
  const [type, count] = KEYS[key];
  return count ? KEY_POSITIONS[clef][type].slice(0, count) : [];
}
export const keySignatureType = (key = 'C') => KEYS[key][0];

// Welches Zeichen steht vor jeder Note? Regeln wie im Notendruck: Die Tonart gilt immer; ein Zeichen
// im Takt gilt für diese Note bis zum Taktstrich; Abweichungen bekommen ♯, ♭ oder das Auflösungszeichen ♮.
export function accidentalsShown(measures, key = 'C') {
  const fromKey = keyAccidentals(key);
  for (const m of measures) {
    const inMeasure = new Map();
    for (const n of m) {
      if (n.rest) continue;
      if (n.tiedFrom) {
        n.showAcc = null; // angebundene Note wiederholt kein Vorzeichen
        continue;
      }
      const { letter, octave, accidental } = parseNote(n.note);
      const id = `${letter}${octave}`;
      const expected = inMeasure.has(id) ? inMeasure.get(id) : fromKey[letter] ?? '';
      n.showAcc = accidental === expected ? null : accidental || 'n';
      inMeasure.set(id, accidental);
    }
  }
  return measures;
}

export const BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 }; // in Vierteln (s = Sechzehntel)

export const SCORE = {
  clefArea: 40,
  timeSigWidth: 16,
  lineContent: 170, // Breite für Takte pro Zeile (danach Umbruch)
  right: 6,
  measurePad: 8, // Abstand vom Taktstrich zur ersten Note
  ledgerHalf: 8.5,
  stemLength: 35,
};

// "C4q." → { note: 'C4', value: 'q', dotted: true, beats: 1.5 }; Pausen: "zq", "zh." …
export function parseToken(token) {
  const r = /^z([whqes])(\.?)$/.exec(token);
  if (r) return { rest: true, value: r[1], dotted: r[2] === '.', beats: BEATS[r[1]] * (r[2] ? 1.5 : 1) };
  const m = /^([A-G](?:#|b)?[0-9])([whqes])(\.?)(-?)$/.exec(token);
  if (!m) throw new Error(`Unbekannte Note im Lied: ${token}`);
  const [, note, value, dot, tie] = m;
  parseNote(note); // prüft, ob es die Note gibt (kein Eis, Ces …)
  // "-" am Ende: Haltebogen zur nächsten Note (die wird dann nicht neu angeschlagen)
  return { note, value, dotted: dot === '.', beats: BEATS[value] * (dot ? 1.5 : 1), tie: tie === '-' };
}

// Lied-Text → Takte mit Noten (jede Note mit fortlaufendem Index; Pausen ohne Index)
export function parseMelody(text) {
  let index = 0;
  let last = null;
  return text
    .split('|')
    .map((bar) => bar.trim())
    .filter(Boolean)
    .map((bar) => bar.split(/\s+/).map((t) => {
      const item = parseToken(t);
      if (item.rest) return item;
      // angebundene Note (gleiche Tonhöhe nach Haltebogen): gezeichnet, aber nicht gespielt
      const tied = last?.tie && last.note === item.note;
      last = item;
      return tied ? { ...item, tiedFrom: true } : { ...item, index: index++ };
    }));
}

// nur die zu spielenden (anzuschlagenden) Noten eines Lieds, in Reihenfolge
export const songNotes = (song) => parseMelody(song.melody).flat().filter((n) => !n.rest && !n.tiedFrom);

// Taktart → Länge eines Takts in Vierteln (6/8 = 3 Viertel)
export const measureBeats = ([top, bottom]) => (top * 4) / bottom;

const advance = (n) => Math.max(19, 14 + 4 * n.beats); // horizontaler Platz einer Note
const ACC_WIDTH = 9; // zusätzlicher Platz für ein Zeichen vor der Note
const LYRIC_SIZE = 8; // Schriftgröße des Liedtexts (ein Linienabstand = 10)
const lyricWidth = (text) => (text ? text.length * LYRIC_SIZE * 0.52 + 4 : 0);
const widthOf = (n) => Math.max(advance(n), lyricWidth(n.lyric)) + (n.showAcc ? ACC_WIDTH : 0);

// Liedtext → eine Silbe je angeschlagener Note. Schreibweise wie in ABC („w:“):
// Silben mit Leerzeichen oder Bindestrich trennen ("Al-le mei-ne"), "_" = vorige Silbe wird
// weitergesungen (keine neue Silbe auf dieser Note), "*" = Note ohne Text.
export function parseLyrics(text = '') {
  const out = [];
  for (const word of text.trim().split(/[ \t\n]+/).filter(Boolean)) { // geschütztes Leerzeichen hält Wörter unter einer Note zusammen
    const parts = word.split('-');
    parts.forEach((p, i) => {
      if (p === '_' || p === '*') out.push('');
      else if (p !== '') out.push(i < parts.length - 1 ? `${p}-` : p);
    });
  }
  return out;
}
const keySigWidth = (key) => (KEYS[key ?? 'C'][1] ? KEYS[key ?? 'C'][1] * 9 + 5 : 0);

// Zeilen aufteilen und Notenpositionen festlegen
export function layoutScore(song) {
  const measures = accidentalsShown(parseMelody(song.melody), song.key);
  const lyrics = song.lyrics ? parseLyrics(song.lyrics) : null;
  if (lyrics) for (const n of measures.flat()) if (n.index !== undefined) n.lyric = lyrics[n.index] ?? '';
  const natural = measures.map((m) => SCORE.measurePad + m.reduce((s, n) => s + widthOf(n), 0) + 3);
  const ks = keySigWidth(song.key);
  const lines = [];
  let current = null;
  measures.forEach((m, i) => {
    const room = SCORE.lineContent - ks - (lines.length === 0 && !current ? SCORE.timeSigWidth : 0);
    if (!current || current.width + natural[i] > current.room) {
      current = { measures: [], width: 0, room };
      lines.push(current);
    }
    current.measures.push(i);
    current.width += natural[i];
  });

  const width = SCORE.clefArea + SCORE.lineContent + SCORE.right;
  return {
    width,
    time: song.time,
    key: song.key ?? 'C',
    lyrics: !!lyrics,
    height: lyrics ? GEOMETRY.height + 10 : GEOMETRY.height, // Platz für den Text unter dem System
    keySigWidth: ks,
    lines: lines.map((line, li) => {
      const start = SCORE.clefArea + ks + (li === 0 ? SCORE.timeSigWidth : 0);
      const last = li === lines.length - 1;
      const scale = last ? 1 : line.room / line.width; // volle Zeilen auf Breite ziehen
      let x = start;
      const notes = [];
      const rests = [];
      const bars = [];
      for (const mi of line.measures) {
        let nx = x + SCORE.measurePad * scale;
        for (const n of measures[mi]) {
          if (n.rest) {
            rests.push({ ...n, measure: mi, x: +(nx + (advance(n) / 2 - 2) * scale).toFixed(2) });
            nx += advance(n) * scale;
            continue;
          }
          const step = staffStep('treble', n.note);
          const x = nx + ((n.showAcc ? ACC_WIDTH : 0) + (widthOf(n) - (n.showAcc ? ACC_WIDTH : 0)) / 2 - 2) * scale;
          notes.push({ ...n, measure: mi, step, x: +x.toFixed(2), y: stepY(step), ledgerYs: ledgerSteps(step).map(stepY), stemUp: step < 4 });
          nx += widthOf(n) * scale;
        }
        x += natural[mi] * scale;
        bars.push(x);
      }
      return { index: li, first: li === 0, last, notes, rests, bars };
    }),
  };
}

// --- Formen (um den Notenmittelpunkt) ---

function ellipsePath(rx, ry, deg) {
  const c = Math.cos((deg * Math.PI) / 180) * rx;
  const s = Math.sin((deg * Math.PI) / 180) * rx;
  const f = (v) => +v.toFixed(3);
  return `M${f(-c)} ${f(-s)}A${rx} ${ry} ${deg} 1 0 ${f(c)} ${f(s)}A${rx} ${ry} ${deg} 1 0 ${f(-c)} ${f(-s)}Z`;
}
const HEAD_FILLED = ellipsePath(6.2, 4.6, -20);
const HEAD_HOLLOW = HEAD_FILLED + ellipsePath(4.9, 2.1, -32);
export const STEM_X = 5.6;

function flag(stemUp, end) {
  // Fähnchen einer Achtel am Halsende (oben rechts bzw. unten rechts)
  const x = stemUp ? STEM_X : -STEM_X;
  const d = stemUp ? 1 : -1;
  const y = end;
  return `<path class="flag" d="M${x} ${y}C${x + 1} ${y + 7 * d} ${x + 9} ${y + 9 * d} ${x + 7} ${y + 21 * d}C${x + 8} ${y + 13 * d} ${x + 4} ${y + 10 * d} ${x} ${y + 9 * d}Z"/>`;
}

// Pausen (absolute Höhe im System): Ganze hängt an der 4. Linie, Halbe liegt auf der Mittellinie
function restShape(r) {
  const l4 = stepY(6);
  const mid = stepY(4);
  const shapes = {
    w: `<path d="M-5 ${l4}h10v5h-10Z"/>`,
    h: `<path d="M-5 ${mid - 5}h10v5h-10Z"/>`,
    q: `<path d="M-2 ${mid - 15}L3.6 ${mid - 8.5}C1 ${mid - 6} 0.5 ${mid - 4} 3.6 ${mid + 0.5}L3 ${mid + 1}C0 ${mid - 0.5} -3 ${mid + 0.5} -1 ${mid + 4.5}C-4.2 ${mid + 2} -5.6 ${mid - 1.5} -0.6 ${mid - 2}L-3.2 ${mid - 6.5}C-0.6 ${mid - 8.5} 0 ${mid - 11} -2 ${mid - 15}Z"/>`,
    e: `<circle cx="-2" cy="${mid - 5.5}" r="2"/><path d="M-2.6 ${mid - 3.7}C-0.6 ${mid - 3} 1.6 ${mid - 4} 3.2 ${mid - 7}L4 ${mid - 6.6}L0 ${mid + 7}H-1.4L2.4 ${mid - 4.2}C0.8 ${mid - 2.6} -1.2 ${mid - 2.2} -2.6 ${mid - 3.7}Z"/>`,
    s: `<circle cx="-1" cy="${mid - 5.5}" r="2"/><circle cx="-2.6" cy="${mid - 0.5}" r="2"/><path d="M-1.6 ${mid - 3.7}C0.4 ${mid - 3} 2.6 ${mid - 4} 4.2 ${mid - 7}L5 ${mid - 6.6}L-0.4 ${mid + 12}H-1.8L1.6 ${mid}C0 ${mid + 1.4} -1.6 ${mid + 1.6} -3.2 ${mid + 1.3}L-3 ${mid + 0.6}C-1.2 ${mid + 0.9} 0.6 ${mid} 2.2 ${mid - 2.6}L3.2 ${mid - 4.2}C1.8 ${mid - 2.6} -0.2 ${mid - 2.2} -1.6 ${mid - 3.7}Z"/>`,
  };
  const dot = r.dotted ? `<circle class="dot" cx="7" cy="${stepY(5)}" r="1.5"/>` : '';
  return shapes[r.value] + dot;
}

// Haltebögen zwischen angebundenen Noten derselben Zeile (unter den Köpfen bei Hals oben, sonst darüber)
function tieArcs(notes) {
  return notes
    .map((n, k) => {
      const prev = notes[k - 1];
      if (!n.tiedFrom || !prev) return '';
      const d = n.stemUp ? 1 : -1;
      const x1 = prev.x + 4;
      const x2 = n.x - 4;
      const y = n.y + 6 * d;
      return `<path class="tie" d="M${x1} ${y}Q${(x1 + x2) / 2} ${y + 7 * d} ${x2} ${y}Q${(x1 + x2) / 2} ${y + 5 * d} ${x1} ${y}Z" fill="currentColor"/>`;
    })
    .join('');
}

function noteShape(n) {
  const middle = stepY(4);
  const parts = [];
  if (n.showAcc) parts.push(accidentalSvg(n.showAcc, n.value === 'w' ? -15 : -13, 0));
  if (n.value === 'w') parts.push(`<path fill-rule="evenodd" d="${WHOLE_NOTE}"/>`);
  else parts.push(`<path class="head" fill-rule="evenodd" d="${n.value === 'h' ? HEAD_HOLLOW : HEAD_FILLED}"/>`);
  let stem = null;
  if (n.value !== 'w') {
    // Hals mind. 3,5 Linienabstände, bei Noten weit außerhalb bis zur Mittellinie
    const len = Math.max(SCORE.stemLength, n.stemUp ? n.y - middle : middle - n.y);
    stem = n.stemUp ? { x: STEM_X, y1: -1, y2: -1 - len } : { x: -STEM_X, y1: 1, y2: 1 + len };
    parts.push(`<line class="stem" x1="${stem.x}" y1="${stem.y1}" x2="${stem.x}" y2="${stem.y2}" stroke="currentColor" stroke-width="1.2"/>`);
    if (n.value === 'e' || n.value === 's') parts.push(flag(n.stemUp, stem.y2));
    if (n.value === 's') parts.push(flag(n.stemUp, stem.y2 + (n.stemUp ? 7 : -7))); // Sechzehntel: zwei Fähnchen
  }
  if (n.dotted) {
    // Punkt rechts neben dem Kopf, bei Noten auf einer Linie im Zwischenraum darüber
    const dy = n.step % 2 === 0 ? -SPACE / 2 : 0;
    parts.push(`<circle class="dot" cx="${n.value === 'w' ? 12.5 : 10.5}" cy="${dy}" r="1.5"/>`);
  }
  return parts.join('');
}

// Eine Zeile als SVG. states: { [Notenindex]: 'right' | 'wrong' }, current: Index der aktuellen Note
export function renderScoreLine(layout, lineIndex, { states = {}, current = -1, label = 'Notenzeile' } = {}) {
  const g = GEOMETRY;
  const line = layout.lines[lineIndex];
  const top = stepY(8);
  const bottom = stepY(0);
  const staffLines = [0, 2, 4, 6, 8].map((s) => `<line class="staff-line" x1="${g.lineLeft}" y1="${stepY(s)}" x2="${layout.width - 4}" y2="${stepY(s)}"/>`).join('');
  const tx = SCORE.clefArea + layout.keySigWidth + 7;
  const time = line.first
    ? `<g class="time" font-family="'Times New Roman', Georgia, serif" font-weight="700" font-size="21" text-anchor="middle" fill="currentColor">` +
      `<text x="${tx}" y="${stepY(6) + 7.3}">${layout.time[0]}</text><text x="${tx}" y="${stepY(2) + 7.3}">${layout.time[1]}</text></g>`
    : '';
  const keySig = keySignatureNotes('treble', layout.key)
    .map((note, i) => accidentalSvg(keySignatureType(layout.key), SCORE.clefArea + 3 + i * 9, stepY(staffStep('treble', note))).replace('class="accidental"', 'class="accidental key"'))
    .join('');
  const cur = line.notes.find((n) => n.index === current);
  const cursor = cur ? `<rect class="cursor" x="${cur.x - 10}" y="3" width="20" height="${g.height - 6}" rx="5"/>` : '';
  const ledgers = line.notes
    .flatMap((n) => n.ledgerYs.map((y) => `<line class="ledger-line" data-index="${n.index}" x1="${+(n.x - SCORE.ledgerHalf).toFixed(2)}" y1="${y}" x2="${+(n.x + SCORE.ledgerHalf).toFixed(2)}" y2="${y}"/>`))
    .join('');
  const notes = line.notes
    .map(
      (n) =>
        `<g class="note${n.tiedFrom ? ' tied' : ''}${states[n.index] ? ` ${states[n.index]}` : ''}" data-note="${n.note}" data-index="${n.index ?? ''}" data-value="${n.value}${n.dotted ? '.' : ''}" ` +
        `transform="translate(${n.x} ${n.y})" fill="currentColor">${noteShape(n)}</g>`,
    )
    .join('');
  const bars = line.bars
    .map((x, i) => {
      const end = line.last && i === line.bars.length - 1;
      return end
        ? `<line class="bar-line" x1="${+(x - 5).toFixed(2)}" y1="${top}" x2="${+(x - 5).toFixed(2)}" y2="${bottom}" stroke-width="1.1"/>` +
            `<line class="bar-line final" x1="${+(x - 1.5).toFixed(2)}" y1="${top}" x2="${+(x - 1.5).toFixed(2)}" y2="${bottom}" stroke-width="3"/>`
        : `<line class="bar-line" x1="${+x.toFixed(2)}" y1="${top}" x2="${+x.toFixed(2)}" y2="${bottom}" stroke-width="1.1"/>`;
    })
    .join('');
  return (
    `<svg class="staff seq score" viewBox="0 0 ${layout.width} ${layout.height}" style="--seq-ratio: ${layout.width / layout.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">` +
    cursor +
    `<g class="staff-lines" stroke="currentColor" stroke-width="${g.lineWidth}">${staffLines}</g>` +
    `<g class="clef" data-clef="treble" transform="translate(${g.clefX} ${stepY(2)}) scale(${SPACE})" fill="currentColor">${CLEF_SHAPES.treble}</g>` +
    keySig +
    time +
    `<g class="ledger-lines" stroke="currentColor" stroke-width="${g.ledgerWidth}">${ledgers}</g>` +
    `<g class="bar-lines" stroke="currentColor">${bars}</g>` +
    tieArcs(line.notes) +
    line.rests.map((r) => `<g class="rest" data-value="${r.value}${r.dotted ? '.' : ''}" transform="translate(${r.x} 0)" fill="currentColor">${restShape(r)}</g>`).join('') +
    notes +
    (layout.lyrics
      ? `<g class="lyrics" font-size="${LYRIC_SIZE}" text-anchor="middle" fill="currentColor">` +
        line.notes
          .filter((n) => n.lyric)
          .map((n) => `<text class="lyric" data-index="${n.index}" x="${n.x}" y="${layout.height - 4}">${escapeXml(n.lyric)}</text>`)
          .join('') +
        '</g>'
      : '') +
    `</svg>`
  );
}

const escapeXml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
