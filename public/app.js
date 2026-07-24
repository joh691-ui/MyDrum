// app.js — MyDrum sequencer + UI controller
import { AudioEngine, SOUNDS } from "./audio.js";

const NUM_STEPS = 16;
const NUM_PATTERNS = 16;
const engine = new AudioEngine();

// --- state ----------------------------------------------------------------

function emptyPattern(sound = 0) {
  return {
    sound,
    steps: Array.from({ length: NUM_STEPS }, () => ({ on: false, note: 36 })),
  };
}

const state = {
  bpm: 120,
  playing: false,
  currentPattern: 0,
  currentStep: -1,
  writeNote: 36, // C2, the note written to a step when toggled on
  mode: "play", // play | write | sound | pattern
  fxHeld: 0,
  patterns: Array.from({ length: NUM_PATTERNS }, () => emptyPattern()),
  volume: 0.9,
};

// --- scheduler ------------------------------------------------------------

const LOOKAHEAD = 0.1; // seconds
const TICK = 25; // ms
let nextStepTime = 0;
let schedStep = 0;
let timer = null;

function secondsPerStep() {
  return 60.0 / state.bpm / 4; // 16th notes
}

function scheduleStep(stepIndex, time) {
  const pat = state.patterns[state.currentPattern];
  const st = pat.steps[stepIndex];
  if (st.on) {
    engine.play(pat.sound, st.note, time, secondsPerStep());
  }
  // schedule the UI highlight
  const delay = (time - engine.now()) * 1000;
  setTimeout(() => {
    state.currentStep = stepIndex;
    paintPlayhead();
    pulseLcd();
  }, Math.max(0, delay));
}

function scheduler() {
  while (nextStepTime < engine.now() + LOOKAHEAD) {
    scheduleStep(schedStep, nextStepTime);
    nextStepTime += secondsPerStep();
    schedStep = (schedStep + 1) % NUM_STEPS;
  }
}

async function play() {
  await engine.init();
  if (state.playing) return;
  state.playing = true;
  schedStep = 0;
  nextStepTime = engine.now() + 0.05;
  timer = setInterval(scheduler, TICK);
  document.getElementById("btn-play").classList.add("active");
  document.body.classList.add("playing");
}

function stop() {
  state.playing = false;
  clearInterval(timer);
  timer = null;
  state.currentStep = -1;
  paintPlayhead();
  document.getElementById("btn-play").classList.remove("active");
  document.body.classList.remove("playing");
}

// --- UI build -------------------------------------------------------------

const stepEls = [];

function buildSteps() {
  const grid = document.getElementById("steps");
  for (let i = 0; i < NUM_STEPS; i++) {
    const b = document.createElement("button");
    b.className = "step";
    b.dataset.i = i;
    b.innerHTML = `<span class="num">${i + 1}</span><span class="dot"></span>`;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onStep(i);
    });
    grid.appendChild(b);
    stepEls.push(b);
  }
}

function onStep(i) {
  engine.init();
  if (state.mode === "sound") {
    state.patterns[state.currentPattern].sound = i;
    // audition
    engine.play(i, state.writeNote, engine.now() + 0.01, secondsPerStep());
    setMode("play");
  } else if (state.mode === "pattern") {
    state.currentPattern = i;
    setMode("play");
  } else if (state.mode === "write") {
    const st = state.patterns[state.currentPattern].steps[i];
    st.on = !st.on;
    if (st.on) {
      st.note = state.writeNote;
      engine.play(state.patterns[state.currentPattern].sound, st.note, engine.now() + 0.01, secondsPerStep());
    }
  } else {
    // play mode: live-trigger this step's note (or the write note if empty)
    const st = state.patterns[state.currentPattern].steps[i];
    const note = st.on ? st.note : state.writeNote;
    engine.play(state.patterns[state.currentPattern].sound, note, engine.now() + 0.01, secondsPerStep());
  }
  render();
}

function setMode(mode) {
  state.mode = mode;
  ["write", "sound", "pattern"].forEach((m) => {
    const el = document.getElementById("btn-" + m);
    if (el) el.classList.toggle("active", state.mode === m);
  });
  document.body.dataset.mode = mode;
  render();
}

// --- rendering ------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

function paintPlayhead() {
  for (let i = 0; i < NUM_STEPS; i++) {
    stepEls[i].classList.toggle("playhead", i === state.currentStep);
  }
}

function render() {
  const pat = state.patterns[state.currentPattern];
  for (let i = 0; i < NUM_STEPS; i++) {
    const st = pat.steps[i];
    stepEls[i].classList.toggle("on", st.on);
    const dot = stepEls[i].querySelector(".dot");
    dot.textContent = st.on ? noteName(st.note) : "";
  }
  paintPlayhead();
  // LCD text
  document.getElementById("lcd-bpm").textContent = state.bpm;
  document.getElementById("lcd-pat").textContent = String(state.currentPattern + 1).padStart(2, "0");
  document.getElementById("lcd-sound").textContent = SOUNDS[pat.sound].name;
  document.getElementById("lcd-note").textContent = noteName(state.writeNote);
  document.getElementById("lcd-mode").textContent = state.mode.toUpperCase();
}

