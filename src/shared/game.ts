// Spiel-Simulation. Läuft identisch im Browser (Lokal / CPU) und im
// Durable Object (Online, serverautoritativ). Keine DOM- oder three.js-Abhängigkeiten.

import { type Box, type MoveKey, type ProjectileKind, getCharacter, moveLength } from './characters';

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

export const INPUT = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  LIGHT: 16,
  HEAVY: 32,
  SPECIAL: 64,
} as const;

export type FighterStatus =
  | 'idle'
  | 'walk'
  | 'jump'
  | 'crouch'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
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
  | { type: 'hit'; x: number; y: number; target: 0 | 1; damage: number; heavy: boolean }
  | { type: 'block'; x: number; y: number; target: 0 | 1 }
  | { type: 'swing'; player: 0 | 1; move: MoveKey }
  | { type: 'projectile'; player: 0 | 1; kind: Projectile['kind'] }
  | { type: 'ko'; loser: 0 | 1; finisher: FinisherKind }
  | { type: 'timeout' }
  | { type: 'roundStart'; round: number }
  | { type: 'fight' }
  | { type: 'matchEnd'; winner: 0 | 1 | -1 };

/** Finaler Schlag: Kopf fliegt, Arm fliegt oder Gegner kracht gegen die Hallenwand. */
export type FinisherKind = 'head' | 'arm' | 'wall';

/** Dauer der Zeitlupe nach dem finalen Schlag (in Ticks Echtzeit). */
export const SLOWMO_TICKS = 120;
/** In der Zeitlupe läuft nur jeder n-te Tick die Simulation. */
export const SLOWMO_FACTOR = 4;

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
  s.finisher = null;
  s.events.push({ type: 'roundStart', round: s.round });
}

