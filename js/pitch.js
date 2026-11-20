// Tonerkennung: aus einem Stück Mikrofon-Signal die gespielte Note bestimmen.
// Reine Rechnung ohne DOM – läuft im Browser und in Node (Tests).
//
// Verfahren: YIN (de Cheveigné & Kawahara 2002). Es sucht die Periodenlänge, nach der
// sich das Signal wiederholt. Das funktioniert auch bei Klaviertönen, deren Grundton
// schwächer ist als die Obertöne (tiefe Lagen, Handy-Mikrofon).

const MIN_FREQ = 60; // knapp unter C (65 Hz)
const MAX_FREQ = 1400; // knapp über c³ (1047 Hz)
const THRESHOLD = 0.15;

export const midiFromFreq = (freq) => 69 + 12 * Math.log2(freq / 440);

// Grundfrequenz eines Signalausschnitts (Float32Array, Werte −1…1).
// Ergebnis: { freq, clarity } oder null, wenn kein klarer Ton drin ist.
export function detectPitch(buf, sampleRate) {
  const maxLag = Math.min(Math.floor(sampleRate / MIN_FREQ), Math.floor(buf.length / 2) - 1);
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const width = buf.length - maxLag - 1;

  // Differenzfunktion und kumuliert normierte Differenz
  const cmnd = new Float32Array(maxLag + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    running += sum;
    cmnd[tau] = running ? (sum * tau) / running : 1;
  }

  // erste Senke unter der Schwelle, dann bis zu ihrem Tiefpunkt
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < THRESHOLD) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Parabel durch die Nachbarn für eine Periode zwischen zwei Abtastwerten
  let better = tau;
  if (tau > 1 && tau < maxLag) {
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) better = tau + (a - c) / (2 * denom);
  }
  return { freq: sampleRate / better, clarity: 1 - cmnd[tau] };
}

export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// Ein Mikrofon-Ausschnitt → { rms, midi } (midi ganzzahlig oder null).
// Halbiert vorher die Abtastrate (Mittelwert je zwei Werte): Für Töne bis 1400 Hz reicht
// das völlig und spart drei Viertel der Rechenzeit.
export function analyseFrame(buf, sampleRate) {
  const level = rms(buf);
  const half = new Float32Array(buf.length >> 1);
  for (let i = 0; i < half.length; i++) half[i] = (buf[2 * i] + buf[2 * i + 1]) / 2;
  const pitch = level > 0.002 ? detectPitch(half, sampleRate / 2) : null;
  const midi = pitch && pitch.clarity >= 0.8 ? Math.round(midiFromFreq(pitch.freq)) : null;
  return { rms: level, midi };
}

// Erkennt einzelne Anschläge: Eine Note zählt erst, wenn die Lautstärke deutlich ansteigt
// (neuer Anschlag) und danach mehrere Ausschnitte hintereinander denselben Ton zeigen.
// Ein noch nachklingender alter Ton löst deshalb keine neue Antwort aus.
export class NoteListener {
  constructor({ minRms = 0.006, rise = 1.8, stableFrames = 3, windowMs = 500 } = {}) {
    this.minRms = minRms;
    this.rise = rise;
    this.stableFrames = stableFrames;
    this.windowMs = windowMs;
    this.floor = null; // Grundrauschen
    this.history = []; // Lautstärke der letzten 200 ms
    this.onsetAt = -Infinity;
    this.open = false;
    this.candidate = null;
    this.count = 0;
  }

  // Liefert die MIDI-Nummer, sobald ein neuer Anschlag sicher erkannt ist, sonst null.
  feed(level, midi, t) {
    this.floor = this.floor === null || level < this.floor ? level : this.floor + (level - this.floor) * 0.02;
    this.history = this.history.filter((h) => t - h.t <= 200);
    const recentMin = this.history.length ? Math.min(...this.history.map((h) => h.level)) : level;
    this.history.push({ t, level });

    const loudEnough = level > Math.max(this.minRms, this.floor * 3);
    if (loudEnough && level > recentMin * this.rise) {
      this.onsetAt = t;
      this.open = true;
      this.candidate = null;
      this.count = 0;
      this.history = [{ t, level }]; // ab hier zählt der neue Ton als Bezug
    }
    if (!this.open) return null;
    if (t - this.onsetAt > this.windowMs) {
      this.open = false;
      return null;
    }
    if (midi === null) return null;
    if (midi === this.candidate) this.count++;
    else {
      this.candidate = midi;
      this.count = 1;
    }
    if (this.count >= this.stableFrames) {
      this.open = false;
      return midi;
    }
    return null;
  }
}
