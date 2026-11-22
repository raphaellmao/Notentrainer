// Liederbuch für Stufe 4 – nur gemeinfreie Melodien (Volkslieder bzw. Komponisten lange
// verstorben). Alle in C-Dur ohne Vorzeichen und im Bereich der Violin-Klaviatur (c¹–c³).
// Wo die übliche Tonlage unter c¹ reichen würde, steht das Lied eine Oktave höher.
//
// Schreibweise: Note + Wert (w Ganze, h Halbe, q Viertel, e Achtel, Punkt = punktiert), Takte mit „|“.

export const SONGS = [
  {
    id: 'entchen',
    title: 'Alle meine Entchen',
    origin: 'Volkslied',
    time: [4, 4],
    tempo: 100,
    melody:
      'C4q D4q E4q F4q | G4h G4h | A4q A4q A4q A4q | G4w | A4q A4q A4q A4q | G4w | ' +
      'F4q F4q F4q F4q | E4h E4h | D4q D4q D4q D4q | C4w',
  },
  {
    id: 'weihnachtsmann',
    title: 'Morgen kommt der Weihnachtsmann',
    origin: 'Volkslied (Melodie: „Ah! vous dirai-je, maman“)',
    time: [4, 4],
    tempo: 100,
    melody:
      'C4q C4q G4q G4q | A4q A4q G4h | F4q F4q E4q E4q | D4q D4q C4h | ' +
      'G4q G4q F4q F4q | E4q E4q D4h | G4q G4q F4q F4q | E4q E4q D4h | ' +
      'C4q C4q G4q G4q | A4q A4q G4h | F4q F4q E4q E4q | D4q D4q C4h',
  },
  {
    id: 'haenschen',
    title: 'Hänschen klein',
    origin: 'Volkslied',
    time: [4, 4],
    tempo: 100,
    melody:
      'G4q E4q E4h | F4q D4q D4h | C4q D4q E4q F4q | G4q G4q G4h | ' +
      'G4q E4q E4h | F4q D4q D4h | C4q E4q G4q G4q | C4w | ' +
      'D4q D4q D4q D4q | D4q E4q F4h | E4q E4q E4q E4q | E4q F4q G4h | ' +
      'G4q E4q E4h | F4q D4q D4h | C4q E4q G4q G4q | C4w',
  },
  {
    id: 'jakob',
    title: 'Bruder Jakob',
    origin: 'Volkslied (Kanon), eine Oktave höher',
    time: [4, 4],
    tempo: 100,
    melody:
      'C5q D5q E5q C5q | C5q D5q E5q C5q | E5q F5q G5h | E5q F5q G5h | ' +
      'G5e A5e G5e F5e E5q C5q | G5e A5e G5e F5e E5q C5q | C5q G4q C5h | C5q G4q C5h',
  },
  {
    id: 'jinglebells',
    title: 'Jingle Bells',
    origin: 'James Lord Pierpont (1857), Refrain',
    time: [4, 4],
    tempo: 110,
    melody:
      'E4q E4q E4h | E4q E4q E4h | E4q G4q C4q. D4e | E4w | ' +
      'F4q F4q F4q. F4e | F4q E4q E4q E4e E4e | E4q D4q D4q E4q | D4h G4h | ' +
      'E4q E4q E4h | E4q E4q E4h | E4q G4q C4q. D4e | E4w | ' +
      'F4q F4q F4q F4q | F4q E4q E4q E4e E4e | G4q G4q F4q D4q | C4w',
  },
  {
    id: 'freude',
    title: 'Ode an die Freude',
    origin: 'Ludwig van Beethoven, 9. Sinfonie (1824), eine Oktave höher',
    time: [4, 4],
    tempo: 100,
    melody:
      'E5q E5q F5q G5q | G5q F5q E5q D5q | C5q C5q D5q E5q | E5q. D5e D5h | ' +
      'E5q E5q F5q G5q | G5q F5q E5q D5q | C5q C5q D5q E5q | D5q. C5e C5h | ' +
      'D5q D5q E5q C5q | D5q E5e F5e E5q C5q | D5q E5e F5e E5q D5q | C5q D5q G4h | ' +
      'E5q E5q F5q G5q | G5q F5q E5q D5q | C5q C5q D5q E5q | D5q. C5e C5h',
  },
];
