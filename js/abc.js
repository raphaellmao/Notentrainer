// Lieder-Import aus ABC-Notation (verbreitete Textschrift für Volkslieder, z. B. abcnotation.com,
// thesession.org). Liefert Lieder im Format von songs.js plus Hinweise, was nicht übernommen wurde.
// Reine Rechnung ohne DOM.
//
// Unterstützt: Kopf T: M: L: K: Q: C: (mehrere Lieder je Datei über X:), Noten mit Oktavzeichen ' und ,,
// Vorzeichen ^ _ = (gelten bis zum Taktstrich), Notenlängen (2, /2, 3/2 …), punktierter Rhythmus > <,
// Pausen z/x/Z, Haltebögen, Wiederholungen |: :| mit 1./2. Ende.
// Vereinfacht (mit Hinweis): Akkorde → oberste Note, Vorschlagsnoten werden ausgelassen, Triolen angenähert.

import { midiNumber, noteFromMidi, asFlat, parseNote } from './notes.js';
import { KEYS, parseMelody } from './score.js';

const LOW = 60; // c¹ – Bereich der Violin-Klaviatur
const HIGH = 84; // c³

// Quintenzirkel: Anzahl Kreuze (+) bzw. b (−) der Dur-Tonart
const MAJOR = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MODE_SHIFT = { '': 0, maj: 0, ion: 0, m: -3, min: -3, aeo: -3, dor: -2, mix: -1, lyd: 1, phr: -4, loc: -5 };
const KEY_BY_COUNT = Object.fromEntries(Object.entries(MAJOR).map(([k, v]) => [v, k]));

