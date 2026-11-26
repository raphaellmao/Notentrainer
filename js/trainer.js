// Übungslogik: Notenvorrat, adaptive Auswahl, Statistik pro Note, Runden, Aufbau mit Leitnoten.
// Ohne DOM; Speicher (localStorage) und Zufall werden hereingereicht.

import { levelNotes, diatonicIndex, parseNote, sameKey } from './notes.js';

export const ROUND_LENGTH = 20;
export const STATS_KEY = 'notentrainer.statistik.v1';
export const AUFBAU_KEY = 'notentrainer.aufbau.v1';

const ALPHA = 0.35; // Gewicht der letzten Antwort in den gleitenden Mittelwerten
// Längere Antwortzeiten zählen als 10 s (Statistik und Rundenschnitt), damit eine
// Pause – App offen liegen gelassen – nicht alles verzerrt.
export const MAX_MS = 10000;
const NEW_WEIGHT = 3; // noch nie geübte Noten kommen bevorzugt dran

// Aufbau: Reihenfolge, in der die Noten dazukommen. Die ersten vier sind Leitnoten,
// an denen man sich orientiert; danach folgen jeweils ihre Nachbarn, Hilfslinien zuletzt.
export const AUFBAU_ORDER = {
  //        c¹    g¹    c²    g²  | f¹ a¹ | h¹ d² | d¹ e¹ | e² f² | a² h² | c³
  treble: ['C4', 'G4', 'C5', 'G5', 'F4', 'A4', 'B4', 'D5', 'D4', 'E4', 'E5', 'F5', 'A5', 'B5', 'C6'],
  //       c¹    f     c     F    | e g  | H d  | a h  | E G  | A D  | C
  bass: ['C4', 'F3', 'C3', 'F2', 'E3', 'G3', 'B2', 'D3', 'A3', 'B3', 'E2', 'G2', 'A2', 'D2', 'C2'],
};
export const AUFBAU_START = 4;
const AUFBAU_STEP = 2;

export const itemKey = (item) => `${item.clef}:${item.note}`;

// Stufe 3 („folgen“): Notenfolgen aus dem vollen Vorrat von Stufe 2
export const SEQUENCE_LENGTH = 5;
const MAX_STEP = 4; // größter Schritt innerhalb einer Folge: Quinte (4 Stammton-Schritte)

// mode: 'treble' | 'bass' | 'mixed', level: 1 | 2 | 'aufbau' | 'folgen'
// unlocked: im Aufbau freigeschaltete Anzahl je Schlüssel
export function buildPool(mode, level, unlocked = {}) {
  const clefs = mode === 'mixed' ? ['treble', 'bass'] : [mode];
  if (level === 'lieder') return []; // Stufe 4: Noten kommen aus dem Lied (startSong)
  const notes = (clef) => {
    if (level === 'aufbau') return AUFBAU_ORDER[clef].slice(0, unlocked[clef] ?? AUFBAU_START);
    if (level === 'vorzeichen') return accidentalNotes(clef);
    return levelNotes(clef, level === 'folgen' ? 2 : level);
  };
  return clefs.flatMap((clef) => notes(clef).map((note) => ({ clef, note })));
}

// Stufe „Vorzeichen“: Stammtöne von Stufe 1 und ihre Kreuz- und b-Varianten (übliche Schreibweisen
// der schwarzen Tasten: Cis Dis Fis Gis Ais, Des Es Ges As B). Zwei Drittel der Noten tragen ein Zeichen.
export function accidentalNotes(clef) {
  return levelNotes(clef, 1).flatMap((natural) => {
    const { letter, octave } = parseNote(natural);
    const out = [natural];
    if ('CDFGA'.includes(letter)) out.push(`${letter}#${octave}`);
    if ('DEGAB'.includes(letter)) out.push(`${letter}b${octave}`);
    return out;
  });
}

