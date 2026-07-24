// audio.js — Web Audio synth engine for PLONK (PO-14 "sub" inspired)
// Monophonic-per-voice bass synthesiser with 16 sound presets + master FX.

// ---------------------------------------------------------------------------
// Sound presets. Each returns a small synth graph when triggered.
// Faithful-in-spirit to the PO-14 "sub" family: deep sines, growly saws,
// FM basses, plucks, and a few percussive/atonal ones.
// ---------------------------------------------------------------------------

// `drive` now feeds a per-voice waveshaper (the PO-14 punch/grit).
// `click` adds a short filtered-noise transient at the attack.
export const SOUNDS = [
  { name: "sub sine",   type: "sine",     glide: 0,    decay: 0.9,  cutoff: 420,  q: 2,  drive: 0.25, sub: 1.0, level: 0.85 },
  { name: "round",      type: "sine",     glide: 0.04, decay: 0.7,  cutoff: 620,  q: 4,  drive: 0.30, sub: 0.7 },
  { name: "triangle",   type: "triangle", glide: 0,    decay: 0.6,  cutoff: 950,  q: 3,  drive: 0.30, sub: 0.5 },
  { name: "saw growl",  type: "sawtooth", glide: 0.02, decay: 0.8,  cutoff: 520,  q: 9,  drive: 0.65, sub: 0.6 },
  { name: "acid",       type: "sawtooth", glide: 0.05, decay: 0.5,  cutoff: 330,  q: 16, drive: 0.75, sub: 0.3, env: 2600 },
  { name: "square bass",type: "square",   glide: 0,    decay: 0.7,  cutoff: 720,  q: 5,  drive: 0.45, sub: 0.5 },
  { name: "reese",      type: "sawtooth", glide: 0.03, decay: 1.0,  cutoff: 470,  q: 7,  drive: 0.55, sub: 0.5, detune: 17 },
  { name: "fm bass",    type: "fm",       glide: 0.01, decay: 0.55, cutoff: 1300, q: 3,  drive: 0.40, sub: 0.4, fm: 1.5, fmAmt: 420 },
  { name: "pluck",      type: "triangle", glide: 0,    decay: 0.26, cutoff: 1700, q: 7,  drive: 0.35, sub: 0.3, env: 2000, click: 0.35 },
  { name: "wobble",     type: "sawtooth", glide: 0.02, decay: 0.9,  cutoff: 520,  q: 11, drive: 0.60, sub: 0.5, lfo: 6, lfoAmt: 420 },
  { name: "hollow",     type: "square",   glide: 0,    decay: 0.6,  cutoff: 1050, q: 2,  drive: 0.35, sub: 0.4, pwm: true },
  { name: "deep drop",  type: "sine",     glide: 0.12, decay: 1.2,  cutoff: 300,  q: 1,  drive: 0.20, sub: 1.0, drop: 14, level: 0.85 },
  { name: "buzz",       type: "sawtooth", glide: 0,    decay: 0.4,  cutoff: 2400, q: 4,  drive: 0.85, sub: 0.2 },
  { name: "sine tick",  type: "sine",     glide: 0,    decay: 0.11, cutoff: 3200, q: 1,  drive: 0.20, sub: 0.15, env: 0, click: 0.5, clickHp: 4000 },
  { name: "noise hit",  type: "noise",    glide: 0,    decay: 0.17, cutoff: 3600, q: 1,  drive: 0.35, sub: 0,   click: 0.5, clickHp: 1800 },
  { name: "sub kick",   type: "sine",     glide: 0,    decay: 0.32, cutoff: 200,  q: 1,  drive: 0.38, sub: 0.7, drop: 40, click: 0.4, clickHp: 1400, level: 0.6 },
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.fx = null;         // fx input node
    this.delay = null;
    this.delayGain = null;
    this.filter = null;     // global performance filter
    this.ready = false;
    this._activeFx = 0;     // performance fx id, 0 = none
    this._noiseBuffer = null;
    this._curves = new Map(); // cached waveshaper curves by drive amount
  }

  // Soft-clip curve (tanh). Cached per drive amount. Higher drive = more grit.
  _curve(drive) {
    const key = Math.round(drive * 20);
    if (this._curves.has(key)) return this._curves.get(key);
    const k = 1 + drive * 9;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k); // normalise to +/-1
    }
    this._curves.set(key, curve);
    return curve;
  }

  // Must be called from a user gesture on iOS.
  async init() {
    if (this.ready) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });

    // master chain: fx -> filter -> drive -> compressor -> master gain -> out
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 3.5;   // gentler so a loud kick doesn't duck the rest
    comp.attack.value = 0.005;
    comp.release.value = 0.22;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.7;

    this.fx = this.ctx.createGain();

    // send/return delay for the "echo" fx
    this.delay = this.ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.28;
    this.delayGain = this.ctx.createGain();
    this.delayGain.gain.value = 0;
    const delayFb = this.ctx.createGain();
    delayFb.gain.value = 0.35;

    // gentle master saturation for hardware-like warmth/glue
    const sat = this.ctx.createWaveShaper();
    sat.curve = this._curve(0.22);
    sat.oversample = "2x";

    this.fx.connect(this.filter);
    this.filter.connect(sat);
    sat.connect(comp);
    comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    // delay tap
    this.fx.connect(this.delay);
    this.delay.connect(delayFb);
    delayFb.connect(this.delay);
    this.delay.connect(this.delayGain);
    this.delayGain.connect(this.filter);

    // pre-render noise buffer for noisy presets
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;

    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.ready = true;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMasterVolume(v) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  // Trigger a note. midi = MIDI note number, time = ctx time to start.
  play(soundIndex, midi, time, stepDur, velocity = 1) {
    if (!this.ready) return;
    const s = SOUNDS[soundIndex] || SOUNDS[0];
    const t = time;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const dur = Math.min(s.decay, Math.max(0.08, stepDur * 3));

    const amp = this.ctx.createGain();
    amp.gain.value = 0;
    amp.connect(this.fx);

    // per-voice lowpass with envelope
    const vf = this.ctx.createBiquadFilter();
    vf.type = "lowpass";
    vf.Q.value = s.q || 1;
    vf.frequency.setValueAtTime(s.cutoff, t);
    if (s.env) {
      vf.frequency.setValueAtTime(s.cutoff + s.env, t);
      vf.frequency.exponentialRampToValueAtTime(Math.max(60, s.cutoff), t + dur * 0.6);
    }
    // per-voice waveshaper = the PO-14 drive/grit
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._curve(s.drive || 0.1);
    shaper.oversample = "2x";
    vf.connect(shaper);
    shaper.connect(amp);

    // attack transient (click) for punchy/percussive presets
    if (s.click) {
      const click = this.ctx.createBufferSource();
      click.buffer = this._noiseBuffer;
      const chp = this.ctx.createBiquadFilter();
      chp.type = "highpass";
      chp.frequency.value = s.clickHp || 2000;
      const cg = this.ctx.createGain();
      cg.gain.setValueAtTime(s.click * velocity, t);
      cg.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
      click.connect(chp);
      chp.connect(cg);
      cg.connect(this.fx);
      click.start(t);
      click.stop(t + 0.05);
    }

    const oscs = [];

    if (s.type === "noise") {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.connect(vf);
      src.start(t);
      src.stop(t + dur + 0.05);
      oscs.push(src);
    } else if (s.type === "fm") {
      const carrier = this.ctx.createOscillator();
      carrier.type = "sine";
      const mod = this.ctx.createOscillator();
      mod.type = "sine";
      const modGain = this.ctx.createGain();
      mod.frequency.setValueAtTime(freq * (s.fm || 2), t);
      modGain.gain.setValueAtTime(s.fmAmt || 200, t);
      modGain.gain.exponentialRampToValueAtTime(1, t + dur);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      this._setPitch(carrier, freq, s, t);
      carrier.connect(vf);
      carrier.start(t); mod.start(t);
      carrier.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
      oscs.push(carrier, mod);
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = s.type;
      if (s.detune) osc.detune.value = -(s.detune / 2);
      this._setPitch(osc, freq, s, t);
      osc.connect(vf);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      oscs.push(osc);

      if (s.detune) {
        const osc2 = this.ctx.createOscillator();
        osc2.type = s.type;
        osc2.detune.value = s.detune / 2;
        this._setPitch(osc2, freq, s, t);
        osc2.connect(vf);
        osc2.start(t);
        osc2.stop(t + dur + 0.05);
        oscs.push(osc2);
      }

      // LFO on filter for the wobble preset
      if (s.lfo) {
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = s.lfo;
        const lg = this.ctx.createGain();
        lg.gain.value = s.lfoAmt || 300;
        lfo.connect(lg);
        lg.connect(vf.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
        oscs.push(lfo);
      }
    }

    // sub oscillator one octave down
    if (s.sub > 0 && s.type !== "noise") {
      const sub = this.ctx.createOscillator();
      sub.type = "sine";
      this._setPitch(sub, freq / 2, s, t);
      const sg = this.ctx.createGain();
      sg.gain.value = s.sub * 0.9;
      sub.connect(sg);
      sg.connect(vf);
      sub.start(t);
      sub.stop(t + dur + 0.05);
      oscs.push(sub);
    }

    // amp envelope (fast attack, exponential decay)
    // per-preset `level` balances loud sub-heavy sounds against the rest
    const peak = 0.9 * velocity * (s.level != null ? s.level : 1);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    amp.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  }

  _setPitch(osc, freq, s, t) {
    if (s.glide) {
      osc.frequency.setValueAtTime(freq * 0.5, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + s.glide);
    } else if (s.drop) {
      osc.frequency.setValueAtTime(freq * Math.pow(2, s.drop / 12), t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + Math.min(0.25, s.decay));
    } else {
      osc.frequency.setValueAtTime(freq, t);
    }
  }

  // Performance FX (hold a button). id 0 = clear.
  setFx(id) {
    if (!this.ready) return;
    this._activeFx = id;
    const t = this.now();
    // reset
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.type = "lowpass";
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
    this.filter.frequency.linearRampToValueAtTime(20000, t + 0.05);
    this.filter.Q.value = 0.7;
    this.delayGain.gain.setValueAtTime(this.delayGain.gain.value, t);
    this.delayGain.gain.linearRampToValueAtTime(0, t + 0.1);

    switch (id) {
      case 1: // low-pass sweep down
        this.filter.frequency.cancelScheduledValues(t);
        this.filter.frequency.setValueAtTime(20000, t);
        this.filter.frequency.exponentialRampToValueAtTime(180, t + 0.4);
        this.filter.Q.value = 6;
        break;
      case 2: // high-pass
        this.filter.type = "highpass";
        this.filter.frequency.cancelScheduledValues(t);
        this.filter.frequency.setValueAtTime(60, t);
        this.filter.frequency.exponentialRampToValueAtTime(1400, t + 0.4);
        this.filter.Q.value = 4;
        break;
      case 3: // echo / delay throw
        this.delayGain.gain.cancelScheduledValues(t);
        this.delayGain.gain.setValueAtTime(0.5, t);
        break;
      case 4: // band-pass wah
        this.filter.type = "bandpass";
        this.filter.frequency.cancelScheduledValues(t);
        this.filter.frequency.setValueAtTime(300, t);
        this.filter.Q.value = 8;
        break;
      default:
        break;
    }
  }
}
