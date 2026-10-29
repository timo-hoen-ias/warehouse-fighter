// Kämpfer-Daten. Alle Werte in Ticks (60 pro Sekunde) bzw. Metern.

export type MoveKey = 'light' | 'heavy' | 'low' | 'air' | 'special';

/** Hitbox relativ zum Kämpfer: x zeigt nach vorn (Blickrichtung), y vom Boden aus. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectileDef {
  kind: 'pallet' | 'laser' | 'box';
  speed: number;
  w: number;
  h: number;
  y: number;
  life: number;
}

export interface MoveDef {
  name: string;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  knockback: number;
  /** 'low' muss geduckt geblockt werden, 'high' (Sprungangriffe) stehend. */
  height: 'mid' | 'low' | 'high';
  hitbox: Box;
  /** Vorwärtsbewegung während des Angriffs (pro Tick). */
  lunge?: number;
  projectile?: ProjectileDef;
}

export interface CharacterDef {
  id: string;
  name: string;
  job: string;
  bio: string;
  maxHp: number;
  walkSpeed: number;
  jumpVel: number;
  colors: { vest: number; shirt: number; pants: number; skin: number; helmet: number };
  prop: 'none' | 'scanner' | 'tape';
  moves: Record<MoveKey, MoveDef>;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'gerd',
    name: 'Gabelstapler-Gerd',
    job: 'Staplerfahrer, 27 Jahre Betriebszugehörigkeit',
    bio: 'Langsam, schwer, unaufhaltsam. Hebt 2,5 Tonnen – und dich.',
    maxHp: 1150,
    walkSpeed: 0.042,
    jumpVel: 0.19,
    colors: { vest: 0xff7a00, shirt: 0x3a4a5c, pants: 0x2b3440, skin: 0xe0b48f, helmet: 0xffd200 },
    prop: 'none',
    moves: {
      light: { name: 'Klemmbrett-Klatscher', startup: 6, active: 3, recovery: 10, damage: 55, hitstun: 16, blockstun: 10, knockback: 0.06, height: 'mid', hitbox: { x: 0.35, y: 1.2, w: 0.75, h: 0.35 } },
      heavy: { name: 'Gabelzinken-Stoß', startup: 14, active: 4, recovery: 22, damage: 120, hitstun: 26, blockstun: 16, knockback: 0.16, height: 'mid', hitbox: { x: 0.35, y: 0.9, w: 1.15, h: 0.4 }, lunge: 0.03 },
      low: { name: 'Palettenrutscher', startup: 10, active: 5, recovery: 22, damage: 85, hitstun: 30, blockstun: 12, knockback: 0.1, height: 'low', hitbox: { x: 0.3, y: 0.0, w: 1.0, h: 0.35 }, lunge: 0.04 },
      air: { name: 'Hubmast-Hammer', startup: 7, active: 8, recovery: 6, damage: 95, hitstun: 22, blockstun: 12, knockback: 0.1, height: 'high', hitbox: { x: 0.2, y: 0.3, w: 0.8, h: 0.6 } },
      special: { name: 'Europaletten-Wurf', startup: 18, active: 1, recovery: 26, damage: 100, hitstun: 26, blockstun: 16, knockback: 0.14, height: 'mid', hitbox: { x: 0, y: 0, w: 0, h: 0 }, projectile: { kind: 'pallet', speed: 0.09, w: 1.2, h: 0.35, y: 0.9, life: 140 } },
    },
  },
  {
    id: 'kim',
    name: 'Kommi-Kim',
    job: 'Kommissioniererin, Rekord: 412 Picks/Stunde',
    bio: 'Schnell wie ein Scanner-Piep. Findet jede Lücke im Regal.',
    maxHp: 900,
    walkSpeed: 0.075,
    jumpVel: 0.235,
    colors: { vest: 0xc6ff00, shirt: 0x223344, pants: 0x1d2a3a, skin: 0x8d5a3b, helmet: 0x1e88e5 },
    prop: 'scanner',
    moves: {
      light: { name: 'Scanner-Jab', startup: 4, active: 3, recovery: 7, damage: 35, hitstun: 14, blockstun: 8, knockback: 0.05, height: 'mid', hitbox: { x: 0.3, y: 1.15, w: 0.7, h: 0.3 } },
      heavy: { name: 'Picklisten-Kick', startup: 9, active: 4, recovery: 15, damage: 85, hitstun: 22, blockstun: 13, knockback: 0.13, height: 'mid', hitbox: { x: 0.3, y: 0.85, w: 0.95, h: 0.4 }, lunge: 0.05 },
      low: { name: 'Rollwagen-Tritt', startup: 7, active: 4, recovery: 16, damage: 60, hitstun: 24, blockstun: 10, knockback: 0.08, height: 'low', hitbox: { x: 0.3, y: 0.0, w: 0.9, h: 0.3 }, lunge: 0.06 },
      air: { name: 'Regalsprung-Kick', startup: 5, active: 8, recovery: 5, damage: 70, hitstun: 20, blockstun: 10, knockback: 0.1, height: 'high', hitbox: { x: 0.2, y: 0.2, w: 0.75, h: 0.55 } },
      special: { name: 'Barcode-Strahl', startup: 12, active: 1, recovery: 20, damage: 65, hitstun: 20, blockstun: 12, knockback: 0.09, height: 'mid', hitbox: { x: 0, y: 0, w: 0, h: 0 }, projectile: { kind: 'laser', speed: 0.2, w: 0.9, h: 0.12, y: 1.25, life: 70 } },
    },
  },
  {
    id: 'piet',
    name: 'Packer Piet',
    job: 'Packstation 7, Spätschicht',
    bio: 'Verpackt alles. Auch Gegner. Mit extra viel Klebeband.',
    maxHp: 1000,
    walkSpeed: 0.058,
    jumpVel: 0.21,
    colors: { vest: 0xff2d55, shirt: 0x5c4033, pants: 0x30343b, skin: 0xf1c7a3, helmet: 0xffffff },
    prop: 'tape',
    moves: {
      light: { name: 'Klebeband-Ohrfeige', startup: 5, active: 3, recovery: 8, damage: 45, hitstun: 15, blockstun: 9, knockback: 0.05, height: 'mid', hitbox: { x: 0.3, y: 1.15, w: 0.75, h: 0.35 } },
      heavy: { name: 'Karton-Kopfnuss', startup: 11, active: 4, recovery: 18, damage: 100, hitstun: 24, blockstun: 14, knockback: 0.14, height: 'mid', hitbox: { x: 0.3, y: 1.0, w: 0.9, h: 0.5 }, lunge: 0.04 },
      low: { name: 'Stretchfolien-Feger', startup: 8, active: 5, recovery: 18, damage: 70, hitstun: 26, blockstun: 11, knockback: 0.09, height: 'low', hitbox: { x: 0.3, y: 0.0, w: 0.95, h: 0.32 }, lunge: 0.05 },
      air: { name: 'Paket-Bombe', startup: 6, active: 8, recovery: 6, damage: 80, hitstun: 21, blockstun: 11, knockback: 0.1, height: 'high', hitbox: { x: 0.2, y: 0.25, w: 0.8, h: 0.6 } },
      special: { name: 'Karton-Kanone', startup: 14, active: 1, recovery: 22, damage: 80, hitstun: 22, blockstun: 14, knockback: 0.12, height: 'mid', hitbox: { x: 0, y: 0, w: 0, h: 0 }, projectile: { kind: 'box', speed: 0.13, w: 0.55, h: 0.55, y: 1.0, life: 100 } },
    },
  },
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function moveLength(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}
