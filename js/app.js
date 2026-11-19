// App: verbindet Notendarstellung, Klaviatur, Übungslogik und Klang mit der Oberfläche.

import { CLEFS, germanName, helmholtzName, frequency } from './notes.js';
import { renderStaff } from './staff.js';
import { keyboardLayout, keyAtClientPoint, renderKeyboard } from './keyboard.js';
import { Trainer } from './trainer.js';
import { Piano } from './audio.js';

const SETTINGS_KEY = 'notentrainer.einstellungen.v1';
const DELAY_RIGHT = 600; // ms bis zur nächsten Note nach richtiger Antwort
const DELAY_WRONG = 1500; // … nach falscher Antwort

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null; // z. B. Cookies/Speicher im Browser gesperrt
  }
})();

const settings = loadSettings();
const trainer = new Trainer({ storage });
const piano = new Piano();

const $ = (sel) => document.querySelector(sel);
const ui = {
  staff: $('#staff'),
  feedback: $('#feedback'),
  keyboard: $('#keyboard'),
  count: $('#count'),
  total: $('#total'),
  progress: $('#progress'),
  sound: $('#sound'),
  sumScore: $('#sum-score'),
  sumRate: $('#sum-rate'),
  sumTime: $('#sum-time'),
  sumWrong: $('#sum-wrong'),
  sumWrongTitle: $('#sum-wrong-title'),
  sumAllRight: $('#sum-all-right'),
  again: $('#again'),
};

let layout = null; // aktuelles Klaviatur-Layout (in Pixeln)
let marks = {}; // gefärbte Tasten
let shownAt = 0; // Zeitpunkt, an dem die aktuelle Note erschienen ist
let locked = true; // während der Rückmeldung keine weiteren Eingaben
let timer = 0;

function loadSettings() {
  const fallback = { mode: 'treble', level: 1, sound: true };
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}');
    return {
      mode: ['treble', 'bass', 'mixed'].includes(saved.mode) ? saved.mode : fallback.mode,
      level: [1, 2].includes(saved.level) ? saved.level : fallback.level,
      sound: typeof saved.sound === 'boolean' ? saved.sound : fallback.sound,
    };
  } catch {
    return fallback;
  }
}

function saveSettings() {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ohne Speicher gelten die Einstellungen nur bis zum Schließen
  }
}

function syncControls() {
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
  for (const b of document.querySelectorAll('[data-level]')) b.setAttribute('aria-checked', String(Number(b.dataset.level) === settings.level));
  ui.sound.setAttribute('aria-pressed', String(settings.sound));
  ui.sound.setAttribute('aria-label', settings.sound ? 'Ton ist an – ausschalten' : 'Ton ist aus – einschalten');
}

function setView(view) {
  document.body.dataset.view = view;
}

function startRound() {
  clearTimeout(timer);
  trainer.configure(settings.mode, settings.level);
  setView('play');
  nextNote();
}

function nextNote() {
  const item = trainer.next();
  ui.staff.innerHTML = renderStaff(item.clef, item.note, { label: `Note im ${CLEFS[item.clef].name}` });
  marks = {};
  drawKeyboard();
  showFeedback(null);
  const { answered, total } = trainer.progress;
  ui.count.textContent = String(answered + 1);
  ui.total.textContent = String(total);
  ui.progress.style.width = `${(answered / total) * 100}%`;
  shownAt = performance.now();
  locked = false;
}

function drawKeyboard() {
  const clef = trainer.current?.clef ?? (settings.mode === 'bass' ? 'bass' : 'treble');
  const { width, height } = ui.keyboard.getBoundingClientRect();
  if (!width || !height) return;
  layout = keyboardLayout(CLEFS[clef].keyboard, width, height);
  ui.keyboard.innerHTML = renderKeyboard(layout, { marks });
}

function showFeedback(result) {
  if (!result) {
    ui.feedback.className = 'feedback';
    ui.feedback.innerHTML = trainer.progress.answered === 0 ? '<span class="hint">Tippe die passende Taste.</span>' : '';
    return;
  }
  const { correct, item } = result;
  ui.feedback.className = `feedback ${correct ? 'right' : 'wrong'}`;
  ui.feedback.innerHTML =
    `<span class="verdict">${correct ? 'Richtig' : 'Falsch'}</span>` +
    `<span class="name">${germanName(item.note)}</span>` +
    `<span class="octave">${helmholtzName(item.note)}</span>`;
}

function answer(tapped) {
  locked = true;
  if (settings.sound) piano.play(frequency(tapped));
  const result = trainer.answer(tapped, performance.now() - shownAt);
  marks = { [tapped]: result.correct ? 'right' : 'wrong' };
  if (!result.correct) marks[result.item.note] = 'right';
  drawKeyboard();
  showFeedback(result);
  const { answered, total } = trainer.progress;
  ui.progress.style.width = `${(answered / total) * 100}%`;
  timer = setTimeout(result.done ? showSummary : nextNote, result.correct ? DELAY_RIGHT : DELAY_WRONG);
}

function showSummary() {
  const s = trainer.summary();
  const seconds = (s.avgMs / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  ui.sumScore.textContent = `${s.correct}/${s.total}`;
  ui.sumRate.textContent = `richtig (${Math.round(s.rate * 100)} %)`;
  ui.sumTime.textContent = `${seconds} s`;
  ui.sumWrong.innerHTML = s.wrong
    .map(
      (w) =>
        `<figure>${renderStaff(w.clef, w.note, { label: `${helmholtzName(w.note)} im ${CLEFS[w.clef].name}` })}` +
        `<figcaption><b>${germanName(w.note)}</b> ${helmholtzName(w.note)}${w.count > 1 ? ` <span>${w.count}×</span>` : ''}</figcaption></figure>`,
    )
    .join('');
  ui.sumWrongTitle.hidden = s.wrong.length === 0;
  ui.sumAllRight.hidden = s.wrong.length > 0;
  setView('summary');
}

// --- Eingaben ---

ui.keyboard.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button > 0) return;
  event.preventDefault();
  if (locked || !layout || !trainer.current) return;
  answer(keyAtClientPoint(layout, ui.keyboard.getBoundingClientRect(), event.clientX, event.clientY));
});
ui.keyboard.addEventListener('contextmenu', (event) => event.preventDefault());

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    if (settings.mode === button.dataset.mode) return;
    settings.mode = button.dataset.mode;
    saveSettings();
    syncControls();
    startRound();
  });
}

for (const button of document.querySelectorAll('[data-level]')) {
  button.addEventListener('click', () => {
    const level = Number(button.dataset.level);
    if (settings.level === level) return;
    settings.level = level;
    saveSettings();
    syncControls();
    startRound();
  });
}

ui.sound.addEventListener('click', () => {
  settings.sound = !settings.sound;
  saveSettings();
  syncControls();
});

ui.again.addEventListener('click', startRound);

// Ton erst nach einer Nutzeraktion freischalten (Vorgabe der Handy-Browser)
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  document.addEventListener(type, () => settings.sound && piano.unlock(), { capture: true, passive: true });
}

// Zeit, in der die App im Hintergrund war, zählt nicht als Antwortzeit
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !locked) shownAt = performance.now();
});

new ResizeObserver(() => drawKeyboard()).observe(ui.keyboard);

syncControls();
startRound();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
