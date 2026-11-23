// Tonerkennung: aus einem Stück Mikrofon-Signal die gespielte Note bestimmen.
// Reine Rechnung ohne DOM – läuft im Browser und in Node (Tests).
//
// Verfahren: YIN (de Cheveigné & Kawahara 2002). Es sucht die Periodenlänge, nach der
// sich das Signal wiederholt. Das funktioniert auch bei Klaviertönen, deren Grundton
// schwächer ist als die Obertöne (tiefe Lagen, Handy-Mikrofon).

const MIN_FREQ = 60; // knapp unter C (65 Hz)
const MAX_FREQ = 1400; // knapp über c³ (1047 Hz)
const THRESHOLD = 0.15;

// refA: Frequenz des a¹ (Kammerton 440 Hz; nach dem Einmessen die Stimmung des eigenen Klaviers)
export const midiFromFreq = (freq, refA = 440) => 69 + 12 * Math.log2(freq / refA);

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

// Ein Mikrofon-Ausschnitt → { rms, hf, midi } (midi ganzzahlig oder null).
// hf ist der Höhenanteil (Lautstärke der Signal-Änderung): Er springt bei jedem Hammeranschlag
// hoch, weil die hohen Obertöne eines klingenden Tons schnell verklingen.
// Halbiert vor der Tonhöhen-Suche die Abtastrate (Mittelwert je zwei Werte): Für Töne bis
// 1400 Hz reicht das völlig und spart drei Viertel der Rechenzeit.
export function analyseFrame(buf, sampleRate, refA = 440) {
  const level = rms(buf);
  let diff = 0;
  for (let i = 1; i < buf.length; i++) diff += (buf[i] - buf[i - 1]) ** 2;
  const hf = Math.sqrt(diff / (buf.length - 1));
  const half = new Float32Array(buf.length >> 1);
  for (let i = 0; i < half.length; i++) half[i] = (buf[2 * i] + buf[2 * i + 1]) / 2;
  const pitch = level > 0.002 ? detectPitch(half, sampleRate / 2) : null;
  const midi = pitch && pitch.clarity >= 0.8 ? Math.round(midiFromFreq(pitch.freq, refA)) : null;
  return { rms: level, hf, midi, freq: pitch?.freq ?? null, clarity: pitch?.clarity ?? 0, rise: attackRise(buf, sampleRate), spec: magnitudeSpectrum(buf), sampleRate, refA };
}

// Anstiegszeit (ms) eines frischen Einsatzes im Fenster: von 20 % auf 80 % der Spitze.
// Klavier (Hammeranschlag): wenige Millisekunden. Stimme: weicher Einsatz, deutlich länger.
// null, wenn im Fenster kein Einsatz aus der Stille zu sehen ist (z. B. alter Ton klingt noch).
export function attackRise(buf, sampleRate) {
  const block = Math.max(1, Math.round(sampleRate * 0.005)); // 5-ms-Blöcke
  const n = Math.floor(buf.length / block);
  const env = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let sum = 0;
    for (let i = b * block; i < (b + 1) * block; i++) sum += buf[i] * buf[i];
    env[b] = Math.sqrt(sum / block);
  }
  let peak = 0;
  let at = -1;
  for (let b = 0; b < n; b++) if (env[b] > peak) [peak, at] = [env[b], b];
  if (peak < 0.005) return null;
  let lo = -1;
  for (let b = at; b >= 0; b--) if (env[b] < 0.2 * peak) { lo = b; break; }
  if (lo < 0) return null;
  let hi = lo;
  while (hi < at && env[hi] < 0.8 * peak) hi++;
  return (hi - lo) * 5;
}

