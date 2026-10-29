import { type MoveDef, type MoveKey, getCharacter } from '../shared/characters';
import { type GameState, INPUT } from '../shared/game';

// CPU-Gegner: arbeitet kleine Pläne ab (Kombo-Ketten, Launcher mit Juggle,
// Würfe, Dashs), reagiert mit Verzögerung auf Angriffe und blockt tief oder
// hoch. Der Level (0..1) steuert Reaktionszeit, Blockquote und wie oft
// lange Kombos statt Einzelschläge kommen.

const BUTTONS = INPUT.LIGHT | INPUT.HEAVY | INPUT.SPECIAL | INPUT.KICK;

interface PlanStep {
  bits: number;
  ticks: number;
}

export class CpuController {
  private plan: PlanStep[] = [];
  private current: PlanStep | null = null;
  private left = 0;
  private reaction = 0;

  constructor(private slot: 0 | 1, private level = 0.6) {}

  next(s: GameState): number {
    const me = s.fighters[this.slot];
    const op = s.fighters[this.slot === 0 ? 1 : 0];
    if (s.phase !== 'fight') {
      this.plan = [];
      this.current = null;
      return 0;
    }
    const moves = getCharacter(me.char).moves;
    const toward = op.x > me.x ? INPUT.RIGHT : INPUT.LEFT;
    const away = toward === INPUT.RIGHT ? INPUT.LEFT : INPUT.RIGHT;
    const dist = Math.abs(op.x - me.x);
    const free = me.status === 'idle' || me.status === 'walk' || me.status === 'crouch';

    // Wurde ich getroffen, ist der Plan hinfällig
    if (me.status === 'hitstun' || me.status === 'blockstun' || me.status === 'down') {
      this.plan = [];
      this.current = null;
      if (me.status !== 'down') this.reaction = Math.round(12 * (1.2 - this.level));
      // im Blockstun weiter blocken (tief, wenn der Gegner tief angreift)
      return me.status === 'blockstun' ? away | (this.isLow(op.move, moves) ? INPUT.DOWN : 0) : 0;
    }

    // Juggle: hochgeschleuderten Gegner weiter bearbeiten
    if (op.launched && op.y > 0.05 && free && Math.random() < 0.4 + this.level * 0.6) {
      if (dist > 1.1) return toward;
      if (op.vy < 0 && op.y < 1.7) this.queue(this.chain(['light', 'light2', 'finisher'], moves, [INPUT.LIGHT, INPUT.LIGHT, INPUT.HEAVY]));
    }

    // Bedrohung erkennen: Angriff in Reichweite oder Projektil auf mich zu
    const opMove = op.move ? getCharacter(op.char).moves[op.move] : null;
    const incoming =
      (op.status === 'attack' && opMove && !opMove.grab && dist < opMove.hitbox.x + opMove.hitbox.w + 0.8) ||
      s.projectiles.some((p) => p.owner !== this.slot && Math.sign(me.x - p.x) === Math.sign(p.vx) && Math.abs(me.x - p.x) < 3.5);
    if (incoming && free && !this.current && this.reaction <= 0 && Math.random() < this.level * 0.55) {
      const projectile = s.projectiles.some((p) => p.owner !== this.slot);
      if (projectile && Math.random() < 0.3) return this.start([{ bits: INPUT.UP | toward, ticks: 30 }]);
      if (!projectile && Math.random() < 0.15 * this.level) return this.start(this.backdash(away));
      return this.start([{ bits: away | (this.isLow(op.move, moves) ? INPUT.DOWN : 0), ticks: 12 }]);
    }

    if (this.current || this.plan.length) return this.tick();
    this.reaction -= 1;
    if (!free) return 0;

    // Gegner liegt: kurz Abstand halten oder ranlaufen
    if (op.status === 'down' || op.status === 'getup') {
      return dist > 1.6 ? toward : dist < 1.0 ? away : 0;
    }

    const r = Math.random();
    const reach = Math.max(moves.light.hitbox.x + moves.light.hitbox.w, moves.heavy.hitbox.x + moves.heavy.hitbox.w);
    const combo = this.level * 0.7 + 0.15;
    if (dist > 4.5) {
      if (r < 0.04) return this.start([{ bits: INPUT.SPECIAL, ticks: 20 }]);
      if (r < 0.06) return this.start([{ bits: INPUT.UP | toward, ticks: 40 }]);
      if (r < 0.1) return this.start(this.dash(toward));
      if (r < 0.12) return this.start([{ bits: toward | INPUT.SPECIAL, ticks: 40 }]); // Ansturm
      return this.start([{ bits: toward, ticks: 10 }]);
    }
    if (dist > reach + 0.2) {
      if (r < 0.03) return this.start([{ bits: INPUT.SPECIAL, ticks: 25 }]);
      if (r < 0.06) return this.start([{ bits: INPUT.UP | toward, ticks: 22 }, { bits: INPUT.KICK, ticks: 20 }]);
      if (r < 0.12) return this.start(this.dash(toward));
      if (r < 0.15) return this.start([{ bits: away, ticks: 12 }]);
      return this.start([{ bits: toward, ticks: 8 }]);
    }

    // Nahkampf: Würfe, Ketten, Launcher, tiefe und hohe Angriffe mischen
    if (dist < 1.1 && r < 0.08) return this.start([{ bits: INPUT.LIGHT | INPUT.KICK, ticks: 34 }]);
    if (r < 0.12 + combo * 0.25) {
      const strings: [MoveKey[], number[]][] = [
        [['light', 'light2', 'finisher'], [INPUT.LIGHT, INPUT.LIGHT, INPUT.HEAVY]],
        [['light', 'light2', 'kick2'], [INPUT.LIGHT, INPUT.LIGHT, INPUT.KICK]],
        [['light', 'kick', 'kick2'], [INPUT.LIGHT, INPUT.KICK, INPUT.KICK]],
        [['heavy', 'fwdKick'], [INPUT.HEAVY, INPUT.KICK]],
        [['fwdLight', 'finisher'], [toward | INPUT.LIGHT, INPUT.HEAVY]],
        [['lowLight', 'lowLight', 'lowKick'], [INPUT.DOWN | INPUT.LIGHT, INPUT.DOWN | INPUT.LIGHT, INPUT.DOWN | INPUT.KICK]],
      ];
      const [keys, bits] = strings[Math.floor(Math.random() * strings.length)];
      return this.start(this.chain(keys, moves, bits));
    }
    if (r < 0.5) return this.start([{ bits: INPUT.LIGHT, ticks: 12 }]);
    if (r < 0.58) return this.start([{ bits: INPUT.KICK, ticks: 18 }]);
    if (r < 0.64) return this.start([{ bits: away | INPUT.HEAVY, ticks: 30 }]); // Launcher
    if (r < 0.7) return this.start([{ bits: INPUT.DOWN | INPUT.HEAVY, ticks: 26 }]); // Feger
    if (r < 0.75) return this.start([{ bits: toward | INPUT.HEAVY, ticks: 30 }]); // Überkopf
    if (r < 0.8) return this.start([{ bits: INPUT.HEAVY, ticks: 22 }]);
    if (r < 0.86) return this.start([{ bits: INPUT.DOWN | away, ticks: 16 }]); // tief blocken
    if (r < 0.9) return this.start(this.backdash(away));
    return this.start([{ bits: away, ticks: 14 }]);
  }

