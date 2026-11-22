// Einmessen: Wie hoch ist das eigene Klavier gestimmt?
// Reine Rechnung ohne DOM. Eingabe: gemessene Frequenzen einzeln gespielter weißer Tasten.
//
// Ein Cent ist ein Hundertstel Halbton. Ein Klavier, das lange nicht gestimmt wurde, liegt oft
// 10–40 Cent zu tief, manchmal fast einen Halbton. Damit die App solche Töne trotzdem der
// richtigen Taste zuordnet, rechnet sie mit der gemessenen Stimmung statt mit 440 Hz.

import { isNatural, noteFromMidi } from './notes.js';

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

// Abweichung in Cent bei einer angenommenen Verstimmung offset: auf welche Note fällt der Ton?
function mapToNote(freq, offset) {
  const exact = 69 + 12 * Math.log2(freq / 440) - offset / 100;
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}

export const MIN_SAMPLES = 5;

// Sammelt beim Einmessen pro Anschlag eine Frequenz (Median über 6 eindeutige Messfenster)
export class TuningSession {
  constructor() {
    this.samples = [];
    this.collect = null;
  }

  // frame: { freq, clarity } aus analyseFrame; attack: Anschlagserkennung hat gerade einen Ton gemeldet
  // Rückgabe true, wenn ein neuer Ton fertig gemessen ist
  feed(frame, attack) {
    if (attack) this.collect = [];
    if (this.collect && frame.freq && frame.clarity >= 0.9) {
      this.collect.push(frame.freq);
      if (this.collect.length >= 6) {
        this.samples.push(median(this.collect));
        this.collect = null;
        return true;
      }
    }
    return false;
  }

  get result() {
    return estimateTuning(this.samples);
  }

  // laufende Schätzung schon ab 2 Tönen – damit das Live-Stimmgerät die richtige Taste zeigt
  get refA() {
    return estimateTuning(this.samples, 2)?.refA ?? null;
  }
}

// Für die Live-Anzeige: nächstliegende Note und Abweichung in Cent bei Stimmung refA
export function nearestNote(freq, refA = 440) {
  const exact = 69 + 12 * Math.log2(freq / refA);
  const midi = Math.round(exact);
  return { note: noteFromMidi(midi), cents: Math.round((exact - midi) * 100) };
}

// samples: Frequenzen (Hz), je eine pro angeschlagener Taste – nur weiße Tasten spielen!
// Ergebnis: { cents, refA, spread, notes: [{ note, cents }], rating } oder null bei zu wenig Daten.
export function estimateTuning(samples, minSamples = MIN_SAMPLES) {
  if (samples.length < minSamples) return null;
  // Abweichung jedes Tons zum nächsten Halbton, um den ersten Ton herum „ausgerollt“,
  // damit Werte knapp über −50 und knapp unter +50 Cent nicht auseinanderfallen
  const first = mapToNote(samples[0], 0).cents;
  const raw = samples.map((f) => {
    let c = mapToNote(f, 0).cents;
    while (c - first > 50) c -= 100;
    while (first - c > 50) c += 100;
    return c;
  });
  const base = median(raw);

  // Halbton-Zweideutigkeit auflösen: Bei welcher Annahme landen die Töne auf weißen Tasten?
  let best = null;
  for (const offset of [base, base - 100, base + 100]) {
    const white = samples.filter((f) => isNatural(noteFromMidi(mapToNote(f, offset).midi))).length;
    if (!best || white > best.white || (white === best.white && Math.abs(offset) < Math.abs(best.offset))) best = { offset, white };
  }
  const offset = best.offset;
  const notes = samples.map((f) => {
    const { midi, cents } = mapToNote(f, 0);
    const m = mapToNote(f, offset);
    // Abweichung der einzelnen Taste gegenüber Kammerton 440 Hz
    return { note: noteFromMidi(m.midi), cents: Math.round((midi - m.midi) * 100 + cents) };
  });
  const spread = Math.sqrt(notes.reduce((s, n) => s + (n.cents - offset) ** 2, 0) / notes.length);
  const abs = Math.abs(offset);
  return {
    cents: Math.round(offset),
    refA: 440 * 2 ** (offset / 1200),
    spread: Math.round(spread),
    whiteShare: best.white / samples.length,
    notes,
    rating: abs < 10 ? 'gut' : abs < 30 ? 'leicht' : 'deutlich',
  };
}
