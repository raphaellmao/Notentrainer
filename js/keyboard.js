// Klaviatur: Tastenlayout, Treffer-Erkennung beim Antippen und SVG-Zeichnung.
// Das Layout rechnet in Bildschirmpixeln (Breite × Höhe des Klaviatur-Bereichs),
// damit Tasten und der Punkt fürs mittlere C nicht verzerrt werden.

import { keysInRange, isNatural, parseNote } from './notes.js';

const BLACK_WIDTH = 0.6; // Anteil einer weißen Taste
const BLACK_HEIGHT = 0.6; // Anteil der Klaviaturhöhe
// Wie beim echten Klavier sitzen die schwarzen Tasten leicht versetzt (Anteil der eigenen Breite)
const BLACK_SHIFT = { C: -0.12, D: 0.12, F: -0.15, G: 0, A: 0.15 };

export const MIDDLE_C = 'C4';

export function keyboardLayout([low, high], width, height) {
  const notes = keysInRange(low, high);
  const whiteCount = notes.filter(isNatural).length;
  const ww = width / whiteCount;
  const bw = ww * BLACK_WIDTH;
  const bh = height * BLACK_HEIGHT;
  const keys = [];
  let whiteIndex = 0;
  for (const note of notes) {
    if (isNatural(note)) {
      keys.push({ note, black: false, x: whiteIndex * ww, y: 0, w: ww, h: height });
      whiteIndex++;
    } else {
      // schwarze Taste sitzt auf der Grenze zur nächsten weißen Taste
      const center = whiteIndex * ww + BLACK_SHIFT[parseNote(note).letter] * bw;
      keys.push({ note, black: true, x: center - bw / 2, y: 0, w: bw, h: bh });
    }
  }
  return { range: [low, high], width, height, whiteWidth: ww, keys };
}

export const keyForNote = (layout, note) => layout.keys.find((k) => k.note === note) || null;

// Welche Taste liegt unter dem Punkt (x|y)? Schwarze Tasten liegen oben drauf.
export function keyAt(layout, x, y) {
  for (const k of layout.keys) {
    if (k.black && x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) return k.note;
  }
  const whites = layout.keys.filter((k) => !k.black);
  const i = Math.min(whites.length - 1, Math.max(0, Math.floor(x / layout.whiteWidth)));
  return whites[i].note;
}

// Bildschirmpunkt → Note. rect = getBoundingClientRect() der gezeichneten Klaviatur.
// Rechnet anteilig um, damit Zeichnung und Treffer immer übereinstimmen.
export function keyAtClientPoint(layout, rect, clientX, clientY) {
  return keyAt(layout, ((clientX - rect.left) * layout.width) / rect.width, ((clientY - rect.top) * layout.height) / rect.height);
}

const num = (v) => +v.toFixed(2);

// Rechteck mit abgerundeten unteren Ecken
function keyPath({ x, y, w, h }, r) {
  return (
    `M${num(x)} ${num(y)}H${num(x + w)}V${num(y + h - r)}` +
    `Q${num(x + w)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)}H${num(x + r)}` +
    `Q${num(x)} ${num(y + h)} ${num(x)} ${num(y + h - r)}Z`
  );
}

// marks: { [note]: 'right' | 'wrong' } färbt Tasten grün bzw. rot
export function renderKeyboard(layout, { marks = {} } = {}) {
  const { width, height, whiteWidth: ww } = layout;
  const gap = Math.min(1.5, ww * 0.05);
  const cls = (k) => `key ${k.black ? 'black' : 'white'}${marks[k.note] ? ` ${marks[k.note]}` : ''}`;
  const whites = layout.keys
    .filter((k) => !k.black)
    .map((k) => `<path class="${cls(k)}" data-note="${k.note}" d="${keyPath({ ...k, x: k.x + gap / 2, w: k.w - gap }, Math.min(6, ww * 0.15))}"/>`)
    .join('');
  const blacks = layout.keys
    .filter((k) => k.black)
    .map((k) => `<path class="${cls(k)}" data-note="${k.note}" d="${keyPath(k, Math.min(3, k.w * 0.12))}"/>`)
    .join('');
  const c = keyForNote(layout, MIDDLE_C);
  const dot = c
    ? `<circle class="middle-c" cx="${num(c.x + c.w / 2)}" cy="${num(height - Math.min(c.w * 0.55, height * 0.12))}" r="${num(Math.min(c.w * 0.13, 5))}"/>`
    : '';
  return (
    `<svg class="keyboard" viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `${whites}${dot}${blacks}</svg>`
  );
}
