// Spiel-Simulation. Läuft identisch im Browser (Lokal / CPU) und im
// Durable Object (Online, serverautoritativ). Keine DOM- oder three.js-Abhängigkeiten.

import { type Box, type ChainButton, type MoveDef, type MoveKey, type ProjectileKind, getCharacter, moveLength } from './characters';

export const TICK_RATE = 60;
export const ARENA_HALF_WIDTH = 7;
export const MAX_SEPARATION = 9;
export const GRAVITY = 0.011;
export const ROUND_SECONDS = 99;
export const ROUNDS_TO_WIN = 2;

const BODY_WIDTH = 0.7;
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.1;
const INTRO_TICKS = 110;
const ROUND_END_TICKS = 200;
/** Wie lange ein Tastendruck gepuffert wird (für Ketten und Moves direkt nach der Erholung). */
const BUFFER_TICKS = 8;
/** Zeitfenster für Doppeltipp (Dash). */
const DASH_WINDOW = 12;
const DASH_TICKS = 14;
const BACKDASH_TICKS = 18;
const DOWN_TICKS = 44;
const GETUP_TICKS = 20;

// --- Anti-Stunlock --------------------------------------------------------
/** Nach dem Aufstehen noch so lange unverwundbar (endet sofort, wenn man selbst angreift). */
export const WAKEUP_INVULN = 16;
/** So lange muss man frei sein, bis die „Stun-Ermüdung“ (heat) verfällt. */
export const HEAT_RESET_TICKS = 40;
/** Ab so vielen Treffern ohne Pause wird man zwangsweise umgeworfen (danach Aufsteh-Schutz). */
export const COMBO_LIMIT = 8;
/** Hitstun schrumpft mit jedem Treffer ohne Pause … */
const STUN_DECAY_PER_HIT = 0.06;
/** … und noch stärker, wenn derselbe Move wiederholt trifft. */
const STUN_DECAY_PER_REPEAT = 0.2;
const MIN_STUN_SCALE = 0.4;
/** Maximal so viele Moves in einer Kette, jeder Move höchstens zweimal. */
const MAX_CHAIN = 5;
/** Kurzes Einfrieren beim Treffer (Hitstop) – gibt Wucht, ändert keine Frame-Vorteile. */
const HITSTOP_LIGHT = 4;
const HITSTOP_HEAVY = 7;
const HITSTOP_BLOCK = 3;
const HITSTOP_MULTI = 2;

export const INPUT = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  LIGHT: 16,
  HEAVY: 32,
  SPECIAL: 64,
  KICK: 128,
} as const;

const ATTACK_BUTTONS = INPUT.LIGHT | INPUT.HEAVY | INPUT.SPECIAL | INPUT.KICK;

export type FighterStatus =
  | 'idle'
  | 'walk'
  | 'jump'
  | 'crouch'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
  | 'dash'
  | 'backdash'
  | 'down'
  | 'getup'
  | 'ko'
  | 'win';

export interface Fighter {
  char: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  status: FighterStatus;
  statusTime: number;
  /** Dauer des aktuellen Hit-/Blockstuns in Ticks. */
  stun: number;
  move: MoveKey | null;
  moveHit: boolean;
  airAttackUsed: boolean;
  crouching: boolean;
  /** Hält gerade "zurück" (Blockhaltung) – nur für die Darstellung. */
  guarding: boolean;
  wins: number;
  combo: number;
  prevInput: number;
  /** Gepufferte Angriffstasten und Restdauer. */
  buffer: number;
  bufferTime: number;
  /** Letzter Richtungstipp (1 = vor, -1 = zurück) und Tick – für den Dash. */
  tapDir: number;
  tapTick: number;
  /** In der Luft getroffen / hochgeschleudert: landet im Knockdown. */
  launched: boolean;
  /** Höhe des letzten Treffers – für die Trefferreaktion in der Animation. */
  lastHit: 'high' | 'mid' | 'low';
  /** Abklingzeit des Fernangriffs in Ticks – verhindert Dauerfeuer. */
  projCooldown: number;
  /** Treffer des aktuellen Moves (Mehrfachtreffer) und Tick des letzten Treffers. */
  hitCount: number;
  hitTick: number;
  /** Verbleibende Panzerung des aktuellen Moves. */
  armorLeft: number;
  /** Moves der laufenden Kette (begrenzt Länge und Wiederholungen). */
  chain: MoveKey[];
  /** Stun-Ermüdung: Treffer seit der letzten echten Verschnaufpause. */
  heat: number;
  /** Ticks am Stück handlungsfähig – setzt heat zurück. */
  freeTime: number;
  /** Zuletzt erlittene Moves (für die Wiederholungs-Strafe). */
  stale: MoveKey[];
  /** Aufsteh-Unverwundbarkeit in Ticks. */
  invuln: number;
  /** Rückstoß für den Angreifer, wenn der Gegner an der Wand klebt. */
  recoil: number;
}

export interface Projectile {
  owner: 0 | 1;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  w: number;
  h: number;
  life: number;
  move: MoveKey;
}

