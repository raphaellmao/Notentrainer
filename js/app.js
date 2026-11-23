// App: verbindet Notendarstellung, Klaviatur, Übungslogik und Klang mit der Oberfläche.

import { CLEFS, germanName, helmholtzName, frequency, noteFromMidi, parseNote, midiNumber, keyOf, asFlat } from './notes.js';
import { Microphone } from './mic.js';
import { SONGS } from './songs.js';
import { layoutScore, renderScoreLine, parseMelody, songNotes } from './score.js';
import { importAbc } from './abc.js';
import { schedule, judge, missedAfter, summarizeRhythm, TIMING_TEXT, SYNC, estimateOffset, cleanOffsets, systematicShift } from './rhythm.js';
import { TuningSession, MIN_SAMPLES, nearestNote } from './tuning.js';
import { renderStaff, renderSequence } from './staff.js';
import { keyboardLayout, keyAtClientPoint, renderKeyboard } from './keyboard.js';
import { Trainer, noteOverview, accidentalOverview } from './trainer.js';
import { createBackup, backupFileName, parseBackup, restoreBackup, undoRestore, hasSafetyCopy } from './backup.js';
import { Piano } from './audio.js';

const SETTINGS_KEY = 'notentrainer.einstellungen.v1';
const DELAY_RIGHT = 600; // ms bis zur nächsten Note nach richtiger Antwort
const DELAY_WRONG = 1500; // … nach falscher Antwort
const SEQ_DELAY_RIGHT = 300; // in Notenfolgen: nach richtiger Note gleich zur nächsten

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null; // z. B. Cookies/Speicher im Browser gesperrt
  }
})();

// Importierte Lieder (ABC) – im Browser gespeichert; ungültige Einträge werden übergangen
const USER_SONGS_KEY = 'notentrainer.lieder.v1';
let userSongs = loadUserSongs();
function loadUserSongs() {
  try {
    const list = JSON.parse(storage?.getItem(USER_SONGS_KEY) || '[]');
    return Array.isArray(list)
      ? list.filter((s) => {
          try {
            return s && s.id && s.title && s.melody && parseMelody(s.melody).length > 0;
          } catch {
            return false;
          }
        })
      : [];
  } catch {
    return [];
  }
}
function saveUserSongs() {
  try {
    storage?.setItem(USER_SONGS_KEY, JSON.stringify(userSongs));
    return true;
  } catch {
    return false;
  }
}
const allSongs = () => [...SONGS, ...userSongs];

// Muss vor loadSettings() stehen: Stand es dahinter, scheiterte das Laden still (const noch nicht
// angelegt) und die App startete bis Version 1.9.0 immer mit den Standard-Einstellungen.
const LEVELS = ['aufbau', 1, 2, 'vorzeichen', 'folgen', 'lieder'];
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
  sumRhythm: $('#sum-rhythm'),
  sumRhythmBox: $('#sum-rhythm-box'),
  sumRhythmHint: $('#sum-rhythm-hint'),
  rhythmBtn: $('#rhythm-btn'),
  rhythmTempo: $('#rhythm-tempo'),
  songbar: $('#songbar'),
  songTitle: $('#song-title'),
  songLine: $('#song-line'),
  songList: $('#song-list'),
  otherSong: $('#other-song'),
};

const parseLevel = (value) => (['aufbau', 'vorzeichen', 'folgen', 'lieder'].includes(value) ? value : Number(value));
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
  const fallback = { mode: 'treble', level: 1, sound: true, refA: 440, song: null, rhythmTempo: 0.8, rhythmOffset: { touch: 0, mic: 0 } };
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}');
    return {
      mode: ['treble', 'bass', 'mixed'].includes(saved.mode) ? saved.mode : fallback.mode,
      level: LEVELS.includes(saved.level) ? saved.level : fallback.level,
      sound: typeof saved.sound === 'boolean' ? saved.sound : fallback.sound,
      // gemessene Stimmung des Klaviers; nur plausible Werte (etwa ±1 Halbton um 440 Hz)
      refA: Number.isFinite(saved.refA) && saved.refA > 410 && saved.refA < 470 ? saved.refA : fallback.refA,
      song: allSongs().some((x) => x.id === saved.song) ? saved.song : fallback.song,
      rhythmTempo: [0.6, 0.8, 1].includes(saved.rhythmTempo) ? saved.rhythmTempo : fallback.rhythmTempo,
      // Takt-Abgleich: gemessene Verzögerung beim Tippen bzw. über das Mikrofon (ms)
      rhythmOffset: cleanOffsets(saved.rhythmOffset),
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
  $('#level').value = String(settings.level);
  // Lieder stehen im Violinschlüssel – die Schlüsselwahl gilt dort nicht
  document.querySelector('.mode').classList.toggle('inactive', settings.level === 'lieder');
  ui.sound.setAttribute('aria-pressed', String(settings.sound));
  ui.sound.setAttribute('aria-label', settings.sound ? 'Ton ist an – ausschalten' : 'Ton ist aus – einschalten');
}

