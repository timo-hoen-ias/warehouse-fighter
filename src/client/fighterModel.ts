import * as THREE from 'three';
import { type AnimKind, type CharacterDef, type MoveKey, getCharacter, moveLength } from '../shared/characters';
import type { Fighter } from '../shared/game';
import { type Look, type Stance, getLook } from './looks';
import { CHAR_ANIMS, type CharAnims } from './charAnims';

// Low-Poly-Lagerarbeiter aus Grundkörpern mit prozeduraler Animation.
// Modell blickt lokal nach +x; Gelenke drehen um die lokale z-Achse.

export interface Pose {
  hipY: number;
  /** Hüfte vor/zurück verschieben (Gewichtsverlagerung, Ausfallschritt) */
  hipX: number;
  /** Hüftdrehung um die Hochachse */
  hipTwist: number;
  lean: number;
  /** Oberkörperdrehung – bringt Kraft in Schläge */
  twist: number;
  head: number;
  armF: number;
  foreF: number;
  armB: number;
  foreB: number;
  legF: number;
  kneeF: number;
  legB: number;
  kneeB: number;
}

const POSE_KEYS = Object.keys({
  hipY: 0, hipX: 0, hipTwist: 0, lean: 0, twist: 0, head: 0, armF: 0, foreF: 0, armB: 0, foreB: 0, legF: 0, kneeF: 0, legB: 0, kneeB: 0,
} satisfies Pose) as (keyof Pose)[];

const HIP_HEIGHT = 0.95;
const UPPER_LEG = 0.45;
const LOWER_LEG = 0.45;
const UPPER_ARM = 0.3;
const LOWER_ARM = 0.3;
const GETUP_TICKS = 20;

function pose(p: Partial<Pose>): Pose {
  return {
    hipY: -0.05, hipX: 0, hipTwist: 0, lean: 0.1, twist: 0.15, head: 0,
    armF: 0.9, foreF: 1.6, armB: 0.5, foreB: 1.9, legF: 0.35, kneeF: 0.3, legB: -0.3, kneeB: 0.25,
    ...p,
  };
}

const P = {
  idle: pose({}),
  crouch: pose({ hipY: -0.42, lean: 0.35, legF: 1.35, kneeF: 2.1, legB: 0.5, kneeB: 2.2, armF: 1.0, foreF: 1.7 }),
  guard: pose({ lean: -0.1, twist: 0.3, armF: 1.3, foreF: 2.1, armB: 1.1, foreB: 2.2, head: -0.1 }),
  crouchGuard: pose({ hipY: -0.42, lean: 0.2, legF: 1.35, kneeF: 2.1, legB: 0.5, kneeB: 2.2, armF: 1.3, foreF: 2.1, armB: 1.1, foreB: 2.2 }),
  jump: pose({ hipY: 0, legF: 1.3, kneeF: 1.9, legB: 0.5, kneeB: 1.7, armF: 1.2, foreF: 1.2, armB: 0.2, foreB: 1.0 }),
  hitHigh: pose({ lean: -0.55, head: -0.6, twist: -0.4, armF: -0.2, foreF: 0.5, armB: -0.5, foreB: 0.4, legF: 0.45, kneeF: 0.2, legB: -0.45 }),
  hitMid: pose({ lean: 0.55, head: 0.35, hipX: -0.08, armF: 1.1, foreF: 1.9, armB: 0.9, foreB: 2.0, legF: 0.5, kneeF: 0.6, legB: -0.2, kneeB: 0.6, hipY: -0.12 }),
  hitLow: pose({ lean: 0.25, head: 0.15, hipY: -0.18, legF: 0.9, kneeF: 1.2, legB: -0.1, kneeB: 0.9, armF: 0.4, armB: 0.2 }),
  airborne: pose({ hipY: 0, lean: -1.1, head: -0.4, armF: 2.4, foreF: 0.4, armB: 2.7, foreB: 0.6, legF: 0.9, kneeF: 0.9, legB: 0.4, kneeB: 1.1 }),
  ko: pose({ hipY: -0.75, lean: -1.45, head: -0.2, twist: 0, armF: 2.6, foreF: 0.2, armB: 2.9, foreB: 0.3, legF: 0.3, kneeF: 0.1, legB: 0.1, kneeB: 0.4 }),
  win: pose({ lean: -0.05, head: -0.2, twist: 0, armF: 2.9, foreF: 0.3, armB: 2.6, foreB: 0.6, legF: 0.25, legB: -0.25 }),
  dash: pose({ lean: 0.5, twist: 0.1, hipY: -0.12, legF: 1.1, kneeF: 1.2, legB: -0.9, kneeB: 0.5, armF: 0.9, foreF: 1.9, armB: -0.3, foreB: 1.4 }),
  backdash: pose({ lean: -0.3, hipY: -0.1, legF: 0.8, kneeF: 0.4, legB: -0.1, kneeB: 0.9, armF: 1.3, foreF: 2.0 }),
};

type Limb = 'handF' | 'handB' | 'footF' | 'footB';
/** Ausholen → Treffer; `limb` ist das Körperteil, das die Schlagspur zieht. */
type Anim = { windup: Partial<Pose>; strike: Partial<Pose>; base?: Pose; limb?: Limb | null };

/** Haltung, Federung und Tempo je Kampfstil – jeder Kämpfer bewegt sich anders. */
const STANCES: Record<Stance, { idle: Partial<Pose>; guard: Partial<Pose>; bob: number; bobSpeed: number; sway: number; snap: number; stride: number }> = {
  brawler: { idle: {}, guard: {}, bob: 0.025, bobSpeed: 4, sway: 0.06, snap: 1, stride: 1 },
  boxer: {
    idle: { armF: 1.25, foreF: 2.15, armB: 1.0, foreB: 2.25, lean: 0.2, hipY: -0.1, legF: 0.45, kneeF: 0.5, kneeB: 0.45, head: 0.1 },
    guard: { armF: 1.45, foreF: 2.35, armB: 1.3, foreB: 2.4 },
    bob: 0.045, bobSpeed: 7.5, sway: 0.05, snap: 1.25, stride: 1.15,
  },
  heavy: {
    idle: { hipY: -0.12, lean: 0.18, legF: 0.5, kneeF: 0.45, legB: -0.45, kneeB: 0.35, armF: 0.7, foreF: 1.4, armB: 0.35, foreB: 1.6, twist: 0.1 },
    guard: { armF: 1.2, foreF: 1.9, armB: 1.0, foreB: 2.0, hipY: -0.14 },
    bob: 0.018, bobSpeed: 2.6, sway: 0.08, snap: 0.8, stride: 0.85,
  },
  upright: {
    idle: { lean: -0.05, head: -0.08, legF: 0.2, kneeF: 0.15, legB: -0.15, kneeB: 0.1, armF: 0.6, foreF: 2.2, armB: 0.2, foreB: 1.2, twist: 0.25 },
    guard: { armF: 1.25, foreF: 2.2, armB: 1.0, foreB: 2.1 },
    bob: 0.012, bobSpeed: 3, sway: 0.03, snap: 1.05, stride: 0.95,
  },
  nimble: {
    idle: { hipY: -0.08, lean: 0.25, legF: 0.55, kneeF: 0.6, legB: -0.35, kneeB: 0.55, armF: 1.0, foreF: 1.9, armB: 0.7, foreB: 2.0 },
    guard: { armF: 1.35, foreF: 2.2, armB: 1.2, foreB: 2.3 },
    bob: 0.05, bobSpeed: 9, sway: 0.1, snap: 1.2, stride: 1.2,
  },
  robot: {
    idle: { lean: 0.05, twist: 0, head: 0, armF: 0.9, foreF: 1.57, armB: 0.6, foreB: 1.57, legF: 0.25, kneeF: 0.2, legB: -0.25, kneeB: 0.2 },
    guard: { armF: 1.4, foreF: 2.0, armB: 1.3, foreB: 2.0 },
    bob: 0.01, bobSpeed: 12, sway: 0, snap: 1.4, stride: 0.9,
  },
};

