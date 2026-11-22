// Notenmodell: Tonhöhen, deutsche Namen, Schlüssel und Position im Notensystem.
// Reine Funktionen ohne DOM – laufen im Browser und in Node (Tests).
//
// Intern wird eine Note als Text geschrieben: Buchstabe, optional "#" (Kreuz) oder "b" (b),
// Oktave in wissenschaftlicher Schreibweise. "C4" ist das mittlere C (= c¹), "B3" ist das
// kleine h, "F#4" ist fis¹, "Bb4" ist b¹ (deutsch: B = das erniedrigte H), "Eb4" ist es¹.
// Englische Buchstaben gibt es nur intern; angezeigt wird immer deutsch.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const GERMAN = { C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', A: 'A', B: 'H' };
const GERMAN_SHARP = { C: 'Cis', D: 'Dis', F: 'Fis', G: 'Gis', A: 'Ais' };
const GERMAN_FLAT = { D: 'Des', E: 'Es', G: 'Ges', A: 'As', B: 'B' };
const SUPERSCRIPT = ['', '¹', '²', '³', '⁴', '⁵'];
const SUBSCRIPT = ['', '₁', '₂'];

// Nur die üblichen Schreibweisen der schwarzen Tasten (kein Eis, His, Ces, Fes)
export function parseNote(id) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(id);
  if (!m) throw new Error(`Unbekannte Note: ${id}`);
  const [, letter, accidental = '', octave] = m;
  if (accidental === '#' && !GERMAN_SHARP[letter]) throw new Error(`Keine schwarze Taste: ${id}`);
  if (accidental === 'b' && !GERMAN_FLAT[letter]) throw new Error(`Keine schwarze Taste: ${id}`);
  return { letter, accidental, sharp: accidental === '#', flat: accidental === 'b', octave: Number(octave) };
}

export const isNatural = (id) => parseNote(id).accidental === '';

// Zählt die Stammtöne (weiße Tasten) durch: C0 = 0, D0 = 1, … C4 = 28.
export function diatonicIndex(id) {
  const { letter, octave } = parseNote(id);
  return octave * 7 + LETTERS.indexOf(letter);
}

export function naturalFromIndex(index) {
  const octave = Math.floor(index / 7);
  return LETTERS[index - octave * 7] + octave;
}

export function midiNumber(id) {
  const { letter, sharp, flat, octave } = parseNote(id);
  return 12 * (octave + 1) + SEMITONE[letter] + (sharp ? 1 : 0) - (flat ? 1 : 0);
}

// Gleiche Taste? (Fis = Ges, Ais = B …)
export const sameKey = (a, b) => midiNumber(a) === midiNumber(b);

// Gleichstufige Stimmung, a¹ = 440 Hz
export const frequency = (id) => 440 * 2 ** ((midiNumber(id) - 69) / 12);

// MIDI-Nummer → Note ("C4", "F#3" …); schwarze Tasten immer mit Kreuz (so heißen die Klaviertasten intern)
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteFromMidi(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const name = CHROMATIC[midi - (octave + 1) * 12];
  return name.length === 2 ? `${name[0]}#${octave}` : `${name}${octave}`;
}

// Taste auf der Klaviatur zu einer Note (Bb4 → A#4)
export const keyOf = (id) => noteFromMidi(midiNumber(id));

// Schwarze Taste in b-Schreibweise (A#4 → Bb4), weiße Tasten unverändert
const TO_FLAT = { C: 'Db', D: 'Eb', F: 'Gb', G: 'Ab', A: 'Bb' };
export function asFlat(id) {
  const { letter, sharp, octave } = parseNote(id);
  return sharp ? `${TO_FLAT[letter]}${octave}` : id;
}

// Deutscher Tonname ohne Oktave: C D E F G A H; Kreuz: Cis Dis Fis Gis Ais; b: Des Es Ges As B
export function germanName(id) {
  const { letter, sharp, flat } = parseNote(id);
  return sharp ? GERMAN_SHARP[letter] : flat ? GERMAN_FLAT[letter] : GERMAN[letter];
}

// Deutsche Oktavschreibweise (Helmholtz): C2 = C, C3 = c, C4 = c¹, C5 = c², C6 = c³
export function helmholtzName(id) {
  const { octave } = parseNote(id);
  const name = germanName(id);
  if (octave >= 4) return name.toLowerCase() + SUPERSCRIPT[octave - 3];
  if (octave === 3) return name.toLowerCase();
  if (octave === 2) return name;
  return name + SUBSCRIPT[2 - octave];
}

// Schlüssel. bottomLine: Note auf der untersten Notenlinie. anchorStep: Linie, auf
// der das Schlüsselsymbol sitzt (Violinschlüssel: G-Linie, Bassschlüssel: F-Linie).
export const CLEFS = {
  treble: {
    id: 'treble',
    name: 'Violinschlüssel',
    bottomLine: 'E4',
    anchorStep: 2,
    keyboard: ['C4', 'C6'],
    levels: { 1: ['D4', 'G5'], 2: ['C4', 'C6'] },
  },
  bass: {
    id: 'bass',
    name: 'Bassschlüssel',
    bottomLine: 'G2',
    anchorStep: 6,
    keyboard: ['C2', 'C4'],
    levels: { 1: ['F2', 'B3'], 2: ['C2', 'C4'] },
  },
};

// Position im Notensystem in Schritten über der untersten Linie:
// 0 = unterste Linie, 1 = erster Zwischenraum, 2 = zweite Linie … 8 = oberste Linie.
// Negative Werte liegen darunter, Werte über 8 darüber.
export function staffStep(clef, note) {
  return diatonicIndex(note) - diatonicIndex(CLEFS[clef].bottomLine);
}

// Hilfslinien, die eine Note an dieser Position braucht (als Schritte, von innen nach außen)
export function ledgerSteps(step) {
  const steps = [];
  for (let s = -2; s >= step; s -= 2) steps.push(s);
  for (let s = 10; s <= step; s += 2) steps.push(s);
  return steps;
}

// Alle Stammtöne von low bis high (einschließlich)
export function naturalRange(low, high) {
  const notes = [];
  for (let i = diatonicIndex(low); i <= diatonicIndex(high); i++) notes.push(naturalFromIndex(i));
  return notes;
}

// Alle Tasten (weiß und schwarz) von low bis high, aufsteigend
export function keysInRange(low, high) {
  const keys = [];
  for (const note of naturalRange(low, high)) {
    keys.push(note);
    const { letter, octave } = parseNote(note);
    if (note !== high && letter !== 'E' && letter !== 'B') keys.push(`${letter}#${octave}`);
  }
  return keys;
}

// Notenvorrat einer Stufe (1 = ohne Hilfslinien, 2 = mit Hilfslinien)
export function levelNotes(clef, level) {
  const [low, high] = CLEFS[clef].levels[level];
  return naturalRange(low, high);
}
