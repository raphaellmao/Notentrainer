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