/** Animationen der Signatur-Moves und Kombo-Abschlüsse (nach Animationstyp). */
const KIND_ANIMS: Record<AnimKind, Anim> = {
  grab: {
    windup: { armF: 1.0, foreF: 1.9, armB: 0.9, foreB: 2.0, lean: 0.05, hipY: -0.1 },
    strike: { armF: 1.65, foreF: 0.25, armB: 1.6, foreB: 0.35, lean: 0.5, hipX: 0.16, legF: 0.9, kneeF: 0.8, legB: -0.7 },
    limb: 'handF',
  },
  lasso: {
    windup: { armF: 2.9, foreF: 0.6, twist: 0.4, lean: -0.15 },
    strike: { armF: 1.5, foreF: 0.05, twist: -0.3, lean: 0.35, hipX: 0.1 },
    limb: 'handF',
  },
  charge: {
    windup: { lean: 0.15, hipY: -0.2, kneeF: 0.9, kneeB: 0.8, armF: 0.6, foreF: 2.3, armB: 0.5, foreB: 2.3, twist: 0.5 },
    strike: { lean: 0.95, twist: 0.25, armF: 0.4, foreF: 2.5, armB: 0.3, foreB: 2.5, legF: 1.15, kneeF: 1.0, legB: -1.0, kneeB: 0.3, hipX: 0.2, hipY: -0.12 },
    limb: null,
  },
  hop: {
    base: P.jump,
    windup: { legF: 1.7, kneeF: 2.4, lean: 0.1, armF: 2.0, armB: 1.6 },
    strike: { legF: 1.35, kneeF: 0.15, legB: -0.4, kneeB: 1.5, lean: -0.45, hipTwist: 0.4, armF: 2.4, armB: 0.8 },
    limb: 'footF',
  },
  flurry: { windup: { armF: 0.8, foreF: 2.2, armB: 0.7, foreB: 2.3, twist: 0.2 }, strike: { armF: 1.6, foreF: 0.05, twist: 0.45, lean: 0.3 }, limb: 'handF' },
  parry: {
    windup: { armF: 1.5, foreF: 2.5, armB: 1.3, foreB: 2.5, lean: -0.2, twist: 0.5, hipX: -0.06 },
    strike: { armF: 1.55, foreF: 2.6, armB: 1.35, foreB: 2.55, lean: -0.15, twist: 0.45, hipX: -0.04, head: -0.1 },
    limb: null,
  },
  uppercut: {
    windup: { hipY: -0.35, armF: -0.3, foreF: 1.8, lean: 0.4, legF: 1.0, kneeF: 1.3, legB: 0.1, kneeB: 1.0, twist: -0.3 },
    strike: { hipY: 0.12, armF: 2.95, foreF: 0.3, lean: -0.35, twist: 0.55, hipTwist: 0.3, legF: 0.2, kneeF: 0.05, legB: -0.25, kneeB: 0.1 },
    limb: 'handF',
  },
  poke: {
    windup: { armF: 0.55, foreF: 2.35, twist: -0.35, hipX: -0.06, lean: -0.05 },
    strike: { armF: 1.57, foreF: 0, lean: 0.55, twist: 0.65, hipX: 0.22, legF: 0.95, kneeF: 0.85, legB: -0.85, kneeB: 0.2 },
    limb: 'handF',
  },
  stomp: {
    windup: { legF: 1.9, kneeF: 1.9, lean: -0.25, armF: 1.7, armB: 1.6, foreF: 1.0, foreB: 1.0, hipY: 0.03 },
    strike: { legF: 0.65, kneeF: 0.1, hipY: -0.22, lean: 0.35, armF: 0.6, armB: 0.5, foreF: 1.8, foreB: 1.8 },
    limb: 'footF',
  },
  slide: {
    base: P.crouch,
    windup: { hipY: -0.3, lean: 0.25 },
    strike: { hipY: -0.68, lean: -0.95, legF: 1.5, kneeF: 0.05, legB: 0.9, kneeB: 1.7, armF: 2.4, foreF: 0.5, armB: 2.2, foreB: 0.6, head: 0.4 },
    limb: 'footF',
  },
  toss: {
    windup: { armF: -0.7, foreF: 0.5, lean: 0.25, hipY: -0.2, kneeF: 0.9, kneeB: 0.8 },
    strike: { armF: 1.25, foreF: 0.1, hipY: -0.38, lean: 0.65, legF: 1.15, kneeF: 1.35, legB: -0.4, kneeB: 1.2 },
    limb: 'handF',
  },
  smash: {
    windup: { armF: 3.0, foreF: 0.5, armB: 2.9, foreB: 0.5, lean: -0.35, hipY: 0.03, twist: 0 },
    strike: { armF: 1.0, foreF: 0.2, armB: 0.95, foreB: 0.2, lean: 0.85, hipY: -0.26, legF: 0.9, kneeF: 1.0, hipX: 0.12 },
    limb: 'handF',
  },
  hammer: {
    windup: { twist: 0.9, hipTwist: 0.35, armF: 1.2, armB: 1.3, foreF: 1.2, foreB: 1.2, lean: 0.05 },
    strike: { twist: -0.75, hipTwist: -0.4, armF: 1.6, armB: 1.55, foreF: 0.2, foreB: 0.2, lean: 0.45, hipX: 0.12 },
    limb: 'handB',
  },
  pull: {
    windup: { armF: 1.6, foreF: 0.1, lean: 0.45, hipX: 0.12, twist: 0.3 },
    strike: { armF: 0.55, foreF: 2.4, lean: -0.3, twist: 0.6, hipX: -0.1, armB: -0.2 },
    limb: 'handF',
  },
  spinKick: {
    windup: { legB: 0.9, kneeB: 2.0, twist: 0.9, hipTwist: 0.9, lean: 0.05 },
    strike: { legB: 2.25, kneeB: 0.05, lean: -0.6, hipTwist: -1.25, twist: -0.85, armB: -0.5, armF: 0.4, legF: 0.05, kneeF: 0.15 },
    limb: 'footB',
  },
  drill: {
    windup: { armF: 0.6, foreF: 2.2, twist: -0.2, lean: 0.05 },
    strike: { armF: 1.57, foreF: 0.05, lean: 0.4, twist: 0.35, hipX: 0.14, legF: 0.7, kneeF: 0.6, legB: -0.6 },
    limb: 'handF',
  },
};

