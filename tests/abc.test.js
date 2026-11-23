// Lieder-Import (ABC-Notation)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importAbc, parseKey } from '../js/abc.js';
import { SONGS } from '../js/songs.js';
import { parseMelody, songNotes, layoutScore, renderScoreLine, measureBeats } from '../js/score.js';

const one = (abc) => {
  const r = importAbc(abc);
  assert.deepEqual(r.errors, [], 'keine Fehler');
  assert.equal(r.tunes.length, 1);
  return r.tunes[0];
};
const notes = (song) => songNotes(song).map((n) => n.note).join(' ');
const tune = (body, head = 'M:4/4\nL:1/4\nK:C') => one(`X:1\nT:Test\n${head}\n${body}`);

test('Gegenprobe: „Alle meine Entchen“ in ABC ergibt genau die Liederbuch-Melodie', () => {
  const { song, warnings } = one(`X:1
T:Alle meine Entchen
M:4/4
L:1/4
K:C
CDEF|G2G2|AAAA|G4|AAAA|G4|FFFF|E2E2|DDDD|C4|]`);
  assert.equal(song.melody, SONGS.find((s) => s.id === 'entchen').melody);
  assert.equal(song.title, 'Alle meine Entchen');
  assert.deepEqual(warnings, []);
});

test('Gegenprobe: „Bruder Jakob“ in F-Dur (B ohne Zeichen = b) ergibt die Liederbuch-Melodie', () => {
  const { song } = one(`X:2
T:Bruder Jakob
M:4/4
L:1/8
K:F
F2G2A2F2|F2G2A2F2|A2B2c4|A2B2c4|cdcB A2F2|cdcB A2F2|F2C2F4|F2C2F4|]`);
  const ref = SONGS.find((s) => s.id === 'jakob');
  assert.equal(song.melody, ref.melody);
  assert.equal(song.key, 'F');
});

test('Vorzeichen: Tonart gilt, Zeichen gelten bis zum Taktstrich, = löst auf', () => {
  assert.equal(notes(tune('^F F G A | F G A B |]').song), 'F#4 F#4 G4 A4 F4 G4 A4 B4');
  assert.equal(notes(tune('F =F F G | F G A B |]', 'M:4/4\nL:1/4\nK:G').song), 'F#4 F4 F4 G4 F#4 G4 A4 B4');
  assert.equal(notes(tune('B _E _A d |]', 'M:4/4\nL:1/4\nK:C').song), 'B4 Eb4 Ab4 D5');
  assert.equal(notes(tune('B E A d |]', 'M:4/4\nL:1/4\nK:Eb').song), 'Bb4 Eb4 Ab4 D5', 'Es-Dur: B, Es, As aus der Tonart');
});

test('Tonarten inklusive Moll und Kirchentonarten', () => {
  assert.equal(parseKey('Em').key, 'G');
  assert.equal(parseKey('Dm').key, 'F');
  assert.equal(parseKey('A dor').key, 'G');
  assert.equal(parseKey('D mix').key, 'G');
  assert.equal(parseKey('F#m').key, 'A');
  assert.equal(parseKey('Bbmaj').key, 'Bb');
  assert.throws(() => parseKey('H'), /Unbekannte Tonart/);
});

test('Oktaven und Notenlängen: c, c\', C,  · 2, /2, 3/2, >, <, Pausen', () => {
  const { song } = tune("c c' | C2 z2 | C/2D/2E F3/2G/2 A | C>D E<F G2 |]");
  // c' liegt über dem Bereich → nichts verschoben nötig, da c³ erlaubt
  assert.equal(notes(song), 'C5 C6 C4 C4 D4 E4 F4 G4 A4 C4 D4 E4 F4 G4');
  assert.equal(song.melody.split(' | ')[0], 'C5q C6q');
  const m = parseMelody(song.melody);
  assert.equal(m[1].map((n) => (n.rest ? 'z' : n.note) + n.value).join(' '), 'C4h zh');
  assert.equal(m[3].map((n) => n.value + (n.dotted ? '.' : '')).join(' '), 'q. e e q. h');
});

test('Wiederholungen werden ausgeschrieben, auch mit 1. und 2. Ende', () => {
  assert.equal(notes(tune('|: C D E F :| G4 |]').song), 'C4 D4 E4 F4 C4 D4 E4 F4 G4');
  assert.equal(notes(tune('|: C4 |[1 D4 :|[2 E4 |]').song), 'C4 D4 C4 E4');
  assert.equal(notes(tune('|: C4 |1 D4 :|2 E4 |]').song), 'C4 D4 C4 E4');
});

test('Haltebögen: angebundene Note wird gezeichnet, aber nicht noch einmal gespielt', () => {
  const { song } = tune('C2- C2 | D4 |]');
  assert.equal(notes(song), 'C4 D4');
  const layout = layoutScore(song);
  assert.match(renderScoreLine(layout, 0), /class="tie"/);
});