export type GameEvent =
  | { type: 'hit'; x: number; y: number; target: 0 | 1; damage: number; heavy: boolean; move: MoveKey; combo: number }
  | { type: 'knockdown'; player: 0 | 1; x: number }
  | { type: 'dash'; player: 0 | 1 }
  | { type: 'block'; x: number; y: number; target: 0 | 1 }
  | { type: 'swing'; player: 0 | 1; move: MoveKey }
  | { type: 'projectile'; player: 0 | 1; kind: Projectile['kind'] }
  | { type: 'ko'; loser: 0 | 1; finisher: FinisherKind }
  | { type: 'timeout' }
  | { type: 'roundStart'; round: number }
  | { type: 'fight' }
  | { type: 'matchEnd'; winner: 0 | 1 | -1 }
  /** Konterhaltung hat einen Angriff abgefangen. */
  | { type: 'parry'; player: 0 | 1; x: number; y: number }
  /** Panzerung hat einen Treffer weggesteckt. */
  | { type: 'armor'; player: 0 | 1; x: number; y: number }
  /** Beide werfen gleichzeitig – Wurf gelöst. */
  | { type: 'tech'; x: number; y: number }
  /** Kombo-Limit erreicht: Zwangs-Knockdown. */
  | { type: 'limit'; target: 0 | 1 }
  /** Landung nach Sprung (Staub, Geräusch). */
  | { type: 'land'; player: 0 | 1; x: number };

/** Finaler Schlag: Kopf fliegt, Arm fliegt oder Gegner kracht gegen die Hallenwand. */
export type FinisherKind = 'head' | 'arm' | 'wall';

/** Dauer der Zeitlupe nach dem finalen Schlag (in Ticks Echtzeit). */
export const SLOWMO_TICKS = 120;
/** In der Zeitlupe läuft nur jeder n-te Tick die Simulation. */
export const SLOWMO_FACTOR = 4;

/** Ticks zwischen zwei Fernangriffen (ab Abwurf) – 1,5 Sekunden. */
export const PROJECTILE_COOLDOWN = 90;

export type Phase = 'intro' | 'fight' | 'roundEnd' | 'matchEnd';

export interface GameState {
  /** Arena-ID, siehe stages.ts */
  stage: string;
  tick: number;
  phase: Phase;
  phaseTime: number;
  round: number;
  timer: number;
  fighters: [Fighter, Fighter];
  projectiles: Projectile[];
  /** Ereignisse des letzten Ticks (Treffer, KO, ...) für Effekte und Sound. */
  events: GameEvent[];
  roundWinner: 0 | 1 | -1 | null;
  matchWinner: 0 | 1 | -1 | null;
  /** Restliche Zeitlupen-Ticks nach dem KO (0 = normal). */
  slowmo: number;
  finisher: { kind: FinisherKind; loser: 0 | 1 } | null;
  /** Hitstop: so viele Ticks bleibt alles kurz stehen. */
  hitstop: number;
}

function createFighter(char: string, slot: 0 | 1): Fighter {
  return {
    char,
    x: slot === 0 ? -2.2 : 2.2,
    y: 0,
    vx: 0,
    vy: 0,
    facing: slot === 0 ? 1 : -1,
    hp: getCharacter(char).maxHp,
    status: 'idle',
    statusTime: 0,
    stun: 0,
    move: null,
    moveHit: false,
    airAttackUsed: false,
    crouching: false,
    guarding: false,
    wins: 0,
    combo: 0,
    prevInput: 0,
    buffer: 0,
    bufferTime: 0,
    tapDir: 0,
    tapTick: -100,
    launched: false,
    lastHit: 'mid',
    projCooldown: 0,
    hitCount: 0,
    hitTick: 0,
    armorLeft: 0,
    chain: [],
    heat: 0,
    freeTime: 0,
    stale: [],
    invuln: 0,
    recoil: 0,
  };
}

export function createGame(charA: string, charB: string, stage = 'wareneingang'): GameState {
  return {
    stage,
    tick: 0,
    phase: 'intro',
    phaseTime: 0,
    round: 1,
    timer: ROUND_SECONDS * TICK_RATE,
    fighters: [createFighter(charA, 0), createFighter(charB, 1)],
    projectiles: [],
    events: [{ type: 'roundStart', round: 1 }],
    slowmo: 0,
    finisher: null,
    hitstop: 0,
    roundWinner: null,
    matchWinner: null,
  };
}

function resetRound(s: GameState) {
  s.fighters = s.fighters.map((f, i) => {
    const fresh = createFighter(f.char, i as 0 | 1);
    fresh.wins = f.wins;
    return fresh;
  }) as [Fighter, Fighter];
  s.projectiles = [];
  s.round += 1;
  s.timer = ROUND_SECONDS * TICK_RATE;
  s.phase = 'intro';
  s.phaseTime = 0;
  s.roundWinner = null;
  s.slowmo = 0;
  s.hitstop = 0;
  s.finisher = null;
  s.events.push({ type: 'roundStart', round: s.round });
}