/** Trefferglied der Standard-Moves für die Schlagspur. */
const LIMBS: Partial<Record<MoveKey, Limb>> = {
  light2: 'handB', heavy: 'handB', kick: 'footF', kick2: 'footB', low: 'footF', lowKick: 'footF',
  fwdKick: 'footF', air: 'footF', airKick: 'footF', launcher: 'handB',
};

/** Ausholen (windup) → Treffer (strike) für jeden Move. */
const ATTACKS: Partial<Record<MoveKey, Anim>> = {
  light: { windup: { armF: 0.7, foreF: 2.2, twist: -0.05 }, strike: { armF: 1.6, foreF: 0.05, lean: 0.25, twist: 0.45, hipTwist: 0.1 } },
  light2: {
    windup: { armB: 0.4, foreB: 2.3, twist: 0.35 },
    strike: { armB: 1.62, foreB: 0.05, twist: -0.55, hipTwist: -0.2, lean: 0.3, armF: 0.9, foreF: 2.3 },
  },
  finisher: {
    windup: { armF: 0.3, foreF: 1.5, twist: -0.7, lean: -0.05, hipX: -0.05 },
    strike: { armF: 1.5, foreF: 0.7, twist: 0.8, hipTwist: 0.3, lean: 0.4, hipX: 0.12, legF: 0.6, kneeF: 0.5 },
  },
  heavy: {
    windup: { armB: 0.2, foreB: 2.4, twist: 0.45, lean: -0.05, hipX: -0.05 },
    strike: { armB: 1.65, foreB: 0, twist: -0.65, hipTwist: -0.25, lean: 0.45, hipX: 0.14, legF: 0.65, kneeF: 0.5, legB: -0.55 },
  },
  kick: {
    windup: { legF: 1.2, kneeF: 2.1, lean: -0.1, hipTwist: 0.25 },
    strike: { legF: 1.55, kneeF: 0.05, lean: -0.4, hipTwist: 0.55, twist: -0.25, legB: -0.05, kneeB: 0.1, armF: 0.5, armB: -0.3 },
  },
  kick2: {
    windup: { legB: 0.9, kneeB: 2.0, hipTwist: -0.3 },
    strike: { legB: 2.1, kneeB: 0.05, lean: -0.55, hipTwist: -0.6, twist: 0.3, legF: 0.05, kneeF: 0.15, armB: -0.4 },
  },
  low: {
    base: P.crouch,
    windup: { legF: 1.1, kneeF: 2.0, hipTwist: 0.3 },
    strike: { hipY: -0.55, legF: 1.55, kneeF: 0.0, lean: 0.1, legB: 0.9, kneeB: 2.4, hipTwist: -0.4 },
  },
  lowLight: { base: P.crouch, windup: { armF: 0.8, foreF: 2.1 }, strike: { armF: 1.35, foreF: 0.1, twist: 0.4, lean: 0.45 } },
  lowKick: { base: P.crouch, windup: { legF: 1.0, kneeF: 2.2 }, strike: { legF: 1.45, kneeF: 0.1, hipY: -0.45, lean: 0.15 } },
  fwdLight: {
    windup: { armF: 0.5, foreF: 2.3, lean: 0 },
    strike: { armF: 1.62, foreF: 0, lean: 0.55, twist: 0.45, hipX: 0.22, legF: 0.95, kneeF: 0.9, legB: -0.8, kneeB: 0.2 },
  },
  fwdKick: { windup: { legF: 1.7, kneeF: 2.3, lean: -0.1 }, strike: { legF: 1.5, kneeF: 0, lean: -0.35, hipX: -0.06, armF: 0.6 } },
  overhead: {
    windup: { armF: 3.0, foreF: 0.4, armB: 2.9, foreB: 0.4, lean: -0.3, hipY: 0.02, twist: 0 },
    strike: { armF: 1.2, foreF: 0.2, armB: 1.1, foreB: 0.2, lean: 0.65, hipY: -0.18, legF: 0.75, kneeF: 0.8, hipX: 0.1 },
  },
  launcher: {
    windup: { hipY: -0.28, armB: -0.2, foreB: 1.6, lean: 0.25, legF: 0.85, kneeF: 1.0, legB: 0.1, kneeB: 0.9, twist: 0.3 },
    strike: { hipY: 0.06, armB: 2.7, foreB: 0.5, lean: -0.3, twist: -0.55, hipTwist: -0.2, legF: 0.3, kneeF: 0.1, legB: -0.3, kneeB: 0.1 },
  },
  air: {
    base: P.jump,
    windup: { legF: 1.4, kneeF: 2.2 },
    strike: { legF: 0.9, kneeF: 0.0, lean: -0.25, legB: 1.3, kneeB: 2.2, armF: 2.0, armB: 1.2 },
  },
  airKick: { base: P.jump, windup: { legF: 1.6, kneeF: 2.3, lean: 0.1 }, strike: { legF: 1.25, kneeF: 0, legB: -0.6, kneeB: 1.4, lean: -0.5, hipTwist: 0.4 } },
  special: {
    windup: { armF: -0.7, foreF: 1.0, armB: -0.9, foreB: 1.0, lean: -0.25, twist: 0.4 },
    strike: { armF: 1.55, foreF: 0.1, armB: 1.45, foreB: 0.2, lean: 0.35, twist: -0.2, legF: 0.6, kneeF: 0.4, legB: -0.5 },
  },
  rush: {
    windup: { lean: 0.1, hipY: -0.15, twist: 0.4, kneeF: 0.8, kneeB: 0.7 },
    strike: { lean: 0.8, twist: 0.7, armF: 0.3, foreF: 2.3, armB: -0.4, legF: 1.05, kneeF: 1.0, legB: -0.95, kneeB: 0.3, hipX: 0.15, hipY: -0.1 },
  },
  throw: {
    windup: { armF: 1.4, foreF: 0.6, armB: 1.3, foreB: 0.7, lean: 0.3 },
    strike: { armF: 2.8, foreF: 0.3, armB: 2.7, foreB: 0.3, lean: -0.4, twist: -0.5, hipTwist: -0.3 },
  },
};

