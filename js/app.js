// App: verbindet Notendarstellung, Klaviatur, Übungslogik und Klang mit der Oberfläche.

import { CLEFS, germanName, helmholtzName, frequency, noteFromMidi, parseNote } from './notes.js';
import { Microphone } from './mic.js';
import { renderStaff } from './staff.js';
import { keyboardLayout, keyAtClientPoint, renderKeyboard } from './keyboard.js';
import { Trainer, noteOverview } from './trainer.js';
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
  sumUnlocked: $('#sum-unlocked'),
  again: $('#again'),
  overviewBtn: $('#overview-btn'),
  overviewList: $('#overview-list'),
  overviewBack: $('#overview-back'),
  toast: $('#toast'),
  micBtn: $('#mic-btn'),
};

const LEVELS = ['aufbau', 1, 2];
const parseLevel = (value) => (value === 'aufbau' ? 'aufbau' : Number(value));
const STATUS_TEXT = { sitzt: 'sitzt', wackelt: 'wackelt', ueben: 'üben', neu: 'noch nicht geübt' };
const seconds = (ms) => (ms / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

let layout = null; // aktuelles Klaviatur-Layout (in Pixeln)
let marks = {}; // gefärbte Tasten
let shownAt = 0; // Zeitpunkt, an dem die aktuelle Note erschienen ist
let locked = true; // während der Rückmeldung keine weiteren Eingaben
let timer = 0;
let toastTimer = 0;
let viewBeforeOverview = 'play';

function loadSettings() {
  const fallback = { mode: 'treble', level: 1, sound: true };
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}');
    return {
      mode: ['treble', 'bass', 'mixed'].includes(saved.mode) ? saved.mode : fallback.mode,
      level: LEVELS.includes(saved.level) ? saved.level : fallback.level,
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
  for (const b of document.querySelectorAll('[data-level]')) b.setAttribute('aria-checked', String(parseLevel(b.dataset.level) === settings.level));
  ui.sound.setAttribute('aria-pressed', String(settings.sound));
  ui.sound.setAttribute('aria-label', settings.sound ? 'Ton ist an – ausschalten' : 'Ton ist aus – einschalten');
}

// Während die Übersicht offen ist, merkt sich die App nur, wohin es danach zurückgeht.
function setView(view) {
  if (document.body.dataset.view === 'overview') viewBeforeOverview = view;
  else document.body.dataset.view = view;
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3000);
}

const noteList = (items) =>
  items.map((it) => (settings.mode === 'mixed' ? `${helmholtzName(it.note)} (${it.clef === 'treble' ? 'Violin' : 'Bass'})` : helmholtzName(it.note))).join(', ');

function showOverview() {
  if (document.body.dataset.view !== 'overview') viewBeforeOverview = document.body.dataset.view;
  ui.overviewList.innerHTML = ['treble', 'bass']
    .map((clef) => {
      const items = noteOverview(clef, trainer.stats, trainer.unlocked[clef]);
      const count = (s) => items.filter((i) => i.status === s).length;
      const open = items.filter((i) => !i.locked).length;
      const cards = items
        .map((i) => {
          const detail = i.attempts ? `${Math.round(i.rate * 100)} % · ${seconds(i.avgMs)} s` : i.locked ? 'Aufbau: noch gesperrt' : '–';
          return (
            `<figure class="ov ${i.status}${i.locked ? ' locked' : ''}">${renderStaff(clef, i.note, { label: `${helmholtzName(i.note)} im ${CLEFS[clef].name}` })}` +
            `<figcaption><b>${helmholtzName(i.note)}</b><span class="st">${STATUS_TEXT[i.status]}</span><span>${detail}</span></figcaption></figure>`
          );
        })
        .join('');
      return (
        `<h3>${CLEFS[clef].name}</h3>` +
        `<p class="ov-sum">${count('sitzt')} sitzen · ${count('wackelt')} wackeln · ${count('ueben')} üben · Aufbau: ${open} von ${items.length} frei</p>` +
        `<div class="ov-grid">${cards}</div>`
      );
    })
    .join('');
  document.body.dataset.view = 'overview';
  document.querySelector('.overview').scrollTop = 0;
}

