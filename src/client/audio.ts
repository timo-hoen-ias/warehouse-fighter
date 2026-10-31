// Synthetische Sounds per WebAudio – keine Audiodateien nötig.
// Alles läuft über einen Master-Kompressor und einen Hallen-Hall (Convolver
// mit generierter Impulsantwort), damit Treffer satt und räumlich klingen.

import type { ProjectileKind } from '../shared/characters';

let ctx: AudioContext | null = null;
let master: GainNode;
let dry: GainNode;
let wet: GainNode;
let musicBus: GainNode;
let sfxWet: GainNode;
let noiseBuf: AudioBuffer;

export const audioSettings = {
  music: load('wf-music', true),
  announcer: load('wf-announcer', true),
  musicVolume: loadNumber('wf-music-vol', 0.8),
  sfxVolume: loadNumber('wf-sfx-vol', 1),
  /** 'auto' = Titel passend zur Arena, sonst feste Titel-ID */
  track: loadString('wf-track', 'auto'),
};

function loadString(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadNumber(key: string, fallback: number) {
  const v = Number(loadString(key, String(fallback)));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // privates Fenster o. Ä.
  }
}

function load(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
}

function save(key: string, on: boolean) {
  store(key, on ? 'on' : 'off');
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
  dry.gain.value = audioSettings.sfxVolume;
  dry.connect(comp);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 1.8, 2.6);
  wet = ctx.createGain();
  wet.gain.value = 0.28;
  wet.connect(reverb).connect(comp);
  sfxWet = ctx.createGain();
  sfxWet.gain.value = audioSettings.sfxVolume;
  sfxWet.connect(wet);

  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
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
    g.connect(s).connect(sfxWet);
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

// Schutz vor Klangbrei: begrenzt gleichzeitige Quellen und doppelte Auslöser im selben Moment.
const MAX_VOICES = 72;
let activeVoices = 0;
function track(src: AudioScheduledSourceNode) {
  activeVoices += 1;
  src.onended = () => {
    activeVoices -= 1;
    src.disconnect();
  };
}
const lastPlayed: Record<string, number> = {};
/** true, wenn der Klang `key` in den letzten `ms` Millisekunden schon lief. */
function throttled(key: string, ms: number) {
  const now = performance.now();
  if (now - (lastPlayed[key] ?? -1e9) < ms) return true;
  lastPlayed[key] = now;
  return false;
}

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  if (!ctx || activeVoices > MAX_VOICES) return;
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
  track(osc);
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
  if (!ctx || activeVoices > MAX_VOICES) return;
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
  track(src);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
}

