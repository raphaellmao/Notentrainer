// Notendarstellung: Notensystem mit Schlüssel und einer ganzen Note als SVG.
// Liefert SVG-Text (kein DOM nötig), damit sich die Positionen in Node testen lassen.

import { CLEFS, staffStep, ledgerSteps, parseNote } from './notes.js';
import { CLEF_SHAPES, accidentalSvg } from './clefs.js';

export const SPACE = 10; // Abstand zweier Notenlinien in SVG-Einheiten

export const GEOMETRY = {
  width: 120,
  height: 96,
  bottomLineY: 68, // y der untersten Notenlinie; die oberste liegt bei 28
  lineLeft: 4,
  lineRight: 116,
  clefX: 9, // linker Rand des Schlüssels
  noteX: 74, // Mitte der Note
  lineWidth: 1.1,
  ledgerWidth: 1.6,
  ledgerHalf: 12, // halbe Länge einer Hilfslinie (Note ist 16,4 breit)
};

// Ganze Note um (0|0): ovaler Kopf mit schräger Öffnung
export const WHOLE_NOTE = (() => {
  const rx = 8.2;
  const ry = 5.4;
  const hrx = 4.0;
  const hry = 2.45;
  const tilt = -50; // Grad
  const c = Math.cos((tilt * Math.PI) / 180) * hrx;
  const s = Math.sin((tilt * Math.PI) / 180) * hrx;
  const f = (v) => +v.toFixed(3);
  return (
    `M${-rx} 0A${rx} ${ry} 0 1 0 ${rx} 0A${rx} ${ry} 0 1 0 ${-rx} 0Z` +
    `M${f(-c)} ${f(-s)}A${hrx} ${hry} ${tilt} 1 0 ${f(c)} ${f(s)}A${hrx} ${hry} ${tilt} 1 0 ${f(-c)} ${f(-s)}Z`
  );
})();

export const stepY = (step) => GEOMETRY.bottomLineY - (step * SPACE) / 2;

// Kreuz bzw. b vor der Note (Stammtöne ohne Zeichen)
function accidentalOf(note, x, y) {
  const { accidental } = parseNote(note);
  return accidental ? accidentalSvg(accidental, x, y) : '';
}

// Geometrie einer Note im Notensystem – daraus zeichnet renderStaff.
export function staffLayout(clef, note) {
  const step = staffStep(clef, note);
  return {
    clef,
    note,
    step,
    lineYs: [0, 2, 4, 6, 8].map(stepY),
    ledgerYs: ledgerSteps(step).map(stepY),
    noteX: GEOMETRY.noteX,
    noteY: stepY(step),
    clefY: stepY(CLEFS[clef].anchorStep),
  };
}

// --- Notenfolge: mehrere Noten nebeneinander (Stufe 3) ---

export const SEQUENCE = {
  clefArea: 40, // Platz für den Schlüssel
  gap: 26, // Abstand der Notenmitten
  right: 8,
  ledgerHalf: 11, // kürzer als bei Einzelnoten, damit sich Nachbar-Hilfslinien nicht berühren
};

export const sequenceWidth = (count) => SEQUENCE.clefArea + count * SEQUENCE.gap + SEQUENCE.right;

export function sequenceLayout(clef, notes) {
  return {
    clef,
    width: sequenceWidth(notes.length),
    lineYs: [0, 2, 4, 6, 8].map(stepY),
    clefY: stepY(CLEFS[clef].anchorStep),
    notes: notes.map((note, i) => {
      const step = staffStep(clef, note);
      return { note, step, x: SEQUENCE.clefArea + SEQUENCE.gap * (i + 0.5), y: stepY(step), ledgerYs: ledgerSteps(step).map(stepY) };
    }),
  };
}

// states[i]: 'right' | 'wrong' | undefined; current: Index der Note, die als Nächstes dran ist
export function renderSequence(clef, notes, { states = [], current = -1, label = 'Notenfolge' } = {}) {
  const g = GEOMETRY;
  const L = sequenceLayout(clef, notes);
  const lines = L.lineYs.map((y) => `<line class="staff-line" x1="${g.lineLeft}" y1="${y}" x2="${L.width - 4}" y2="${y}"/>`).join('');
  const cursor = L.notes[current]
    ? `<rect class="cursor" x="${L.notes[current].x - SEQUENCE.gap / 2 + 1}" y="3" width="${SEQUENCE.gap - 2}" height="${g.height - 6}" rx="5"/>`
    : '';
  const ledgers = L.notes
    .flatMap((n, i) =>
      n.ledgerYs.map((y) => `<line class="ledger-line" data-index="${i}" x1="${n.x - SEQUENCE.ledgerHalf}" y1="${y}" x2="${n.x + SEQUENCE.ledgerHalf}" y2="${y}"/>`),
    )
    .join('');
  const heads = L.notes
    .map(
      (n, i) =>
        `<g class="note${states[i] ? ` ${states[i]}` : ''}" data-note="${n.note}" data-index="${i}" transform="translate(${n.x} ${n.y})" fill="currentColor"><path fill-rule="evenodd" d="${WHOLE_NOTE}"/></g>`,
    )
    .join('');
  return (
    `<svg class="staff seq" viewBox="0 0 ${L.width} ${g.height}" style="--seq-ratio: ${L.width / g.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">` +
    cursor +
    `<g class="staff-lines" stroke="currentColor" stroke-width="${g.lineWidth}">${lines}</g>` +
    `<g class="clef" data-clef="${clef}" transform="translate(${g.clefX} ${L.clefY}) scale(${SPACE})" fill="currentColor">${CLEF_SHAPES[clef]}</g>` +
    `<g class="ledger-lines" stroke="currentColor" stroke-width="${g.ledgerWidth}">${ledgers}</g>` +
    heads +
    `</svg>`
  );
}

export function renderStaff(clef, note, { label = 'Notensystem mit einer Note' } = {}) {
  const g = GEOMETRY;
  const L = staffLayout(clef, note);
  const lines = L.lineYs
    .map((y) => `<line class="staff-line" x1="${g.lineLeft}" y1="${y}" x2="${g.lineRight}" y2="${y}"/>`)
    .join('');
  const ledgers = L.ledgerYs
    .map((y) => `<line class="ledger-line" x1="${L.noteX - g.ledgerHalf}" y1="${y}" x2="${L.noteX + g.ledgerHalf}" y2="${y}"/>`)
    .join('');
  return (
    `<svg class="staff" viewBox="0 0 ${g.width} ${g.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">` +
    `<g class="staff-lines" stroke="currentColor" stroke-width="${g.lineWidth}">${lines}</g>` +
    `<g class="clef" data-clef="${clef}" transform="translate(${g.clefX} ${L.clefY}) scale(${SPACE})" fill="currentColor">${CLEF_SHAPES[clef]}</g>` +
    `<g class="ledger-lines" stroke="currentColor" stroke-width="${g.ledgerWidth}">${ledgers}</g>` +
    accidentalOf(note, L.noteX - 17, L.noteY) +
    `<g class="note" data-note="${note}" transform="translate(${L.noteX} ${L.noteY})" fill="currentColor"><path fill-rule="evenodd" d="${WHOLE_NOTE}"/></g>` +
    `</svg>`
  );
}
