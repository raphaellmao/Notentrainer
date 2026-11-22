// Notensatz für Lieder (Stufe 4): Notenwerte, Hälse, Fähnchen, Punkte, Taktstriche, Taktart.
// Liefert SVG-Text zeilenweise, damit sich alles in Node prüfen lässt.
//
// Liedschreibweise: Note + Wert, Takte durch „|“ getrennt, z. B. "C4q D4q E4h | G4w".
// Werte: w = Ganze, h = Halbe, q = Viertel, e = Achtel; ein Punkt dahinter verlängert um die Hälfte.

import { staffStep, ledgerSteps, isNatural } from './notes.js';
import { GEOMETRY, SPACE, stepY, WHOLE_NOTE } from './staff.js';
import { CLEF_SHAPES } from './clefs.js';

export const BEATS = { w: 4, h: 2, q: 1, e: 0.5 }; // in Vierteln

export const SCORE = {
  clefArea: 40,
  timeSigWidth: 16,
  lineContent: 170, // Breite für Takte pro Zeile (danach Umbruch)
  right: 6,
  measurePad: 8, // Abstand vom Taktstrich zur ersten Note
  ledgerHalf: 8.5,
  stemLength: 35,
};

// "C4q." → { note: 'C4', value: 'q', dotted: true, beats: 1.5 }
export function parseToken(token) {
  const m = /^([A-G][0-9])([whqe])(\.?)$/.exec(token);
  if (!m) throw new Error(`Unbekannte Note im Lied: ${token}`);
  const [, note, value, dot] = m;
  if (!isNatural(note)) throw new Error(`Nur Stammtöne: ${token}`);
  return { note, value, dotted: dot === '.', beats: BEATS[value] * (dot ? 1.5 : 1) };
}

// Lied-Text → Takte mit Noten (jede Note mit fortlaufendem Index)
export function parseMelody(text) {
  let index = 0;
  return text
    .split('|')
    .map((bar) => bar.trim())
    .filter(Boolean)
    .map((bar) => bar.split(/\s+/).map((t) => ({ ...parseToken(t), index: index++ })));
}

// Taktart → Länge eines Takts in Vierteln (6/8 = 3 Viertel)
export const measureBeats = ([top, bottom]) => (top * 4) / bottom;

const advance = (n) => Math.max(19, 14 + 4 * n.beats); // horizontaler Platz einer Note

// Zeilen aufteilen und Notenpositionen festlegen
export function layoutScore(song) {
  const measures = parseMelody(song.melody);
  const natural = measures.map((m) => SCORE.measurePad + m.reduce((s, n) => s + advance(n), 0) + 3);
  const lines = [];
  let current = null;
  measures.forEach((m, i) => {
    const room = SCORE.lineContent - (lines.length === 0 && !current ? SCORE.timeSigWidth : 0);
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
    lines: lines.map((line, li) => {
      const start = SCORE.clefArea + (li === 0 ? SCORE.timeSigWidth : 0);
      const last = li === lines.length - 1;
      const scale = last ? 1 : line.room / line.width; // volle Zeilen auf Breite ziehen
      let x = start;
      const notes = [];
      const bars = [];
      for (const mi of line.measures) {
        let nx = x + SCORE.measurePad * scale;
        for (const n of measures[mi]) {
          const step = staffStep('treble', n.note);
          notes.push({ ...n, measure: mi, step, x: +(nx + (advance(n) * scale) / 2 - 2).toFixed(2), y: stepY(step), ledgerYs: ledgerSteps(step).map(stepY), stemUp: step < 4 });
          nx += advance(n) * scale;
        }
        x += natural[mi] * scale;
        bars.push(x);
      }
      return { index: li, first: li === 0, last, notes, bars };
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

function noteShape(n) {
  const middle = stepY(4);
  const parts = [];
  if (n.value === 'w') parts.push(`<path fill-rule="evenodd" d="${WHOLE_NOTE}"/>`);
  else parts.push(`<path class="head" fill-rule="evenodd" d="${n.value === 'h' ? HEAD_HOLLOW : HEAD_FILLED}"/>`);
  let stem = null;
  if (n.value !== 'w') {
    // Hals mind. 3,5 Linienabstände, bei Noten weit außerhalb bis zur Mittellinie
    const len = Math.max(SCORE.stemLength, n.stemUp ? n.y - middle : middle - n.y);
    stem = n.stemUp ? { x: STEM_X, y1: -1, y2: -1 - len } : { x: -STEM_X, y1: 1, y2: 1 + len };
    parts.push(`<line class="stem" x1="${stem.x}" y1="${stem.y1}" x2="${stem.x}" y2="${stem.y2}" stroke="currentColor" stroke-width="1.2"/>`);
    if (n.value === 'e') parts.push(flag(n.stemUp, stem.y2));
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
  const time = line.first
    ? `<g class="time" font-family="'Times New Roman', Georgia, serif" font-weight="700" font-size="21" text-anchor="middle" fill="currentColor">` +
      `<text x="${SCORE.clefArea + 7}" y="${stepY(6) + 7.3}">${layout.time[0]}</text><text x="${SCORE.clefArea + 7}" y="${stepY(2) + 7.3}">${layout.time[1]}</text></g>`
    : '';
  const cur = line.notes.find((n) => n.index === current);
  const cursor = cur ? `<rect class="cursor" x="${cur.x - 10}" y="3" width="20" height="${g.height - 6}" rx="5"/>` : '';
  const ledgers = line.notes
    .flatMap((n) => n.ledgerYs.map((y) => `<line class="ledger-line" data-index="${n.index}" x1="${+(n.x - SCORE.ledgerHalf).toFixed(2)}" y1="${y}" x2="${+(n.x + SCORE.ledgerHalf).toFixed(2)}" y2="${y}"/>`))
    .join('');
  const notes = line.notes
    .map(
      (n) =>
        `<g class="note${states[n.index] ? ` ${states[n.index]}` : ''}" data-note="${n.note}" data-index="${n.index}" data-value="${n.value}${n.dotted ? '.' : ''}" ` +
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
    `<svg class="staff seq score" viewBox="0 0 ${layout.width} ${g.height}" style="--seq-ratio: ${layout.width / g.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">` +
    cursor +
    `<g class="staff-lines" stroke="currentColor" stroke-width="${g.lineWidth}">${staffLines}</g>` +
    `<g class="clef" data-clef="treble" transform="translate(${g.clefX} ${stepY(2)}) scale(${SPACE})" fill="currentColor">${CLEF_SHAPES.treble}</g>` +
    time +
    `<g class="ledger-lines" stroke="currentColor" stroke-width="${g.ledgerWidth}">${ledgers}</g>` +
    `<g class="bar-lines" stroke="currentColor">${bars}</g>` +
    notes +
    `</svg>`
  );
}