test('Akkorde: oberste Note zählt, mit Hinweis; Vorschläge und Verzierungen werden übergangen', () => {
  const { song, warnings } = tune('[CEG]2 {g}A ~B | "Am"!trill!c4 |]');
  assert.equal(notes(song), 'G4 A4 B4 C5');
  assert.ok(warnings.some((w) => /Akkorde/.test(w)));
  assert.ok(warnings.some((w) => /Vorschlag/.test(w)));
});

test('Zu tief oder zu hoch: um Oktaven auf die Klaviatur geschoben; zu großer Umfang wird abgelehnt', () => {
  const low = tune('C,D,E,F, | G,4 |]');
  assert.equal(notes(low.song), 'C4 D4 E4 F4 G4');
  assert.ok(low.warnings.some((w) => /nach oben verschoben/.test(w)));
  const r = importAbc("X:1\nT:Riesig\nM:4/4\nL:1/4\nK:C\nC,, C c c'' |]");
  assert.equal(r.tunes.length, 0);
  assert.match(r.errors[0], /Tonumfang zu groß/);
});

test('Typische Datei aus dem Netz: Kommentare, Liedtext, Akkordsymbole, Taktart C, Tempo, mehrere Lieder', () => {
  const r = importAbc(`% Sammlung
X: 7
T: Probe eins
T: Untertitel
C: trad.
M: C
L: 1/8
Q: 1/4=120
K: D
|: "D"A2 FA "G"B2 dB | "A"c2 ec "D"d4 :|
w: la la la la la la la la

X: 8
T: Probe zwei
M: 3/4
L: 1/4
K: Am
A B c | e2 d | c3 |]

X: 9
T: Ohne Tonart
M: 4/4
C D E F |]
`);
  assert.equal(r.tunes.length, 2);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /Ohne Tonart/);
  const [a, b] = r.tunes.map((t) => t.song);
  assert.equal(a.title, 'Probe eins');
  assert.equal(a.origin, 'Importiert · trad.');
  assert.deepEqual(a.time, [4, 4]);
  assert.equal(a.tempo, 120);
  assert.equal(a.key, 'D');
  assert.equal(notes(a).split(' ').length, 20, 'Wiederholung ausgeschrieben (2 × 10 Noten)');
  assert.ok(notes(a).includes('F#4') && notes(a).includes('C#5'), 'D-Dur: Fis und Cis');
  assert.equal(b.key, 'C', 'a-Moll hat keine Vorzeichen');
  for (const s of [a, b]) {
    parseMelody(s.melody).forEach((m) => assert.equal(m.reduce((x, n) => x + n.beats, 0), measureBeats(s.time)));
  }
});

test('Triolen werden mit Hinweis gerundet, das Lied bleibt nutzbar', () => {
  const { song, warnings } = tune('(3CDE F G | A4 |]', 'M:4/4\nL:1/8\nK:C');
  assert.ok(warnings.some((w) => /Triolen/.test(w)));
  assert.equal(notes(song), 'C4 D4 E4 F4 G4 A4');
});

import { abcLyrics } from '../js/abc.js';
import { parseLyrics } from '../js/score.js';

test('ABC-Liedtext: w:-Zeilen werden übernommen und Silbe für Silbe unter die Noten gelegt', () => {
  const abc = ['X:1', 'T:Entchen', 'M:4/4', 'L:1/4', 'K:C', 'CDEF|G2G2|', 'w:Al-le mei-ne Ent-chen', 'w:zwei-te Stro-phe gilt nicht', 'AAAA|G4|]', 'w:schwim-men auf dem See'].join('\n');
  const { tunes } = importAbc(abc);
  const song = tunes[0].song;
  assert.deepEqual(parseLyrics(song.lyrics), ['Al-', 'le', 'mei-', 'ne', 'Ent-', 'chen', 'schwim-', 'men', 'auf', 'dem', 'See']);
  assert.equal(parseLyrics(song.lyrics).length, songNotes(song).length);
  assert.deepEqual(tunes[0].warnings, []);
});

test('ABC-Liedtext: ~ _ * und \- nach ABC-Regeln', () => {
  const t = abcLyrics(['CDEF|', String.raw`w:a~b c_ * x\-y`]);
  assert.deepEqual(parseLyrics(t), ['a b', 'c', '', '', 'x‐y']);
});

test('ABC-Liedtext: passt die Silbenzahl nicht, wird er mit Hinweis weggelassen', () => {
  const { tunes } = importAbc(['X:1', 'T:Kurz', 'M:4/4', 'L:1/4', 'K:C', 'CDEF|G4|]', 'w:nur drei Sil-ben'].join('\n'));
  assert.equal(tunes[0].song.lyrics, undefined);
  assert.ok(tunes[0].warnings.some((w) => /Liedtext weggelassen: 4 Silben für 5 Noten/.test(w)), tunes[0].warnings.join());
});
