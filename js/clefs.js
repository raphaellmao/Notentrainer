// Schlüsselsymbole als eigene SVG-Pfade – bewusst ohne Schriftart und ohne
// Unicode-Zeichen (𝄞/𝄢 sehen auf iPhone und Android unterschiedlich aus oder fehlen).
//
// Jeder Schlüssel ist ein „Federstrich“ mit wechselnder Breite entlang einer
// Mittellinie, dazu Kugeln und Punkte. Koordinaten in Notenlinien-Abständen,
// y zeigt nach unten, Ursprung auf der Bezugslinie des Schlüssels:
//   Violinschlüssel: G-Linie (2. Linie von unten) – um sie windet sich die Schnecke.
//   Bassschlüssel:   F-Linie (4. Linie von unten) – auf ihr sitzt die Kugel,
//                    die beiden Punkte liegen in den Zwischenräumen darüber und darunter.

// Mittellinie als Punkte [x, y, Strichbreite].
// Violinschlüssel in einem Zug: Schneckenende auf der G-Linie → über die Mittellinie
// nach rechts → Bauch → schräg hinauf zur oberen Schleife → Hals hinab → Haken mit Kugel.
const TREBLE_STROKE = [
  [1.25, 0.12, 0.06], // Ende der Schnecke, links vom Hals auf der G-Linie
  [1.12, -0.3, 0.12],
  [1.3, -0.78, 0.22],
  [1.8, -0.98, 0.34], // Oberkante der Schnecke an der Mittellinie
  [2.32, -0.86, 0.45],
  [2.66, -0.42, 0.48],
  [2.7, 0.15, 0.44],
  [2.5, 0.68, 0.35],
  [2.0, 1.02, 0.24],
  [1.38, 1.1, 0.2], // Unterkante des Bauchs, knapp unter der untersten Linie
  [0.78, 0.92, 0.26],
  [0.38, 0.42, 0.4],
  [0.26, -0.2, 0.5], // linke Bauchseite, kräftig
  [0.46, -0.95, 0.52],
  [0.96, -1.7, 0.5],
  [1.5, -2.35, 0.42], // kreuzt den Hals
  [1.96, -3.05, 0.32],
  [2.1, -3.7, 0.26],
  [1.94, -4.25, 0.22],
  [1.62, -4.4, 0.2], // Spitze der oberen Schleife
  [1.32, -4.05, 0.22],
  [1.22, -3.4, 0.24],
  [1.28, -2.5, 0.22], // Hals, leicht schräg nach rechts unten
  [1.42, -1.5, 0.2],
  [1.58, -0.5, 0.2],
  [1.74, 0.5, 0.2],
  [1.86, 1.55, 0.21],
  [1.9, 2.08, 0.22], // Haken, rund um die Kugel
  [1.76, 2.45, 0.21],
  [1.46, 2.6, 0.18],
  [1.2, 2.5, 0.15],
];
const TREBLE_BALL = { cx: 1.13, cy: 2.12, r: 0.4 };

// Bassschlüssel: Kugel auf der F-Linie, Bogen über die oberste Linie, schmal auslaufend
const BASS_STROKE = [
  [0.42, -0.2, 0.1],
  [0.62, -0.7, 0.13],
  [1.05, -0.94, 0.18],
  [1.58, -0.85, 0.28],
  [1.98, -0.48, 0.42],
  [2.16, 0.08, 0.52],
  [2.06, 0.7, 0.5],
  [1.74, 1.3, 0.42],
  [1.24, 1.84, 0.31],
  [0.66, 2.24, 0.18],
  [0.05, 2.52, 0.05],
];
const BASS_BALL = { cx: 0.42, cy: 0, r: 0.42 };
const BASS_DOTS = [
  { cx: 2.7, cy: -0.5, r: 0.16 },
  { cx: 2.7, cy: 0.5, r: 0.16 },
];

const num = (v) => String(+v.toFixed(3));

// Punkt auf einer zentripetalen Catmull-Rom-Kurve zwischen p1 und p2 (u von 0 bis 1).
// Interpoliert auch die Strichbreite.
function centripetal(p0, p1, p2, p3, u) {
  const knot = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a, b, ta, tb) => a.map((v, i) => ((tb - t) * v + (t - ta) * b[i]) / (tb - ta));
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

// Umriss eines Strichs mit wechselnder Breite als geschlossener SVG-Pfad (runde Enden).
export function strokeOutline(points, steps = 12) {
  const n = points.length;
  const ext = [
    points[0].map((v, i) => 2 * v - points[1][i]),
    ...points,
    points[n - 1].map((v, i) => 2 * v - points[n - 2][i]),
  ];
  const samples = [];
  for (let i = 1; i < ext.length - 2; i++) {
    for (let s = 0; s < steps; s++) samples.push(centripetal(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], s / steps));
  }
  samples.push(points[n - 1]);

  const left = [];
  const right = [];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const [x, y, w] = samples[i];
    left.push([x + (nx * w) / 2, y + (ny * w) / 2]);
    right.push([x - (nx * w) / 2, y - (ny * w) / 2]);
  }
  const pt = ([x, y]) => `${num(x)} ${num(y)}`;
  const endR = num(samples[samples.length - 1][2] / 2);
  const startR = num(samples[0][2] / 2);
  return (
    `M${pt(left[0])}` +
    left.slice(1).map((p) => `L${pt(p)}`).join('') +
    `A${endR} ${endR} 0 0 0 ${pt(right[right.length - 1])}` +
    right.slice(0, -1).reverse().map((p) => `L${pt(p)}`).join('') +
    `A${startR} ${startR} 0 0 0 ${pt(left[0])}Z`
  );
}

const circle = ({ cx, cy, r }, cls) => `<circle${cls ? ` class="${cls}"` : ''} cx="${cx}" cy="${cy}" r="${r}"/>`;

// SVG-Inhalt der Schlüssel (Einheit: ein Notenlinien-Abstand)
export const CLEF_SHAPES = {
  treble: `<path d="${strokeOutline(TREBLE_STROKE)}"/>${circle(TREBLE_BALL)}`,
  bass: `<path d="${strokeOutline(BASS_STROKE)}"/>${circle(BASS_BALL)}${BASS_DOTS.map((d) => circle(d, 'clef-dot')).join('')}`,
};

// Für Tests und Prüfseite: Rohdaten der Formen
export const CLEF_PARTS = { TREBLE_STROKE, TREBLE_BALL, BASS_STROKE, BASS_BALL, BASS_DOTS };
