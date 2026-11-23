// Liederbuch für Stufe 4 – nur gemeinfreie Melodien (Volkslieder bzw. Komponisten lange
// verstorben), alle im Bereich der Violin-Klaviatur (c¹–c³). key: Tonart (Standard C-Dur);
// Noten mit ihrer tatsächlichen Tonhöhe schreiben (in F-Dur also "Bb4"), die Vorzeichen setzt der Notensatz.
// Wo die übliche Tonlage unter c¹ reichen würde, steht das Lied eine Oktave höher.
//
// Schreibweise: Note + Wert (w Ganze, h Halbe, q Viertel, e Achtel, Punkt = punktiert), Takte mit „|“.
// lyrics: eine Silbe je angeschlagener Note, Silben mit „-“ getrennt, „_“ = Silbe wird weitergesungen.

export const SONGS = [
  {
    id: 'entchen',
    title: 'Alle meine Entchen',
    origin: 'Volkslied',
    time: [4, 4],
    tempo: 100,
    lyrics: 'Al-le mei-ne Ent-chen schwim-men auf dem See, schwim-men auf dem See, Köpf-chen in das Was-ser, Schwänz-chen in die Höh.',
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
    lyrics: 'Häns-chen klein ging al-lein in die wei-te Welt hin-ein. Stock und Hut steht ihm gut, ist gar wohl-ge-mut. A-ber Mut-ter wei-net sehr, hat ja nun kein Häns-chen mehr. Da be-sinnt sich das Kind, kehrt nach Haus ge-schwind.',
    melody:
      'G4q E4q E4h | F4q D4q D4h | C4q D4q E4q F4q | G4q G4q G4h | ' +
      'G4q E4q E4h | F4q D4q D4h | C4q E4q G4q G4q | C4w | ' +
      'D4q D4q D4q D4q | D4q E4q F4h | E4q E4q E4q E4q | E4q F4q G4h | ' +
      'G4q E4q E4h | F4q D4q D4h | C4q E4q G4q G4q | C4w',
  },
  {
    id: 'jakob',
    title: 'Bruder Jakob',
    origin: 'Volkslied (Kanon), F-Dur mit einem b',
    time: [4, 4],
    key: 'F',
    tempo: 100,
    lyrics: 'Bru-der Ja-kob, Bru-der Ja-kob, schläfst du noch? Schläfst du noch? Hörst du nicht die Glo-cken? Hörst du nicht die Glo-cken? Ding, dang, dong! Ding, dang, dong!',
    melody:
      'F4q G4q A4q F4q | F4q G4q A4q F4q | A4q Bb4q C5h | A4q Bb4q C5h | ' +
      'C5e D5e C5e Bb4e A4q F4q | C5e D5e C5e Bb4e A4q F4q | F4q C4q F4h | F4q C4q F4h',
  },
  {
    id: 'jinglebells',
    title: 'Jingle Bells',
    origin: 'James Lord Pierpont (1857), Refrain',
    time: [4, 4],
    tempo: 110,
    lyrics: 'Jin-gle bells, jin-gle bells, jin-gle all the way! Oh what fun it is to ride in a one-horse o-pen sleigh, hey! Jin-gle bells, jin-gle bells, jin-gle all the way! Oh what fun it is to ride in a one-horse o-pen sleigh.',
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
    lyrics: 'Freu-de, schö-ner Göt-ter-fun-ken, Toch-ter aus E-ly-si-um, wir be-tre-ten feu-er-trun-ken, Himm-li-sche, dein Hei-lig-tum! Dei-ne Zau-ber bin-den _ wie-der, was die _ Mo-de streng ge-teilt; al-le Men-schen wer-den Brü-der, wo dein sanf-ter Flü-gel weilt.',
    melody:
      'E5q E5q F5q G5q | G5q F5q E5q D5q | C5q C5q D5q E5q | E5q. D5e D5h | ' +
      'E5q E5q F5q G5q | G5q F5q E5q D5q | C5q C5q D5q E5q | D5q. C5e C5h | ' +
      'D5q D5q E5q C5q | D5q E5e F5e E5q C5q | D5q E5e F5e E5q D5q | C5q D5q G4h | ' +
      'E5q E5q F5q G5q | G5q F5q E5q D5q | C5q C5q D5q E5q | D5q. C5e C5h',
  },
];