function mix(a: Pose, b: Partial<Pose>, t: number): Pose {
  const out = { ...a };
  for (const k of POSE_KEYS) if (b[k] !== undefined) out[k] = a[k] + (b[k]! - a[k]) * t;
  return out;
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function animFor(def: CharacterDef, key: MoveKey): Anim {
  const kind = def.moves[key].anim;
  if (kind && (key === 'sig1' || key === 'sig2' || key === 'ender' || !ATTACKS[key])) return KIND_ANIMS[kind];
  const std = ATTACKS[key] ?? ATTACKS.light!;
  // Eigene Ausführung des Kämpfers (z. B. Gerds Gabelstoß mit beiden Armen)
  const own = CHAR_ANIMS[def.id]?.moves[key];
  return own ? { base: std.base, windup: own.windup, strike: own.strike, limb: own.limb === undefined ? std.limb : own.limb } : std;
}

const FALLBACK_ANIMS: CharAnims = { moves: {}, fidget: () => ({}), intro: () => ({}), win: () => ({}), walk: 'normal', flinch: 1 };

/** Sanftes Ein- und Ausblenden einer Geste über `len` Ticks. */
function envelope(n: number, len: number) {
  const k = n / len;
  return k <= 0 || k >= 1 ? 0 : Math.min(1, k * 5, (1 - k) * 5);
}

function targetPose(f: Fighter, def: CharacterDef, t: number, look: Look, intro: boolean): Pose {
  const n = f.statusTime;
  const st = STANCES[look.stance];
  const ca = CHAR_ANIMS[def.id] ?? FALLBACK_ANIMS;
  const idle = mix(P.idle, st.idle, 1);
  switch (f.status) {
    case 'walk': {
      // Gangart je Kämpfer: watscheln, federn, marschieren, schleichen
      const tw = ca.walk === 'march' ? Math.floor(t * 10) / 10 : t;
      const ph = tw * 9 * (def.walkSpeed / 0.06) * st.stride;
      const s = Math.sin(ph) * f.facing * Math.sign(f.vx || 1);
      const g = { waddle: [0.35, 0.03, 0.22, 0.12], bounce: [0.5, 0.075, 0.1, 0.02], march: [0.55, 0.01, 0.05, 0], prowl: [0.4, 0.02, 0.18, 0.04], normal: [0.45, 0.035, 0.08, 0.02] }[ca.walk];
      const [stride, bob, hipSway, leanSway] = g;
      return mix(idle, {
        legF: 0.35 + s * stride, legB: -0.3 - s * stride,
        kneeF: 0.35 + Math.max(0, -s) * (ca.walk === 'march' ? 1.0 : 0.6), kneeB: 0.3 + Math.max(0, s) * (ca.walk === 'march' ? 1.0 : 0.6),
        hipY: idle.hipY - Math.abs(Math.cos(ph)) * bob,
        twist: idle.twist + s * 0.12, hipTwist: -s * hipSway,
        lean: idle.lean + Math.cos(ph * 2) * leanSway,
        armB: idle.armB - s * (ca.walk === 'march' ? 0.5 : 0.2), foreF: idle.foreF + s * 0.15,
        armF: ca.walk === 'march' ? idle.armF + s * 0.4 : idle.armF,
      }, 1);
    }
    case 'dash': {
      const ph = t * 16;
      return mix(P.dash, { legF: 1.1 + Math.sin(ph) * 0.4, legB: -0.9 - Math.sin(ph) * 0.4 }, 1);
    }
    case 'backdash':
      return P.backdash;
    case 'crouch':
      return f.guarding ? P.crouchGuard : look.stance === 'boxer' || look.stance === 'nimble' ? mix(P.crouch, { armF: 1.3, foreF: 2.2 }, 1) : P.crouch;
    case 'jump':
      return f.vy > 0.05 ? mix(P.jump, { legF: 0.8, kneeF: 1.0, legB: 0.1, kneeB: 0.8 }, 0.6) : P.jump;
    case 'hitstun': {
      if (f.launched || f.y > 0.05) return mix(P.airborne, { lean: -1.1 - Math.min(0.5, n * 0.02) }, 1);
      // Schwergewichte wanken weniger, Leichtgewichte fliegen fast aus den Schuhen
      const base = mix(idle, f.lastHit === 'high' ? P.hitHigh : f.lastHit === 'low' ? P.hitLow : P.hitMid, ca.flinch);
      // Nach dem Treffer langsam zurück in die Grundhaltung
      return mix(base, idle, Math.max(0, Math.min(1, (n - f.stun * 0.5) / Math.max(1, f.stun * 0.5))));
    }
    case 'blockstun':
      return mix(f.crouching ? P.crouchGuard : mix(P.guard, st.guard, 1), { hipX: -0.06 - Math.max(0, 1 - n / 6) * 0.08, lean: f.crouching ? 0.1 : -0.2 }, 1);
    case 'down':
    case 'ko':
      return P.ko;
    case 'getup': {
      // erst auf die Knie, dann hoch in die Kampfhaltung
      const k = n / GETUP_TICKS;
      return k < 0.6 ? mix(P.ko, P.crouch, easeOut(k / 0.6)) : mix(P.crouch, idle, easeOut((k - 0.6) / 0.4));
    }
    case 'win':
      // eigene Siegerpose
      return mix(idle, ca.win(t, n), Math.min(1, n / 12));
    case 'attack': {
      const m = def.moves[f.move!];
      const anim = animFor(def, f.move!);
      const kind = m.anim;
      const base = anim.base ?? (f.y > 0.05 && (f.move === 'air' || f.move === 'airKick') ? P.jump : idle);
      const windup = mix(base, anim.windup, 1);
      let strike = mix(windup, anim.strike, 1);
      // Mehrfachtreffer: Fäuste wechseln sich ab bzw. der Bohrer vibriert
      if ((kind === 'flurry' || kind === 'drill') && n >= m.startup && n < m.startup + m.active) {
        if (kind === 'flurry' && Math.floor((n - m.startup) / 2) % 2 === 1) {
          strike = mix(windup, { armB: 1.62, foreB: 0.05, armF: 0.9, foreF: 2.3, twist: -0.45, lean: 0.3 }, 1);
        }
        if (kind === 'drill') strike = mix(strike, { twist: strike.twist + Math.sin(n * 2.7) * 0.18, foreF: Math.abs(Math.sin(n * 1.9)) * 0.25 }, 1);
        return strike;
      }
      // Ausholen mit leichtem Zurückziehen (Antizipation), Schlag schnappt durch, Erholung federt aus
      if (n < m.startup) return mix(base, anim.windup, easeOut(n / m.startup));
      if (n < m.startup + m.active + 3) return mix(windup, anim.strike, Math.min(1, (n - m.startup + 1) / 2));
      const r = (n - m.startup - m.active - 3) / Math.max(1, moveLength(m) - m.startup - m.active - 3);
      return mix(strike, base, easeOut(Math.min(1, r)));
    }
    default: {
      if (f.guarding) return mix(P.guard, st.guard, 1);
      // Rundeneröffnung: eigene Intro-Pose, kurz vor „Schichtbeginn“ in die Kampfhaltung
      if (intro && n < 95) return mix(idle, ca.intro(t, n), Math.min(1, (95 - n) / 15));
      // Leerlauf-Geste, wenn man eine Weile still steht (alle 4 Sekunden für knapp eine Sekunde)
      if (f.status === 'idle' && n > 150) {
        const k = envelope((n - 150) % 240, 55);
        if (k > 0) return mix(idle, ca.fidget(t, n), k);
      }
      // Kampfhaltung: atmen, Gewicht verlagern, wippen – Tempo und Ausschlag je nach Kampfstil
      const tt = look.stance === 'robot' ? Math.floor(t * 8) / 8 : t;
      const b = Math.sin(tt * st.bobSpeed) * st.bob;
      const sway = Math.sin(tt * 1.7) * (st.sway / 0.06);
      return mix(idle, { hipY: idle.hipY + b, foreF: idle.foreF + b * 4, hipX: sway * 0.03, twist: idle.twist + sway * 0.06, head: idle.head + sway * 0.04 }, 1);
    }
  }
}

function limb(len: number, radius: number, mat: THREE.Material) {
  const pivot = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(radius, len - radius * 2, 4, 10);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -len / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

/** Leuchtende Schlagspur hinter Faust oder Fuß (Band aus den letzten Positionen). */
class SwingTrail {
  static readonly N = 10;
  readonly mesh: THREE.Mesh;
  private tips: THREE.Vector3[] = [];
  private bases: THREE.Vector3[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private color: THREE.Color;

  constructor(color: number) {
    const n = SwingTrail.N;
    this.color = new THREE.Color(color);
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** `tip`/`base`: Weltpositionen von Glied-Ende und -Mitte, oder null = Spur verblasst. */
  push(tip: THREE.Vector3 | null, base: THREE.Vector3 | null) {
    if (tip && base) {
      this.tips.unshift(tip.clone());
      this.bases.unshift(base.clone());
    } else if (this.tips.length) {
      this.tips.pop();
      this.bases.pop();
    }
    if (this.tips.length > SwingTrail.N) {
      this.tips.pop();
      this.bases.pop();
    }
    const n = SwingTrail.N;
    const count = this.tips.length;
    for (let i = 0; i < n; i++) {
      const k = Math.min(i, Math.max(0, count - 1));
      const tp = this.tips[k];
      const bp = this.bases[k];
      const a = count > 1 && i < count ? (1 - i / count) * 0.85 : 0;
      for (let j = 0; j < 2; j++) {
        const v = j === 0 ? tp : bp;
        const o = (i * 2 + j) * 3;
        this.pos[o] = v ? v.x : 0;
        this.pos[o + 1] = v ? v.y : -10;
        this.pos[o + 2] = v ? v.z : 0;
        const c = (i * 2 + j) * 4;
        this.col[c] = this.color.r;
        this.col[c + 1] = this.color.g;
        this.col[c + 2] = this.color.b;
        this.col[c + 3] = j === 0 ? a : a * 0.15;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.mesh.visible = count > 1;
  }
}

export class FighterModel {
  readonly root = new THREE.Group();
  /** Zusatzversatz für den Finisher „gegen die Wand“ (vom Renderer gesteuert). */
  readonly offset = new THREE.Vector3();
  spin = 0;
  private stumps: THREE.Mesh[] = [];
  private orient = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private headPivot = new THREE.Group();
  private j: Record<'armF' | 'foreF' | 'armB' | 'foreB' | 'legF' | 'kneeF' | 'legB' | 'kneeB', THREE.Group>;
  private current: Pose = { ...P.idle };
  private velocity: Pose = pose({ hipY: 0, lean: 0, twist: 0, armF: 0, foreF: 0, armB: 0, foreB: 0, legF: 0, kneeF: 0, legB: 0, kneeB: 0 });
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private flash = 0;
  private flashShown = -1;
  readonly def: CharacterDef;
  readonly look: Look;
  /** Schlagspur – der Renderer hängt sie in die Szene. */
  readonly trail: SwingTrail;
  private hands: THREE.Object3D[] = [];
  private feet: THREE.Object3D[] = [];
  private ponytail: THREE.Object3D | null = null;
  private beacon: THREE.MeshStandardMaterial | null = null;
  private tmpTarget = new THREE.Vector3();
  private tmpTip = new THREE.Vector3();
  private tmpBase = new THREE.Vector3();

  constructor(charId: string) {
    const def = (this.def = getCharacter(charId));
    const look = (this.look = getLook(charId));
    this.trail = new SwingTrail(look.trail);
    const c = def.colors;
    const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
      this.flashMats.push(m);
      return m;
    };
    const skin = def.robot ? std(c.skin, { metalness: 0.8, roughness: 0.3 }) : std(c.skin);
    const shirt = std(c.shirt);
    const pants = std(c.pants);
    const vest = std(c.vest, { roughness: 0.5 });
    const reflect = std(0xe0e0e0, { emissive: 0x888888, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3 });
    const helmet = std(c.helmet, { roughness: 0.35 });
    const boot = std(0x2a2118);

    const bulk = def.build;
    const metal = (color: number) => std(color, { metalness: 0.8, roughness: 0.3 });

    this.root.add(this.orient);
    this.orient.add(this.hips);
    this.hips.position.y = HIP_HEIGHT;
    this.hips.scale.set(1, 1, bulk);

    // Becken
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.4), pants);
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    // Oberkörper
    this.hips.add(this.torso);
    this.torso.position.y = 0.05;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.28 * bulk, 0.58, 0.46), shirt);
    chest.position.y = 0.32;
    chest.castShadow = true;
    this.torso.add(chest);
    const vestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.31 * bulk, 0.5, 0.49), vest);
    vestMesh.position.y = 0.3;
    vestMesh.castShadow = true;
    this.torso.add(vestMesh);
    for (const y of [0.18, 0.36]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.32 * bulk, 0.045, 0.5), reflect);
      stripe.position.y = y;
      this.torso.add(stripe);
    }
    if (look.belly > 0) {
      const belly = new THREE.Mesh(new THREE.SphereGeometry(look.belly, 14, 10), vest);
      belly.scale.set(0.9, 1, 1.25);
      belly.position.set(0.1 * bulk, 0.16, 0);
      belly.castShadow = true;
      this.torso.add(belly);
    }
    this.buildBodyExtras(look, bulk, { shirt, pants, vest, skin, metal, std });

    // Kopf mit Helm
    this.torso.add(this.headPivot);
    this.headPivot.position.y = 0.62;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin);
    neck.position.y = 0.03;
    this.headPivot.add(neck);
    const head = new THREE.Mesh(def.robot ? new THREE.BoxGeometry(0.24, 0.24, 0.26) : new THREE.SphereGeometry(0.13, 16, 12), skin);
    head.position.y = 0.17;
    if (!def.robot) head.scale.set(1, 1.1, 0.95);
    head.castShadow = true;
    this.headPivot.add(head);
    this.buildHat(def, helmet);
    this.buildHead(look, def, std);
    const eyes = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, def.robot ? 0.05 : 0.025, def.robot ? 0.2 : 0.14),
      new THREE.MeshBasicMaterial({ color: def.robot ? 0x00e5ff : 0x111111 }),
    );
    eyes.position.set(0.125, 0.18, 0);
    this.headPivot.add(eyes);
    if (def.mustache) {
      const stache = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.12), new THREE.MeshStandardMaterial({ color: 0x5a3a20 }));
      stache.position.set(0.13, 0.11, 0);
      this.headPivot.add(stache);
    }

    // Arme
    const mkArm = (z: number) => {
      const upper = limb(UPPER_ARM, 0.06 * bulk, shirt);
      upper.position.set(0, 0.55, z);
      this.torso.add(upper);
      const fore = limb(LOWER_ARM, 0.05 * bulk, skin);
      fore.position.y = -UPPER_ARM;
      upper.add(fore);
      const hand = new THREE.Group();
      hand.position.y = -LOWER_ARM;
      fore.add(hand);
      if (look.extras.includes('claws')) {
        // Greifzange statt Hand
        const m = metal(look.gloves);
        const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), m);
        hand.add(palm);
        for (const z of [-0.035, 0.035]) {
          const finger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.025), m);
          finger.position.set(0.02, -0.07, z);
          finger.rotation.z = z > 0 ? 0.25 : -0.25;
          hand.add(finger);
        }
      } else {
        const glove = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), std(look.gloves));
        glove.castShadow = true;
        hand.add(glove);
        // Stulpe
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058 * bulk, 0.062 * bulk, 0.05, 10), std(look.gloves, { roughness: 0.9 }));
        cuff.position.y = 0.06;
        hand.add(cuff);
      }
      this.hands.push(hand);
      return { upper, fore, hand };
    };
    const armF = mkArm(0.3 * bulk);
    const armB = mkArm(-0.3 * bulk);

    // Beine
    const mkLeg = (z: number) => {
      const upper = limb(UPPER_LEG, 0.085 * bulk, pants);
      upper.position.set(0, -0.05, z);
      this.hips.add(upper);
      const lower = limb(LOWER_LEG, 0.07 * bulk, pants);
      lower.position.y = -UPPER_LEG;
      upper.add(lower);
      const tracks = look.extras.includes('tracks');
      const foot = new THREE.Mesh(tracks ? new THREE.BoxGeometry(0.34, 0.11, 0.16) : new THREE.BoxGeometry(0.24, 0.08, 0.12), tracks ? std(0x263238) : boot);
      foot.position.set(0.05, -LOWER_LEG, 0);
      foot.castShadow = true;
      lower.add(foot);
      if (tracks) {
        // Kettenlaufwerk mit Rollen
        for (const x of [-0.11, 0, 0.11]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.17, 10), metal(0x90a4ae));
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(x, 0, 0);
          foot.add(wheel);
        }
      }
      if (look.extras.includes('kneepads')) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.13), std(0x37474f, { roughness: 0.5 }));
        pad.position.set(0.075 * bulk, -0.04, 0);
        lower.add(pad);
      }
      this.feet.push(foot);
      return { upper, lower };
    };
    const legF = mkLeg(0.12);
    const legB = mkLeg(-0.12);

    this.j = {
      armF: armF.upper, foreF: armF.fore, armB: armB.upper, foreB: armB.fore,
      legF: legF.upper, kneeF: legF.lower, legB: legB.upper, kneeB: legB.lower,
    };

    this.buildProp(def, armF.hand);

    // Stümpfe für den Finisher – erst sichtbar, wenn Kopf oder Arm abfliegen
    const goreMat = new THREE.MeshStandardMaterial({ color: def.robot ? 0x222222 : 0x8b0000, roughness: 0.4 });
    const neckStump = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 10), goreMat);
    neckStump.position.y = 0.6;
    const shoulderStump = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), goreMat);
    shoulderStump.position.set(0, 0.55, 0.3 * bulk);
    for (const st of [neckStump, shoulderStump]) {
      st.visible = false;
      this.torso.add(st);
      this.stumps.push(st);
    }
  }

  /** Frisur, Bart, Brille und Kopf-Ausrüstung. */
  private buildHead(look: Look, def: CharacterDef, std: (c: number, e?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial) {
    const hp = this.headPivot;
    const hair = std(look.hairColor, { roughness: 0.9 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z = 0, parent: THREE.Object3D = hp) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // Haube über dem Hinterkopf, vorne offen fürs Gesicht
    const cap = (r: number, thetaLen: number) => new THREE.SphereGeometry(r, 16, 10, Math.PI + 0.95, Math.PI * 2 - 1.9, 0, thetaLen);
    switch (look.hair) {
      case 'ponytail': {
        if (def.hat === 'none') add(cap(0.138, Math.PI * 0.55), hair, 0, 0.18);
        const pivot = new THREE.Group();
        pivot.position.set(-0.13, 0.22, 0);
        hp.add(pivot);
        add(new THREE.SphereGeometry(0.035, 8, 6), hair, 0, 0, 0, pivot);
        const tail = add(new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), hair, -0.03, -0.13, 0, pivot);
        tail.rotation.z = -0.25;
        this.ponytail = pivot;
        break;
      }
      case 'bun':
        add(cap(0.138, Math.PI * 0.6), hair, 0, 0.18);
        add(new THREE.SphereGeometry(0.065, 12, 8), hair, -0.08, 0.3);
        break;
      case 'bob': {
        const b = add(cap(0.15, Math.PI * 0.7), hair, -0.01, 0.17);
        b.scale.y = 1.15;
        break;
      }
      case 'messy':
        // Pony schaut unter der Mütze hervor
        for (let i = 0; i < 4; i++) {
          const strand = add(new THREE.BoxGeometry(0.03, 0.06, 0.05), hair, 0.12, 0.23 - (i % 2) * 0.015, -0.075 + i * 0.05);
          strand.rotation.z = -0.5 + (i % 2) * 0.3;
        }
        break;
      case 'dreads':
        add(cap(0.14, Math.PI * 0.5), hair, 0, 0.18);
        for (let i = 0; i < 7; i++) {
          const a = Math.PI * 0.6 + (i / 6) * Math.PI * 0.8;
          const d = add(new THREE.CapsuleGeometry(0.022, 0.16, 3, 6), hair, Math.cos(a) * 0.12, 0.12, Math.sin(a) * 0.12);
          d.rotation.x = Math.sin(a) * 0.3;
          d.rotation.z = -Math.cos(a) * 0.3;
        }
        break;
    }
    if (look.beard) {
      const color = look.beard === 'frost' ? 0xe0f7fa : look.beard === 'stubble' ? 0x3e2723 : look.hairColor;
      const m = std(color, { roughness: 1, ...(look.beard === 'frost' ? { emissive: 0x335566 } : {}) });
      if (look.beard === 'stubble') add(new THREE.BoxGeometry(0.03, 0.07, 0.17), m, 0.115, 0.08);
      else {
        const beard = add(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), m, 0.04, 0.13);
        beard.scale.set(1, 1.1, 1.05);
        if (look.beard === 'frost') {
          for (const z of [-0.05, 0, 0.05]) {
            const icicle = add(new THREE.ConeGeometry(0.015, 0.06, 5), std(0xb3e5fc, { transparent: true, opacity: 0.8 }), 0.09, 0.02, z);
            icicle.rotation.z = Math.PI;
          }
        }
      }
    }
    if (look.glasses) {
      const frame = std(look.glasses === 'sun' ? 0x111111 : 0x5d4037, { metalness: 0.4 });
      if (look.glasses === 'sun') {
        add(new THREE.BoxGeometry(0.02, 0.045, 0.2), std(0x101010, { metalness: 0.9, roughness: 0.1 }), 0.135, 0.19);
      } else {
        for (const z of [-0.05, 0.05]) {
          const ring = add(new THREE.TorusGeometry(0.032, 0.007, 6, 14), frame, 0.13, 0.19, z);
          ring.rotation.y = Math.PI / 2;
        }
        add(new THREE.BoxGeometry(0.01, 0.008, 0.04), frame, 0.135, 0.195);
        if (look.extras.includes('glassesChain')) {
          const chain = add(new THREE.TorusGeometry(0.11, 0.004, 4, 20, Math.PI), std(0xffd54f, { metalness: 1 }), 0.03, 0.12);
          chain.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        }
      }
    }
    if (look.extras.includes('earmuffs')) {
      for (const z of [-0.14, 0.14]) {
        const muff = add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), std(0xff3d00), 0, 0.17, z);
        muff.rotation.x = Math.PI / 2;
      }
    }
    if (look.extras.includes('headset')) {
      const m = std(0x212121);
      const cup = add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10), m, 0, 0.17, 0.135);
      cup.rotation.x = Math.PI / 2;
      const boom = add(new THREE.BoxGeometry(0.13, 0.01, 0.01), m, 0.07, 0.11, 0.13);
      boom.rotation.y = 0.35;
      add(new THREE.SphereGeometry(0.015, 6, 4), std(0x00e676, { emissive: 0x00e676, emissiveIntensity: 1 }), 0.13, 0.1, 0.1);
    }
    if (look.extras.includes('headband')) {
      const band = add(new THREE.TorusGeometry(0.135, 0.018, 6, 20), std(0x2e7d32), 0, 0.23);
      band.rotation.x = Math.PI / 2;
    }
    if (look.extras.includes('beacon')) {
      this.beacon = std(0xff6d00, { emissive: 0xff6d00, emissiveIntensity: 1, transparent: true, opacity: 0.9 });
      add(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 10), this.beacon, 0, 0.33);
    }
  }

  /** Kleidung und Ausrüstung am Körper. */
  private buildBodyExtras(
    look: Look,
    bulk: number,
    m: {
      shirt: THREE.Material;
      pants: THREE.Material;
      vest: THREE.Material;
      skin: THREE.Material;
      metal: (c: number) => THREE.Material;
      std: (c: number, e?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
    },
  ) {
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.torso) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const ex = look.extras;
    if (ex.includes('shoulderPads')) for (const z of [-0.27, 0.27]) add(new THREE.SphereGeometry(0.1 * bulk, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.vest, 0, 0.56, z * bulk);
    if (ex.includes('apron')) {
      const apron = add(new THREE.BoxGeometry(0.02, 0.5, 0.36), m.std(0x8d6e63, { roughness: 1 }), 0.165 * bulk, 0.02, 0);
      apron.rotation.z = -0.05;
      add(new THREE.BoxGeometry(0.022, 0.1, 0.14), m.std(0x6d4c41), 0.17 * bulk, -0.05, 0.06); // Tasche
    }
    if (ex.includes('beltTape')) {
      const roll = add(new THREE.TorusGeometry(0.06, 0.025, 8, 14), m.std(0xc9a46a), 0, -0.02, 0.22 * bulk, this.hips);
      roll.rotation.y = Math.PI / 2;
    }
    if (ex.includes('badge') || ex.includes('lanyard')) {
      const cord = add(new THREE.TorusGeometry(0.13, 0.006, 4, 18, Math.PI), m.std(ex.includes('badge') ? 0x1e88e5 : 0xd81b60), 0.07, 0.48, 0);
      cord.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(0.01, 0.09, 0.065), m.std(0xffffff, { emissive: 0x222222 }), 0.19 * bulk, 0.32, 0.02);
    }
    if (ex.includes('hood')) add(new THREE.TorusGeometry(0.11, 0.045, 8, 14, Math.PI), m.shirt, -0.08, 0.6, 0).rotation.set(Math.PI / 2, 0, Math.PI / 2);
    if (ex.includes('furCollar')) {
      const fur = add(new THREE.TorusGeometry(0.12, 0.05, 8, 16), m.std(0xeceff1, { roughness: 1 }), 0, 0.6, 0);
      fur.rotation.x = Math.PI / 2;
    }
    if (ex.includes('toolbelt')) {
      const belt = add(new THREE.BoxGeometry(0.3 * bulk, 0.06, 0.44), m.std(0x5d4037), 0, 0.06, 0, this.hips);
      belt.scale.set(1, 1, 1.02);
      for (const z of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.08, 0.1, 0.06), m.std(0x795548), 0.05, 0.0, z, this.hips);
    }
    if (ex.includes('flannel')) {
      // Karohemd: dunkle Streifen auf der Brust
      for (const y of [0.1, 0.26, 0.42]) add(new THREE.BoxGeometry(0.285 * bulk, 0.03, 0.465), m.std(0x3e2723), 0, y, 0);
    }
    if (ex.includes('chestPanel')) {
      add(new THREE.BoxGeometry(0.02, 0.18, 0.24), m.std(0x263238, { metalness: 0.6 }), 0.16 * bulk, 0.34, 0);
      [0x00e676, 0xffea00, 0xff1744].forEach((c, i) => add(new THREE.BoxGeometry(0.022, 0.035, 0.035), m.std(c, { emissive: c, emissiveIntensity: 1.2 }), 0.17 * bulk, 0.39, -0.07 + i * 0.07));
    }
  }

  private buildHat(def: CharacterDef, mat: THREE.Material) {
    const add = (geo: THREE.BufferGeometry, x: number, y: number, m = mat) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, 0);
      mesh.castShadow = true;
      this.headPivot.add(mesh);
      return mesh;
    };
    switch (def.hat) {
      case 'helmet':
        add(new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.21);
        add(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 16), 0.03, 0.21);
        break;
      case 'cap':
        add(new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.22);
        add(new THREE.BoxGeometry(0.14, 0.015, 0.2), 0.15, 0.225);
        break;
      case 'beanie': {
        const b = add(new THREE.SphereGeometry(0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 0.2);
        b.scale.y = 1.15;
        add(new THREE.SphereGeometry(0.04, 8, 6), 0, 0.38);
        break;
      }
      case 'none':
        if (def.robot) {
          add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), -0.03, 0.38);
          add(new THREE.SphereGeometry(0.03, 8, 6), -0.03, 0.49, new THREE.MeshBasicMaterial({ color: 0xff1744 }));
        }
        break;
    }
  }

  private buildProp(def: CharacterDef, hand: THREE.Object3D) {
    const m = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });
    const item = new THREE.Group();
    switch (def.prop) {
      case 'scanner': {
        item.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), m(0x222222)));
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.05), m(0xff0000, { emissive: 0xff0000, emissiveIntensity: 2 }));
        lens.position.x = 0.085;
        item.add(lens);
        item.position.set(0.05, -0.04, 0.03);
        item.rotation.z = Math.PI / 2;
        break;
      }
      case 'tape':
        item.add(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 8, 16), m(0xc9a46a, { roughness: 0.4 })));
        item.position.set(0, -0.03, 0.06);
        break;
      case 'clipboard': {
        item.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.22), m(0x8d6e63)));
        const paper = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.26, 0.19), m(0xffffff));
        paper.position.y = -0.01;
        item.add(paper);
        item.position.set(0.02, -0.1, 0.04);
        break;
      }
      case 'mug': {
        item.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.11, 12), m(0xffffff)));
        const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.005, 12), m(0x4e342e));
        coffee.position.y = 0.055;
        item.add(coffee);
        item.position.set(0.02, 0, 0.06);
        break;
      }
      case 'tablet': {
        item.add(new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.26, 0.18), m(0x212121)));
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.22, 0.15), m(0x4fc3f7, { emissive: 0x4fc3f7, emissiveIntensity: 1 }));
        item.add(screen);
        item.position.set(0.03, -0.08, 0.04);
        break;
      }
      case 'wrench': {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.02), m(0x90a4ae, { metalness: 0.8, roughness: 0.3 }));
        handle.position.y = -0.1;
        item.add(handle);
        const head = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.015, 6, 12, Math.PI * 1.5), m(0x90a4ae, { metalness: 0.8, roughness: 0.3 }));
        head.position.y = -0.27;
        item.add(head);
        item.position.set(0.02, 0, 0.04);
        break;
      }
      case 'none':
        return;
    }
    hand.add(item);
  }

  /** Löst Kopf bzw. vorderen Arm vom Körper; der Renderer übernimmt das Teil in die Szene. */
  detach(part: 'head' | 'arm'): THREE.Object3D {
    const obj = part === 'head' ? this.headPivot : this.j.armF;
    this.stumps[part === 'head' ? 0 : 1].visible = true;
    return obj;
  }

  /** Weltposition von Hals bzw. Schulter (für den Blutstrahl). */
  stumpPosition(part: 'head' | 'arm'): THREE.Vector3 {
    return this.stumps[part === 'head' ? 0 : 1].getWorldPosition(new THREE.Vector3());
  }

  hitFlash() {
    this.flash = 1;
  }

  /** Liegt gerade eine aktive Schlagphase an? Dann zieht das Trefferglied eine Spur. */
  private strikeLimb(f: Fighter): Limb | null {
    if (f.status !== 'attack' || !f.move) return null;
    const m = this.def.moves[f.move];
    if (m.projectile || m.parry || m.grab) return null;
    const n = f.statusTime;
    if (n < m.startup - 2 || n > m.startup + m.active + 2) return null;
    const anim = animFor(this.def, f.move);
    if (anim.limb === null) return null;
    let limb = anim.limb ?? LIMBS[f.move] ?? 'handF';
    if (m.anim === 'flurry' && Math.floor((n - m.startup) / 2) % 2 === 1) limb = 'handB';
    return limb;
  }

  /** `smooth`: Online-Snapshots kommen mit 30 Hz – Position weich nachziehen. */
  update(f: Fighter, time: number, dt: number, smooth = false, intro = false) {
    const target = this.tmpTarget.set(f.x, f.y, 0).add(this.offset);
    if (smooth && this.root.position.distanceTo(target) < 1.5) {
      this.root.position.lerp(target, 1 - Math.pow(0.000001, dt));
    } else {
      this.root.position.copy(target);
    }
    this.root.rotation.x = this.spin;
    // 3/4-Ansicht zur Kamera, bei Blick nach links gespiegelt
    const h = this.look.height;
    this.orient.scale.set(f.facing * h, h, h);
    this.orient.rotation.y = -0.35 * f.facing;

    // Gelenke folgen der Zielpose als gedämpfte Federn – gibt Schwung und leichtes Nachfedern.
    // Der Kampfstil bestimmt, wie zackig: Roboter schnappt hart, Schwergewichte schwingen nach.
    const goal = targetPose(f, this.def, time, this.look, intro);
    const snap = STANCES[this.look.stance].snap;
    const robot = this.look.stance === 'robot';
    const stiffness = (f.status === 'attack' ? 1100 : f.status === 'hitstun' ? 1400 : f.status === 'ko' || f.status === 'down' ? 120 : 320) * snap;
    const damping = 2 * Math.sqrt(stiffness) * (robot ? 1 : f.status === 'attack' ? 0.7 : 0.8);
    // Große Zeitsprünge (Tab im Hintergrund) begrenzen, sonst explodiert die Feder
    const sdt = Math.min(dt, 1 / 20);
    const steps = Math.max(1, Math.ceil(sdt / (1 / 120)));
    const hs = sdt / steps;
    for (let i = 0; i < steps; i++) {
      for (const key of POSE_KEYS) {
        const v = this.velocity[key] + ((goal[key] - this.current[key]) * stiffness - this.velocity[key] * damping) * hs;
        this.velocity[key] = v;
        this.current[key] += v * hs;
      }
    }

    const p = this.current;
    this.hips.position.y = HIP_HEIGHT + p.hipY;
    this.hips.position.x = p.hipX;
    this.hips.rotation.y = p.hipTwist;
    this.hips.rotation.z = -p.lean * 0.3;
    this.torso.rotation.y = p.twist - p.hipTwist * 0.5;
    this.torso.rotation.z = -p.lean * 0.7;
    this.headPivot.rotation.z = -p.head;
    this.j.armF.rotation.z = p.armF;
    this.j.foreF.rotation.z = p.foreF;
    this.j.armB.rotation.z = p.armB;
    this.j.foreB.rotation.z = p.foreB;
    // Beine gegen die Hüftneigung ausgleichen, damit die Füße am Boden bleiben
    this.j.legF.rotation.z = p.legF + p.lean * 0.3;
    this.j.kneeF.rotation.z = -p.kneeF;
    this.j.legB.rotation.z = p.legB + p.lean * 0.3;
    this.j.kneeB.rotation.z = -p.kneeB;

    // Pferdeschwanz schwingt mit der Bewegung
    if (this.ponytail) this.ponytail.rotation.z = 0.25 - p.lean * 0.6 + Math.sin(time * 5) * 0.08 - Math.min(0.6, Math.abs(f.vx) * 6);
    // Rundumleuchte des Roboters
    if (this.beacon) this.beacon.emissiveIntensity = 0.4 + Math.max(0, Math.sin(time * 8)) * 2.2;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 20);
    }
    // Materialien nur anfassen, wenn sich der Blitz geändert hat
    const e = this.flash;
    if (e !== this.flashShown) {
      for (const m of this.flashMats) {
        if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
        if (e > 0) m.emissive.setRGB(e, e * 0.9, e * 0.7);
        else m.emissive.setHex(m.userData.baseEmissive);
      }
      this.flashShown = e;
    }

    // Schlagspur
    const limb = this.strikeLimb(f);
    if (limb) {
      this.root.updateMatrixWorld(true);
      const [tipObj, baseObj] =
        limb === 'handF' ? [this.hands[0], this.j.foreF] : limb === 'handB' ? [this.hands[1], this.j.foreB] : limb === 'footF' ? [this.feet[0], this.j.kneeF] : [this.feet[1], this.j.kneeB];
      tipObj.getWorldPosition(this.tmpTip);
      baseObj.getWorldPosition(this.tmpBase);
      this.tmpBase.lerp(this.tmpTip, 0.45);
      this.trail.push(this.tmpTip, this.tmpBase);
    } else {
      this.trail.push(null, null);
    }
  }

  dispose() {
    this.trail.mesh.removeFromParent();
    this.trail.mesh.geometry.dispose();
  }
}