  private isLow(move: MoveKey | null, _moves: Record<MoveKey, MoveDef>) {
    return move === 'low' || move === 'lowLight' || move === 'lowKick';
  }

  /** Kettenschritte: nächste Taste kurz nach dem aktiven Teil drücken (Input-Puffer fängt Ungenauigkeit ab). */
  private chain(keys: MoveKey[], moves: Record<MoveKey, MoveDef>, bits: number[]): PlanStep[] {
    return keys.map((k, i) => {
      const m = moves[k];
      const last = i === keys.length - 1;
      return { bits: bits[i], ticks: last ? m.startup + m.active + m.recovery : m.startup + m.active + 1 };
    });
  }

  private dash(dir: number): PlanStep[] {
    return [
      { bits: dir, ticks: 2 },
      { bits: 0, ticks: 2 },
      { bits: dir, ticks: 14 },
    ];
  }

  private backdash(dir: number): PlanStep[] {
    return [
      { bits: dir, ticks: 2 },
      { bits: 0, ticks: 2 },
      { bits: dir, ticks: 18 },
    ];
  }

  private queue(steps: PlanStep[]) {
    if (!this.current && !this.plan.length) this.plan = steps;
  }

  private start(steps: PlanStep[]) {
    this.plan = steps;
    this.current = null;
    return this.tick();
  }

  /** Aktuellen Planschritt abspielen: Angriffstasten nur im ersten Tick, Richtungen halten. */
  private tick(): number {
    if (!this.current || this.left <= 0) {
      this.current = this.plan.shift() ?? null;
      if (!this.current) return 0;
      this.left = this.current.ticks;
      this.left -= 1;
      return this.current.bits;
    }
    this.left -= 1;
    const bits = this.current.bits & ~BUTTONS;
    if (this.left <= 0 && !this.plan.length) this.current = null;
    return bits;
  }
}