function currentMove(f: Fighter): MoveDef | null {
  return f.status === 'attack' && f.move ? getCharacter(f.char).moves[f.move] : null;
}

export function hurtbox(f: Fighter): Box {
  // Hochgeschleudert liegt man quer in der Luft – niedrigere, flache Hurtbox
  if (f.launched && f.y > 0) return { x: f.x - 0.55, y: f.y - 0.3, w: 1.1, h: 1.2 };
  const sliding = currentMove(f)?.slide === true;
  const h = f.status === 'down' ? 0.4 : sliding ? 0.6 : f.crouching ? CROUCH_HEIGHT : f.status === 'jump' ? 1.4 : STAND_HEIGHT;
  return { x: f.x - BODY_WIDTH / 2, y: f.y, w: BODY_WIDTH, h };
}

/** Am Boden liegend, beim Aufstehen, kurz danach und in Unverwundbarkeits-Frames ist man nicht zu treffen. */
export function hittable(f: Fighter) {
  if (f.status === 'down' || f.status === 'getup' || f.status === 'ko' || f.invuln > 0) return false;
  const m = currentMove(f);
  if (m?.invuln && f.statusTime >= m.invuln[0] && f.statusTime <= m.invuln[1]) return false;
  return true;
}

/** Aktive Angriffs-Hitbox in Weltkoordinaten oder null. */
export function attackBox(f: Fighter): Box | null {
  if (f.status !== 'attack' || !f.move) return null;
  const m = getCharacter(f.char).moves[f.move];
  if (m.projectile) return null;
  const t = f.statusTime;
  if (t < m.startup || t >= m.startup + m.active) return null;
  const hb = m.hitbox;
  const x = f.facing === 1 ? f.x + hb.x : f.x - hb.x - hb.w;
  return { x, y: f.y + hb.y, w: hb.w, h: hb.h };
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function grounded(f: Fighter) {
  return f.y <= 0;
}

function isHoldingBack(f: Fighter, input: number) {
  return f.facing === 1 ? (input & INPUT.LEFT) !== 0 : (input & INPUT.RIGHT) !== 0;
}

function isHoldingForward(f: Fighter, input: number) {
  return f.facing === 1 ? (input & INPUT.RIGHT) !== 0 : (input & INPUT.LEFT) !== 0;
}

function canAct(f: Fighter) {
  return f.status === 'idle' || f.status === 'walk' || f.status === 'crouch' || (f.status === 'dash' && f.statusTime > 3);
}

function startAttack(s: GameState, f: Fighter, slot: 0 | 1, key: MoveKey) {
  const m = getCharacter(f.char).moves[key];
  const fromDash = f.status === 'dash';
  f.status = 'attack';
  f.statusTime = 0;
  f.move = key;
  f.moveHit = false;
  f.buffer = 0;
  f.bufferTime = 0;
  f.hitCount = 0;
  f.hitTick = 0;
  f.armorLeft = m.armor ?? 0;
  // Wer selbst angreift, verliert den Aufsteh-Schutz
  f.invuln = 0;
  // Aus dem Dash heraus behält man etwas Schwung
  if (key !== 'air' && key !== 'airKick') f.vx = fromDash ? f.vx * 0.5 : 0;
  if (m.hop) {
    f.vy = m.hop;
    f.y = Math.max(f.y, 0.01);
  }
  f.crouching = m.crouch === true;
  s.events.push({ type: 'swing', player: slot, move: key });
}

/** Welcher Bodenmove gehört zu den gepufferten Tasten und der Richtung? */
function chooseGroundMove(s: GameState, f: Fighter, slot: 0 | 1, buf: number, input: number): MoveKey | null {
  const down = (input & INPUT.DOWN) !== 0;
  const fwd = isHoldingForward(f, input);
  const back = isHoldingBack(f, input);
  if (buf & INPUT.LIGHT && buf & INPUT.KICK) return 'throw';
  if (buf & INPUT.SPECIAL) {
    if (fwd) return 'rush';
    const def = getCharacter(f.char).moves;
    const sig = down ? 'sig1' : back ? 'sig2' : null;
    if (sig) return def[sig].projectile && (f.projCooldown > 0 || s.projectiles.some((p) => p.owner === slot)) ? null : sig;
    // nur ein Geschoss gleichzeitig, danach Abklingzeit
    return f.projCooldown > 0 || s.projectiles.some((p) => p.owner === slot) ? null : 'special';
  }
  if (buf & INPUT.HEAVY) return down ? 'low' : fwd ? 'overhead' : back ? 'launcher' : 'heavy';
  if (buf & INPUT.KICK) return down ? 'lowKick' : fwd ? 'fwdKick' : 'kick';
  if (buf & INPUT.LIGHT) return down ? 'lowLight' : fwd ? 'fwdLight' : 'light';
  return null;
}

function chainFromBuffer(f: Fighter): MoveKey | null {
  const routes = f.move ? getCharacter(f.char).chains[f.move] : undefined;
  if (!routes || f.chain.length >= MAX_CHAIN) return null;
  const order: [ChainButton, number][] = [
    ['heavy', INPUT.HEAVY],
    ['kick', INPUT.KICK],
    ['light', INPUT.LIGHT],
  ];
  for (const [btn, bit] of order) {
    const next = routes[btn];
    // Endlos-Schleifen (z. B. ↓ Leicht, ↓ Leicht, …) abschneiden
    if (f.buffer & bit && next && f.chain.filter((k) => k === next).length < 2) return next;
  }
  return null;
}

function updateFighter(s: GameState, slot: 0 | 1, input: number) {
  const f = s.fighters[slot];
  const other = s.fighters[slot === 0 ? 1 : 0];
  const def = getCharacter(f.char);
  const fighting = s.phase === 'fight';
  if (!fighting) input = 0;
  const pressed = bufferInput(f, input, true);
  f.statusTime += 1;
  if (f.projCooldown > 0) f.projCooldown -= 1;
  if (f.invuln > 0) f.invuln -= 1;
  // Stun-Ermüdung verfällt erst nach einer echten Verschnaufpause
  const stunned = f.status === 'hitstun' || f.status === 'blockstun' || f.status === 'down' || f.status === 'getup';
  f.freeTime = stunned ? 0 : f.freeTime + 1;
  if (f.freeTime >= HEAT_RESET_TICKS) {
    f.heat = 0;
    f.stale = [];
  }

  const lockedFacing = f.status === 'attack' || f.status === 'hitstun' || f.status === 'ko' || f.status === 'down' || f.status === 'backdash';
  if (grounded(f) && !lockedFacing) f.facing = other.x >= f.x ? 1 : -1;

  f.guarding = fighting && canAct(f) && f.status !== 'dash' && grounded(f) && isHoldingBack(f, input);

  switch (f.status) {
    case 'hitstun':
    case 'blockstun': {
      if (grounded(f)) f.vx *= 0.88;
      // Hochgeschleudert: bleibt im Hitstun bis zur Landung (Juggle)
      if (f.statusTime >= f.stun && !f.launched) {
        f.status = grounded(f) ? 'idle' : 'jump';
        f.statusTime = 0;
        if (f.status === 'idle') f.combo = 0;
      }
      break;
    }
    case 'down': {
      f.vx *= 0.8;
      // Nach kurzer Zeit kann man sich mit einer Richtung schneller aufrappeln
      const wantsUp = f.statusTime > 16 && (input & (INPUT.UP | INPUT.LEFT | INPUT.RIGHT | ATTACK_BUTTONS)) !== 0;
      if (f.statusTime >= DOWN_TICKS || wantsUp) {
        f.status = 'getup';
        f.statusTime = 0;
      }
      break;
    }
    case 'getup':
      if (f.statusTime >= GETUP_TICKS) {
        f.status = 'idle';
        f.statusTime = 0;
        f.combo = 0;
        f.heat = 0;
        f.stale = [];
        f.invuln = WAKEUP_INVULN;
      }
      break;
    case 'backdash':
      f.vx *= 0.9;
      if (f.statusTime >= BACKDASH_TICKS) {
        f.status = 'idle';
        f.statusTime = 0;
        f.vx = 0;
      }
      break;
    case 'ko':
    case 'win':
      if (grounded(f)) f.vx *= 0.9;
      break;
    case 'attack': {
      const m = def.moves[f.move!];
      // Folge-Moves einer Kette rücken leicht nach, damit die Kette trotz Rückstoß zusammenhält
      const lunge = m.lunge ?? (f.chain.length > 1 ? 0.045 : 0);
      if (lunge && f.statusTime < m.startup + m.active) f.vx = lunge * f.facing;
      else if (grounded(f)) f.vx *= 0.7;
      // Leicht + Tritt fast gleichzeitig = Wurf
      if (f.statusTime <= 3 && ((f.move === 'light' && pressed & INPUT.KICK) || (f.move === 'kick' && pressed & INPUT.LIGHT))) {
        startAttack(s, f, slot, 'throw');
        break;
      }
      if (m.projectile && f.statusTime === m.startup) {
        const p = m.projectile;
        s.projectiles.push({
          owner: slot,
          kind: p.kind,
          x: f.x + f.facing * 0.6,
          y: f.y + p.y,
          vx: p.speed * f.facing,
          w: p.w,
          h: p.h,
          life: p.life,
          move: f.move!,
        });
        f.projCooldown = PROJECTILE_COOLDOWN;
        s.events.push({ type: 'projectile', player: slot, kind: p.kind });
      }
      // Kombo-Kette: nach Treffer/Block in der Erholungsphase in den Folgemove abbrechen
      if (f.moveHit && f.statusTime >= m.startup + m.active) {
        const next = chainFromBuffer(f);
        if (next) {
          f.chain.push(next);
          startAttack(s, f, slot, next);
          break;
        }
      }
      const airMove = f.move === 'air' || f.move === 'airKick';
      // Trifft der Launcher, erholt man sich schnell genug für den Juggle
      const length = f.moveHit && m.launch ? m.startup + m.active + 6 : moveLength(m);
      if (f.statusTime >= length || (airMove && grounded(f) && f.statusTime > 2)) {
        f.status = grounded(f) ? 'idle' : 'jump';
        f.statusTime = 0;
        f.move = null;
        f.crouching = false;
      }
      break;
    }
    case 'jump': {
      if (f.buffer && !f.airAttackUsed) {
        f.airAttackUsed = true;
        startAttack(s, f, slot, f.buffer & INPUT.KICK ? 'airKick' : 'air');
      }
      break;
    }
    default: {
      // idle / walk / crouch / dash – frei steuerbar
      if (f.status === 'dash') {
        f.vx *= 0.93;
        if (f.statusTime >= DASH_TICKS) {
          f.status = 'idle';
          f.statusTime = 0;
        }
      }
      const move = f.buffer ? chooseGroundMove(s, f, slot, f.buffer, input) : null;
      const horizontal = pressed & (INPUT.LEFT | INPUT.RIGHT);
      if (move) {
        f.chain = [move];
        startAttack(s, f, slot, move);
      } else if (input & INPUT.UP) {
        f.status = 'jump';
        f.statusTime = 0;
        f.crouching = false;
        f.airAttackUsed = false;
        f.vy = def.jumpVel;
        const dir = (input & INPUT.RIGHT ? 1 : 0) - (input & INPUT.LEFT ? 1 : 0);
        f.vx = dir * def.walkSpeed * 1.35;
      } else if (horizontal && !(input & INPUT.DOWN)) {
        // Doppeltipp vor/zurück = Dash/Backdash
        const tap = isHoldingForward(f, horizontal) ? 1 : -1;
        if (f.tapDir === tap && s.tick - f.tapTick <= DASH_WINDOW) {
          f.status = tap === 1 ? 'dash' : 'backdash';
          f.statusTime = 0;
          f.vx = tap * f.facing * def.walkSpeed * (tap === 1 ? 3.2 : 2.6);
          f.tapDir = 0;
          s.events.push({ type: 'dash', player: slot });
        } else {
          f.tapDir = tap;
          f.tapTick = s.tick;
          walkOrStand(f, input, def.walkSpeed);
        }
      } else if (f.status === 'dash') {
        // Dash läuft aus
      } else if (input & INPUT.DOWN) {
        if (f.status !== 'crouch') f.statusTime = 0;
        f.status = 'crouch';
        f.crouching = true;
        f.vx = 0;
      } else {
        walkOrStand(f, input, def.walkSpeed);
      }
    }
  }

  // Physik
  f.x += f.vx + f.recoil;
  f.recoil *= 0.75;
  if (Math.abs(f.recoil) < 0.002) f.recoil = 0;
  if (!grounded(f) || f.vy > 0) {
    f.vy -= GRAVITY;
    f.y += f.vy;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      if (f.launched && f.status === 'hitstun') {
        f.status = 'down';
        f.statusTime = 0;
        f.launched = false;
        f.vx *= 0.3;
        s.events.push({ type: 'knockdown', player: slot, x: f.x });
      } else if (f.status === 'jump') {
        f.status = 'idle';
        f.statusTime = 0;
        f.vx = 0;
        s.events.push({ type: 'land', player: slot, x: f.x });
      } else if (f.status === 'attack') {
        s.events.push({ type: 'land', player: slot, x: f.x });
      }
      f.launched = false;
    }
  }
}

