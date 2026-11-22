// Lernstand sichern und wiederherstellen: alle Daten der App aus dem Browser-Speicher
// (Statistik, Aufbau, Einstellungen inkl. Einmessung, importierte Lieder) in eine Datei.
// Reine Rechnung ohne DOM; storage ist localStorage oder ein Ersatz mit getItem/setItem/removeItem/key/length.

const PREFIX = 'notentrainer.';
export const SAFETY_KEY = 'notentrainer.sicherung-vor-wiederherstellung';
const FORMAT = 'notentrainer-lernstand';

// Alle App-Schlüssel (ohne die eigene Sicherheitskopie)
function appKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(PREFIX) && k !== SAFETY_KEY) keys.push(k);
  }
  return keys.sort();
}

function snapshot(storage) {
  return Object.fromEntries(appKeys(storage).map((k) => [k, storage.getItem(k)]));
}

// Sicherungsdatei als Text
export function createBackup(storage, now = new Date()) {
  return JSON.stringify({ format: FORMAT, version: 1, savedAt: now.toISOString(), data: snapshot(storage) }, null, 1);
}

// Dateiname wie „notentrainer-lernstand-2026-11-22.json“
export const backupFileName = (now = new Date()) => `notentrainer-lernstand-${now.toISOString().slice(0, 10)}.json`;

// Sicherungsdatei prüfen → { data, savedAt, summary } oder Fehler mit verständlicher Meldung
export function parseBackup(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist keine Lernstand-Sicherung (kein gültiges Format).');
  }
  if (!file || file.format !== FORMAT || typeof file.data !== 'object' || file.data === null) {
    throw new Error('Die Datei ist keine Lernstand-Sicherung des Notentrainers.');
  }
  if (file.version > 1) throw new Error('Die Sicherung stammt aus einer neueren App-Version – bitte die App erst aktualisieren.');
  const data = {};
  for (const [k, v] of Object.entries(file.data)) {
    if (!k.startsWith(PREFIX) || k === SAFETY_KEY || typeof v !== 'string') continue;
    try {
      JSON.parse(v);
    } catch {
      throw new Error(`Die Sicherung ist beschädigt (${k}).`);
    }
    data[k] = v;
  }
  if (!Object.keys(data).length) throw new Error('Die Sicherung enthält keine Daten.');
  return { data, savedAt: file.savedAt ?? null, summary: summarize(data) };
}

// Kurzbeschreibung für die Rückfrage
export function summarize(data) {
  const read = (k, fallback) => {
    try {
      return JSON.parse(data[k] ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  };
  const stats = read('notentrainer.statistik.v1', {});
  const songs = read('notentrainer.lieder.v1', []);
  const attempts = Object.values(stats).reduce((s, x) => s + (x?.attempts ?? 0), 0);
  return { notes: Object.keys(stats).length, attempts, songs: Array.isArray(songs) ? songs.length : 0 };
}

// Lernstand ersetzen. Vorher wird der bisherige Stand als Sicherheitskopie abgelegt,
// damit ein versehentliches Wiederherstellen rückgängig gemacht werden kann.
export function restoreBackup(storage, data) {
  storage.setItem(SAFETY_KEY, JSON.stringify(snapshot(storage)));
  for (const k of appKeys(storage)) if (!(k in data)) storage.removeItem(k);
  for (const [k, v] of Object.entries(data)) storage.setItem(k, v);
}

// Sicherheitskopie zurückholen (macht das letzte Wiederherstellen rückgängig)
export function undoRestore(storage) {
  const saved = storage.getItem(SAFETY_KEY);
  if (!saved) return false;
  const data = JSON.parse(saved);
  for (const k of appKeys(storage)) if (!(k in data)) storage.removeItem(k);
  for (const [k, v] of Object.entries(data)) storage.setItem(k, v);
  storage.removeItem(SAFETY_KEY);
  return true;
}

export const hasSafetyCopy = (storage) => !!storage.getItem(SAFETY_KEY);