// Während die Übersicht offen ist, merkt sich die App nur, wohin es danach zurückgeht.
const OVERLAYS = ['overview', 'tune', 'sync'];
function setView(view) {
  if (OVERLAYS.includes(document.body.dataset.view)) viewBeforeOverview = view;
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
  stopRhythm();
  if (!OVERLAYS.includes(document.body.dataset.view)) viewBeforeOverview = document.body.dataset.view;
  ui.overviewList.innerHTML = ['treble', 'bass']
    .map((clef) => {
      const items = noteOverview(clef, trainer.stats, trainer.unlocked[clef]);
      const count = (list, s) => list.filter((i) => i.status === s).length;
      const open = items.filter((i) => !i.locked).length;
      const cards = (list) =>
        list
          .map((i) => {
            const detail = i.attempts ? `${Math.round(i.rate * 100)} % · ${seconds(i.avgMs)} s` : i.locked ? 'Aufbau: noch gesperrt' : '–';
            return (
              `<figure class="ov ${i.status}${i.locked ? ' locked' : ''}" data-note="${i.note}">${renderStaff(clef, i.note, { label: `${helmholtzName(i.note)} im ${CLEFS[clef].name}` })}` +
              `<figcaption><b>${helmholtzName(i.note)}</b><span class="st">${STATUS_TEXT[i.status]}</span><span>${detail}</span></figcaption></figure>`
            );
          })
          .join('');
      // Noten mit Kreuz und b (Stufe „Vorzeichen“) – aufgeklappt, sobald welche geübt wurden
      const acc = accidentalOverview(clef, trainer.stats);
      const practiced = acc.filter((i) => i.attempts > 0).length;
      return (
        `<h3>${CLEFS[clef].name}</h3>` +
        `<p class="ov-sum">${count(items, 'sitzt')} sitzen · ${count(items, 'wackelt')} wackeln · ${count(items, 'ueben')} üben · Aufbau: ${open} von ${items.length} frei</p>` +
        `<div class="ov-grid">${cards(items)}</div>` +
        `<details class="ov-acc"${practiced ? ' open' : ''}><summary>Mit Vorzeichen (Kreuz und b) · ${practiced ? `${count(acc, 'sitzt')} sitzen · ${count(acc, 'wackelt')} wackeln · ${count(acc, 'ueben')} üben` : 'noch nicht geübt'}</summary>` +
        `<div class="ov-grid">${cards(acc)}</div></details>`
      );
    })
    .join('');
  $('#backup-undo').hidden = !(storage && hasSafetyCopy(storage));
  document.body.dataset.view = 'overview';
  document.querySelector('.overview').scrollTop = 0;
}

// --- Lernstand sichern und wiederherstellen ---

function backupMessage(text, error = false) {
  const el = $('#backup-msg');
  el.textContent = text;
  el.className = error ? 'import-error' : 'backup-ok';
}

async function saveBackup() {
  if (!storage) return backupMessage('Der Browser-Speicher ist nicht verfügbar.', true);
  const name = backupFileName();
  const text = createBackup(storage);
  const file = new File([text], name, { type: 'application/json' });
  try {
    // iPhone/Android: Teilen-Menü („In Dateien sichern“, Mail, Cloud …)
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Notentrainer – Lernstand' });
      return backupMessage(`Gesichert als „${name}“.`);
    }
  } catch (err) {
    if (err?.name === 'AbortError') return backupMessage('Sichern abgebrochen.');
  }
  // sonst als Download
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  backupMessage(`Gesichert als „${name}“ (im Download-Ordner).`);
}

async function loadBackup(file) {
  if (!storage) return backupMessage('Der Browser-Speicher ist nicht verfügbar.', true);
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (err) {
    return backupMessage(err.message, true);
  }
  const { summary, savedAt } = parsed;
  const when = savedAt ? new Date(savedAt).toLocaleDateString('de-DE') : 'unbekanntem Datum';
  const ok = window.confirm(
    `Lernstand vom ${when} wiederherstellen?\n\n${summary.notes} Noten mit ${summary.attempts} Antworten, ${summary.songs} importierte Lieder.\n\n` +
      'Dein jetziger Stand wird dadurch ersetzt. Eine Sicherheitskopie bleibt – du kannst es danach rückgängig machen.',
  );
  if (!ok) return backupMessage('Wiederherstellen abgebrochen – nichts geändert.');
  restoreBackup(storage, parsed.data);
  location.reload();
}

function undoBackup() {
  if (!storage || !hasSafetyCopy(storage)) return;
  if (!window.confirm('Den Stand von vor dem letzten Wiederherstellen zurückholen?')) return;
  undoRestore(storage);
  location.reload();
}

function closeOverview() {
  document.body.dataset.view = viewBeforeOverview;
  if (viewBeforeOverview === 'play') {
    drawKeyboard();
    if (!locked) shownAt = performance.now(); // Zeit in der Übersicht zählt nicht
  }
}

function startRound() {
  stopRhythm();
  clearTimeout(timer);
  trainer.configure(settings.mode, settings.level);
  ui.songbar.hidden = settings.level !== 'lieder';
  ui.otherSong.hidden = settings.level !== 'lieder';
  if (settings.level === 'lieder') {
    const song = allSongs().find((x) => x.id === settings.song);
    if (!song) return showSongs();
    return startSong(song);
  }
  setView('play');
  if (trainer.isSequence) nextSequence();
  else nextNote();
}

// --- Stufe 4: Lieder ---

let songLayout = null;
let currentSong = null;
let playbackUntil = 0; // während „Anhören“ zählt das Mikrofon nicht

