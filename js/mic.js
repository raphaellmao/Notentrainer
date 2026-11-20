// Mikrofon: hört dem echten Klavier zu und meldet jede neu angeschlagene Note.
// Die Rechnung (Tonhöhe, Anschlag) steckt in pitch.js; hier nur Aufnahme und Takt.

import { analyseFrame, NoteListener } from './pitch.js';

const FRAME = 4096;
const EVERY_MS = 30; // etwa 30 Auswertungen pro Sekunde

export class Microphone {
  // onNote(midi): neue Note erkannt; onLevel(rms): aktuelle Lautstärke; onEnded(): Mikrofon weg
  constructor({ onNote, onLevel, onEnded }) {
    this.onNote = onNote;
    this.onLevel = onLevel;
    this.onEnded = onEnded;
    this.stream = null;
    this.ctx = null;
    this.raf = 0;
    this.last = 0;
  }

  get active() {
    return this.stream !== null;
  }

  // Muss aus einem Tipp heraus aufgerufen werden. Wirft bei fehlender Erlaubnis.
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nicht-unterstuetzt');
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; // iPhone: Aufnahme erlauben
    } catch {
      // ältere Browser kennen das nicht
    }
    // Ohne Rauschunterdrückung & Co.: die würden Klaviertöne als „Störgeräusch“ wegfiltern
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    await this.ctx.resume().catch(() => {});
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FRAME;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.buf = new Float32Array(FRAME);
    this.listener = new NoteListener();
    for (const track of this.stream.getAudioTracks()) track.addEventListener('ended', () => this.onEnded?.());
    this.tick();
  }

  tick = () => {
    if (!this.stream) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (now - this.last < EVERY_MS) return;
    this.last = now;
    this.analyser.getFloatTimeDomainData(this.buf);
    const { rms, midi } = analyseFrame(this.buf, this.ctx.sampleRate);
    this.onLevel?.(rms);
    const note = this.listener.feed(rms, midi, now);
    if (note !== null) this.onNote(note);
  };

  stop() {
    cancelAnimationFrame(this.raf);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // egal
    }
  }
}