// LCD animated character (a little dancing pixel guy)
let lcdFrame = 0;
const FRAMES = ["( •_•)", "( •‿•)", "(•_• )", "\\(^o^)/"];
function pulseLcd() {
  lcdFrame = (lcdFrame + 1) % FRAMES.length;
  document.getElementById("lcd-face").textContent = FRAMES[lcdFrame];
}

// --- note keyboard --------------------------------------------------------

function buildKeys() {
  const kb = document.getElementById("keys");
  const base = 24; // C1
  for (let n = base; n < base + 24; n++) {
    const isSharp = [1, 3, 6, 8, 10].includes(n % 12);
    const k = document.createElement("button");
    k.className = "key" + (isSharp ? " sharp" : "");
    k.dataset.note = n;
    if (n % 12 === 0) k.textContent = noteName(n);
    k.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      engine.init();
      state.writeNote = n;
      engine.play(state.patterns[state.currentPattern].sound, n, engine.now() + 0.01, secondsPerStep());
      render();
    });
    kb.appendChild(k);
  }
}

// --- transport & function buttons ----------------------------------------

function bindControls() {
  document.getElementById("btn-play").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.playing ? stop() : play();
  });
  document.getElementById("btn-write").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setMode(state.mode === "write" ? "play" : "write");
  });
  document.getElementById("btn-sound").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setMode(state.mode === "sound" ? "play" : "sound");
  });
  document.getElementById("btn-pattern").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setMode(state.mode === "pattern" ? "play" : "pattern");
  });

  document.getElementById("btn-bpm-down").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.bpm = Math.max(40, state.bpm - 1);
    render();
  });
  document.getElementById("btn-bpm-up").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.bpm = Math.min(240, state.bpm + 1);
    render();
  });

  document.getElementById("btn-clear").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.patterns[state.currentPattern] = emptyPattern(state.patterns[state.currentPattern].sound);
    render();
  });

  const vol = document.getElementById("vol");
  vol.addEventListener("input", () => {
    state.volume = vol.value / 100;
    engine.setMasterVolume(state.volume);
  });

  // FX buttons (hold)
  document.querySelectorAll(".fx").forEach((el) => {
    const id = Number(el.dataset.fx);
    const on = (e) => { e.preventDefault(); engine.init(); engine.setFx(id); el.classList.add("active"); };
    const off = (e) => { e.preventDefault(); engine.setFx(0); el.classList.remove("active"); };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointerleave", off);
    el.addEventListener("pointercancel", off);
  });

  // save / load
  document.getElementById("btn-save").addEventListener("pointerdown", (e) => { e.preventDefault(); saveBank(); });
  document.getElementById("btn-load").addEventListener("pointerdown", (e) => { e.preventDefault(); openLoad(); });
}

// --- persistence (backend API + localStorage fallback) --------------------

function serialize() {
  return { bpm: state.bpm, patterns: state.patterns };
}

function deserialize(data) {
  if (!data) return;
  state.bpm = data.bpm || 120;
  if (Array.isArray(data.patterns)) {
    for (let i = 0; i < NUM_PATTERNS; i++) {
      state.patterns[i] = data.patterns[i] || emptyPattern();
    }
  }
  render();
}

async function saveBank() {
  const name = prompt("Namn på ditt set:", "my set " + new Date().toLocaleDateString());
  if (name === null) return;
  const body = JSON.stringify({ name, data: serialize() });
  try {
    const r = await fetch("/api/patterns", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) throw new Error("http " + r.status);
    flash("sparat till servern");
  } catch (err) {
    localStorage.setItem("mydrum:" + Date.now(), body);
    flash("sparat lokalt (offline)");
  }
}

async function openLoad() {
  let banks = [];
  try {
    const r = await fetch("/api/patterns");
    banks = await r.json();
  } catch (err) {
    banks = Object.keys(localStorage)
      .filter((k) => k.startsWith("mydrum:"))
      .map((k) => ({ id: k, name: JSON.parse(localStorage.getItem(k)).name, local: true }));
  }
  if (!banks.length) return flash("inga sparade set");
  const list = banks.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
  const pick = prompt("Ladda vilket set?\n" + list + "\n\nSkriv nummer:");
  const idx = Number(pick) - 1;
  if (isNaN(idx) || !banks[idx]) return;
  const b = banks[idx];
  try {
    if (b.local) {
      deserialize(JSON.parse(localStorage.getItem(b.id)).data);
    } else {
      const r = await fetch("/api/patterns/" + b.id);
      const full = await r.json();
      deserialize(full.data);
    }
    flash("laddat: " + b.name);
  } catch (err) {
    flash("kunde inte ladda");
  }
}

function flash(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}

// --- boot -----------------------------------------------------------------

function seedDemo() {
  // a simple bass line so there is something to hear immediately
  const p = state.patterns[0];
  p.sound = 3; // saw growl
  const line = [
    [0, 36], [3, 36], [6, 43], [8, 36], [10, 39], [14, 43],
  ];
  line.forEach(([i, n]) => { p.steps[i] = { on: true, note: n }; });
}

function boot() {
  buildSteps();
  buildKeys();
  bindControls();
  seedDemo();
  setMode("play");
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", boot);