/** Tastendrücke puffern – läuft auch während des Hitstops weiter, damit keine Eingabe verloren geht. */
function bufferInput(f: Fighter, input: number, countDown: boolean): number {
  const pressed = input & ~f.prevInput;
  f.prevInput = input;
  if (pressed & ATTACK_BUTTONS) {
    f.buffer |= pressed & ATTACK_BUTTONS;
    f.bufferTime = BUFFER_TICKS;
  } else if (countDown && f.bufferTime > 0 && --f.bufferTime === 0) {
    f.buffer = 0;
  }
  return pressed;
}

function walkOrStand(f: Fighter, input: number, walkSpeed: number) {
  f.crouching = false;
  const dir = (input & INPUT.RIGHT ? 1 : 0) - (input & INPUT.LEFT ? 1 : 0);
  if (dir !== 0) {
    // Rückwärts etwas langsamer – klassisch
    const back = dir !== f.facing;
    f.vx = dir * walkSpeed * (back ? 0.8 : 1);
    if (f.status !== 'walk') f.statusTime = 0;
    f.status = 'walk';
  } else {
    f.vx = 0;
    if (f.status !== 'idle') f.statusTime = 0;
    f.status = 'idle';
  }
}

function setStun(f: Fighter, status: 'hitstun' | 'blockstun', ticks: number) {
  f.status = status;
  f.statusTime = 0;
  f.move = null;
  f.crouching = status === 'blockstun' ? f.crouching : false;
  f.stun = ticks;
}