// Betragsspektrum (Hann-Fenster, FFT) – nur für Längen, die Zweierpotenzen sind
const fftTables = new Map();
export function magnitudeSpectrum(buf) {
  const n = buf.length;
  if (n < 2 || (n & (n - 1)) !== 0) return null;
  let tab = fftTables.get(n);
  if (!tab) {
    const hann = new Float32Array(n).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    const rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float32Array(n / 2).map((_, i) => Math.cos((-2 * Math.PI * i) / n));
    const sin = new Float32Array(n / 2).map((_, i) => Math.sin((-2 * Math.PI * i) / n));
    tab = { hann, rev, cos, sin };
    fftTables.set(n, tab);
  }
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[tab.rev[i]] = buf[i] * tab.hann[i];
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j++) {
        const a = start + j;
        const b = a + half;
        const wr = tab.cos[j * step];
        const wi = tab.sin[j * step];
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

// Stärke des Spektrums bei einer Frequenz (größter Wert im Umkreis von ±1 Frequenzband)
function magAt(spec, freq, sampleRate) {
  const k = Math.round((freq * spec.length * 2) / sampleRate);
  let m = 0;
  for (let i = Math.max(0, k - 1); i <= Math.min(spec.length - 1, k + 1); i++) m = Math.max(m, spec[i]);
  return m;
}

// Ist am Grundton oder ersten Oberton dieser Note neue Energie aufgetaucht (seit ref)?
// Verhindert „virtuelle Grundtöne“ aus Mischklängen (z. B. mit Pedal gehaltene Akkorde).
export function hasNewEnergy(midi, spec, ref, sampleRate, refA = 440) {
  if (!spec || !ref) return true;
  let peak = 0;
  for (let i = 0; i < spec.length; i++) peak = Math.max(peak, spec[i]);
  const f0 = refA * 2 ** ((midi - 69) / 12);
  return [f0, 2 * f0].some((f) => {
    const now = magAt(spec, f, sampleRate);
    return now > 2 * magAt(ref, f, sampleRate) && now > 0.05 * peak;
  });
}

// Schwankung der Tonhöhe in Cent (größter minus kleinster Wert)
function wobble(freqs) {
  if (freqs.length < 2) return 0;
  const cents = freqs.map((f) => 1200 * Math.log2(f));
  return Math.max(...cents) - Math.min(...cents);
}

// Erkennt einzelne gespielte Noten. Eine Note zählt, wenn
//   a) ein neuer Anschlag zu hören ist (Höhenanteil oder Lautstärke steigen deutlich) und danach
//      mehrere Ausschnitte hintereinander denselben Ton zeigen – so zählt auch dieselbe Note zweimal, oder
//   b) die Tonhöhe stabil auf einen anderen Ton wechselt (leiser Anschlag unter einem lauten).
// Ein bloß nachklingender Ton löst keine neue Antwort aus.
export class NoteListener {
  constructor({ minRms = 0.006, rise = 1.6, levelRise = 2, stableFrames = 3, changeFrames = 4, windowMs = 600, settleMs = 50, refractoryMs = 250, pianoOnly = true } = {}) {
    // Klavier-Filter: Stimme (weicher Einsatz, schwankende Tonhöhe) zählt nicht
    this.pianoOnly = pianoOnly;
    this.maxRiseMs = 35; // Klavier erreicht seine Lautstärke schneller
    this.maxWobbleCents = 15; // Klavierton steht still; Stimme hat Vibrato oder gleitet
    this.changeFrames = changeFrames; // für Regel b) etwas strenger
    this.run = { midi: null, count: 0 }; // gleiche Tonhöhe in Folge
    this.sounding = null; // zuletzt gemeldete, noch klingende Note
    this.minRms = minRms;
    this.rise = rise; // Anstieg des Höhenanteils (Hammeranschlag)
    this.levelRise = levelRise; // oder Anstieg der Lautstärke (tiefe Töne haben kaum Höhen)
    this.stableFrames = stableFrames;
    this.windowMs = windowMs;
    this.settleMs = settleMs; // kurz warten, bis das Messfenster vom neuen Ton gefüllt ist
    this.refractoryMs = refractoryMs; // so lange nach einem Anschlag keinen neuen erkennen
    this.floor = null; // Grundrauschen: folgt dem Minimum, steigt nur langsam (≈ +35 % je Sekunde)
    this.history = []; // Lautstärke und Höhenanteil der letzten 200 ms
    this.onsetAt = -Infinity;
    this.open = false;
    this.candidate = null;
    this.count = 0;
  }

  // Liefert die MIDI-Nummer, sobald ein neuer Anschlag sicher erkannt ist, sonst null.
  // frame (optional): { spec, sampleRate } aus analyseFrame – für die Plausibilitätsprüfung
  feed(level, midi, t, hf = level, frame = null) {
    const prevSpec = this.lastSpec ?? null;
    this.lastSpec = frame?.spec ?? null;
    this.sampleRate = frame?.sampleRate ?? this.sampleRate;
    this.refA = frame?.refA ?? this.refA ?? 440;
    this.floor = this.floor === null ? level : Math.min(level, this.floor * 1.01);
    this.history = this.history.filter((h) => t - h.t <= 200);
    const minHf = this.history.length ? Math.min(...this.history.map((h) => h.hf)) : hf;
    const minLevel = this.history.length ? Math.min(...this.history.map((h) => h.level)) : level;
    this.history.push({ t, hf, level });

    const loudEnough = level > Math.max(this.minRms, this.floor * 3);
    const attack = hf > minHf * this.rise || level > minLevel * this.levelRise;
    if (!loudEnough) this.sounding = null; // verklungen: dieselbe Note darf wieder zählen
    if (loudEnough && attack && t - this.onsetAt > this.refractoryMs) {
      this.onsetAt = t;
      this.open = true;
      this.candidate = null;
      this.count = 0;
      this.onsetRef = prevSpec; // Spektrum vor dem Anschlag
      this.onsetRise = null;
      this.candFreqs = [];
    }
    // längste Anstiegszeit in den ersten 120 ms merken: Das erste Fenster schneidet einen weichen
    // Einsatz nur an (wirkt dort kurz); erst die folgenden Fenster zeigen ihn ganz
    if (this.open && t - this.onsetAt <= 120 && frame?.rise != null) this.onsetRise = Math.max(this.onsetRise ?? 0, frame.rise);

    // b) stabiler Tonwechsel
    if (midi !== null && midi === this.run.midi) {
      this.run.count++;
      if (frame?.freq) this.run.freqs.push(frame.freq);
    } else this.run = { midi, count: midi === null ? 0 : 1, ref: prevSpec, freqs: frame?.freq && midi !== null ? [frame.freq] : [], t };

    if (this.open && t - this.onsetAt > this.windowMs) this.open = false;
    if (this.open) {
      if (midi === null || t - this.onsetAt < this.settleMs) return null;
      if (midi === this.candidate) this.count++;
      else {
        this.candidate = midi;
        this.count = 1;
        this.candFreqs = [];
      }
      if (frame?.freq) this.candFreqs.push(frame.freq);
      if (this.count >= this.stableFrames) {
        if (this.pianoOnly && this.onsetRise !== null && this.onsetRise > this.maxRiseMs) return this.reject(midi); // weicher Einsatz
        if (this.pianoOnly && wobble(this.candFreqs) > this.maxWobbleCents) return this.reject(midi); // Tonhöhe schwankt
        return this.emit(midi, this.onsetRef, this.onsetAt);
      }
      return null;
    }
    if (loudEnough && this.run.count >= this.changeFrames && this.run.midi !== this.sounding) {
      if (this.pianoOnly && wobble(this.run.freqs) > this.maxWobbleCents) return null;
      return this.emit(this.run.midi, this.run.ref, this.run.t);
    }
    return null;
  }

  // Ton gehört, aber nicht vom Klavier: nicht melden, aber merken (sonst Tonwechsel-Regel)
  reject(midi) {
    this.open = false;
    this.sounding = midi;
    this.rejected = (this.rejected ?? 0) + 1;
    return null;
  }

  // at: Zeitpunkt des Anschlags (für die Rhythmus-Bewertung) – nicht der spätere Moment der Erkennung
  emit(midi, ref, at = null) {
    this.eventAt = at;
    this.open = false;
    if (!hasNewEnergy(midi, this.lastSpec, ref, this.sampleRate, this.refA)) return null; // Mischklang: lieber nichts
    this.sounding = midi;
    return midi;
  }
}