export function hurtbox(f: Fighter): Box {
  const h = f.crouching ? CROUCH_HEIGHT : f.status === 'jump' ? 1.4 : STAND_HEIGHT;
  return { x: f.x - BODY_WIDTH / 2, y: f.y, w: BODY_WIDTH, h };
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

function canAct(f: Fighter) {
  return f.status === 'idle' || f.status === 'walk' || f.status === 'crouch';
}

function startAttack(s: GameState, f: Fighter, slot: 0 | 1, key: MoveKey) {
  f.status = 'attack';
  f.statusTime = 0;
  f.move = key;
  f.moveHit = false;
  if (key !== 'air') f.vx = 0;
  if (key === 'low') f.crouching = true;
  s.events.push({ type: 'swing', player: slot, move: key });
}

function updateFighter(s: GameState, slot: 0 | 1, input: number) {
  const f = s.fighters[slot];
  const other = s.fighters[slot === 0 ? 1 : 0];
  const def = getCharacter(f.char);
  const fighting = s.phase === 'fight';
  if (!fighting) input = 0;
  const pressed = input & ~f.prevInput;
  f.prevInput = input;
  f.statusTime += 1;

  if (grounded(f) && f.status !== 'attack' && f.status !== 'hitstun' && f.status !== 'ko') {
    f.facing = other.x >= f.x ? 1 : -1;
  }

  f.guarding = fighting && canAct(f) && grounded(f) && isHoldingBack(f, input);

  switch (f.status) {
    case 'hitstun':
    case 'blockstun': {
      f.vx *= 0.88;
      if (f.statusTime >= f.stun) {
        f.status = grounded(f) ? 'idle' : 'jump';
        f.statusTime = 0;
        if (f.status === 'idle') f.combo = 0;
      }
      break;
    }
    case 'ko':
    case 'win':
      f.vx *= 0.9;
      break;
    case 'attack': {
      const m = def.moves[f.move!];
      if (m.lunge && f.statusTime < m.startup + m.active) f.vx = m.lunge * f.facing;
      else if (grounded(f)) f.vx *= 0.7;
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
        s.events.push({ type: 'projectile', player: slot, kind: p.kind });
      }
      if (f.statusTime >= moveLength(m) || (f.move === 'air' && grounded(f) && f.statusTime > 2)) {
        f.status = grounded(f) ? 'idle' : 'jump';
        f.statusTime = 0;
        f.move = null;
        f.crouching = false;
      }
      break;
    }
    case 'jump': {
      if (pressed & (INPUT.LIGHT | INPUT.HEAVY | INPUT.SPECIAL) && !f.airAttackUsed) {
        f.airAttackUsed = true;
        startAttack(s, f, slot, 'air');
      }
      break;
    }
    default: {
      // idle / walk / crouch – frei steuerbar
      const special = pressed & INPUT.SPECIAL;
      const heavy = pressed & INPUT.HEAVY;
      const light = pressed & INPUT.LIGHT;
      const down = (input & INPUT.DOWN) !== 0;
      const ownProjectile = s.projectiles.some((p) => p.owner === slot);
      if (special && !ownProjectile) {
        f.crouching = false;
        startAttack(s, f, slot, 'special');
      } else if (heavy) {
        startAttack(s, f, slot, down ? 'low' : 'heavy');
      } else if (light) {
        f.crouching = false;
        startAttack(s, f, slot, 'light');
      } else if (input & INPUT.UP) {
        f.status = 'jump';
        f.statusTime = 0;
        f.crouching = false;
        f.airAttackUsed = false;
        f.vy = def.jumpVel;
        const dir = (input & INPUT.RIGHT ? 1 : 0) - (input & INPUT.LEFT ? 1 : 0);
        f.vx = dir * def.walkSpeed * 1.35;
      } else if (down) {
        if (f.status !== 'crouch') f.statusTime = 0;
        f.status = 'crouch';
        f.crouching = true;
        f.vx = 0;
      } else {
        f.crouching = false;
        const dir = (input & INPUT.RIGHT ? 1 : 0) - (input & INPUT.LEFT ? 1 : 0);
        if (dir !== 0) {
          // Rückwärts etwas langsamer – klassisch
          const back = dir !== f.facing;
          f.vx = dir * def.walkSpeed * (back ? 0.8 : 1);
          if (f.status !== 'walk') f.statusTime = 0;
          f.status = 'walk';
        } else {
          f.vx = 0;
          if (f.status !== 'idle') f.statusTime = 0;
          f.status = 'idle';
        }
      }
    }
  }

  // Physik
  f.x += f.vx;
  if (!grounded(f) || f.vy > 0) {
    f.vy -= GRAVITY;
    f.y += f.vy;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      if (f.status === 'jump') {
        f.status = 'idle';
        f.statusTime = 0;
        f.vx = 0;
      }
    }
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
  if (!grounded(defender) || !canAct(defender) && defender.status !== 'blockstun') return false;
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
) {
  const d = s.fighters[target];
  const atk = s.fighters[target === 0 ? 1 : 0];
  const m = getCharacter(attackerChar).moves[moveKey];
  const dir = d.x >= attackerX ? 1 : -1;
  if (blocks(d, defInput, m.height, attackerX)) {
    d.hp = Math.max(1, d.hp - Math.round(m.damage * 0.1));
    setStun(d, 'blockstun', m.blockstun);
    d.vx = dir * m.knockback * 0.7;
    s.events.push({ type: 'block', x: hx, y: hy, target });
    return;
  }
  const scale = Math.max(0.4, 1 - d.combo * 0.12);
  const dmg = Math.round(m.damage * scale);
  d.hp = Math.max(0, d.hp - dmg);
  d.combo += 1;
  setStun(d, 'hitstun', m.hitstun);
  d.vx = dir * m.knockback;
  if (!grounded(d) || moveKey === 'heavy') {
    d.vy = Math.max(d.vy, 0.08);
  }
  atk.combo = 0;
  s.events.push({ type: 'hit', x: hx, y: hy, target, damage: dmg, heavy: m.damage >= 80 });
}

function resolveCombat(s: GameState, inputs: [number, number]) {
  // Nahkampf
  for (const slot of [0, 1] as const) {
    const a = s.fighters[slot];
    const t = (slot === 0 ? 1 : 0) as 0 | 1;
    const box = attackBox(a);
    if (!box || a.moveHit) continue;
    const hb = hurtbox(s.fighters[t]);
    if (overlap(box, hb)) {
      a.moveHit = true;
      const hx = (Math.max(box.x, hb.x) + Math.min(box.x + box.w, hb.x + hb.w)) / 2;
      const hy = (Math.max(box.y, hb.y) + Math.min(box.y + box.h, hb.y + hb.h)) / 2;
      applyHit(s, t, a.x, a.move!, a.char, inputs[t], hx, hy);
    }
  }
  // Projektile
  for (const p of s.projectiles) {
    p.x += p.vx;
    p.life -= 1;
    const t = (p.owner === 0 ? 1 : 0) as 0 | 1;
    const pb: Box = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
    if (overlap(pb, hurtbox(s.fighters[t]))) {
      p.life = 0;
      applyHit(s, t, p.x - p.vx * 10, p.move, s.fighters[p.owner].char, inputs[t], p.x, p.y);
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