function showSongs() {
  stopRhythm();
  clearTimeout(timer);
  const card = (song) => {
    const notes = songNotes(song);
    const range = [...notes].sort((a, b) => frequency(a.note) - frequency(b.note));
    const del = song.imported ? `<button type="button" class="song-delete" data-delete="${song.id}" aria-label="${escapeHtml(song.title)} entfernen">Entfernen</button>` : '';
    return (
      `<div class="song-row"><button type="button" class="song-card" data-song="${song.id}"><b>${escapeHtml(song.title)}</b>` +
      `<span>${escapeHtml(song.origin)}</span><span>${notes.length} Noten · ${helmholtzName(range[0].note)} bis ${helmholtzName(range[range.length - 1].note)} · ${song.time.join('/')}-Takt</span></button>${del}</div>`
    );
  };
  ui.songList.innerHTML =
    SONGS.map(card).join('') + (userSongs.length ? `<h3 class="songs-sub">Importiert</h3>${userSongs.map(card).join('')}` : '');
  ui.songbar.hidden = true;
  setView('songs');
}

function startSong(song) {
  currentSong = song;
  songLayout = layoutScore(song);
  trainer.startSong(songNotes(song).map((n) => n.note));
  seqStates = [];
  ui.songTitle.textContent = song.title;
  ui.songbar.hidden = false;
  setView('play');
  drawSequence(trainer.position);
  ready();
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

// --- Lieder importieren (ABC) ---

function runImport(text) {
  const out = $('#import-result');
  if (!text.trim()) {
    out.innerHTML = '<p class="import-error">Bitte zuerst ABC-Text einfügen oder eine Datei wählen.</p>';
    return;
  }
  const { tunes, errors } = importAbc(text);
  for (const t of tunes) userSongs.push(t.song);
  const saved = tunes.length ? saveUserSongs() : true;
  const parts = tunes.map(({ song, warnings }) => {
    const count = songNotes(song).length;
    return (
      `<div class="import-ok"><b>✓ ${escapeHtml(song.title)}</b> – ${count} Noten, ${song.time.join('/')}-Takt` +
      (warnings.length ? `<ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '') +
      `<button type="button" class="link-btn" data-song="${song.id}">Jetzt spielen</button></div>`
    );
  });
  parts.push(...errors.map((e) => `<p class="import-error">✗ ${escapeHtml(e)}</p>`));
  if (!saved) parts.push('<p class="import-error">Speichern im Browser nicht möglich – das Lied ist nur bis zum Schließen da.</p>');
  out.innerHTML = parts.join('');
  showSongs();
  $('#import-panel').open = true;
}

// --- Im Takt spielen (Stufe 4): Metronom, Einzählen, Bewertung der Zeitpunkte ---

let rhythm = null; // läuft gerade: { sched, startPerf, results, raf, timers }
let lastRhythm = null; // Ergebnis für die Auswertung

async function startRhythm() {
  if (!currentSong) return;
  stopRhythm();
  clearTimeout(timer);
  piano.unlock();
  if (piano.ctx && piano.ctx.state !== 'running') await piano.ctx.resume().catch(() => {});
  const sched = schedule(currentSong, settings.rhythmTempo);
  // Lied von vorn
  startSong(currentSong);
  locked = false;
  const countInMs = sched.perBar * sched.beatMs;
  const leadMs = 250;
  const perfNow = performance.now();
  const latency = piano.latencyMs;
  const startPerf = perfNow + leadMs + countInMs + latency;
  rhythm = { sched, startPerf, results: [], raf: 0, timers: [] };
  document.body.dataset.rhythm = 'on';
  document.body.dataset.rhythmStart = String(startPerf); // auch für Tests auslesbar
  ui.rhythmBtn.innerHTML = '■ Stopp';

  // Metronom: ein Takt Einzählen, dann durch das ganze Lied (betont auf der Eins)
  if (piano.ctx && piano.ctx.state === 'running') {
    rhythm.bus = piano.ctx.createGain();
    rhythm.bus.connect(piano.out);
    const audioStart = piano.ctx.currentTime + (leadMs + countInMs) / 1000;
    for (let k = 0; k < sched.perBar; k++) piano.click(audioStart - ((sched.perBar - k) * sched.beatMs) / 1000, k === 0, rhythm.bus);
    for (let b = 0; b * sched.beatMs < sched.totalMs - 1; b++) piano.click(audioStart + (b * sched.beatMs) / 1000, b % sched.perBar === 0, rhythm.bus);
  } else showToast('Ohne Ton – zähle selbst mit');

  // Einzählen anzeigen
  ui.feedback.className = 'feedback';
  for (let k = 0; k < sched.perBar; k++) {
    rhythm.timers.push(
      setTimeout(() => {
        ui.feedback.innerHTML = `<span class="count-in">${k + 1}</span>`;
      }, leadMs + latency + k * sched.beatMs),
    );
  }
  rhythm.timers.push(setTimeout(() => (ui.feedback.innerHTML = '<span class="count-in go">Los!</span>'), startPerf - perfNow - 40));

  const tick = () => {
    if (!rhythm) return;
    rhythm.raf = requestAnimationFrame(tick);
    const now = performance.now() - rhythm.startPerf;
    const note = rhythm.sched.notes[trainer.position];
    if (note && now > missedAfter(note, rhythm.sched.quarterMs)) {
      // verpasst: Lied läuft weiter wie echte Musik
      rhythm.results.push({ timing: 'missed', delta: null, correct: false });
      seqStates[trainer.position] = 'wrong';
      const res = trainer.skip();
      ui.feedback.className = 'feedback wrong';
      ui.feedback.innerHTML = `<span class="verdict">verpasst</span><span class="name">${germanName(res.item.note)}</span><span class="octave">${helmholtzName(res.item.note)}</span>`;
      advanceRhythm(res.done);
    }
  };
  rhythm.raf = requestAnimationFrame(tick);
}

function advanceRhythm(done) {
  const { answered, total } = trainer.progress;
  ui.progress.style.width = `${(answered / total) * 100}%`;
  if (done || !trainer.advance()) {
    drawSequence(trainer.sequence.length - 1);
    finishRhythm();
    return;
  }
  ui.count.textContent = String(answered + 1);
  drawSequence(trainer.position);
}

function answerInRhythm(tapped, at, source) {
  const note = rhythm.sched.notes[trainer.position];
  if (!note) return;
  // gemessene Verzögerung von Lautsprecher, Bildschirm bzw. Mikrofon herausrechnen (Takt-Abgleich)
  const delta = at - rhythm.startPerf - note.at - (settings.rhythmOffset[source] ?? 0);
  if (delta < -rhythm.sched.beatMs * 1.5) return; // noch beim Einzählen: ignorieren
  if (settings.sound && !mic.active) piano.play(frequency(tapped));
  const timing = judge(delta, rhythm.sched.quarterMs);
  const result = trainer.answer(tapped, 1000);
  rhythm.results.push({ timing, delta, correct: result.correct, source });
  seqStates[trainer.position] = result.correct ? 'right' : 'wrong';
  marks = { [tapped]: result.correct ? 'right' : 'wrong' };
  if (!result.correct) marks[keyOf(result.item.note)] = 'right';
  drawKeyboard();
  const keysShown = marks;
  setTimeout(() => {
    if (marks === keysShown) {
      marks = {};
      drawKeyboard();
    }
  }, 250);
  ui.feedback.className = `feedback ${result.correct ? 'right' : 'wrong'} timing-${timing}`;
  ui.feedback.innerHTML =
    `<span class="verdict">${result.correct ? 'Richtig' : 'Falsch'}</span>` +
    `<span class="name">${germanName(result.item.note)}</span>` +
    `<span class="timing">${TIMING_TEXT[timing]}</span>`;
  advanceRhythm(result.done);
}

function finishRhythm() {
  if (!rhythm) return;
  lastRhythm = { ...summarizeRhythm(rhythm.results), shift: systematicShift(rhythm.results, rhythm.sched.quarterMs) };
  stopRhythm();
  locked = true;
  timer = setTimeout(showSummary, 900);
}

function stopRhythm() {
  if (!rhythm) return;
  cancelAnimationFrame(rhythm.raf);
  rhythm.timers.forEach(clearTimeout);
  rhythm.bus?.disconnect(); // vorausgeplante Metronom-Klicks verstummen
  rhythm = null;
  delete document.body.dataset.rhythm;
  delete document.body.dataset.rhythmStart;
  ui.rhythmBtn.innerHTML = '♩ Im Takt<span class="long"> spielen</span>';
}

// Melodie vorspielen (Tempo aus dem Lied, Viertel = 60/Tempo Sekunden)
async function playSong() {
  if (!currentSong) return;
  piano.unlock();
  if (piano.ctx && piano.ctx.state !== 'running') await piano.ctx.resume().catch(() => {});
  if (!piano.ctx) return showToast('Dieser Browser kann keine Töne abspielen.');
  if (piano.ctx.state !== 'running') return showToast('Ton ist noch nicht freigegeben – bitte nochmal tippen.');
  const quarter = 60 / currentSong.tempo;
  let t = 0.1;
  for (const n of parseMelody(currentSong.melody).flat()) {
    if (!n.rest && !n.tiedFrom) piano.voice(frequency(n.note), t); // Pausen und Haltebögen klingen nicht neu
    t += n.beats * quarter;
  }
  playbackUntil = performance.now() + t * 1000 + 800;
  if (mic.active) showToast('Beim Anhören wertet das Mikrofon nicht.');
}

function nextNote() {
  const item = trainer.next();
  ui.staff.innerHTML = renderStaff(item.clef, item.note, { label: `Note im ${CLEFS[item.clef].name}` });
  ready();
}

// --- Stufe 3: Notenfolgen ---

let seqStates = []; // je Note der Folge: 'right' | 'wrong' | undefined

function nextSequence() {
  trainer.nextSequence();
  seqStates = [];
  drawSequence(trainer.position);
  ready();
}

function drawSequence(current) {
  const seq = trainer.sequence;
  if (settings.level === 'lieder' && songLayout) {
    // Zeile mit der aktuellen Note (am Ende die letzte Zeile)
    const target = Math.min(current, seq.length - 1);
    const li = Math.max(0, songLayout.lines.findIndex((l) => l.notes.some((n) => n.index === target)));
    ui.songLine.textContent = `Zeile ${li + 1}/${songLayout.lines.length}`;
    ui.staff.innerHTML = renderScoreLine(songLayout, li, { states: seqStates, current, label: `${currentSong.title}, Zeile ${li + 1}` });
    return;
  }
  ui.staff.innerHTML = renderSequence(seq[0].clef, seq.map((it) => it.note), {
    states: seqStates,
    current,
    label: `Notenfolge im ${CLEFS[seq[0].clef].name}`,
  });
}

// nach einer Antwort in der Folge: weiter zur nächsten Note, zur nächsten Folge oder zur Auswertung
function continueSequence(done) {
  if (done) return showSummary();
  if (trainer.advance()) {
    drawSequence(trainer.position);
    ready();
  } else nextSequence();
}

// Aufgabe steht: Tasten zurücksetzen, Zähler aktualisieren, Eingabe freigeben
function ready() {
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
      ui.feedback.innerHTML =
        '<span class="listen"><span class="listen-text">Spiel die Note am Klavier</span>' +
        '<span class="mic-level"><i></i></span><span class="heard"></span>' +
        '<button type="button" class="link-btn" data-action="tune">Einmessen</button></span>';
    } else {
      const hint = trainer.isSequence ? 'Spiel die Noten von links nach rechts.' : 'Tippe die passende Taste.';
      ui.feedback.innerHTML = trainer.progress.answered === 0 ? `<span class="hint">${hint}</span>` : '';
    }
    return;
  }
  const { correct, item } = result;
  let played = '';
  if (!correct) {
    // gleiche Taste, andere Oktave? (auch bei schwarzen Tasten, z. B. b¹ statt b²)
    const octaveOff = (midiNumber(tapped) - midiNumber(item.note)) % 12 === 0;
    // schwarze Taste so benennen, wie die Aufgabe geschrieben ist (b-Note → b-Name)
    const shown = parseNote(item.note).flat ? asFlat(tapped) : tapped;
    played = `<span class="played">${mic.active ? 'gespielt' : 'getippt'}: ${helmholtzName(shown)}${octaveOff ? ' – falsche Oktave' : ''}</span>`;
  }
  ui.feedback.className = `feedback ${correct ? 'right' : 'wrong'}`;
  ui.feedback.innerHTML =
    `<span class="verdict">${correct ? 'Richtig' : 'Falsch'}</span>` +
    `<span class="name">${germanName(item.note)}</span>` +
    `<span class="octave">${helmholtzName(item.note)}</span>${played}`;
}

// --- Mikrofon: am echten Klavier antworten ---

const mic = new Microphone({
  onNote: (midi, at) => {
    if (document.body.dataset.view === 'sync') return syncTap(at, 'mic');
    if (locked || !trainer.current || document.body.dataset.view !== 'play' || performance.now() < playbackUntil) return;
    answer(noteFromMidi(midi), at, 'mic');
  },
  // Pegel + live gehörte Note anzeigen; nach 8 s Stille einen Hinweis geben
  onLevel: (level, heardMidi) => {
    const now = performance.now();
    if (heardMidi !== null) {
      lastHeard = { midi: heardMidi, at: now };
      lastSoundAt = now;
    }
    const bar = ui.feedback.querySelector('.mic-level i');
    if (!bar) return;
    bar.style.width = `${Math.min(100, Math.sqrt(level) * 350)}%`;
    const heard = ui.feedback.querySelector('.heard');
    const showHeard = lastHeard && now - lastHeard.at < 500;
    heard.textContent = showHeard ? `höre: ${helmholtzName(noteFromMidi(lastHeard.midi))}` : '';
    ui.feedback.querySelector('.listen-text').textContent =
      now - lastSoundAt > 8000 ? 'Ich höre nichts – Handy näher ans Klavier?' : 'Spiel die Note am Klavier';
  },
  onEnded: () => {
    stopMic();
    showToast('Mikrofon wurde beendet. Zum Weitermachen wieder antippen.');
  },
  onFrame: (frame, note) => tuneFrame(frame, note),
});
mic.refA = settings.refA;

let lastHeard = null;
let lastSoundAt = 0;

// --- Einmessen: Stimmung des Klaviers messen ---

let tuneSession = null;
let tuneResult = null;
const centsText = (c) => `${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c)} Cent`;

async function showTune() {
  if (!OVERLAYS.includes(document.body.dataset.view)) viewBeforeOverview = document.body.dataset.view;
  if (!mic.active) await startMic();
  if (!mic.active) return; // keine Erlaubnis – Hinweis kam schon als Meldung
  tuneSession = new TuningSession();
  tuneResult = null;
  mic.calibrating = true;
  document.body.dataset.view = 'tune';
  $('#tune-result').hidden = true;
  $('#tune-save').disabled = true;
  $('#tune-count').textContent = `0 von ${MIN_SAMPLES} Tönen gemessen`;
  $('#tune-current').textContent =
    settings.refA === 440 ? 'Bisher: Kammerton a¹ = 440 Hz (nicht eingemessen)' : `Bisher eingemessen: a¹ ≈ ${settings.refA.toFixed(1)} Hz`;
}

function tuneFrame(frame, note) {
  if (document.body.dataset.view !== 'tune' || !tuneSession) return;
  // Live-Stimmgerät
  if (frame.freq && frame.clarity >= 0.85 && frame.rms > 0.01) {
    // Taste aus der laufenden Schätzung, Abweichung gegenüber Kammerton 440 Hz (wie im Ergebnis)
    const n = nearestNote(frame.freq, tuneSession.refA ?? settings.refA);
    const cents = Math.round((69 + 12 * Math.log2(frame.freq / 440) - midiNumber(n.note)) * 100);
    $('#tuner-note').textContent = helmholtzName(n.note);
    $('#tuner-cents').textContent = centsText(cents);
    $('#tuner-needle').style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  }
  if (!tuneSession.feed(frame, note !== null)) return;
  const count = tuneSession.samples.length;
  $('#tune-count').textContent = `${Math.min(count, MIN_SAMPLES)} von ${MIN_SAMPLES} Tönen gemessen${count > MIN_SAMPLES ? ` (+${count - MIN_SAMPLES} weitere)` : ''}`;
  tuneResult = tuneSession.result;
  if (tuneResult) showTuneResult(tuneResult);
}

function showTuneResult(r) {
  const dir = r.cents < 0 ? 'zu tief' : 'zu hoch';
  const lines = [];
  if (r.rating === 'gut') lines.push(`<b>Gut gestimmt</b> – Abweichung etwa ${centsText(r.cents)}.`);
  else if (r.rating === 'leicht') lines.push(`<b>Leicht verstimmt:</b> etwa ${Math.abs(r.cents)} Cent ${dir}. Für die App kein Problem – das wird herausgerechnet.`);
  else
    lines.push(
      `<b>Deutlich verstimmt:</b> etwa ${Math.abs(r.cents)} Cent ${dir} (a¹ ≈ ${r.refA.toFixed(0)} Hz). Die App rechnet das heraus. ` +
        'Zum Zusammenspielen mit anderen Instrumenten oder Aufnahmen wäre Stimmen lassen sinnvoll.',
    );
  if (r.spread >= 15) lines.push(`Die Töne weichen unterschiedlich stark ab (etwa ±${r.spread} Cent). Erkennt die App einzelne Töne falsch, liegt es daran – dann hilft nur Stimmen.`);
  const whiteOk = r.whiteShare >= 0.8;
  if (!whiteOk) lines.push('<b>Bitte nur weiße Tasten spielen</b> – einige Töne passten nicht dazu. Einfach weiterspielen.');
  lines.push(`<span class="tune-notes">${r.notes.map((n) => `${helmholtzName(n.note)} ${centsText(n.cents)}`).join(' · ')}</span>`);
  $('#tune-result').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  $('#tune-result').hidden = false;
  $('#tune-save').disabled = !whiteOk;
}

function closeTune() {
  mic.calibrating = false;
  tuneSession = null;
  document.body.dataset.view = viewBeforeOverview;
  if (viewBeforeOverview === 'play') {
    drawKeyboard();
    if (!locked) shownAt = performance.now();
    showFeedback(null);
  }
}

function saveTuning(refA) {
  settings.refA = refA;
  mic.refA = refA;
  saveSettings();
  closeTune();
  showToast(refA === 440 ? 'Zurückgesetzt auf a¹ = 440 Hz' : `Eingemessen: a¹ ≈ ${refA.toFixed(1)} Hz`);
}

// --- Takt-Abgleich ---
let sync = null; // läuft bzw. lief: { beatMs, measured, taps: { touch, mic }, timers, bus, done }
let syncResult = null;
const msText = (ms) => (ms === 0 ? '0 ms' : `${ms > 0 ? '+' : '−'}${Math.abs(ms)} ms`);

function showSync() {
  stopRhythm();
  clearTimeout(timer);
  if (!OVERLAYS.includes(document.body.dataset.view)) viewBeforeOverview = document.body.dataset.view;
  document.body.dataset.view = 'sync';
  resetSync();
}

function resetSync() {
  stopSync();
  sync = null;
  syncResult = null;
  const pad = $('#sync-pad');
  pad.textContent = 'Start';
  pad.classList.remove('running');
  $('#sync-count').innerHTML = mic.active ? 'Mikrofon ist an – du kannst auch am Klavier spielen.' : '&nbsp;';
  $('#sync-result').hidden = true;
  $('#sync-save').disabled = true;
  const o = settings.rhythmOffset;
  $('#sync-current').textContent = `Bisher: Tippen ${msText(o.touch)} · Mikrofon ${msText(o.mic)}`;
}

async function startSync() {
  stopSync();
  piano.unlock();
  if (piano.ctx && piano.ctx.state !== 'running') await piano.ctx.resume().catch(() => {});
  if (!piano.ctx || piano.ctx.state !== 'running') {
    showToast('Ohne Ton geht der Abgleich nicht – bitte nochmal antippen.');
    return;
  }
  const beatMs = 60000 / SYNC.tempo;
  const total = SYNC.countIn + SYNC.beats;
  const leadMs = 400;
  const perfNow = performance.now();
  // Klicks so planen wie bei „Im Takt spielen“ (gemeldete Lautsprecher-Verzögerung schon eingerechnet)
  const first = perfNow + leadMs + piano.latencyMs;
  const clicks = Array.from({ length: total }, (_, k) => first + k * beatMs);
  sync = { beatMs, measured: clicks.slice(SYNC.countIn), taps: { touch: [], mic: [] }, timers: [], bus: piano.ctx.createGain(), done: false };
  document.body.dataset.syncStart = String(sync.measured[0]); // für Tests: erster gemessener Klick
  sync.bus.connect(piano.out);
  const audioStart = piano.ctx.currentTime + leadMs / 1000;
  for (let k = 0; k < total; k++) piano.click(audioStart + (k * beatMs) / 1000, k % 4 === 0, sync.bus);
  const pad = $('#sync-pad');
  pad.classList.add('running');
  pad.textContent = 'Hör zu …';
  $('#sync-count').textContent = 'Einzählen …';
  $('#sync-result').hidden = true;
  $('#sync-save').disabled = true;
  clicks.forEach((at, k) => {
    sync.timers.push(
      setTimeout(() => {
        pad.textContent = k < SYNC.countIn ? `${k + 1}` : 'Tippen!';
        $('#sync-count').textContent = k < SYNC.countIn ? 'Einzählen …' : `Klick ${k - SYNC.countIn + 1} von ${SYNC.beats}`;
        pad.classList.remove('beat');
        void pad.offsetWidth; // Animation neu starten
        pad.classList.add('beat');
      }, at - perfNow),
    );
  });
  sync.timers.push(setTimeout(finishSync, clicks[total - 1] - perfNow + beatMs * 0.6));
}

function syncTap(at, source) {
  if (!sync || sync.done) return;
  sync.taps[source].push(at);
  const pad = $('#sync-pad');
  pad.classList.add('hit');
  setTimeout(() => pad.classList.remove('hit'), 90);
}

function finishSync() {
  if (!sync) return;
  sync.done = true;
  const pad = $('#sync-pad');
  pad.classList.remove('running');
  pad.textContent = 'Nochmal';
  const results = { touch: estimateOffset(sync.taps.touch, sync.measured, sync.beatMs), mic: estimateOffset(sync.taps.mic, sync.measured, sync.beatMs) };
  const label = { touch: 'Tippen', mic: 'Klavier über Mikrofon' };
  const lines = [];
  syncResult = {};
  for (const source of ['touch', 'mic']) {
    const r = results[source];
    if (!r) continue;
    const when = r.offset === 0 ? 'genau mit dem Klick' : `etwa ${Math.abs(r.offset)} ms ${r.offset > 0 ? 'nach' : 'vor'} dem Klick`;
    if (r.steady) {
      syncResult[source] = r.offset;
      lines.push(`<b>${label[source]}:</b> ${when} (gleichmäßig, ${r.count} Treffer). Wird bei „Im Takt spielen“ herausgerechnet.`);
    } else {
      lines.push(`<b>${label[source]}:</b> ${when}, aber ungleichmäßig (etwa ±${r.spread} ms). Bitte nochmal – möglichst genau mit jedem Klick.`);
    }
  }
  if (!lines.length) lines.push('Zu wenige Tipps erkannt. Bitte nochmal und bei jedem Klick tippen (mindestens 6-mal).');
  $('#sync-count').textContent = 'Fertig';
  $('#sync-result').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  $('#sync-result').hidden = false;
  $('#sync-save').disabled = Object.keys(syncResult).length === 0;
  document.body.dataset.syncDone = JSON.stringify(results); // für Tests
}

function stopSync() {
  if (!sync) return;
  sync.timers.forEach(clearTimeout);
  sync.bus?.disconnect();
  sync.done = true;
  delete document.body.dataset.syncStart;
}

function saveSync() {
  if (!syncResult) return;
  settings.rhythmOffset = { ...settings.rhythmOffset, ...syncResult };
  saveSettings();
  const o = settings.rhythmOffset;
  closeSync();
  showToast(`Takt-Abgleich gespeichert: Tippen ${msText(o.touch)} · Mikrofon ${msText(o.mic)}`);
}

function closeSync() {
  stopSync();
  sync = null;
  delete document.body.dataset.syncDone;
  document.body.dataset.view = viewBeforeOverview;
  if (viewBeforeOverview === 'play') {
    drawKeyboard();
    if (!locked) shownAt = performance.now();
    showFeedback(null);
  }
}

async function startMic() {
  ui.micBtn.disabled = true;
  try {
    await mic.start();
    lastSoundAt = performance.now();
    showToast(settings.refA === 440 ? 'Mikrofon an. Tipp: Klavier einmal „Einmessen“' : 'Mikrofon an – spiel die Noten am Klavier');
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

function answer(tapped, at = performance.now(), source = 'touch') {
  if (rhythm) return answerInRhythm(tapped, at, source);
  locked = true;
  // im Mikrofon-Modus kein eigener Ton – sonst hört sich die App selbst
  if (settings.sound && !mic.active) piano.play(frequency(tapped));
  const result = trainer.answer(tapped, performance.now() - shownAt);
  marks = { [tapped]: result.correct ? 'right' : 'wrong' };
  if (!result.correct) marks[keyOf(result.item.note)] = 'right'; // b-Noten liegen auf der Taste mit Kreuz-Namen
  drawKeyboard();
  showFeedback(result, tapped);
  const { answered, total } = trainer.progress;
  ui.progress.style.width = `${(answered / total) * 100}%`;
  if (result.unlocked.length) showToast(`Neu dazu: ${noteList(result.unlocked)}`);
  if (trainer.isSequence) {
    seqStates[trainer.position] = result.correct ? 'right' : 'wrong';
    drawSequence(trainer.position);
    const lastOfSequence = trainer.position === trainer.sequence.length - 1;
    // im Fluss lesen: nach richtiger Note gleich weiter, am Ende der Folge kurz das Ergebnis zeigen
    const delay = !result.correct ? DELAY_WRONG : lastOfSequence ? DELAY_RIGHT + 300 : SEQ_DELAY_RIGHT;
    timer = setTimeout(() => continueSequence(result.done), delay);
    return;
  }
  timer = setTimeout(result.done ? showSummary : nextNote, result.correct ? DELAY_RIGHT : DELAY_WRONG);
}

function showSummary() {
  const s = trainer.summary();
  const rhythmRun = lastRhythm; // bei „Im Takt“ gibt das Tempo die Zeit vor – Antwortzeit ohne Aussage
  ui.sumRhythmBox.hidden = !lastRhythm;
  if (lastRhythm) {
    const r = lastRhythm;
    ui.sumRhythmHint.hidden = !r.shift;
    ui.sumRhythmHint.textContent = r.shift
      ? `Fast alles war etwa ${Math.abs(r.shift)} ms ${r.shift > 0 ? 'zu spät' : 'zu früh'} – oft liegt das an der Verzögerung von Handy, Kopfhörer oder Mikrofon. Ein Takt-Abgleich rechnet sie heraus.`
      : '';
    ui.sumRhythm.textContent =
      `Im Takt: ${r.ok} von ${r.total} · ${r.early} zu früh · ${r.late} zu spät · ${r.missed} verpasst` +
      (r.total - r.missed ? ` · Abweichung im Schnitt ${r.avgAbsMs} ms` : '');
    lastRhythm = null;
  }
  ui.sumScore.textContent = `${s.correct}/${s.total}`;
  ui.sumRate.textContent = `richtig (${Math.round(s.rate * 100)} %)`;
  ui.sumTime.textContent = rhythmRun ? '–' : `${seconds(s.avgMs)} s`;
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
  // Zeitpunkt des Antippens (für „Im Takt“) – timeStamp ist auf derselben Uhr wie performance.now()
  answer(keyAtClientPoint(layout, ui.keyboard.getBoundingClientRect(), event.clientX, event.clientY), event.timeStamp || performance.now());
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

$('#level').addEventListener('change', (event) => {
  const level = parseLevel(event.target.value);
  if (settings.level === level) return;
  settings.level = level;
  saveSettings();
  syncControls();
  if (level === 'lieder') showSongs();
  else startRound();
});

ui.songList.addEventListener('click', (event) => {
  const del = event.target.closest('[data-delete]');
  if (del) {
    const song = userSongs.find((x) => x.id === del.dataset.delete);
    if (song && window.confirm(`„${song.title}“ aus dem Liederbuch entfernen?`)) {
      userSongs = userSongs.filter((x) => x !== song);
      saveUserSongs();
      if (settings.song === song.id) settings.song = null;
      saveSettings();
      showSongs();
    }
    return;
  }
  const card = event.target.closest('[data-song]');
  if (!card) return;
  settings.song = card.dataset.song;
  saveSettings();
  startRound();
});
$('#song-list-btn').addEventListener('click', showSongs);
$('#import-run').addEventListener('click', () => runImport($('#import-text').value));
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  $('#import-text').value = text;
  runImport(text);
  event.target.value = '';
});
$('#import-result').addEventListener('click', (event) => {
  const play = event.target.closest('[data-song]');
  if (!play) return;
  settings.song = play.dataset.song;
  saveSettings();
  startRound();
});
$('#song-listen').addEventListener('click', playSong);
ui.rhythmBtn.addEventListener('click', () => {
  if (rhythm) {
    stopRhythm();
    startSong(currentSong);
  } else startRhythm();
});
ui.rhythmTempo.value = String(settings.rhythmTempo);
ui.rhythmTempo.addEventListener('change', () => {
  settings.rhythmTempo = Number(ui.rhythmTempo.value);
  saveSettings();
  if (rhythm) startRhythm();
});
ui.otherSong.addEventListener('click', showSongs);

ui.sound.addEventListener('click', () => {
  settings.sound = !settings.sound;
  saveSettings();
  syncControls();
});

ui.again.addEventListener('click', startRound);
ui.micBtn.addEventListener('click', () => (mic.active ? stopMic() : startMic()));
ui.overviewBtn.addEventListener('click', () => (document.body.dataset.view === 'overview' ? closeOverview() : showOverview()));
ui.overviewBack.addEventListener('click', closeOverview);
$('#backup-save').addEventListener('click', saveBackup);
$('#backup-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) loadBackup(file);
});
$('#backup-undo').addEventListener('click', undoBackup);
// Einmessen: Knopf im Mikrofon-Hinweis (wird neu gezeichnet, daher über die Rückmeldung abgefangen)
ui.feedback.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="tune"]')) showTune();
});
$('#tune-save').addEventListener('click', () => tuneResult && saveTuning(tuneResult.refA));
$('#tune-reset').addEventListener('click', () => saveTuning(440));
$('#tune-cancel').addEventListener('click', closeTune);
// Takt-Abgleich: Knöpfe in der Auswertung und in der Liederliste
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="sync"]')) showSync();
});
// Tipps zählen schon beim Berühren (pointerdown, zeitgenau); gestartet wird per click, weil Handys
// den Ton erst nach dem Loslassen freigeben
$('#sync-pad').addEventListener('pointerdown', (event) => {
  if (sync && !sync.done) {
    event.preventDefault();
    syncTap(event.timeStamp || performance.now(), 'touch');
  }
});
$('#sync-pad').addEventListener('click', () => {
  if (!sync || sync.done) startSync();
});
$('#sync-save').addEventListener('click', saveSync);
$('#sync-reset').addEventListener('click', () => {
  settings.rhythmOffset = { touch: 0, mic: 0 };
  saveSettings();
  closeSync();
  showToast('Takt-Abgleich zurückgesetzt');
});
$('#sync-cancel').addEventListener('click', closeSync);

// Ton erst nach einer Nutzeraktion freischalten (Vorgabe der Handy-Browser)
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  document.addEventListener(type, () => settings.sound && !mic.active && piano.unlock(), { capture: true, passive: true });
}

// Zeit, in der die App im Hintergrund war, zählt nicht als Antwortzeit
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!locked) shownAt = performance.now();
  if (mic.active) {
    mic.resume(); // Mikrofon läuft nach dem Hintergrund weiter (oder meldet sich über onEnded ab)
    lastSoundAt = performance.now();
  }
});

new ResizeObserver(() => drawKeyboard()).observe(ui.keyboard);

syncControls();
startRound();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
