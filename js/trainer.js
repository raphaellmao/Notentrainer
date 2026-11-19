// Übungslogik: Notenvorrat, adaptive Auswahl, Statistik pro Note, Runden.
// Ohne DOM; Speicher (localStorage) und Zufall werden hereingereicht.

import { levelNotes } from './notes.js';

export const ROUND_LENGTH = 20;
export const STATS_KEY = 'notentrainer.statistik.v1';

const ALPHA = 0.35; // Gewicht der letzten Antwort in den gleitenden Mittelwerten
// Längere Antwortzeiten zählen als 10 s (Statistik und Rundenschnitt), damit eine
// Pause – App offen liegen gelassen – nicht alles verzerrt.
export const MAX_MS = 10000;
const NEW_WEIGHT = 3; // noch nie geübte Noten kommen bevorzugt dran

export const itemKey = (item) => `${item.clef}:${item.note}`;

// mode: 'treble' | 'bass' | 'mixed', level: 1 | 2
export function buildPool(mode, level) {
  const clefs = mode === 'mixed' ? ['treble', 'bass'] : [mode];
  return clefs.flatMap((clef) => levelNotes(clef, level).map((note) => ({ clef, note })));
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
  return { total, correct, rate: total ? correct / total : 0, avgMs, wrong: [...wrong.values()] };
}

export function loadStats(storage) {
  try {
    const data = JSON.parse(storage?.getItem(STATS_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function saveStats(storage, stats) {
  try {
    storage?.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Speicher voll oder gesperrt (privates Fenster) – Übung läuft trotzdem weiter
  }
}

export class Trainer {
  constructor({ storage = null, rng = Math.random, roundLength = ROUND_LENGTH } = {}) {
    this.storage = storage;
    this.rng = rng;
    this.roundLength = roundLength;
    this.stats = loadStats(storage);
    this.pool = [];
    this.previous = null;
    this.current = null;
    this.answers = [];
  }

  configure(mode, level) {
    this.pool = buildPool(mode, level);
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
    this.answers.push({ item, tapped, correct, ms });
    return { correct, item, done: this.answers.length >= this.roundLength };
  }

  get progress() {
    return { answered: this.answers.length, total: this.roundLength };
  }

  summary() {
    return summarize(this.answers);
  }
}
