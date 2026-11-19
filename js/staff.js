// Notendarstellung: Notensystem mit Schlüssel und einer ganzen Note als SVG.
// Liefert SVG-Text (kein DOM nötig), damit sich die Positionen in Node testen lassen.

import { CLEFS, staffStep, ledgerSteps } from './notes.js';
import { CLEF_SHAPES } from './clefs.js';

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
const WHOLE_NOTE = (() => {
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
    `<g class="note" data-note="${note}" transform="translate(${L.noteX} ${L.noteY})" fill="currentColor"><path fill-rule="evenodd" d="${WHOLE_NOTE}"/></g>` +
    `</svg>`
  );
}
