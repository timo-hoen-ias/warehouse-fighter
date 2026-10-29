// Synthetische Sounds per WebAudio – keine Audiodateien nötig.
let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, vol = 0.2, slide = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function noise(dur: number, vol = 0.3, filterFreq = 1200) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
}

export const sfx = {
  swing: () => noise(0.08, 0.08, 3000),
  hit: (heavy: boolean) => {
    noise(heavy ? 0.25 : 0.12, heavy ? 0.5 : 0.35, heavy ? 800 : 1600);
    tone(heavy ? 90 : 160, 0.15, 'square', 0.12, -60);
  },
  block: () => tone(700, 0.06, 'square', 0.08, -300),
  scanner: () => tone(1800, 0.12, 'square', 0.08),
  throw: () => noise(0.18, 0.15, 500),
  ko: () => {
    tone(220, 0.6, 'sawtooth', 0.15, -180);
    noise(0.5, 0.4, 400);
  },
  // Lagerhallen-Gong für Rundenstart
  bell: () => {
    tone(660, 0.9, 'sine', 0.15);
    tone(990, 0.9, 'sine', 0.08);
  },
  horn: () => tone(180, 0.5, 'sawtooth', 0.12, 20),
};
