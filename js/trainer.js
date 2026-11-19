// Übungslogik: Notenvorrat, adaptive Auswahl, Statistik pro Note, Runden, Aufbau mit Leitnoten.
// Ohne DOM; Speicher (localStorage) und Zufall werden hereingereicht.

import { levelNotes } from './notes.js';

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

// mode: 'treble' | 'bass' | 'mixed', level: 1 | 2 | 'aufbau'
// unlocked: im Aufbau freigeschaltete Anzahl je Schlüssel
export function buildPool(mode, level, unlocked = {}) {
  const clefs = mode === 'mixed' ? ['treble', 'bass'] : [mode];
  const notes = (clef) =>
    level === 'aufbau' ? AUFBAU_ORDER[clef].slice(0, unlocked[clef] ?? AUFBAU_START) : levelNotes(clef, level);
  return clefs.flatMap((clef) => notes(clef).map((note) => ({ clef, note })));
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
    this.pool = buildPool(mode, level, this.unlocked);
    this.startRound();
  }

  startRound() {
    this.answers = [];
    this.current = null;
  }

  next() {
    this.current = pickNext(this.pool, this.stats, this.previous, this.rng);
    this.previous = this.current;
    return this.current;
  }

  // tapped: Note der angetippten Taste (schwarze Tasten zählen immer als falsch)
  answer(tapped, ms) {
    const item = this.current;
    const correct = tapped === item.note;
    recordAnswer(this.stats, item, correct, ms);
    saveStats(this.storage, this.stats);
    const unlocked = this.level === 'aufbau' ? this.unlockIfReady(item.clef) : [];
    this.answers.push({ item, tapped, correct, ms, unlocked });
    return { correct, item, unlocked, done: this.answers.length >= this.roundLength };
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