// "G", "Em", "D dor", "Bbmaj", "F#m" → Tonart wie in score.js (Dur mit gleichen Vorzeichen)
export function parseKey(text) {
  const t = text.trim();
  if (!t || /^(none|HP|Hp)\b/.test(t)) return { key: 'C', warning: 'Tonart „none“ – als C-Dur gelesen' };
  const m = /^([A-G])([#b]?)\s*([A-Za-z]*)/.exec(t);
  if (!m) throw new Error(`Unbekannte Tonart: K:${t}`);
  const tonic = m[1] + m[2];
  const mode = m[3].toLowerCase().slice(0, 3);
  const shift = mode === 'm' || mode === 'mi' ? -3 : MODE_SHIFT[mode];
  if (shift === undefined || MAJOR[tonic] === undefined) throw new Error(`Unbekannte Tonart: K:${t}`);
  const count = MAJOR[tonic] + shift;
  if (!KEY_BY_COUNT[count]) throw new Error(`Tonart mit mehr als 7 Vorzeichen: K:${t}`);
  return { key: KEY_BY_COUNT[count] };
}

function parseMeter(text) {
  const t = text.trim();
  if (t === 'C') return [4, 4];
  if (t === 'C|') return [2, 2];
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const fraction = (text) => {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  return m ? Number(m[1]) / Number(m[2]) : null;
};

// Tempo „1/4=120“, „3/8=60“ oder „120“ → Viertel pro Minute
function parseTempo(text) {
  const m = /(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/.exec(text);
  if (!m) return null;
  const unit = m[1] ? Number(m[1]) / Number(m[2]) : 0.25;
  return Math.round((Number(m[3]) * unit) / 0.25);
}

// Länge in Vierteln → erlaubte Notenwerte; längere Werte werden mit Haltebogen geteilt
const VALUES = [
  [4, 'w'], [3, 'h.'], [2, 'h'], [1.5, 'q.'], [1, 'q'], [0.75, 'e.'], [0.5, 'e'], [0.25, 's'],
];
function splitDuration(beats) {
  const parts = [];
  let rest = beats;
  while (rest > 0.001) {
    const fit = VALUES.find(([b]) => b <= rest + 1e-9);
    if (!fit) break;
    parts.push(fit[1]);
    rest -= fit[0];
  }
  return { parts, exact: rest < 0.001 };
}

// Vorzeichen der Tonart je Buchstabe (+1 Kreuz, −1 b)
function keyMap(key) {
  const [type, count] = KEYS[key];
  const order = type === '#' ? 'FCGDAEB' : 'BEADGCF';
  return Object.fromEntries([...order.slice(0, count)].map((l) => [l, type === '#' ? 1 : -1]));
}

// Text einer Note → { midi, letter, alter, octave } (berücksichtigt Tonart und Vorzeichen im Takt)
function pitchOf(acc, letter, marks, keyAcc, barAcc) {
  const upper = letter.toUpperCase();
  let octave = letter === upper ? 4 : 5;
  for (const c of marks) octave += c === "'" ? 1 : -1;
  const id = `${upper}${octave}`;
  let alter;
  if (acc) {
    alter = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[acc];
    barAcc.set(id, alter);
  } else alter = barAcc.has(id) ? barAcc.get(id) : keyAcc[upper] ?? 0;
  return { midi: midiNumber(id) + alter, letter: upper, alter, octave };
}

// Notenname wie im Original geschrieben (Es bleibt Es); nur ungewöhnliche Schreibweisen
// (Eis, Ces, Doppelkreuz …) werden auf die übliche Taste umgeschrieben
function spell(p, shift, preferFlat) {
  const written = `${p.letter}${{ 1: '#', '-1': 'b', 0: '' }[p.alter] ?? '?'}${p.octave + shift / 12}`;
  try {
    parseNote(written);
    return written;
  } catch {
    const sharp = noteFromMidi(p.midi + shift);
    return preferFlat ? asFlat(sharp) : sharp;
  }
}

// Ein Lied (Kopf + Rumpf) lesen
function parseTune(lines) {
  const warnings = new Set();
  const head = { title: '', meter: null, unit: null, key: 'C', tempo: null, composer: '' };
  let bodyStart = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z]):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, f, v] = m;
    if (f === 'T' && !head.title) head.title = v.trim();
    else if (f === 'M') head.meter = parseMeter(v);
    else if (f === 'L') head.unit = fraction(v);
    else if (f === 'Q') head.tempo = parseTempo(v);
    else if (f === 'C') head.composer = v.trim();
    else if (f === 'K') {
      const k = parseKey(v);
      head.key = k.key;
      if (k.warning) warnings.add(k.warning);
      bodyStart = i + 1;
      break;
    }
  }
  if (bodyStart >= lines.length) throw new Error('Keine Noten gefunden (nach der Zeile „K:“ folgt nichts).');
  if (!head.meter) {
    head.meter = [4, 4];
    warnings.add('Keine Taktart angegeben – 4/4 angenommen');
  }
  const meterValue = head.meter[0] / head.meter[1];
  const unitBeats = (head.unit ?? (meterValue < 0.75 ? 1 / 16 : 1 / 8)) * 4;

  // Rumpf: Kommentare, Liedtext- und Feldzeilen entfernen
  const body = lines
    .slice(bodyStart)
    .filter((l) => !/^[A-Za-z]:/.test(l) && !/^%/.test(l))
    .map((l) => l.replace(/%.*$/, '').replace(/\\\s*$/, ''))
    .join(' ');

  const keyAcc = keyMap(head.key);
  const preferFlat = KEYS[head.key][0] === 'b';
  const bars = []; // { items: [{ midi|null (Pause), beats, tie }], startRepeat, endRepeat, ending }
  let bar = { items: [], startRepeat: false, endRepeat: false, ending: null };
  let barAcc = new Map();
  let ending = null; // laufendes 1./2. Ende
  let broken = null; // Faktor für die nächste Note nach > oder <
  let tuplet = null; // { left, factor }
  const closeBar = (marker) => {
    if (bar.items.length || marker.endRepeat) {
      bar.ending = ending;
      bar.endRepeat = marker.endRepeat;
      bars.push(bar);
    }
    if (marker.endRepeat || marker.final) ending = null;
    bar = { items: [], startRepeat: marker.startRepeat, endRepeat: false, ending: null };
    barAcc = new Map();
  };
  const durationAt = (i) => {
    const m = /^(\d*)(\/*)(\d*)/.exec(body.slice(i));
    let factor = m[1] ? Number(m[1]) : 1;
    if (m[2]) factor /= m[3] ? Number(m[3]) : 2 ** m[2].length;
    return { factor, length: m[0].length };
  };
  const addItem = (pitch, factor) => {
    let beats = unitBeats * factor;
    if (broken) {
      beats *= broken;
      broken = null;
    }
    if (tuplet) {
      beats *= tuplet.factor;
      warnings.add('Triolen u. Ä. werden auf normale Notenwerte gerundet');
      if (--tuplet.left <= 0) tuplet = null;
    }
    bar.items.push({ pitch, midi: pitch?.midi ?? null, beats, tie: false });
  };

  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (/\s/.test(c) || c === 'y' || c === '`') { i++; continue; }
    if (c === '"') { i = body.indexOf('"', i + 1) + 1 || body.length; continue; } // Akkordsymbole, Beschriftungen
    if (c === '!' || c === '+') { const e = body.indexOf(c, i + 1); i = e < 0 ? i + 1 : e + 1; continue; } // Verzierungen
    if ('.~HLMOPSTuv'.includes(c)) { i++; continue; }
    if (c === '{') { i = body.indexOf('}', i) + 1 || body.length; warnings.add('Vorschlagsnoten werden ausgelassen'); continue; }
    if (c === '(') {
      const m = /^\((\d)(?::(\d)?)?(?::(\d))?/.exec(body.slice(i));
      if (m) {
        const p = Number(m[1]);
        const q = m[2] ? Number(m[2]) : { 2: 3, 3: 2, 4: 3, 6: 2 }[p] ?? 2;
        tuplet = { left: m[3] ? Number(m[3]) : p, factor: q / p };
        i += m[0].length;
      } else i++; // Bindebogen
      continue;
    }
    if (c === ')') { i++; continue; }
    if (c === '-') {
      const last = bar.items[bar.items.length - 1] ?? bars[bars.length - 1]?.items.at(-1);
      if (last && last.midi !== null) last.tie = true;
      i++;
      continue;
    }
    if (c === '>' || c === '<') {
      let n = 0;
      while (body[i] === c) { n++; i++; }
      const short = 0.5 ** n;
      const last = bar.items[bar.items.length - 1];
      if (last) {
        last.beats *= c === '>' ? 2 - short : short;
        broken = c === '>' ? short : 2 - short;
      }
      continue;
    }
    if (c === '[' && /^\[[A-Za-z]:/.test(body.slice(i))) {
      const e = body.indexOf(']', i);
      const field = body.slice(i + 1, e < 0 ? body.length : e);
      if (/^K:/.test(field)) warnings.add('Tonartwechsel im Lied wird nicht übernommen');
      if (/^M:/.test(field)) warnings.add('Taktwechsel im Lied wird nicht übernommen');
      i = e < 0 ? body.length : e + 1;
      continue;
    }
    // Taktstriche, Wiederholungen, Enden
    const barm = /^(:*\|[\]|]?:*|:*\[\||::+|\[(?=\d))(\s*\[?\d)?/.exec(body.slice(i));
    if (barm && (barm[1].includes('|') || barm[1].startsWith('::') || barm[1] === '[')) {
      const sym = barm[1];
      const endRepeat = sym.startsWith(':');
      const startRepeat = sym.endsWith(':') && sym !== ':';
      const final = sym.includes(']') || sym === '||';
      if (sym !== '[') closeBar({ endRepeat, startRepeat, final });
      if (barm[2]) ending = Number(barm[2].replace(/\D/g, ''));
      i += barm[0].length;
      continue;
    }
    // Akkord: oberste Note
    if (c === '[') {
      const e = body.indexOf(']', i);
      const inner = body.slice(i + 1, e < 0 ? body.length : e);
      const notes = [...inner.matchAll(/(\^\^|__|\^|_|=)?([A-Ga-g])([',]*)/g)].map((m) => pitchOf(m[1], m[2], m[3], keyAcc, barAcc));
      i = e < 0 ? body.length : e + 1;
      const d = durationAt(i);
      i += d.length;
      if (notes.length) {
        addItem(notes.reduce((a, b) => (b.midi > a.midi ? b : a)), d.factor);
        if (notes.length > 1) warnings.add('Akkorde: es zählt jeweils die oberste Note');
      }
      continue;
    }
    // Note oder Pause
    const nm = /^(\^\^|__|\^|_|=)?([A-Ga-gzxZ])([',]*)/.exec(body.slice(i));
    if (nm) {
      i += nm[0].length;
      const d = durationAt(i);
      i += d.length;
      if (nm[2] === 'Z') {
        // mehrere ganze Pausentakte
        for (let k = 0; k < (d.length ? d.factor : 1); k++) {
          bar.items.push({ pitch: null, midi: null, beats: meterValue * 4, tie: false });
          closeBar({});
        }
        continue;
      }
      if (nm[2] === 'z' || nm[2] === 'x') addItem(null, d.factor);
      else addItem(pitchOf(nm[1], nm[2], nm[3], keyAcc, barAcc), d.factor);
      continue;
    }
    i++; // unbekanntes Zeichen überspringen
  }
  closeBar({ final: true });
  if (bars.length === 0) throw new Error('Keine Noten gefunden.');

  // Wiederholungen ausschreiben: |: … :| zweimal, beim zweiten Mal ohne das 1. Ende
  const expanded = [];
  let repStart = 0;
  bars.forEach((b, idx) => {
    if (b.startRepeat) repStart = idx;
    expanded.push(b);
    if (b.endRepeat) {
      for (let k = repStart; k <= idx; k++) if (bars[k].ending !== 1) expanded.push(bars[k]);
      repStart = idx + 1;
    }
  });

  // Tonumfang: um ganze Oktaven in c¹–c³ schieben
  const midis = expanded.flatMap((b) => b.items).filter((it) => it.midi !== null).map((it) => it.midi);
  if (!midis.length) throw new Error('Das Lied enthält nur Pausen.');
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  if (hi - lo > HIGH - LOW) throw new Error(`Tonumfang zu groß (${hi - lo} Halbtöne) – die Klaviatur reicht zwei Oktaven.`);
  let shift = 0;
  for (const k of [0, 12, -12, 24, -24, 36, -36]) {
    if (lo + k >= LOW && hi + k <= HIGH) { shift = k; break; }
  }
  if (lo + shift < LOW || hi + shift > HIGH) throw new Error('Das Lied passt nicht auf die Klaviatur (c¹–c³).');
  if (shift) warnings.add(`Um ${Math.abs(shift / 12)} Oktave${Math.abs(shift) > 12 ? 'n' : ''} ${shift > 0 ? 'nach oben' : 'nach unten'} verschoben, damit es auf die Klaviatur passt`);

  // In die Liedschreibweise übersetzen
  const target = (head.meter[0] * 4) / head.meter[1];
  const measures = expanded.map((b, bi) => {
    const tokens = [];
    const sum = b.items.reduce((s, it) => s + it.beats, 0);
    if (Math.abs(sum - target) > 0.01 && bi > 0 && bi < expanded.length - 1) warnings.add('Einige Takte haben nicht die volle Länge');
    for (const it of b.items) {
      const { parts, exact } = splitDuration(it.beats);
      if (!exact || !parts.length) warnings.add('Ungewöhnliche Notenlängen wurden gerundet');
      const use = parts.length ? parts : ['s'];
      use.forEach((v, k) => {
        if (it.midi === null) tokens.push(`z${v}`);
        else {
          const tieOn = k < use.length - 1 || it.tie;
          tokens.push(`${spell(it.pitch, shift, preferFlat)}${v}${tieOn ? '-' : ''}`);
        }
      });
    }
    return tokens.join(' ');
  }).filter(Boolean);

  const song = {
    id: `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: head.title || 'Unbenanntes Lied',
    origin: `Importiert${head.composer ? ` · ${head.composer}` : ''}`,
    time: head.meter,
    key: head.key,
    tempo: Math.min(200, Math.max(40, head.tempo ?? 100)),
    melody: measures.join(' | '),
    imported: true,
  };
  parseMelody(song.melody); // prüft das Ergebnis
  return { song, warnings: [...warnings] };
}

// ABC-Text (eine oder mehrere Lieder) → { tunes: [{ song, warnings }], errors: [string] }
export function importAbc(text) {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const starts = lines.map((l, i) => (/^X:/.test(l) ? i : -1)).filter((i) => i >= 0);
  const blocks = starts.length ? starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length)) : [lines];
  const tunes = [];
  const errors = [];
  for (const block of blocks) {
    const title = block.find((l) => /^T:/.test(l))?.slice(2).trim() || 'Lied';
    try {
      tunes.push(parseTune(block.filter((l) => l !== '')));
    } catch (err) {
      errors.push(`${title}: ${err.message}`);
    }
  }
  return { tunes, errors };
}