/** Metallischer Klang aus unharmonischen Teiltönen (Regal, Gitterbox, Gong). */
function metal(base: number, dur: number, vol: number, reverb = 0.5, delay = 0, dest?: AudioNode) {
  for (const [ratio, v] of [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25]] as const) {
    tone(base * ratio, dur / ratio ** 0.3, { type: 'sine', vol: vol * v, reverb, delay, dest });
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// --- Stimmen ---------------------------------------------------------------
// Synthetische Kampfschreie: Sägezahn als Stimmbänder, drei Bandpässe als Vokal-Formanten,
// davor ein Hauch Rauschen fürs „H“. Jeder Kämpfer hat eigene Tonhöhe und Klangfarbe.

interface VoiceProfile {
  /** Grundton in Hz */
  pitch: number;
  /** Formant-Verschiebung (kleiner = größerer Körper) */
  formant: number;
  /** Rauheit 0..1 */
  rough: number;
  robot?: boolean;
}

const VOICES: Record<string, VoiceProfile> = {
  gerd: { pitch: 98, formant: 0.86, rough: 0.55 },
  kim: { pitch: 235, formant: 1.18, rough: 0.15 },
  piet: { pitch: 132, formant: 1, rough: 0.3 },
  lena: { pitch: 205, formant: 1.12, rough: 0.12 },
  ludger: { pitch: 84, formant: 0.8, rough: 0.7 },
  paul: { pitch: 175, formant: 1.08, rough: 0.15 },
  ingrid: { pitch: 192, formant: 1.06, rough: 0.25 },
  kalle: { pitch: 110, formant: 0.9, rough: 0.45 },
  rita: { pitch: 188, formant: 1.08, rough: 0.3 },
  robo: { pitch: 140, formant: 1, rough: 0, robot: true },
};

const VOWELS = {
  a: [800, 1200, 2500],
  e: [480, 1800, 2550],
  u: [360, 760, 2400],
  o: [520, 920, 2450],
} as const;

export type VoiceKind = 'effort' | 'kiai' | 'hurt' | 'ko' | 'win';

function vocal(p: VoiceProfile, kind: VoiceKind) {
  if (!ctx || activeVoices > MAX_VOICES - 8) return;
  const t = ctx.currentTime;
  const spec = {
    effort: { dur: 0.11, vowel: 'e', from: 1.05, to: 0.95, vol: 0.12, breath: 0.08 },
    kiai: { dur: 0.22, vowel: 'a', from: 1.2, to: 0.9, vol: 0.2, breath: 0.12 },
    hurt: { dur: 0.24, vowel: 'u', from: 1.25, to: 0.75, vol: 0.18, breath: 0.1 },
    ko: { dur: 1.0, vowel: 'a', from: 1.35, to: 0.55, vol: 0.24, breath: 0.15 },
    win: { dur: 0.35, vowel: 'o', from: 1.0, to: 1.25, vol: 0.18, breath: 0.08 },
  }[kind];
  const pitch = p.pitch * rand(0.95, 1.06);
  if (p.robot) {
    // Roboter: gestufte Rechteck-Piepser statt Stimme
    const steps = kind === 'ko' ? 10 : kind === 'win' ? 4 : 3;
    for (let i = 0; i < steps; i++) {
      const f = pitch * 4 * (kind === 'hurt' || kind === 'ko' ? 1 - i * 0.08 : 1 + (i % 2) * 0.5);
      tone(f, spec.dur / steps, { type: 'square', vol: spec.vol * 0.35, delay: (i * spec.dur) / steps, reverb: 0.15 });
    }
    noise(spec.dur * 0.6, { type: 'bandpass', freq: 3000, q: 4, vol: 0.05 });
    return;
  }
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(pitch * spec.from, t);
  src.frequency.linearRampToValueAtTime(pitch * (spec.from + 0.08), t + spec.dur * 0.2);
  src.frequency.exponentialRampToValueAtTime(pitch * spec.to, t + spec.dur);
  // Vibrato / Rauheit
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5 + p.rough * 30;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = pitch * (0.015 + p.rough * 0.06);
  lfo.connect(lfoGain).connect(src.frequency);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(spec.vol, t + 0.02);
  env.gain.setValueAtTime(spec.vol, t + spec.dur * 0.55);
  env.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
  const dest = out(0.25);
  env.connect(dest);
  VOWELS[spec.vowel as keyof typeof VOWELS].forEach((f, i) => {
    const bp = ctx!.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * p.formant;
    bp.Q.value = 6 + i * 3;
    const g = ctx!.createGain();
    g.gain.value = [1, 0.55, 0.25][i] * 2.2;
    src.connect(bp).connect(g).connect(env);
  });
  track(src);
  src.start(t);
  src.stop(t + spec.dur + 0.05);
  lfo.start(t);
  lfo.stop(t + spec.dur + 0.05);
  // Atem / Rauheit
  noise(spec.dur * 0.5, { type: 'bandpass', freq: 1400 * p.formant, q: 1.2, vol: spec.breath + p.rough * 0.05, attack: 0.005 });
}

// --- Kampfgeräusche -------------------------------------------------------

export type Weight = 'light' | 'mid' | 'heavy';

export const sfx = {
  /** Luftzug: Bandpass-Sweep, schwere Moves tiefer und länger. */
  swing(weight: Weight = 'light', kick = false) {
    if (throttled(`swing-${weight}`, 40)) return;
    const dur = weight === 'heavy' ? 0.26 : weight === 'mid' ? 0.18 : 0.12;
    const f = (kick ? 700 : 1100) * rand(0.9, 1.15);
    noise(dur, { type: 'bandpass', freq: f, to: f * 3.2, q: 1.6, vol: weight === 'heavy' ? 0.22 : 0.13, attack: dur * 0.5, reverb: 0.05 });
  },

  /** Treffer: tiefer Bums + Klatschen + Klick, nach Gewicht geschichtet. Metall bei Robotern. */
  hit(weight: Weight, combo = 1, metallic = false) {
    if (metallic) metal(rand(500, 640), 0.3, weight === 'heavy' ? 0.14 : 0.08, 0.3);
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

  /** Kampfschrei bzw. Schmerzlaut des Kämpfers. */
  voice(char: string, kind: VoiceKind) {
    // pro Kämpfer nicht öfter als alle 0,18 s, damit Ketten nicht zum Dauerbrüllen werden
    if (kind !== 'ko' && throttled(`voice-${char}`, kind === 'hurt' ? 260 : 180)) return;
    vocal(VOICES[char] ?? VOICES.piet, kind);
  },

  /** Konter: heller Klang wie ein angeschlagenes Regalrohr, dazu ein Luftzug. */
  parry() {
    metal(1250, 0.6, 0.16, 0.6);
    tone(2400, 0.25, { type: 'triangle', to: 3200, vol: 0.08, reverb: 0.5 });
    noise(0.2, { type: 'bandpass', freq: 2000, to: 6000, q: 1.2, vol: 0.12 });
  },

  /** Panzerung: dumpfes Blech. */
  armor() {
    metal(190, 0.5, 0.2, 0.4);
    tone(70, 0.25, { type: 'sine', to: 45, vol: 0.4 });
    noise(0.08, { type: 'lowpass', freq: 1200, vol: 0.25 });
  },

  /** Würfe gelöst: Klatschen und Abstoßen. */
  tech() {
    noise(0.06, { type: 'bandpass', freq: 2200, q: 0.7, vol: 0.35 });
    noise(0.18, { type: 'bandpass', freq: 600, to: 1800, q: 1, vol: 0.12, delay: 0.04 });
  },

  /** Landung nach dem Sprung. */
  land() {
    if (throttled('land', 80)) return;
    tone(110, 0.12, { type: 'sine', to: 50, vol: 0.25, reverb: 0.2 });
    noise(0.08, { type: 'lowpass', freq: 700, vol: 0.15 });
  },

  /** Kombo-Limit erreicht: der Gegner kommt frei. */
  release() {
    tone(900, 0.35, { type: 'triangle', to: 300, vol: 0.08, reverb: 0.4 });
    noise(0.3, { type: 'highpass', freq: 3000, to: 900, vol: 0.06 });
  },

  /** Robo-Servo beim Schlagen. */
  servo() {
    if (throttled('servo', 90)) return;
    tone(rand(380, 460), 0.14, { type: 'sawtooth', to: rand(700, 900), vol: 0.035, reverb: 0.05 });
  },

  /** Signatur-Geräusch des Kämpfers beim Spezialmove. */
  signature(char: string) {
    switch (char) {
      case 'gerd': // Rückfahrwarner des Staplers
        for (let i = 0; i < 2; i++) tone(1050, 0.1, { type: 'square', vol: 0.06, delay: i * 0.16, reverb: 0.3 });
        break;
      case 'ludger': // Lkw-Hupe
        for (const f of [155, 196]) tone(f, 0.45, { type: 'sawtooth', vol: 0.1, attack: 0.02, reverb: 0.5 });
        break;
      case 'kim': // Scanner-Piep
        tone(2600, 0.07, { type: 'square', vol: 0.06 });
        break;
      case 'piet': // Klebeband abreißen
        noise(0.25, { type: 'bandpass', freq: 3500, to: 1500, q: 2.5, vol: 0.14 });
        break;
      case 'lena': // Kugelschreiber-Klick
        noise(0.015, { type: 'highpass', freq: 5000, vol: 0.2 });
        noise(0.015, { type: 'highpass', freq: 4000, vol: 0.18, delay: 0.07 });
        break;
      case 'paul': // Kaffee schwappt
        noise(0.25, { type: 'bandpass', freq: 900, to: 400, q: 4, vol: 0.12 });
        break;
      case 'ingrid': // Zähler-Klacken
        for (let i = 0; i < 3; i++) noise(0.02, { type: 'bandpass', freq: 2500, q: 3, vol: 0.15, delay: i * 0.05 });
        break;
      case 'kalle': // Eiskristalle
        metal(1800, 0.35, 0.05, 0.6);
        noise(0.3, { type: 'highpass', freq: 6000, vol: 0.08 });
        break;
      case 'rita': // Ratsche
        for (let i = 0; i < 5; i++) noise(0.015, { type: 'bandpass', freq: 1800, q: 4, vol: 0.14, delay: i * 0.035 });
        break;
      case 'robo':
        tone(300, 0.3, { type: 'sawtooth', to: 1200, vol: 0.05 });
        tone(1200, 0.08, { type: 'square', vol: 0.04, delay: 0.3 });
        break;
    }
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
    u.volume = 0.9 * audioSettings.sfxVolume;
    speechSynthesis.speak(u);
  } catch {
    // Sprachausgabe nicht verfügbar
  }
}

// --- Musik ---------------------------------------------------------------
// 90er-Arcade-Musik, komplett synthetisiert: Beat, Bass, Arpeggios, Flächen und
// eine Leadstimme mit Schwebung und Echo. Ein Titel fürs Hauptmenü und fünf
// Kampftitel; welcher läuft, hängt von der Arena ab (oder von den Optionen).
// Eingeplant per Lookahead-Scheduler.

type Drums = 'euro' | 'light' | 'techno' | 'synth' | 'boss';
type Bass = 'octave' | 'offbeat' | 'rolling';

interface SongDef {
  title: string;
  bpm: number;
  /** Grundton (MIDI) und Moll/Dur je Takt */
  chords: [number, boolean][];
  /** Lead-Melodie: 16 Sechzehntel je Takt, 0 = Pause */
  lead: number[][];
  leadType: OscillatorType;
  drums: Drums;
  bass: Bass;
}

export const SONGS = {
  menu: {
    title: 'Lager 3 (Hauptmenü)',
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
    bass: 'octave',
  },
  schicht: {
    title: 'Schichtbeginn',
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
    bass: 'octave',
  },
  turbo: {
    title: 'Gabelstapler-Turbo',
    bpm: 165,
    chords: [[50, true], [46, false], [48, false], [45, true]],
    lead: [
      [81, 0, 79, 0, 77, 0, 76, 0, 77, 0, 0, 74, 0, 0, 74, 0],
      [77, 0, 79, 0, 81, 0, 82, 0, 81, 0, 79, 0, 77, 0, 0, 0],
      [76, 0, 77, 0, 79, 0, 0, 76, 0, 0, 72, 0, 76, 0, 79, 0],
      [81, 0, 0, 0, 76, 0, 0, 0, 72, 0, 76, 0, 81, 0, 84, 0],
    ],
    leadType: 'square',
    drums: 'euro',
    bass: 'offbeat',
  },
  techno: {
    title: 'Kühlhaus-Techno',
    bpm: 138,
    chords: [[52, true], [52, true], [48, false], [50, false]],
    lead: [
      [76, 0, 76, 0, 0, 0, 79, 0, 76, 0, 0, 0, 74, 0, 76, 0],
      [76, 0, 76, 0, 0, 0, 83, 0, 81, 0, 79, 0, 76, 0, 0, 0],
      [72, 0, 76, 0, 79, 0, 76, 0, 72, 0, 76, 0, 79, 0, 84, 0],
      [74, 0, 78, 0, 81, 0, 78, 0, 74, 0, 78, 0, 81, 0, 86, 0],
    ],
    leadType: 'sawtooth',
    drums: 'techno',
    bass: 'rolling',
  },
  nacht: {
    title: 'Nachtschicht',
    bpm: 112,
    chords: [[53, false], [55, false], [52, true], [57, true]],
    lead: [
      [72, 0, 0, 0, 74, 0, 0, 0, 76, 0, 0, 0, 77, 0, 76, 0],
      [74, 0, 0, 0, 0, 0, 71, 0, 74, 0, 0, 0, 79, 0, 0, 0],
      [76, 0, 0, 0, 79, 0, 0, 0, 83, 0, 0, 0, 79, 0, 76, 0],
      [76, 0, 0, 0, 72, 0, 0, 0, 69, 0, 0, 0, 0, 0, 0, 0],
    ],
    leadType: 'square',
    drums: 'synth',
    bass: 'rolling',
  },
  boss: {
    title: 'Endgegner',
    bpm: 170,
    chords: [[48, true], [44, false], [46, false], [43, false]],
    lead: [
      [72, 0, 75, 0, 79, 0, 75, 0, 84, 0, 0, 82, 0, 0, 79, 0],
      [80, 0, 0, 79, 0, 0, 75, 0, 72, 0, 75, 0, 80, 0, 0, 0],
      [82, 0, 0, 79, 0, 0, 77, 0, 74, 0, 77, 0, 82, 0, 0, 0],
      [79, 0, 0, 0, 83, 0, 0, 0, 86, 0, 0, 0, 83, 0, 79, 0],
    ],
    leadType: 'square',
    drums: 'boss',
    bass: 'octave',
  },
} satisfies Record<string, SongDef>;

export type Song = keyof typeof SONGS;
/** Kampftitel in der Reihenfolge, in der sie den Arenen zugeordnet werden. */
export const FIGHT_SONGS: Song[] = ['schicht', 'turbo', 'techno', 'nacht', 'boss'];

let musicTimer: ReturnType<typeof setInterval> | null = null;
let song: Song | null = null;
let musicLevel = 1;
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
  const kick = (vol = 0.7) => tone(120, 0.2, { ...o, type: 'sine', to: 40, vol });
  const snare = (vol = 0.32) => {
    noise(0.16, { ...o, type: 'bandpass', freq: 1900, q: 0.5, vol });
    tone(190, 0.08, { ...o, type: 'triangle', to: 120, vol: vol * 0.6 });
  };

  // Schlagzeug
  switch (def.drums) {
    case 'euro':
    case 'boss':
      if (s % 4 === 0) kick();
      if (def.drums === 'boss' && (s === 7 || s === 14)) kick(0.45);
      if (s === 4 || s === 12) snare();
      if (s % 4 === 2) noise(0.09, { ...o, type: 'highpass', freq: 7500, vol: 0.16 }); // offene Hi-Hat
      else if (s % 2 === 1) noise(0.025, { ...o, type: 'highpass', freq: 9000, vol: 0.06 });
      if (bar % 4 === 3 && s >= 12) noise(0.06, { ...o, type: 'bandpass', freq: 1400 + s * 120, q: 0.8, vol: 0.18 }); // Snare-Wirbel
      if (def.drums === 'boss' && s === 0 && bar % 2 === 0) metal(220, 1.2, 0.05, 0, delay, musicBus); // Amboss-Schlag
      break;
    case 'techno':
      if (s % 4 === 0) kick(0.8);
      if (s === 4 || s === 12) noise(0.05, { ...o, type: 'bandpass', freq: 2600, q: 1.2, vol: 0.2 }); // Clap
      if (s % 4 === 2) noise(0.12, { ...o, type: 'highpass', freq: 6500, vol: 0.18 });
      noise(0.02, { ...o, type: 'highpass', freq: 10000, vol: s % 2 ? 0.04 : 0.07 });
      if (s === 10 && bar % 2) metal(600, 0.3, 0.04, 0, delay, musicBus); // Kühlaggregat-Klong
      break;
    case 'synth':
      if (s === 0 || s === 8 || s === 11) kick(0.6);
      if (s === 4 || s === 12) {
        snare(0.36);
        noise(0.4, { ...o, type: 'lowpass', freq: 3000, to: 800, vol: 0.12 }); // Gated-Reverb-Schwanz
      }
      if (s % 2 === 0) noise(0.03, { ...o, type: 'highpass', freq: 8000, vol: 0.08 });
      break;
    default:
      if (s === 0 || s === 8 || s === 10) tone(100, 0.25, { ...o, type: 'sine', to: 40, vol: 0.5 });
      if (s === 4 || s === 12) noise(0.1, { ...o, type: 'bandpass', freq: 2400, q: 0.7, vol: 0.12 });
      if (s % 2 === 0) noise(0.03, { ...o, type: 'highpass', freq: 8000, vol: 0.07 });
  }

  // Bass
  const bassTone = (n: number, len: number, vol = 0.13) => {
    tone(midi(n), len, { ...o, type: 'sawtooth', vol, attack: 0.004 });
    tone(midi(n) * 1.005, len, { ...o, type: 'square', vol: vol * 0.4, attack: 0.004 });
  };
  if (def.bass === 'octave' && s % 2 === 0) bassTone(root - 12 + (s % 4 === 2 ? 12 : 0), stepLen * 1.7);
  if (def.bass === 'offbeat' && s % 4 === 2) bassTone(root - 12, stepLen * 1.8, 0.16);
  if (def.bass === 'rolling' && s % 4 !== 0) bassTone(root - 12, stepLen * 0.8, s % 4 === 2 ? 0.14 : 0.09);

  // Arpeggio auf Sechzehnteln
  const arp = triad[s % 4] + 12 + root;
  tone(midi(arp), stepLen * 0.9, { ...o, type: 'square', vol: def.drums === 'light' ? 0.03 : 0.035, attack: 0.002 });

  // Akkordfläche zum Taktbeginn
  if (s === 0) {
    for (const iv of triad.slice(0, 3)) {
      tone(midi(root + 12 + iv), stepLen * 15, { ...o, type: 'sawtooth', vol: def.drums === 'synth' ? 0.035 : 0.02, attack: 0.08 });
    }
  }

  // Lead (nicht im Intro/Break-Abschnitt)
  const note = def.lead[bar % def.lead.length][s];
  if (note && section !== 0) {
    const up = section === 3 ? 12 : 0;
    const len = stepLen * (def.drums === 'synth' ? 3.5 : 1.8);
    const vol = def.leadType === 'sawtooth' ? 0.05 : 0.075;
    tone(midi(note + up), len, { ...o, type: def.leadType, vol, attack: 0.004 });
    tone(midi(note + up) * 1.007, len, { ...o, type: def.leadType, vol: vol * 0.55, attack: 0.004 }); // Schwebung
    tone(midi(note + up), len, { ...o, type: def.leadType, vol: vol * 0.33, attack: 0.004, delay: delay + stepLen * 3 }); // Echo
  }
}

/** Startet einen Titel (läuft schon derselbe, passiert nichts). */
export function startMusic(which: Song) {
  if (!ctx) return;
  if (song === which && musicTimer) return;
  song = which;
  nextTime = ctx.currentTime + 0.1;
  stepIndex = 0;
  if (musicTimer) return;
  musicTimer = setInterval(() => {
    if (!ctx || !song) return;
    const def: SongDef = SONGS[song];
    while (nextTime < ctx.currentTime + 0.25) {
      scheduleStep(def, nextTime, stepIndex++);
      nextTime += 60 / def.bpm / 4;
    }
  }, 50);
  setMusicLevel(musicLevel);
}

/** Kampftitel für eine Arena: fest gewählt in den Optionen oder passend zur Arena. */
export function fightSong(stageIndex: number, finale = false): Song {
  const t = audioSettings.track;
  if (t !== 'auto' && t in SONGS) return t as Song;
  if (finale) return 'boss';
  return FIGHT_SONGS[stageIndex % (FIGHT_SONGS.length - 1)];
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  song = null;
}

/** Leiser in der Pause/Zeitlupe, ganz aus wenn abgeschaltet. */
export function setMusicLevel(level: number) {
  musicLevel = level;
  if (!ctx) return;
  const target = audioSettings.music ? 0.32 * audioSettings.musicVolume * level : 0;
  musicBus.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
}

export function setMusicEnabled(on: boolean) {
  audioSettings.music = on;
  save('wf-music', on);
  setMusicLevel(musicLevel);
}

export function setMusicVolume(v: number) {
  audioSettings.musicVolume = v;
  store('wf-music-vol', String(v));
  setMusicLevel(musicLevel);
}

export function setSfxVolume(v: number) {
  audioSettings.sfxVolume = v;
  store('wf-sfx-vol', String(v));
  if (!ctx) return;
  dry.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  sfxWet.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}

export function setTrack(t: string) {
  audioSettings.track = t;
  store('wf-track', t);
}

export function setAnnouncerEnabled(on: boolean) {
  audioSettings.announcer = on;
  save('wf-announcer', on);
  if (!on && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
