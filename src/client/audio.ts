// Synthetische Sounds per WebAudio – keine Audiodateien nötig.
// Alles läuft über einen Master-Kompressor und einen Hallen-Hall (Convolver
// mit generierter Impulsantwort), damit Treffer satt und räumlich klingen.

import type { ProjectileKind } from '../shared/characters';

let ctx: AudioContext | null = null;
let master: GainNode;
let dry: GainNode;
let wet: GainNode;
let musicBus: GainNode;
let noiseBuf: AudioBuffer;

export const audioSettings = {
  music: load('wf-music', true),
  announcer: load('wf-announcer', true),
};

function load(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
}

function save(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // privates Fenster o. Ä.
  }
}

export function unlockAudio() {
  if (!ctx) init();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function init() {
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  master = ctx.createGain();
  master.gain.value = 0.9;
  comp.connect(master).connect(ctx.destination);

  dry = ctx.createGain();
  dry.connect(comp);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 1.8, 2.6);
  wet = ctx.createGain();
  wet.gain.value = 0.28;
  wet.connect(reverb).connect(comp);

  musicBus = ctx.createGain();
  musicBus.gain.value = audioSettings.music ? 0.32 : 0;
  musicBus.connect(comp);
  const musicVerb = ctx.createGain();
  musicVerb.gain.value = 0.18;
  musicBus.connect(musicVerb).connect(wet);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/** Impulsantwort einer großen Lagerhalle: abklingendes Rauschen mit frühen Reflexionen. */
function impulse(c: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      let v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      // frühe Reflexionen an Regalen und Wänden
      if (i % Math.floor(c.sampleRate * (0.031 + ch * 0.007)) < 40) v *= 3;
      data[i] = v * 0.6;
    }
  }
  return buf;
}

/** Ausgang mit Hallanteil. */
function out(reverb = 0.3): AudioNode {
  const g = ctx!.createGain();
  g.connect(dry);
  if (reverb > 0) {
    const s = ctx!.createGain();
    s.gain.value = reverb;
    g.connect(s).connect(wet);
  }
  return g;
}

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  to?: number;
  attack?: number;
  delay?: number;
  reverb?: number;
  dest?: AudioNode;
}

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
  const vol = o.vol ?? 0.2;
  const attack = o.attack ?? 0.002;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(o.dest ?? out(o.reverb ?? 0.2));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

interface NoiseOpts {
  vol?: number;
  type?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
  attack?: number;
  delay?: number;
  reverb?: number;
  dest?: AudioNode;
}