function blocks(defender: Fighter, defInput: number, height: 'mid' | 'low' | 'high', attackerX: number) {
  if (!grounded(defender) || (!canAct(defender) && defender.status !== 'blockstun')) return false;
  if (defender.status === 'dash') return false;
  const back = defender.facing === 1 ? (defInput & INPUT.LEFT) !== 0 : (defInput & INPUT.RIGHT) !== 0;
  // Blockrichtung relativ zur Angriffsquelle (wichtig bei Projektilen)
  const awayFromAttacker = attackerX >= defender.x ? (defInput & INPUT.LEFT) !== 0 : (defInput & INPUT.RIGHT) !== 0;
  if (!back && !awayFromAttacker) return false;
  const crouch = (defInput & INPUT.DOWN) !== 0;
  if (height === 'low') return crouch;
  if (height === 'high') return !crouch;
  return true;
}

function applyHit(
  s: GameState,
  target: 0 | 1,
  attackerX: number,
  moveKey: MoveKey,
  attackerChar: string,
  defInput: number,
  hx: number,
  hy: number,
  firstHit = true,
  fromProjectile = false,
) {
  const d = s.fighters[target];
  const atkSlot = (target === 0 ? 1 : 0) as 0 | 1;
  const atk = s.fighters[atkSlot];
  const m = getCharacter(attackerChar).moves[moveKey];
  const dir = d.x >= attackerX ? 1 : -1;
  const airborne = !grounded(d) || d.launched;
  const dm = currentMove(d);

  if (m.grab) {
    // Würfe greifen nicht in der Luft und nicht, solange der Gegner im Treffer-/Blockstun steckt (keine Wurf-Schleifen)
    if (airborne || d.status === 'hitstun' || d.status === 'blockstun') return false;
    // Beide werfen gleichzeitig: Wurf gelöst, beide springen auseinander
    if (dm?.grab && d.statusTime <= dm.startup + 2) {
      d.status = 'blockstun';
      d.statusTime = 0;
      d.stun = 14;
      d.move = null;
      d.vx = dir * 0.1;
      atk.recoil = -dir * 0.1;
      s.hitstop = HITSTOP_BLOCK;
      s.events.push({ type: 'tech', x: hx, y: hy });
      return true;
    }
  }

  // Konterhaltung: mittlere und hohe Angriffe werden abgefangen, Angreifer taumelt
  if (dm?.parry && !m.grab && m.height !== 'low' && d.statusTime >= dm.startup && d.statusTime < dm.startup + dm.active) {
    d.status = 'idle';
    d.statusTime = 0;
    d.move = null;
    if (!fromProjectile) {
      setStun(atk, 'hitstun', 30);
      atk.lastHit = 'mid';
      atk.vx = -dir * 0.04;
    }
    s.hitstop = HITSTOP_HEAVY;
    s.events.push({ type: 'parry', player: target, x: hx, y: hy });
    return true;
  }

  if (!m.grab && blocks(d, defInput, m.height, attackerX)) {
    d.hp = Math.max(1, d.hp - Math.round(m.damage * 0.1));
    setStun(d, 'blockstun', m.blockstun);
    d.vx = dir * m.knockback * 0.7;
    // Wer blockt, hat sich erfolgreich gewehrt: Stun-Ermüdung zurücksetzen
    d.heat = 0;
    d.stale = [];
    pushFromWall(d, atk, dir, m.knockback * 0.7, fromProjectile);
    s.hitstop = Math.max(s.hitstop, m.hits && m.hits > 1 ? HITSTOP_MULTI : HITSTOP_BLOCK);
    s.events.push({ type: 'block', x: hx, y: hy, target });
    return true;
  }

  // Panzerung: Treffer wird im Anlauf weggesteckt – voller Schaden, aber kein Stun
  if (dm && d.armorLeft > 0 && !m.grab && d.statusTime < dm.startup) {
    d.armorLeft -= 1;
    d.hp = Math.max(1, d.hp - m.damage);
    s.hitstop = HITSTOP_HEAVY;
    s.events.push({ type: 'armor', player: target, x: hx, y: hy });
    return true;
  }

  // Wiederholt derselbe Move? Dann weniger Stun und weniger Schaden.
  const repeats = firstHit ? d.stale.filter((k) => k === moveKey).length : 0;
  if (firstHit) {
    d.stale.push(moveKey);
    if (d.stale.length > 6) d.stale.shift();
  }
  const scale = Math.max(0.3, 1 - d.combo * 0.1) * Math.max(0.5, 1 - repeats * 0.15);
  const dmg = Math.max(1, Math.round(m.damage * scale));
  d.hp = Math.max(0, d.hp - dmg);
  d.combo += 1;
  d.heat += 1;
  // Hitstun-Decay: je länger man ohne Pause getroffen wird, desto schneller kommt man frei
  const stunScale = Math.max(MIN_STUN_SCALE, 1 - (d.heat - 1) * STUN_DECAY_PER_HIT - repeats * STUN_DECAY_PER_REPEAT);
  setStun(d, 'hitstun', Math.max(6, Math.round(m.hitstun * stunScale)));
  d.lastHit = m.height === 'low' ? 'low' : hy - d.y > 1.25 ? 'high' : 'mid';
  // Pushback wächst mit der Ermüdung – Dauerschläge treiben den Gegner aus der Reichweite
  const push = m.knockback * Math.min(1.8, 1 + Math.max(0, d.heat - 3) * 0.1 + repeats * 0.25);
  d.vx = dir * push;
  pushFromWall(d, atk, dir, push, fromProjectile);
  // Kombo-Limit: zu viele Treffer am Stück -> Zwangs-Knockdown, danach Aufsteh-Schutz
  const limit = d.heat >= COMBO_LIMIT;
  // Juggle-Schwerkraft: je länger die Kombo, desto weniger Höhe
  const juggleScale = Math.max(0.3, 1 - (Math.max(d.combo, d.heat) - 1) * 0.1);
  // Nur ein Launcher pro Kombo: in der Luft schleudert er nicht erneut hoch
  if (m.launch && !limit && !airborne) {
    d.vy = m.launch * juggleScale;
    d.launched = true;
  } else if (m.knockdown || limit) {
    d.vy = Math.max(d.vy, m.grab ? 0.19 : 0.1);
    if (m.grab) d.vx = dir * 0.07;
    if (limit) d.vx = dir * Math.max(0.1, Math.abs(d.vx));
    d.launched = true;
    if (limit) {
      // bis zur Landung nicht mehr treffbar – danach greift der Aufsteh-Schutz
      d.invuln = 45;
      s.events.push({ type: 'limit', target });
    }
  } else if (airborne) {
    // Juggle: kurz anheben, kaum wegstoßen, damit die Kombo weitergehen kann
    d.vy = Math.max(0.12 * juggleScale, d.vy * 0.3 + 0.05);
    d.vx = dir * Math.min(m.knockback, 0.025);
    d.launched = true;
  }
  if (d.launched) d.y = Math.max(d.y, 0.01);
  atk.combo = 0;
  const heavy = m.damage >= 80 || !!m.knockdown || !!m.launch || !!m.grab;
  s.hitstop = Math.max(s.hitstop, m.hits && m.hits > 1 ? HITSTOP_MULTI : heavy ? HITSTOP_HEAVY : HITSTOP_LIGHT);
  s.events.push({ type: 'hit', x: hx, y: hy, target, damage: dmg, heavy, move: moveKey, combo: d.combo });
  return true;
}

