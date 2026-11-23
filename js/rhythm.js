// Rhythmus: „Im Takt spielen“ – Zeitplan eines Lieds und Bewertung der Zeitpunkte.
// Reine Rechnung ohne DOM. Alle Zeiten in Millisekunden ab dem ersten Schlag nach dem Einzählen.

import { parseMelody } from './score.js';

// Schlag des Metronoms je Taktart: bei 6/8, 9/8, 12/8 die punktierte Viertel, sonst der Nenner
export function metronomeBeat([top, bottom]) {
  const compound = bottom === 8 && top % 3 === 0 && top > 3;
  const beatQuarters = compound ? 1.5 : 4 / bottom;
  return { beatQuarters, perBar: compound ? top / 3 : top };
}

// Wann ist jede anzuschlagende Note fällig? factor: Tempo-Faktor (0,6 = langsamer)
export function schedule(song, factor = 1) {
  const quarterMs = 60000 / (song.tempo * factor);
  const notes = [];
  let t = 0;
  for (const n of parseMelody(song.melody).flat()) {
    const ms = n.beats * quarterMs;
    if (n.tiedFrom && notes.length) notes[notes.length - 1].durMs += ms; // Haltebogen verlängert
    else if (!n.rest) notes.push({ index: n.index, note: n.note, at: t, durMs: ms });
    t += ms;
  }
  const { beatQuarters, perBar } = metronomeBeat(song.time);
  return { quarterMs, beatMs: beatQuarters * quarterMs, perBar, notes, totalMs: t };
}

// Spielraum für „im Takt“: ein Fünftel einer Viertel, mindestens 90, höchstens 180 ms
export const tolerance = (quarterMs) => Math.min(180, Math.max(90, quarterMs * 0.2));

// delta = gespielter Zeitpunkt − fälliger Zeitpunkt
export function judge(delta, quarterMs) {
  const tol = tolerance(quarterMs);
  if (Math.abs(delta) <= tol) return 'ok';
  return delta < 0 ? 'early' : 'late';
}

// Ab wann gilt eine Note als verpasst? (Spielraum, bei langen Noten bis zur Hälfte ihrer Dauer)
export const missedAfter = (note, quarterMs) => note.at + Math.max(tolerance(quarterMs), note.durMs * 0.5);

// Ergebnis einer Runde: [{ timing: 'ok'|'early'|'late'|'missed', delta }]
export function summarizeRhythm(results) {
  const count = (k) => results.filter((r) => r.timing === k).length;
  const played = results.filter((r) => r.timing !== 'missed');
  const avgAbs = played.length ? played.reduce((s, r) => s + Math.abs(r.delta), 0) / played.length : 0;
  return { total: results.length, ok: count('ok'), early: count('early'), late: count('late'), missed: count('missed'), avgAbsMs: Math.round(avgAbs) };
}

export const TIMING_TEXT = { ok: 'im Takt', early: 'zu früh', late: 'zu spät', missed: 'verpasst' };

// --- Takt-Abgleich ---
// Lautsprecher (vor allem Bluetooth), Touchscreen und Mikrofon verzögern unterschiedlich stark. Der Nutzer
// tippt bzw. spielt zu gleichmäßigen Klicks; die typische Abweichung wird später von jeder Wertung abgezogen.
export const SYNC = { tempo: 100, countIn: 4, beats: 12, min: 6, maxOffset: 300 };

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// taps, clicks: Zeitpunkte in ms; je Klick zählt der nächstgelegene Tipp (höchstens knapp eine halbe Schlaglänge entfernt)
export function estimateOffset(taps, clicks, beatMs) {
  const best = new Map();
  for (const t of taps) {
    let nearest = null;
    for (const c of clicks) if (nearest === null || Math.abs(t - c) < Math.abs(t - nearest)) nearest = c;
    if (nearest === null) continue;
    const d = t - nearest;
    if (Math.abs(d) > beatMs * 0.45) continue;
    if (!best.has(nearest) || Math.abs(d) < Math.abs(best.get(nearest))) best.set(nearest, d);
  }
  const deltas = [...best.values()];
  if (deltas.length < SYNC.min) return null;
  const mid = median(deltas);
  const spread = median(deltas.map((d) => Math.abs(d - mid)));
  const offset = Math.round(Math.max(-SYNC.maxOffset, Math.min(SYNC.maxOffset, mid)));
  return { offset, spread: Math.round(spread), count: deltas.length, steady: spread <= 45 };
}

// Gespeicherte Werte prüfen: { touch, mic } in ms, sonst 0
export function cleanOffsets(saved) {
  const ok = (v) => (Number.isFinite(v) && Math.abs(v) <= SYNC.maxOffset ? Math.round(v) : 0);
  return { touch: ok(saved?.touch), mic: ok(saved?.mic) };
}

// Hinweis nach einer Runde: lag fast alles gleich weit daneben, ist eher die Technik verzögert als der Spieler
export function systematicShift(results, quarterMs) {
  const played = results.filter((r) => r.timing !== 'missed' && Number.isFinite(r.delta)).map((r) => r.delta);
  if (played.length < 6) return 0;
  const mid = median(played);
  const sameSide = played.filter((d) => Math.sign(d) === Math.sign(mid)).length / played.length;
  return Math.abs(mid) >= Math.max(70, tolerance(quarterMs) * 0.6) && sameSide >= 0.8 ? Math.round(mid) : 0;
}
