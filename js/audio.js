// Klang: einfacher, klavierähnlicher Ton mit der Web Audio API (ohne Sounddateien).
//
// Handys erlauben Ton erst nach einer Nutzeraktion. Beim Antippen (pointerdown) gilt
// das auf Touch-Geräten noch nicht als Aktion, erst beim Loslassen. Deshalb merkt sich
// play() den Ton, falls der Audio-Kontext noch nicht läuft, und unlock() spielt ihn
// beim Loslassen nach. Ab dann klingt jeder Ton sofort beim Antippen.

export class Piano {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.pending = null;
  }

  // Aus einem Nutzerereignis (pointerup, touchend, click, keydown) aufrufen
  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
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
  voice(freq) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
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