/** Klebt der Getroffene an der Hallenwand, wird stattdessen der Angreifer zurückgeschoben. */
function pushFromWall(d: Fighter, atk: Fighter, dir: number, push: number, fromProjectile: boolean) {
  if (fromProjectile) return;
  if (Math.abs(d.x) >= ARENA_HALF_WIDTH - 0.35 && Math.sign(d.x) === dir) atk.recoil = -dir * Math.abs(push) * 0.9;
}

function resolveCombat(s: GameState, inputs: [number, number]) {
  // Nahkampf
  for (const slot of [0, 1] as const) {
    const a = s.fighters[slot];
    const t = (slot === 0 ? 1 : 0) as 0 | 1;
    const box = attackBox(a);
    if (!box || !hittable(s.fighters[t])) continue;
    const m = getCharacter(a.char).moves[a.move!];
    const maxHits = m.hits ?? 1;
    const interval = Math.max(2, Math.floor(m.active / maxHits));
    if (a.hitCount >= maxHits || (a.hitCount > 0 && a.statusTime - a.hitTick < interval)) continue;
    const hb = hurtbox(s.fighters[t]);
    if (overlap(box, hb)) {
      const hx = (Math.max(box.x, hb.x) + Math.min(box.x + box.w, hb.x + hb.w)) / 2;
      const hy = (Math.max(box.y, hb.y) + Math.min(box.y + box.h, hb.y + hb.h)) / 2;
      const first = a.hitCount === 0;
      a.hitCount += 1;
      a.hitTick = a.statusTime;
      a.moveHit = true;
      const landed = applyHit(s, t, a.x, a.move!, a.char, inputs[t], hx, hy, first);
      // Ein abgefangener/gelöster Angriff trifft nicht weiter
      if (!landed || a.status !== 'attack') a.hitCount = maxHits;
    }
  }
  // Projektile
  for (const p of s.projectiles) {
    p.x += p.vx;
    p.life -= 1;
    const t = (p.owner === 0 ? 1 : 0) as 0 | 1;
    const pb: Box = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
    if (hittable(s.fighters[t]) && overlap(pb, hurtbox(s.fighters[t]))) {
      p.life = 0;
      applyHit(s, t, p.x - p.vx * 10, p.move, s.fighters[p.owner].char, inputs[t], p.x, p.y, true, true);
    }
  }
  // Projektile heben sich gegenseitig auf
  if (s.projectiles.length === 2) {
    const [a, b] = s.projectiles;
    if (a.owner !== b.owner && Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) {
      a.life = 0;
      b.life = 0;
      s.events.push({ type: 'block', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, target: a.owner });
    }
  }
  s.projectiles = s.projectiles.filter((p) => p.life > 0 && Math.abs(p.x) < ARENA_HALF_WIDTH + 2);
}