function closeOverview() {
  document.body.dataset.view = viewBeforeOverview;
  if (viewBeforeOverview === 'play') {
    drawKeyboard();
    if (!locked) shownAt = performance.now(); // Zeit in der Übersicht zählt nicht
  }
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

function showFeedback(result, tapped) {
  if (!result) {
    ui.feedback.className = 'feedback';
    if (mic.active) {
      ui.feedback.innerHTML = '<span class="listen">Spiel die Note am Klavier <span class="mic-level"><i></i></span></span>';
    } else {
      ui.feedback.innerHTML = trainer.progress.answered === 0 ? '<span class="hint">Tippe die passende Taste.</span>' : '';
    }
    return;
  }
  const { correct, item } = result;
  let played = '';
  if (!correct) {
    const sameLetter = parseNote(tapped).letter === parseNote(item.note).letter && !parseNote(tapped).sharp;
    played = `<span class="played">${mic.active ? 'gespielt' : 'getippt'}: ${helmholtzName(tapped)}${sameLetter ? ' – falsche Oktave' : ''}</span>`;
  }
  ui.feedback.className = `feedback ${correct ? 'right' : 'wrong'}`;
  ui.feedback.innerHTML =
    `<span class="verdict">${correct ? 'Richtig' : 'Falsch'}</span>` +
    `<span class="name">${germanName(item.note)}</span>` +
    `<span class="octave">${helmholtzName(item.note)}</span>${played}`;
}

// --- Mikrofon: am echten Klavier antworten ---

const mic = new Microphone({
  onNote: (midi) => {
    if (locked || !trainer.current || document.body.dataset.view !== 'play') return;
    answer(noteFromMidi(midi));
  },
  onLevel: (level) => {
    const bar = ui.feedback.querySelector('.mic-level i');
    if (bar) bar.style.width = `${Math.min(100, Math.sqrt(level) * 350)}%`;
  },
  onEnded: () => {
    stopMic();
    showToast('Mikrofon wurde beendet. Zum Weitermachen wieder antippen.');
  },
});

async function startMic() {
  ui.micBtn.disabled = true;
  try {
    await mic.start();
    showToast('Mikrofon an – spiel die Noten am Klavier');
  } catch (err) {
    mic.stop();
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    showToast(denied ? 'Mikrofon nicht erlaubt. Bitte in den Einstellungen freigeben.' : 'Mikrofon ist hier nicht verfügbar.');
  } finally {
    ui.micBtn.disabled = false;
    syncMic();
  }
}

function stopMic() {
  mic.stop();
  syncMic();
}

function syncMic() {
  ui.micBtn.setAttribute('aria-pressed', String(mic.active));
  ui.micBtn.setAttribute('aria-label', mic.active ? 'Mikrofon ist an – ausschalten' : 'Mikrofon: am echten Klavier antworten');
  if (!locked && document.body.dataset.view === 'play') showFeedback(null);
}

function answer(tapped) {
  locked = true;
  // im Mikrofon-Modus kein eigener Ton – sonst hört sich die App selbst
  if (settings.sound && !mic.active) piano.play(frequency(tapped));
  const result = trainer.answer(tapped, performance.now() - shownAt);
  marks = { [tapped]: result.correct ? 'right' : 'wrong' };
  if (!result.correct) marks[result.item.note] = 'right';
  drawKeyboard();
  showFeedback(result, tapped);
  const { answered, total } = trainer.progress;
  ui.progress.style.width = `${(answered / total) * 100}%`;
  if (result.unlocked.length) showToast(`Neu dazu: ${noteList(result.unlocked)}`);
  timer = setTimeout(result.done ? showSummary : nextNote, result.correct ? DELAY_RIGHT : DELAY_WRONG);
}

function showSummary() {
  const s = trainer.summary();
  ui.sumScore.textContent = `${s.correct}/${s.total}`;
  ui.sumRate.textContent = `richtig (${Math.round(s.rate * 100)} %)`;
  ui.sumTime.textContent = `${seconds(s.avgMs)} s`;
  ui.sumUnlocked.hidden = s.unlocked.length === 0;
  ui.sumUnlocked.textContent = `Neu freigeschaltet: ${noteList(s.unlocked)}`;
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
    const level = parseLevel(button.dataset.level);
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
ui.micBtn.addEventListener('click', () => (mic.active ? stopMic() : startMic()));
ui.overviewBtn.addEventListener('click', () => (document.body.dataset.view === 'overview' ? closeOverview() : showOverview()));
ui.overviewBack.addEventListener('click', closeOverview);

// Ton erst nach einer Nutzeraktion freischalten (Vorgabe der Handy-Browser)
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  document.addEventListener(type, () => settings.sound && !mic.active && piano.unlock(), { capture: true, passive: true });
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
