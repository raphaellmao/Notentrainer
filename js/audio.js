// Klang: einfacher, klavierähnlicher Ton mit der Web Audio API (ohne Sounddateien).
//
// Handys erlauben Ton erst nach einer Nutzeraktion. Beim Antippen (pointerdown) gilt
// das auf Touch-Geräten noch nicht als Aktion, erst beim Loslassen. Deshalb merkt sich
// play() den Ton, falls der Audio-Kontext noch nicht läuft, und unlock() spielt ihn
// beim Loslassen nach. Ab dann klingt jeder Ton sofort beim Antippen.
//
// iPhone: Steht der Lautlos-Schalter auf lautlos, spielt Safari Web-Audio-Töne
// normalerweise nicht ab. Deshalb meldet sich die App als Wiedergabe (wie ein
// Musik-Player): ab iOS 17 über navigator.audioSession, bei älteren iOS-Versionen
// über ein stummes, endlos laufendes <audio>-Element.

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Stumme WAV-Datei (0,1 s), im Speicher erzeugt
function silentWavUrl() {
  const rate = 8000;
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const text = (offset, s) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class Piano {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.pending = null;
    this.keepAlive = null;
  }

  // Ton auch bei Lautlos-Schalter: Wiedergabe-Modus anfordern (muss in einer Nutzeraktion passieren)
  requestPlayback() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback';
        return;
      }
      if (!navigator.audioSession && isIOS()) {
        if (!this.keepAlive) {
          this.keepAlive = new Audio(silentWavUrl());
          this.keepAlive.loop = true;
          this.keepAlive.setAttribute('playsinline', '');
        }
        if (this.keepAlive.paused) this.keepAlive.play().catch(() => {});
      }
    } catch {
      // ohne diese Funktionen bleibt es beim normalen Verhalten
    }
  }

  // Aus einem Nutzerereignis (pointerup, touchend, click, keydown) aufrufen
  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.requestPlayback();
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 10;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(limiter).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'running') {
      this.flush();
      return;
    }
    // stummer Puffer: schaltet ältere iOS-Versionen frei
    const silent = this.ctx.createBufferSource();
    silent.buffer = this.ctx.createBuffer(1, 1, 22050);
    silent.connect(this.ctx.destination);
    silent.start(0);
    this.ctx.resume().then(() => this.flush(), () => {});
  }

  play(freq) {
    if (this.ctx && this.ctx.state === 'running') this.voice(freq);
    else this.pending = { freq, at: performance.now() };
  }

  flush() {
    if (this.pending && performance.now() - this.pending.at < 700) this.voice(this.pending.freq);
    this.pending = null;
  }

  // Ein Anschlag: Grundton + Obertöne, die unterschiedlich schnell verklingen
  // Metronom-Klick zur Zeit at (AudioContext-Zeit in Sekunden); betont auf der Eins
  // bus: eigener Lautstärkeregler, damit sich vorausgeplante Klicks beim Stoppen abschalten lassen
  click(at, accent = false, bus = this.out) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 2000 : 1400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + 0.06);
  }

  // Verzögerung bis zum Lautsprecher (ms) – damit Klick und erwarteter Zeitpunkt zusammenpassen
  get latencyMs() {
    return ((this.ctx?.outputLatency || this.ctx?.baseLatency || 0) * 1000);
  }

  // delay: Sekunden ab jetzt (zum Vorspielen ganzer Melodien)
  voice(freq, delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005 + delay;
    const dur = Math.min(3.2, 1.3 + 160 / freq); // tiefe Töne klingen länger
    const count = freq < 160 ? 10 : 7; // tiefe Töne brauchen Obertöne, sonst hört man sie am Handy kaum

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.4, t + 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(Math.min(12000, freq * 10), t);
    tone.frequency.exponentialRampToValueAtTime(Math.max(500, freq * 2.5), t + dur * 0.7);
    tone.connect(env).connect(this.out);

    let sum = 0;
    for (let n = 1; n <= count; n++) sum += 1 / n ** 1.15;
    for (let n = 1; n <= count; n++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * n * Math.sqrt(1 + 0.0004 * n * n); // leicht gespreizt wie bei Saiten
      const gain = ctx.createGain();
      const level = 1 / n ** 1.15 / sum;
      gain.gain.setValueAtTime(level, t);
      // Obertöne verklingen schneller als der Grundton (der folgt nur der Hüllkurve)
      if (n > 1) gain.gain.exponentialRampToValueAtTime(level * 0.001, t + dur / Math.sqrt(n));
      osc.connect(gain).connect(tone);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }
}
