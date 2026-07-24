// audio.js — Web Audio synth engine for MyDrum (PO-14 "sub" inspired)
// Monophonic-per-voice bass synthesiser with 16 sound presets + master FX.

// ---------------------------------------------------------------------------
// Sound presets. Each returns a small synth graph when triggered.
// Faithful-in-spirit to the PO-14 "sub" family: deep sines, growly saws,
// FM basses, plucks, and a few percussive/atonal ones.
// ---------------------------------------------------------------------------

export const SOUNDS = [
  { name: "sub sine",   type: "sine",     glide: 0,    decay: 0.9,  cutoff: 400,  q: 2,  drive: 0.1, sub: 1.0 },
  { name: "round",      type: "sine",     glide: 0.04, decay: 0.7,  cutoff: 600,  q: 4,  drive: 0.2, sub: 0.7 },
  { name: "triangle",   type: "triangle", glide: 0,    decay: 0.6,  cutoff: 900,  q: 3,  drive: 0.2, sub: 0.5 },
  { name: "saw growl",  type: "sawtooth", glide: 0.02, decay: 0.8,  cutoff: 500,  q: 8,  drive: 0.5, sub: 0.6 },
  { name: "acid",       type: "sawtooth", glide: 0.05, decay: 0.5,  cutoff: 350,  q: 14, drive: 0.6, sub: 0.3, env: 2200 },
  { name: "square bass",type: "square",   glide: 0,    decay: 0.7,  cutoff: 700,  q: 4,  drive: 0.3, sub: 0.5 },
  { name: "reese",      type: "sawtooth", glide: 0.03, decay: 1.0,  cutoff: 450,  q: 6,  drive: 0.4, sub: 0.5, detune: 14 },
  { name: "fm bass",    type: "fm",       glide: 0.01, decay: 0.6,  cutoff: 1200, q: 2,  drive: 0.3, sub: 0.4, fm: 2, fmAmt: 300 },
  { name: "pluck",      type: "triangle", glide: 0,    decay: 0.28, cutoff: 1600, q: 6,  drive: 0.2, sub: 0.3, env: 1800 },
  { name: "wobble",     type: "sawtooth", glide: 0.02, decay: 0.9,  cutoff: 500,  q: 10, drive: 0.5, sub: 0.5, lfo: 6, lfoAmt: 400 },
  { name: "hollow",     type: "square",   glide: 0,    decay: 0.6,  cutoff: 1000, q: 2,  drive: 0.2, sub: 0.4, pwm: true },
  { name: "deep drop",  type: "sine",     glide: 0.12, decay: 1.2,  cutoff: 300,  q: 1,  drive: 0.1, sub: 1.0, drop: 12 },
  { name: "buzz",       type: "sawtooth", glide: 0,    decay: 0.4,  cutoff: 2200, q: 4,  drive: 0.7, sub: 0.2 },
  { name: "sine tick",  type: "sine",     glide: 0,    decay: 0.12, cutoff: 3000, q: 1,  drive: 0.1, sub: 0.2, env: 0 },
  { name: "noise hit",  type: "noise",    glide: 0,    decay: 0.18, cutoff: 4000, q: 1,  drive: 0.2, sub: 0 },
  { name: "sub kick",   type: "sine",     glide: 0,    decay: 0.35, cutoff: 200,  q: 1,  drive: 0.3, sub: 1.0, drop: 36 },
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
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;

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

    this.fx.connect(this.filter);
    this.filter.connect(comp);
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
    vf.connect(amp);

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
    const peak = 0.9 * velocity;
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