function separate(s: GameState) {
  const [a, b] = s.fighters;
  // Körper schieben sich auseinander
  const dx = b.x - a.x;
  const minDist = BODY_WIDTH;
  const verticalOverlap = Math.abs(a.y - b.y) < 1.2;
  if (Math.abs(dx) < minDist && verticalOverlap) {
    const push = (minDist - Math.abs(dx)) / 2;
    const dir = dx === 0 ? (a.facing === 1 ? 1 : -1) : Math.sign(dx);
    a.x -= push * dir;
    b.x += push * dir;
  }
  for (const f of s.fighters) {
    f.x = Math.max(-ARENA_HALF_WIDTH, Math.min(ARENA_HALF_WIDTH, f.x));
  }
  // Beide müssen ins Bild passen
  const sep = b.x - a.x;
  if (Math.abs(sep) > MAX_SEPARATION) {
    const excess = (Math.abs(sep) - MAX_SEPARATION) / 2;
    const dir = Math.sign(sep);
    a.x += excess * dir;
    b.x -= excess * dir;
  }
}

function checkRoundEnd(s: GameState) {
  const [a, b] = s.fighters;
  let winner: 0 | 1 | -1 | null = null;
  if (a.hp <= 0 || b.hp <= 0) {
    winner = a.hp <= 0 && b.hp <= 0 ? -1 : a.hp <= 0 ? 1 : 0;
    const loser = winner === 0 ? 1 : 0;
    // Abwechslung, aber deterministisch (Server und Client sind sich einig)
    const kinds: FinisherKind[] = ['head', 'wall', 'arm'];
    const kind = kinds[(s.tick + s.round) % kinds.length];
    s.finisher = { kind, loser };
    s.slowmo = SLOWMO_TICKS;
    s.hitstop = 0;
    s.events.push({ type: 'ko', loser, finisher: kind });
  } else if (s.timer <= 0) {
    const ra = a.hp / getCharacter(a.char).maxHp;
    const rb = b.hp / getCharacter(b.char).maxHp;
    winner = ra === rb ? -1 : ra > rb ? 0 : 1;
    s.events.push({ type: 'timeout' });
  }
  if (winner === null) return;
  s.phase = 'roundEnd';
  s.phaseTime = 0;
  s.roundWinner = winner;
  s.projectiles = [];
  if (winner === -1) {
    a.wins += 1;
    b.wins += 1;
  } else {
    s.fighters[winner].wins += 1;
  }
  for (const f of s.fighters) {
    if (f.hp <= 0) {
      f.status = 'ko';
      f.statusTime = 0;
      const wall = s.finisher?.kind === 'wall';
      f.vy = Math.max(f.vy, wall ? 0.16 : 0.1);
      f.vx = -f.facing * (wall ? 0.12 : 0.06);
    }
  }
}

