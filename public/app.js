// app.js — PLONK sequencer + UI controller
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
  writeSound: 0, // the sound written to a step when toggled on
  mode: "play", // play | write | sound | pattern
  prevMode: "play", // mode to return to after sound/pattern pick
  fxHeld: 0,
  patterns: Array.from({ length: NUM_PATTERNS }, () => emptyPattern()),
  volume: 0.9,
};

// The sound a step actually plays: its own override, else the pattern default.
function stepSound(pat, st) {
  return st.sound != null ? st.sound : pat.sound;
}

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
    engine.play(stepSound(pat, st), st.note, time, secondsPerStep());
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
  const pat = state.patterns[state.currentPattern];
  if (state.mode === "sound") {
    // The 16 pads act as a sound palette: pad i selects preset i as the
    // active sound. It's then written to any step you switch on.
    state.writeSound = i;
    engine.play(i, state.writeNote, engine.now() + 0.01, secondsPerStep());
    setMode(state.prevMode); // back to where you were (write or play)
  } else if (state.mode === "pattern") {
    state.currentPattern = i;
    setMode(state.prevMode);
  } else if (state.mode === "write") {
    const st = pat.steps[i];
    st.on = !st.on;
    if (st.on) {
      st.note = state.writeNote;
      st.sound = state.writeSound; // remember this pad's own sound
      engine.play(st.sound, st.note, engine.now() + 0.01, secondsPerStep());
    }
  } else {
    // play mode: live-trigger. If the step has content, play it as stored;
    // otherwise preview the currently selected sound + note.
    const st = pat.steps[i];
    const sound = st.on ? stepSound(pat, st) : state.writeSound;
    const note = st.on ? st.note : state.writeNote;
    engine.play(sound, note, engine.now() + 0.01, secondsPerStep());
  }
  render();
}

function setMode(mode) {
  // remember where we came from so sound/pattern picks can return there
  if ((mode === "sound" || mode === "pattern") &&
      (state.mode === "play" || state.mode === "write")) {
    state.prevMode = state.mode;
  }
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
    const el = stepEls[i];
    const dot = el.querySelector(".dot");
    if (state.mode === "sound") {
      // pads become a sound palette: each pad shows its preset name
      el.classList.toggle("on", false);
      el.classList.toggle("sel", i === state.writeSound);
      dot.textContent = SOUNDS[i].name;
    } else if (state.mode === "pattern") {
      el.classList.toggle("on", false);
      el.classList.toggle("sel", i === state.currentPattern);
      dot.textContent = "";
    } else {
      // play / write: show programmed steps with their note name
      el.classList.toggle("sel", false);
      el.classList.toggle("on", st.on);
      dot.textContent = st.on ? noteName(st.note) : "";
    }
  }
  paintPlayhead();
  // LCD text
  document.getElementById("lcd-bpm").textContent = state.bpm;
  document.getElementById("lcd-pat").textContent = String(state.currentPattern + 1).padStart(2, "0");
  document.getElementById("lcd-sound").textContent = SOUNDS[state.writeSound].name;
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
      engine.play(state.writeSound, n, engine.now() + 0.01, secondsPerStep());
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
    localStorage.setItem("plonk:" + Date.now(), body);
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
      .filter((k) => k.startsWith("plonk:") || k.startsWith("mydrum:"))
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

// Sound indices (see SOUNDS in audio.js)
const KICK = 15, SNARE = 14, HAT = 13, BASS = 3, SUB = 0, ROUND = 1,
      ACID = 4, REESE = 6, FM = 7, WOB = 9, DROP = 11;

// Five demo patterns, each a different genre. Each step: [index, midi, sound]
const DEMOS = [
  // 1 — boom bap (hip-hop)
  [[0,36,KICK],[2,36,HAT],[4,38,SNARE],[6,36,HAT],[7,43,BASS],
   [8,36,KICK],[10,36,HAT],[11,36,KICK],[12,38,SNARE],[14,36,HAT],[15,41,BASS]],
  // 2 — house (four on the floor)
  [[0,36,KICK],[2,36,HAT],[3,36,ROUND],[4,36,KICK],[6,36,HAT],[7,36,ROUND],
   [8,36,KICK],[10,36,HAT],[11,39,ROUND],[12,36,KICK],[14,36,HAT],[15,41,ROUND]],
  // 3 — acid line (303-ish)
  [[0,36,KICK],[2,36,ACID],[3,48,ACID],[5,39,ACID],[6,36,ACID],[7,43,ACID],
   [8,36,KICK],[10,36,ACID],[11,48,ACID],[13,41,ACID],[14,36,ACID],[15,45,ACID]],
  // 4 — electro / reese
  [[0,36,KICK],[2,36,HAT],[3,36,KICK],[4,38,SNARE],[6,33,REESE],[8,36,WOB],
   [10,36,KICK],[11,36,HAT],[12,38,SNARE],[14,35,REESE]],
  // 5 — dub / minimal sub
  [[0,36,KICK],[2,36,FM],[4,31,DROP],[6,36,HAT],[8,36,KICK],[10,38,SUB],
   [11,36,SUB],[14,36,HAT]],
];

function seedDemo() {
  DEMOS.forEach((groove, pi) => {
    const p = state.patterns[pi];
    p.sound = BASS; // fallback sound for the pattern
    groove.forEach(([i, n, s]) => { p.steps[i] = { on: true, note: n, sound: s }; });
  });
  state.currentPattern = 0;
  state.writeSound = KICK; // start on the kick so the first tap is drum-y
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