// Eine Notenfolge wie eine kleine Melodie: alles in einem Schlüssel, kleine Schritte
// (höchstens eine Quinte), nie dieselbe Note zweimal hintereinander, schwache Noten bevorzugt.
export function pickSequence(pool, stats, previous, length = SEQUENCE_LENGTH, rng = Math.random) {
  const first = pickNext(pool, stats, previous, rng);
  const clefPool = pool.filter((it) => it.clef === first.clef);
  const seq = [first];
  while (seq.length < length) {
    const last = seq[seq.length - 1];
    const near = clefPool.filter((it) => Math.abs(diatonicIndex(it.note) - diatonicIndex(last.note)) <= MAX_STEP);
    seq.push(pickNext(near.length > 1 ? near : clefPool, stats, last, rng));
  }
  return seq;
}

// Wie gut sitzt eine Note? 'neu' | 'sitzt' | 'wackelt' | 'ueben'
export function mastery(stat) {
  if (!stat || !stat.attempts) return 'neu';
  if (stat.emaErr >= 0.45) return 'ueben';
  if (stat.attempts >= 3 && stat.emaErr < 0.2 && stat.emaMs <= 3000) return 'sitzt';
  return 'wackelt';
}

// Nächste Noten freischalten? Alle bisherigen mind. 3× geübt, keine auf „üben“, mind. 70 % sitzen.
export function readyToUnlock(clef, count, stats) {
  const states = AUFBAU_ORDER[clef].slice(0, count).map((note) => stats[itemKey({ clef, note })]);
  if (states.some((s) => !s || s.attempts < 3 || mastery(s) === 'ueben')) return false;
  return states.filter((s) => mastery(s) === 'sitzt').length >= Math.ceil(states.length * 0.7);
}

// Stand aller Noten eines Schlüssels für die Übersicht
export function noteOverview(clef, stats, unlockedCount = AUFBAU_START) {
  const open = new Set(AUFBAU_ORDER[clef].slice(0, unlockedCount));
  return levelNotes(clef, 2).map((note) => {
    const s = stats[itemKey({ clef, note })];
    const attempts = s?.attempts ?? 0;
    return {
      clef,
      note,
      status: mastery(s),
      attempts,
      rate: attempts ? (attempts - s.errors) / attempts : null,
      avgMs: attempts ? s.totalMs / attempts : null,
      locked: !open.has(note),
    };
  });
}

