import { getCharacter } from '../shared/characters';
import { type GameState, INPUT } from '../shared/game';

// Einfacher CPU-Gegner: reagiert mit Verzögerung, hält Abstand je nach Lage,
// blockt manchmal und streut Angriffe.
export class CpuController {
  private hold = 0;
  private holdTicks = 0;
  private reaction = 0;

  constructor(private slot: 0 | 1, private level = 0.6) {}

  next(s: GameState): number {
    const me = s.fighters[this.slot];
    const op = s.fighters[this.slot === 0 ? 1 : 0];
    if (s.phase !== 'fight') return 0;

    const toward = op.x > me.x ? INPUT.RIGHT : INPUT.LEFT;
    const away = toward === INPUT.RIGHT ? INPUT.LEFT : INPUT.RIGHT;
    const dist = Math.abs(op.x - me.x);

    // Bedrohung erkennen: gegnerischer Angriff oder Projektil auf mich zu
    const threat =
      (op.status === 'attack' && dist < 2.2) ||
      s.projectiles.some((p) => p.owner !== this.slot && Math.sign(me.x - p.x) === Math.sign(p.vx) && Math.abs(me.x - p.x) < 3.5);
    if (threat && this.reaction <= 0 && Math.random() < this.level * 0.5) {
      const low = op.move === 'low';
      const projectile = s.projectiles.some((p) => p.owner !== this.slot);
      if (projectile && Math.random() < 0.35) return this.set(INPUT.UP | toward, 30);
      return this.set(away | (low ? INPUT.DOWN : 0), 14);
    }

    if (this.holdTicks > 0) {
      this.holdTicks -= 1;
      // Angriffstasten nur einen Tick lang drücken, damit sie als "gedrückt" zählen
      const out = this.hold;
      this.hold &= ~(INPUT.LIGHT | INPUT.HEAVY | INPUT.SPECIAL);
      return out;
    }
    this.reaction -= 1;
    if (me.status === 'hitstun' || me.status === 'blockstun') {
      this.reaction = Math.round(14 * (1.2 - this.level));
      return away;
    }

    const r = Math.random();
    const reach = Math.max(...Object.values(getCharacter(me.char).moves).map((m) => m.hitbox.x + m.hitbox.w));
    if (dist > 4.5) {
      if (r < 0.04) return this.set(INPUT.SPECIAL, 20);
      if (r < 0.06) return this.set(INPUT.UP | toward, 40);
      return this.set(toward, 10);
    }
    if (dist > reach + 0.2) {
      if (r < 0.03) return this.set(INPUT.SPECIAL, 25);
      if (r < 0.06) return this.set(INPUT.UP | toward, 30);
      if (r < 0.12) return this.set(away, 12);
      return this.set(toward, 8);
    }
    if (r < 0.35) return this.set(INPUT.LIGHT, 12);
    if (r < 0.55) return this.set(INPUT.HEAVY, 22);
    if (r < 0.7) return this.set(INPUT.DOWN | INPUT.HEAVY, 24);
    if (r < 0.8) return this.set(INPUT.UP | toward | INPUT.HEAVY, 30);
    return this.set(away, 15);
  }

  private set(bits: number, ticks: number) {
    this.hold = bits;
    this.holdTicks = ticks;
    const out = this.hold;
    this.hold &= ~(INPUT.LIGHT | INPUT.HEAVY | INPUT.SPECIAL);
    return out;
  }
}
