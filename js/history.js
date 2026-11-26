// Übungsverlauf: je Kalendertag (Ortszeit) gespielte Noten, davon richtig, Übungszeit und Runden.
// Reine Rechnung ohne DOM. Bewusst ohne „Serie“ (Tage am Stück): Der Verlauf soll zeigen, was man
// geübt hat, nicht Druck machen, wenn ein Tag ausfällt.

export const HISTORY_KEY = 'notentrainer.verlauf.v1';
export const KEEP_DAYS = 400; // ältere Tage werden verworfen
const MAX_MS = 10000; // eine Antwort zählt höchstens 10 s Übungszeit (Pausen nicht mitzählen)

const pad = (n) => String(n).padStart(2, '0');
// Tag in Ortszeit, z. B. "2026-11-26"
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const emptyDay = () => ({ notes: 0, right: 0, ms: 0, rounds: 0 });
const validDay = (v) =>
  v && typeof v === 'object' && ['notes', 'right', 'ms', 'rounds'].every((k) => Number.isFinite(v[k]) && v[k] >= 0) && v.right <= v.notes;

export function loadHistory(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(HISTORY_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && validDay(v)));
  } catch {
    return {};
  }
}

export function saveHistory(storage, history) {
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

// Eine beantwortete Note (bzw. ein Zusammenklang, eine verpasste Note im Takt) zählen
export function recordNote(history, correct, ms, now = new Date()) {
  const k = dayKey(now);
  const day = (history[k] ??= emptyDay());
  day.notes += 1;
  if (correct) day.right += 1;
  day.ms += Math.round(Math.min(MAX_MS, Math.max(0, ms || 0)));
  prune(history, now);
  return day;
}

// Eine fertige Runde (bzw. ein ganzes Lied) zählen
export function recordRound(history, now = new Date()) {
  const day = (history[dayKey(now)] ??= emptyDay());
  day.rounds += 1;
  return day;
}

export function prune(history, now = new Date()) {
  const oldest = dayKey(addDays(now, -KEEP_DAYS + 1));
  for (const k of Object.keys(history)) if (k < oldest) delete history[k];
  return history;
}

// Die letzten n Tage bis heute (ältester zuerst), auch Tage ohne Übung
export function lastDays(history, n = 14, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(now, -i);
    const k = dayKey(d);
    out.push({ day: k, weekday: WEEKDAYS[d.getDay()], date: d.getDate(), today: i === 0, ...emptyDay(), ...(history[k] ?? {}) });
  }
  return out;
}

const sum = (days) => {
  const t = days.reduce((a, d) => ({ notes: a.notes + d.notes, right: a.right + d.right, ms: a.ms + d.ms, rounds: a.rounds + d.rounds, active: a.active + (d.notes > 0 ? 1 : 0) }), { notes: 0, right: 0, ms: 0, rounds: 0, active: 0 });
  return { ...t, rate: t.notes ? t.right / t.notes : null, minutes: Math.round(t.ms / 60000) };
};

// Letzte 7 Tage und die 7 davor (zum Vergleich), dazu alles insgesamt
export function weekSummary(history, now = new Date()) {
  const days = lastDays(history, 14, now);
  const all = Object.values(history);
  return {
    week: sum(days.slice(7)),
    previous: sum(days.slice(0, 7)),
    total: sum(all),
    first: Object.keys(history).sort()[0] ?? null,
  };
}

// Säulen der letzten Tage als SVG: ganze Säule = gespielte Noten, grüner Teil = richtig
export function renderHistoryChart(days) {
  const W = 320;
  const H = 120;
  const top = 14;
  const base = 96;
  const step = W / days.length;
  const bw = Math.min(16, step * 0.62);
  const max = Math.max(10, ...days.map((d) => d.notes));
  const h = (v) => +(((base - top) * v) / max).toFixed(2);
  const bars = days
    .map((d, i) => {
      const cx = +(step * i + step / 2).toFixed(2);
      const x = +(cx - bw / 2).toFixed(2);
      const all = h(d.notes);
      const right = h(d.right);
      const title = `${d.weekday} ${d.date}.: ${d.notes ? `${d.notes} Noten, ${d.right} richtig` : 'nicht geübt'}`;
      return (
        `<g class="day${d.today ? ' today' : ''}" data-day="${d.day}" data-notes="${d.notes}" data-right="${d.right}"><title>${title}</title>` +
        (d.notes
          ? `<rect class="bar-all" x="${x}" y="${+(base - all).toFixed(2)}" width="${+bw.toFixed(2)}" height="${all}" rx="2"/>` +
            `<rect class="bar-right" x="${x}" y="${+(base - right).toFixed(2)}" width="${+bw.toFixed(2)}" height="${right}" rx="2"/>`
          : `<rect class="bar-none" x="${x}" y="${base - 2}" width="${+bw.toFixed(2)}" height="2" rx="1"/>`) +
        `<text class="wd" x="${cx}" y="${base + 13}" text-anchor="middle">${d.weekday}</text>` +
        (d.notes ? `<text class="num" x="${cx}" y="${+(base - all - 3).toFixed(2)}" text-anchor="middle">${d.notes}</text>` : '') +
        '</g>'
      );
    })
    .join('');
  return (
    `<svg class="history-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gespielte Noten der letzten ${days.length} Tage">` +
    `<line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}"/>` +
    bars +
    '</svg>'
  );
}