/** Ein Simulationsschritt (1/60 s). Verändert den State direkt. */
export function step(s: GameState, inputs: [number, number]) {
  s.events = [];
  s.tick += 1;
  if (s.slowmo > 0) {
    s.slowmo -= 1;
    if (s.slowmo % SLOWMO_FACTOR !== 0) return;
  }
  // Hitstop: alles steht kurz still, nur Tastendrücke werden weiter gepuffert
  if (s.hitstop > 0) {
    s.hitstop -= 1;
    s.fighters.forEach((f, i) => bufferInput(f, s.phase === 'fight' ? inputs[i] : 0, false));
    return;
  }
  s.phaseTime += 1;

  if (s.phase === 'intro' && s.phaseTime >= INTRO_TICKS) {
    s.phase = 'fight';
    s.phaseTime = 0;
    s.events.push({ type: 'fight' });
  }

  updateFighter(s, 0, inputs[0]);
  updateFighter(s, 1, inputs[1]);

  if (s.phase === 'fight') {
    resolveCombat(s, inputs);
    s.timer -= 1;
    checkRoundEnd(s);
  }
  separate(s);

  if (s.phase === 'roundEnd') {
    if (s.phaseTime === 60) {
      s.fighters.forEach((f, i) => {
        if (f.status !== 'ko' && (s.roundWinner === i || s.roundWinner === -1)) {
          f.status = 'win';
          f.statusTime = 0;
        }
      });
    }
    if (s.phaseTime >= ROUND_END_TICKS) {
      const [a, b] = s.fighters;
      if (a.wins >= ROUNDS_TO_WIN || b.wins >= ROUNDS_TO_WIN) {
        s.phase = 'matchEnd';
        s.phaseTime = 0;
        s.matchWinner = a.wins === b.wins ? -1 : a.wins > b.wins ? 0 : 1;
        s.events.push({ type: 'matchEnd', winner: s.matchWinner });
      } else {
        resetRound(s);
      }
    }
  }
}