// Stand der Noten mit Kreuz bzw. b (Stufe „Vorzeichen“) für die Übersicht – ohne Sperre
export function accidentalOverview(clef, stats) {
  return accidentalNotes(clef)
    .filter((note) => /[#b]/.test(note))
    .map((note) => {
      const s = stats[itemKey({ clef, note })];
      const attempts = s?.attempts ?? 0;
      return {
        clef,
        note,
        status: mastery(s),
        attempts,
        rate: attempts ? (attempts - s.errors) / attempts : null,
        avgMs: attempts ? s.totalMs / attempts : null,
        locked: false,
      };
    });
}

// Gewicht einer Note für die Auswahl: oft falsch oder langsamer als der eigene
// Durchschnitt → häufiger. avgMs ist die mittlere Antwortzeit über den Vorrat.
export function noteWeight(stat, avgMs) {
  if (!stat || !stat.attempts) return NEW_WEIGHT;
  const slowness = avgMs > 0 ? stat.emaMs / avgMs - 1 : 0;
  return 1 + 5 * stat.emaErr + 2 * Math.min(1.5, Math.max(0, slowness));
}

// Nächste Note, gewichtet zufällig – nie dieselbe Note zweimal hintereinander.
export function pickNext(pool, stats, previous, rng = Math.random) {
  let candidates = previous ? pool.filter((it) => it.note !== previous.note) : pool;
  if (!candidates.length) candidates = pool;
  const seen = pool.map((it) => stats[itemKey(it)]).filter((s) => s && s.attempts);
  const avgMs = seen.length ? seen.reduce((sum, s) => sum + s.emaMs, 0) / seen.length : 0;
  const weights = candidates.map((it) => noteWeight(stats[itemKey(it)], avgMs));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// Antwort in die Statistik der Note eintragen (Versuche, Fehler, Zeit + gleitende Mittel)
export function recordAnswer(stats, item, correct, ms) {
  const key = itemKey(item);
  const t = Math.min(Math.max(0, ms), MAX_MS);
  const s = stats[key] || { attempts: 0, errors: 0, totalMs: 0, emaErr: 0.5, emaMs: t };
  s.attempts += 1;
  if (!correct) s.errors += 1;
  s.totalMs += Math.round(t);
  s.emaErr += ALPHA * ((correct ? 0 : 1) - s.emaErr);
  s.emaMs += ALPHA * (t - s.emaMs);
  stats[key] = s;
  return s;
}

export function summarize(answers) {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const avgMs = total ? answers.reduce((sum, a) => sum + Math.min(a.ms, MAX_MS), 0) / total : 0;
  const wrong = new Map();
  for (const a of answers) {
    if (a.correct) continue;
    const key = itemKey(a.item);
    const entry = wrong.get(key) || { ...a.item, count: 0 };
    entry.count += 1;
    wrong.set(key, entry);
  }
  const unlocked = answers.flatMap((a) => a.unlocked ?? []);
  return { total, correct, rate: total ? correct / total : 0, avgMs, wrong: [...wrong.values()], unlocked };
}

function load(storage, key) {
  try {
    const data = JSON.parse(storage?.getItem(key) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function save(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Speicher voll oder gesperrt (privates Fenster) – Übung läuft trotzdem weiter
  }
}

export const loadStats = (storage) => load(storage, STATS_KEY);
export const saveStats = (storage, stats) => save(storage, STATS_KEY, stats);

export function loadUnlocked(storage) {
  const data = load(storage, AUFBAU_KEY);
  const clamp = (n) => (Number.isInteger(n) ? Math.min(AUFBAU_ORDER.treble.length, Math.max(AUFBAU_START, n)) : AUFBAU_START);
  return { treble: clamp(data.treble), bass: clamp(data.bass) };
}

export class Trainer {
  constructor({ storage = null, rng = Math.random, roundLength = ROUND_LENGTH } = {}) {
    this.storage = storage;
    this.rng = rng;
    this.roundLength = roundLength;
    this.baseRoundLength = roundLength;
    this.stats = loadStats(storage);
    this.unlocked = loadUnlocked(storage);
    this.mode = 'treble';
    this.level = 1;
    this.pool = [];
    this.previous = null;
    this.current = null;
    this.answers = [];
  }

  configure(mode, level) {
    this.mode = mode;
    this.level = level;
    this.roundLength = this.baseRoundLength;
    this.pool = buildPool(mode, level, this.unlocked);
    this.startRound();
  }

  startRound() {
    this.answers = [];
    this.current = null;
    this.sequence = null;
    this.position = 0;
  }

  get isSequence() {
    return this.level === 'folgen' || this.level === 'lieder';
  }

  // Stufe 4: ein ganzes Lied – die Runde ist so lang wie das Lied. items: Notennamen (Melodie im
  // Violinschlüssel) oder { clef, note, notes? } – notes: Zusammenklang beider Hände, alle Tasten nötig
  startSong(items) {
    this.answers = [];
    this.sequence = items.map((it) => (typeof it === 'string' ? { clef: 'treble', note: it } : it));
    this.roundLength = this.sequence.length;
    this.position = 0;
    this.pending = null;
    this.current = this.sequence[0];
    this.previous = this.sequence[this.sequence.length - 1];
    return this.sequence;
  }

  next() {
    this.current = pickNext(this.pool, this.stats, this.previous, this.rng);
    this.previous = this.current;
    return this.current;
  }

  // Stufe 3: neue Folge (kürzer, falls die Runde sonst überläuft); current = erste Note
  nextSequence() {
    const length = Math.min(SEQUENCE_LENGTH, this.roundLength - this.answers.length);
    this.sequence = pickSequence(this.pool, this.stats, this.previous, length, this.rng);
    this.position = 0;
    this.current = this.sequence[0];
    this.previous = this.sequence[length - 1];
    return this.sequence;
  }

  // Stufe 3: zur nächsten Note der Folge; null, wenn die Folge zu Ende ist
  advance() {
    this.position += 1;
    this.pending = null;
    this.current = this.sequence?.[this.position] ?? null;
    return this.current;
  }

  // Im Takt: Note verpasst – zählt in der Runde als falsch, aber nicht in der Statistik der Note
  skip() {
    const item = this.current;
    this.pending = null;
    this.answers.push({ item, tapped: null, correct: false, ms: 0, missed: true, unlocked: [] });
    return { correct: false, item, unlocked: [], done: this.answers.length >= this.roundLength };
  }

  // tapped: Note der angetippten Taste (schwarze Tasten zählen immer als falsch)
  // anyOf: bei Zusammenklängen genügt eine der Noten (Mikrofon hört nur einen Ton sicher)
  answer(tapped, ms, { anyOf = false } = {}) {
    const item = this.current;
    if (item.notes?.length > 1) return this.answerChord(tapped, ms, anyOf);
    const correct = sameKey(tapped, item.note); // Fis und Ges sind dieselbe Taste
    recordAnswer(this.stats, item, correct, ms);
    saveStats(this.storage, this.stats);
    const unlocked = this.level === 'aufbau' ? this.unlockIfReady(item.clef) : [];
    this.answers.push({ item, tapped, correct, ms, unlocked });
    return { correct, item, unlocked, done: this.answers.length >= this.roundLength };
  }

  // Zusammenklang: jede richtige Taste zählt einzeln, das Ereignis ist erst mit allen Tasten geschafft.
  // Eine falsche Taste beendet es als Fehler (gezählt bei der ersten noch fehlenden Note).
  answerChord(tapped, ms, anyOf) {
    const chord = this.current;
    const notes = chord.notes.map((n) => n.note);
    if (!this.pending) this.pending = chord.notes.map((n) => ({ clef: n.clef, note: n.note }));
    const done = () => this.answers.length >= this.roundLength;
    const hit = this.pending.find((n) => sameKey(tapped, n.note));
    if (hit) {
      recordAnswer(this.stats, hit, true, ms);
      saveStats(this.storage, this.stats);
      this.pending = anyOf ? [] : this.pending.filter((n) => n !== hit);
      if (this.pending.length) return { correct: true, partial: true, item: chord, notes, hit, missing: [...this.pending], unlocked: [], done: false };
      this.answers.push({ item: chord, tapped, correct: true, ms, unlocked: [] });
      return { correct: true, item: chord, notes, hit, missing: [], unlocked: [], done: done() };
    }
    // dieselbe Taste ein zweites Mal: nichts passiert
    if (notes.some((n) => sameKey(tapped, n))) return { ignored: true, correct: true, partial: true, item: chord, notes, missing: [...this.pending], unlocked: [], done: false };
    const miss = this.pending[0];
    const missing = [...this.pending];
    recordAnswer(this.stats, miss, false, ms);
    saveStats(this.storage, this.stats);
    this.answers.push({ item: miss, tapped, correct: false, ms, unlocked: [] });
    return { correct: false, item: miss, notes, missing, unlocked: [], done: done() };
  }

  // Im Aufbau die nächsten Noten freischalten, falls die bisherigen sitzen. Freigeschaltetes bleibt.
  unlockIfReady(clef) {
    const count = this.unlocked[clef];
    const order = AUFBAU_ORDER[clef];
    if (count >= order.length || !readyToUnlock(clef, count, this.stats)) return [];
    const next = Math.min(order.length, count + AUFBAU_STEP);
    this.unlocked[clef] = next;
    save(this.storage, AUFBAU_KEY, this.unlocked);
    this.pool = buildPool(this.mode, this.level, this.unlocked);
    return order.slice(count, next).map((note) => ({ clef, note }));
  }

  get progress() {
    return { answered: this.answers.length, total: this.roundLength };
  }

  summary() {
    return summarize(this.answers);
  }
}