function noise(dur: number, o: NoiseOpts = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + (o.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? 'lowpass';
  filter.frequency.setValueAtTime(o.freq ?? 1200, t);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  filter.Q.value = o.q ?? 0.8;
  const gain = ctx.createGain();
  const vol = o.vol ?? 0.3;
  const attack = o.attack ?? 0.002;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(o.dest ?? out(o.reverb ?? 0.2));
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
}

/** Metallischer Klang aus unharmonischen Teiltönen (Regal, Gitterbox, Gong). */
function metal(base: number, dur: number, vol: number, reverb = 0.5, delay = 0) {
  for (const [ratio, v] of [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25]] as const) {
    tone(base * ratio, dur / ratio ** 0.3, { type: 'sine', vol: vol * v, reverb, delay });
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// --- Kampfgeräusche -------------------------------------------------------

export type Weight = 'light' | 'mid' | 'heavy';

export const sfx = {
  /** Luftzug: Bandpass-Sweep, schwere Moves tiefer und länger. */
  swing(weight: Weight = 'light', kick = false) {
    const dur = weight === 'heavy' ? 0.26 : weight === 'mid' ? 0.18 : 0.12;
    const f = (kick ? 700 : 1100) * rand(0.9, 1.15);
    noise(dur, { type: 'bandpass', freq: f, to: f * 3.2, q: 1.6, vol: weight === 'heavy' ? 0.22 : 0.13, attack: dur * 0.5, reverb: 0.05 });
  },

  /** Treffer: tiefer Bums + Klatschen + Klick, nach Gewicht geschichtet. */
  hit(weight: Weight, combo = 1) {
    const p = rand(0.94, 1.06) * (1 + Math.min(combo, 8) * 0.025);
    const k = weight === 'heavy' ? 1 : weight === 'mid' ? 0.75 : 0.55;
    // Körper-Bums
    tone(150 * p, 0.14 + k * 0.12, { type: 'sine', to: 42, vol: 0.55 * k + 0.15, reverb: 0.15 });
    // Klatschen
    noise(0.05 + k * 0.08, { type: 'bandpass', freq: 1800 * p, to: 600, q: 0.7, vol: 0.5 * k + 0.2, reverb: 0.25 });
    // Klick / Knacken
    noise(0.018, { type: 'highpass', freq: 4500, vol: 0.35, reverb: 0 });
    if (weight === 'heavy') {
      tone(70, 0.35, { type: 'triangle', to: 30, vol: 0.4, reverb: 0.35 });
      noise(0.3, { type: 'lowpass', freq: 500, to: 120, vol: 0.35, reverb: 0.5 });
    }
  },

  /** Blocken: Klonk wie auf einen Rollcontainer. */
  block() {
    metal(rand(380, 440), 0.25, 0.12, 0.35);
    noise(0.04, { type: 'highpass', freq: 3000, vol: 0.2 });
    tone(110, 0.08, { type: 'square', to: 60, vol: 0.08 });
  },

  /** Wurf: Packen (Stoff) und danach Aufschlag. */
  grab() {
    noise(0.12, { type: 'bandpass', freq: 900, q: 0.5, vol: 0.3 });
    tone(220, 0.1, { type: 'triangle', to: 120, vol: 0.15 });
  },

  /** Aufprall auf dem Hallenboden. */
  knockdown() {
    tone(90, 0.45, { type: 'sine', to: 32, vol: 0.7, reverb: 0.4 });
    noise(0.35, { type: 'lowpass', freq: 900, to: 90, vol: 0.5, reverb: 0.6 });
    noise(0.5, { type: 'bandpass', freq: 220, q: 0.6, vol: 0.2, delay: 0.08, reverb: 0.6 });
  },

  dash() {
    noise(0.16, { type: 'bandpass', freq: 500, to: 1600, q: 0.9, vol: 0.12, attack: 0.05, reverb: 0.05 });
    noise(0.05, { type: 'highpass', freq: 2500, vol: 0.06, delay: 0.02 }); // Sohlenquietschen
    tone(2100, 0.05, { type: 'sine', to: 2600, vol: 0.03, delay: 0.02 });
  },

  /** Jeder Kämpfer wirft etwas anderes – jedes Geschoss klingt anders. */
  projectile(kind: ProjectileKind) {
    switch (kind) {
      case 'laser':
      case 'lidar':
        tone(kind === 'laser' ? 1900 : 1200, 0.18, { type: 'square', vol: 0.07 });
        tone(kind === 'laser' ? 2850 : 2400, 0.25, { type: 'sawtooth', to: 400, vol: 0.05, delay: 0.03 });
        break;
      case 'label':
        tone(1600, 0.06, { type: 'square', vol: 0.07 });
        tone(1600, 0.06, { type: 'square', vol: 0.07, delay: 0.09 });
        noise(0.12, { type: 'highpass', freq: 3500, vol: 0.08 });
        break;
      case 'wave':
        tone(160, 0.6, { type: 'sawtooth', to: 120, vol: 0.12, attack: 0.05, reverb: 0.5 });
        tone(240, 0.6, { type: 'sawtooth', to: 180, vol: 0.08, attack: 0.05, reverb: 0.5 });
        break;
      case 'ice':
        metal(1400, 0.4, 0.06, 0.6);
        noise(0.25, { type: 'highpass', freq: 5000, vol: 0.12 });
        break;
      case 'cup':
        tone(700, 0.12, { type: 'sine', to: 300, vol: 0.12 });
        noise(0.2, { type: 'bandpass', freq: 1200, q: 3, vol: 0.08, delay: 0.05 }); // Schwappen
        break;
      case 'clipboard':
        noise(0.15, { type: 'bandpass', freq: 2200, to: 900, q: 1.5, vol: 0.14 });
        break;
      case 'pallet':
        noise(0.22, { type: 'lowpass', freq: 700, vol: 0.3 });
        tone(130, 0.2, { type: 'triangle', to: 70, vol: 0.2 });
        break;
      default: // box, parcel
        noise(0.15, { type: 'bandpass', freq: 600, q: 0.8, vol: 0.25 });
        tone(180, 0.12, { type: 'triangle', to: 90, vol: 0.12 });
    }
  },

  /** K.O.: Donnerschlag mit langem Hallenhall. */
  ko() {
    tone(60, 1.6, { type: 'sine', to: 25, vol: 0.9, reverb: 0.8 });
    tone(120, 0.9, { type: 'sawtooth', to: 40, vol: 0.2, reverb: 0.8 });
    noise(1.2, { type: 'lowpass', freq: 1500, to: 60, vol: 0.6, reverb: 1 });
    metal(160, 2.2, 0.12, 1, 0.05);
  },

  /** Zerbrechen beim Finisher (Kopf/Arm ab). */
  gore() {
    noise(0.3, { type: 'bandpass', freq: 400, q: 0.6, vol: 0.4, reverb: 0.4 });
    noise(0.12, { type: 'highpass', freq: 2500, vol: 0.25, delay: 0.03 });
    tone(80, 0.3, { type: 'sine', to: 30, vol: 0.5 });
  },

  /** Gegner kracht ins Regal. */
  wallSlam() {
    metal(110, 2, 0.25, 1);
    metal(173, 1.6, 0.18, 1, 0.04);
    noise(0.8, { type: 'lowpass', freq: 2500, to: 100, vol: 0.6, reverb: 1 });
    for (let i = 0; i < 6; i++) noise(0.08, { type: 'bandpass', freq: rand(600, 1600), q: 2, vol: 0.12, delay: 0.25 + i * rand(0.06, 0.12), reverb: 0.6 });
  },

  /** Rundengong – eine Werkshallen-Glocke. */
  bell() {
    metal(420, 2.4, 0.18, 0.9);
  },

  /** Hupe zum Schichtbeginn. */
  horn() {
    for (const f of [185, 233]) tone(f, 0.7, { type: 'sawtooth', vol: 0.09, attack: 0.03, reverb: 0.6 });
  },

  /** Kurzer Akzent, wenn eine Kombo wächst. */
  comboTick(combo: number) {
    if (combo < 3) return;
    tone(500 + combo * 70, 0.08, { type: 'triangle', vol: 0.05, reverb: 0.2 });
  },

  menu() {
    tone(880, 0.05, { type: 'square', vol: 0.04, reverb: 0.1 });
  },
};

// --- Ansager -------------------------------------------------------------

let voice: SpeechSynthesisVoice | null | undefined;

export function announce(text: string) {
  if (!audioSettings.announcer || typeof speechSynthesis === 'undefined') return;
  try {
    if (voice === undefined) {
      const voices = speechSynthesis.getVoices();
      if (voices.length) voice = voices.find((v) => v.lang.startsWith('de')) ?? null;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 0.6;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch {
    // Sprachausgabe nicht verfügbar
  }
}

// --- Musik ---------------------------------------------------------------
// 90er-Arcade-Musik, komplett synthetisiert: Eurodance-Beat, Oktav-Bass,
// Arpeggio-Flächen und eine Rechteck-Leadstimme. Zwei Stücke: eines fürs
// Hauptmenü, ein schnelleres für die Kämpfe. Eingeplant per Lookahead-Scheduler.

export type Song = 'menu' | 'fight';

interface SongDef {
  bpm: number;
  /** Grundton (MIDI) und Moll/Dur je Takt */
  chords: [number, boolean][];
  /** Lead-Melodie: 16 Sechzehntel je Takt, 0 = Pause */
  lead: number[][];
  leadType: OscillatorType;
  /** Takte pro Abschnitt; Abschnitt 0 ohne Lead (Intro/Break) */
  drums: 'euro' | 'light';
}

const SONGS: Record<Song, SongDef> = {
  fight: {
    bpm: 152,
    chords: [[57, true], [53, false], [48, false], [55, false]],
    lead: [
      [76, 0, 76, 74, 72, 0, 69, 0, 72, 0, 74, 0, 76, 0, 79, 0],
      [77, 0, 76, 74, 72, 0, 69, 0, 77, 0, 76, 0, 72, 0, 74, 0],
      [79, 0, 79, 77, 76, 0, 72, 0, 76, 0, 77, 0, 79, 0, 84, 0],
      [83, 0, 81, 79, 74, 0, 71, 0, 79, 0, 0, 0, 81, 0, 83, 0],
    ],
    leadType: 'square',
    drums: 'euro',
  },
  menu: {
    bpm: 124,
    chords: [[50, true], [46, false], [53, false], [48, false]],
    lead: [
      [74, 0, 0, 77, 0, 0, 76, 0, 74, 0, 72, 0, 69, 0, 0, 0],
      [70, 0, 0, 74, 0, 0, 72, 0, 70, 0, 69, 0, 65, 0, 0, 0],
      [69, 0, 0, 72, 0, 0, 77, 0, 76, 0, 74, 0, 72, 0, 0, 0],
      [72, 0, 74, 0, 76, 0, 79, 0, 76, 0, 0, 0, 0, 0, 0, 0],
    ],
    leadType: 'triangle',
    drums: 'light',
  },
};

let musicTimer: ReturnType<typeof setInterval> | null = null;
let song: Song | null = null;
let nextTime = 0;
let stepIndex = 0;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function scheduleStep(def: SongDef, t: number, i: number) {
  const stepLen = 60 / def.bpm / 4;
  const bar = Math.floor(i / 16);
  const s = i % 16;
  const section = Math.floor(bar / 4) % 4;
  const [root, minor] = def.chords[bar % def.chords.length];
  const triad = [0, minor ? 3 : 4, 7, 12];
  const delay = Math.max(0, t - ctx!.currentTime);
  const o = { delay, dest: musicBus, reverb: 0 };

  // Schlagzeug
  if (def.drums === 'euro') {
    if (s % 4 === 0) tone(120, 0.2, { ...o, type: 'sine', to: 40, vol: 0.7 });
    if (s === 4 || s === 12) {
      noise(0.16, { ...o, type: 'bandpass', freq: 1900, q: 0.5, vol: 0.32 });
      tone(190, 0.08, { ...o, type: 'triangle', to: 120, vol: 0.2 });
    }
    if (s % 4 === 2) noise(0.09, { ...o, type: 'highpass', freq: 7500, vol: 0.16 }); // offene Hi-Hat
    else if (s % 2 === 1) noise(0.025, { ...o, type: 'highpass', freq: 9000, vol: 0.06 });
    if (bar % 4 === 3 && s >= 12) noise(0.06, { ...o, type: 'bandpass', freq: 1400 + s * 120, q: 0.8, vol: 0.18 }); // Snare-Wirbel
  } else {
    if (s === 0 || s === 8 || s === 10) tone(100, 0.25, { ...o, type: 'sine', to: 40, vol: 0.5 });
    if (s === 4 || s === 12) noise(0.1, { ...o, type: 'bandpass', freq: 2400, q: 0.7, vol: 0.12 });
    if (s % 2 === 0) noise(0.03, { ...o, type: 'highpass', freq: 8000, vol: 0.07 });
  }

  // Oktav-Bass auf Achteln (der typische Eurodance-Puls)
  if (s % 2 === 0) {
    const n = root - 12 + (s % 4 === 2 ? 12 : 0);
    tone(midi(n), stepLen * 1.7, { ...o, type: 'sawtooth', vol: 0.13, attack: 0.004 });
    tone(midi(n) * 1.005, stepLen * 1.7, { ...o, type: 'square', vol: 0.05, attack: 0.004 });
  }

  // Arpeggio auf Sechzehnteln
  const arp = triad[s % 4] + 12 + root;
  tone(midi(arp), stepLen * 0.9, { ...o, type: 'square', vol: def.drums === 'euro' ? 0.035 : 0.03, attack: 0.002 });

  // Akkordfläche zum Taktbeginn
  if (s === 0) {
    for (const iv of triad.slice(0, 3)) {
      tone(midi(root + 12 + iv), stepLen * 15, { ...o, type: 'sawtooth', vol: 0.02, attack: 0.08 });
    }
  }

  // Lead (nicht im Intro/Break-Abschnitt)
  const note = def.lead[bar % def.lead.length][s];
  if (note && section !== 0) {
    const up = section === 3 ? 12 : 0;
    const len = stepLen * 1.8;
    tone(midi(note + up), len, { ...o, type: def.leadType, vol: 0.075, attack: 0.004 });
    tone(midi(note + up) * 1.007, len, { ...o, type: def.leadType, vol: 0.04, attack: 0.004 }); // Schwebung
    tone(midi(note + up), len, { ...o, type: def.leadType, vol: 0.025, attack: 0.004, delay: delay + stepLen * 3 }); // Echo
  }
}

/** Startet ein Stück (läuft schon dasselbe, passiert nichts). */
export function startMusic(which: Song) {
  if (!ctx) return;
  if (song === which && musicTimer) return;
  song = which;
  nextTime = ctx.currentTime + 0.1;
  stepIndex = 0;
  if (musicTimer) return;
  musicTimer = setInterval(() => {
    if (!ctx || !song) return;
    const def = SONGS[song];
    while (nextTime < ctx.currentTime + 0.25) {
      scheduleStep(def, nextTime, stepIndex++);
      nextTime += 60 / def.bpm / 4;
    }
  }, 50);
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  song = null;
}

/** Leiser in der Pause/Zeitlupe, ganz aus wenn abgeschaltet. */
export function setMusicLevel(level: number) {
  if (!ctx) return;
  const target = audioSettings.music ? 0.32 * level : 0;
  musicBus.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
}

export function setMusicEnabled(on: boolean) {
  audioSettings.music = on;
  save('wf-music', on);
  setMusicLevel(1);
}

export function setAnnouncerEnabled(on: boolean) {
  audioSettings.announcer = on;
  save('wf-announcer', on);
  if (!on && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
