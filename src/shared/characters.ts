// Kämpfer-Daten. Alle Werte in Ticks (60 pro Sekunde) bzw. Metern.

export type MoveKey = 'light' | 'heavy' | 'low' | 'air' | 'special';

/** Hitbox relativ zum Kämpfer: x zeigt nach vorn (Blickrichtung), y vom Boden aus. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ProjectileKind = 'pallet' | 'laser' | 'box' | 'clipboard' | 'wave' | 'cup' | 'label' | 'ice' | 'parcel' | 'lidar';

export interface ProjectileDef {
  kind: ProjectileKind;
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
  prop: 'none' | 'scanner' | 'tape' | 'clipboard' | 'mug' | 'tablet' | 'wrench';
  hat: 'helmet' | 'cap' | 'beanie' | 'none';
  /** Körperbreite (1 = normal). */
  build: number;
  mustache?: boolean;
  /** Metallkörper mit leuchtenden Augen statt Haut. */
  robot?: boolean;
  /** Emoji für die Auswahlkarte. */
  icon: string;
  moves: Record<MoveKey, MoveDef>;
}

type H = MoveDef['height'];

/** Kurzschreibweise für Angriffe: Frames (Anlauf/aktiv/Erholung), Schaden, Stun, Rückstoß, Höhe, Hitbox. */
function mv(
  name: string,
  [startup, active, recovery]: [number, number, number],
  damage: number,
  [hitstun, blockstun]: [number, number],
  knockback: number,
  height: H,
  [x, y, w, h]: [number, number, number, number],
  lunge?: number,
): MoveDef {
  return { name, startup, active, recovery, damage, hitstun, blockstun, knockback, height, hitbox: { x, y, w, h }, lunge };
}

function special(
  name: string,
  [startup, recovery]: [number, number],
  damage: number,
  [hitstun, blockstun]: [number, number],
  knockback: number,
  projectile: ProjectileDef,
): MoveDef {
  return { name, startup, active: 1, recovery, damage, hitstun, blockstun, knockback, height: 'mid', hitbox: { x: 0, y: 0, w: 0, h: 0 }, projectile };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'gerd',
    name: 'Gabelstapler-Gerd',
    job: 'Staplerfahrer, 27 Jahre Betriebszugehörigkeit',
    bio: 'Langsam, schwer, unaufhaltsam. Hebt 2,5 Tonnen – und dich.',
    icon: '🏗️',
    maxHp: 1150,
    walkSpeed: 0.042,
    jumpVel: 0.19,
    colors: { vest: 0xff7a00, shirt: 0x3a4a5c, pants: 0x2b3440, skin: 0xe0b48f, helmet: 0xffd200 },
    prop: 'none',
    hat: 'helmet',
    build: 1.15,
    mustache: true,
    moves: {
      light: mv('Klemmbrett-Klatscher', [6, 3, 10], 55, [16, 10], 0.06, 'mid', [0.35, 1.2, 0.75, 0.35]),
      heavy: mv('Gabelzinken-Stoß', [14, 4, 22], 120, [26, 16], 0.16, 'mid', [0.35, 0.9, 1.15, 0.4], 0.03),
      low: mv('Palettenrutscher', [10, 5, 22], 85, [30, 12], 0.1, 'low', [0.3, 0, 1.0, 0.35], 0.04),
      air: mv('Hubmast-Hammer', [7, 8, 6], 95, [22, 12], 0.1, 'high', [0.2, 0.3, 0.8, 0.6]),
      special: special('Europaletten-Wurf', [18, 26], 100, [26, 16], 0.14, { kind: 'pallet', speed: 0.09, w: 1.2, h: 0.35, y: 0.9, life: 140 }),
    },
  },
  {
    id: 'kim',
    name: 'Kommi-Kim',
    job: 'Kommissioniererin, Rekord: 412 Picks/Stunde',
    bio: 'Schnell wie ein Scanner-Piep. Findet jede Lücke im Regal.',
    icon: '📟',
    maxHp: 900,
    walkSpeed: 0.075,
    jumpVel: 0.235,
    colors: { vest: 0xc6ff00, shirt: 0x223344, pants: 0x1d2a3a, skin: 0x8d5a3b, helmet: 0x1e88e5 },
    prop: 'scanner',
    hat: 'helmet',
    build: 0.92,
    moves: {
      light: mv('Scanner-Jab', [4, 3, 7], 35, [14, 8], 0.05, 'mid', [0.3, 1.15, 0.7, 0.3]),
      heavy: mv('Picklisten-Kick', [9, 4, 15], 85, [22, 13], 0.13, 'mid', [0.3, 0.85, 0.95, 0.4], 0.05),
      low: mv('Rollwagen-Tritt', [7, 4, 16], 60, [24, 10], 0.08, 'low', [0.3, 0, 0.9, 0.3], 0.06),
      air: mv('Regalsprung-Kick', [5, 8, 5], 70, [20, 10], 0.1, 'high', [0.2, 0.2, 0.75, 0.55]),
      special: special('Barcode-Strahl', [12, 20], 65, [20, 12], 0.09, { kind: 'laser', speed: 0.2, w: 0.9, h: 0.12, y: 1.25, life: 70 }),
    },
  },
  {
    id: 'piet',
    name: 'Packer Piet',
    job: 'Packstation 7, Spätschicht',
    bio: 'Verpackt alles. Auch Gegner. Mit extra viel Klebeband.',
    icon: '📦',
    maxHp: 1000,
    walkSpeed: 0.058,
    jumpVel: 0.21,
    colors: { vest: 0xff2d55, shirt: 0x5c4033, pants: 0x30343b, skin: 0xf1c7a3, helmet: 0xffffff },
    prop: 'tape',
    hat: 'helmet',
    build: 1,
    moves: {
      light: mv('Klebeband-Ohrfeige', [5, 3, 8], 45, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.75, 0.35]),
      heavy: mv('Karton-Kopfnuss', [11, 4, 18], 100, [24, 14], 0.14, 'mid', [0.3, 1.0, 0.9, 0.5], 0.04),
      low: mv('Stretchfolien-Feger', [8, 5, 18], 70, [26, 11], 0.09, 'low', [0.3, 0, 0.95, 0.32], 0.05),
      air: mv('Paket-Bombe', [6, 8, 6], 80, [21, 11], 0.1, 'high', [0.2, 0.25, 0.8, 0.6]),
      special: special('Karton-Kanone', [14, 22], 80, [22, 14], 0.12, { kind: 'box', speed: 0.13, w: 0.55, h: 0.55, y: 1.0, life: 100 }),
    },
  },
  {
    id: 'lena',
    name: 'Lagerleiterin Lena',
    job: 'Standortleitung, hat für alles eine Kennzahl',
    bio: 'Ihr Klemmbrett ist schärfer als jede Abmahnung.',
    icon: '📋',
    maxHp: 1000,
    walkSpeed: 0.06,
    jumpVel: 0.21,
    colors: { vest: 0x00bcd4, shirt: 0xeceff1, pants: 0x263238, skin: 0xd9a07a, helmet: 0xffffff },
    prop: 'clipboard',
    hat: 'helmet',
    build: 0.95,
    moves: {
      light: mv('Klemmbrett-Kante', [5, 3, 9], 45, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.8, 0.35]),
      heavy: mv('Abmahnungs-Absatz', [10, 4, 17], 95, [24, 14], 0.14, 'mid', [0.3, 0.85, 1.0, 0.4], 0.04),
      low: mv('Dienstplan-Feger', [8, 5, 18], 70, [26, 11], 0.09, 'low', [0.3, 0, 0.95, 0.32], 0.05),
      air: mv('Chefinnen-Sturz', [6, 8, 6], 80, [21, 11], 0.1, 'high', [0.2, 0.25, 0.8, 0.6]),
      special: special('KPI-Klemmbrett', [13, 21], 75, [22, 13], 0.11, { kind: 'clipboard', speed: 0.15, w: 0.5, h: 0.5, y: 1.15, life: 90 }),
    },
  },
  {
    id: 'ludger',
    name: 'LKW-Ludger',
    job: 'Fernfahrer, 40-Tonner, immer zu früh am Tor',
    bio: 'Der Größte in der Halle. Seine Hupe zählt als Waffe.',
    icon: '🚚',
    maxHp: 1250,
    walkSpeed: 0.038,
    jumpVel: 0.18,
    colors: { vest: 0xffeb3b, shirt: 0x8d4b3b, pants: 0x1a3a7a, skin: 0xc68c6a, helmet: 0xd32f2f },
    prop: 'none',
    hat: 'cap',
    build: 1.25,
    mustache: true,
    moves: {
      light: mv('Lenkrad-Hieb', [7, 3, 11], 60, [16, 10], 0.07, 'mid', [0.35, 1.2, 0.8, 0.4]),
      heavy: mv('Ladebordwand', [16, 5, 24], 135, [28, 17], 0.18, 'mid', [0.35, 0.9, 1.2, 0.5], 0.03),
      low: mv('Reifenwechsel', [11, 5, 24], 90, [30, 13], 0.1, 'low', [0.3, 0, 1.05, 0.35], 0.04),
      air: mv('Führerhaus-Fall', [8, 8, 7], 105, [23, 13], 0.12, 'high', [0.15, 0.2, 0.9, 0.7]),
      special: special('Hupkonzert', [20, 26], 95, [26, 16], 0.16, { kind: 'wave', speed: 0.075, w: 0.8, h: 1.5, y: 0.95, life: 110 }),
    },
  },
  {
    id: 'paul',
    name: 'Praktikant Paul',
    job: 'Erster Tag. Hat noch keinen Spind.',
    bio: 'Klein, flink, überkoffeiniert. Unterschätze ihn nicht.',
    icon: '☕',
    maxHp: 820,
    walkSpeed: 0.082,
    jumpVel: 0.245,
    colors: { vest: 0xff9800, shirt: 0x43a047, pants: 0x37474f, skin: 0xf3d0b5, helmet: 0x7e57c2 },
    prop: 'mug',
    hat: 'beanie',
    build: 0.86,
    moves: {
      light: mv('Kaffee-Jab', [3, 3, 7], 30, [13, 8], 0.04, 'mid', [0.3, 1.1, 0.65, 0.3]),
      heavy: mv('Erster-Tag-Kick', [8, 4, 14], 75, [21, 12], 0.12, 'mid', [0.3, 0.85, 0.9, 0.4], 0.06),
      low: mv('Rutsch-Unfall', [6, 5, 15], 55, [24, 10], 0.08, 'low', [0.3, 0, 0.95, 0.3], 0.08),
      air: mv('Übermotiviert', [4, 8, 5], 65, [19, 10], 0.09, 'high', [0.2, 0.2, 0.7, 0.55]),
      special: special('Kaffeebecher-Wurf', [10, 18], 55, [20, 11], 0.08, { kind: 'cup', speed: 0.17, w: 0.3, h: 0.35, y: 1.2, life: 70 }),
    },
  },
  {
    id: 'ingrid',
    name: 'Inventur-Ingrid',
    job: 'Zählt seit 1998 jedes Teil. Zweimal.',
    bio: 'Findet jede Differenz – und jede Deckungslücke.',
    icon: '🏷️',
    maxHp: 950,
    walkSpeed: 0.065,
    jumpVel: 0.22,
    colors: { vest: 0xab47bc, shirt: 0x607d8b, pants: 0x3e2723, skin: 0xe8b796, helmet: 0x4a148c },
    prop: 'tablet',
    hat: 'cap',
    build: 0.95,
    moves: {
      light: mv('Zähl-Stoß', [4, 3, 8], 40, [14, 9], 0.05, 'mid', [0.3, 1.15, 0.75, 0.3]),
      heavy: mv('Differenz-Tritt', [10, 4, 16], 90, [23, 13], 0.13, 'mid', [0.3, 0.85, 0.95, 0.4], 0.04),
      low: mv('Bestands-Feger', [7, 5, 17], 65, [25, 10], 0.08, 'low', [0.3, 0, 0.95, 0.3], 0.05),
      air: mv('Stichproben-Sprung', [5, 8, 6], 75, [20, 10], 0.1, 'high', [0.2, 0.2, 0.8, 0.55]),
      special: special('Etiketten-Salve', [9, 18], 50, [18, 10], 0.07, { kind: 'label', speed: 0.22, w: 0.55, h: 0.25, y: 1.2, life: 60 }),
    },
  },
  {
    id: 'kalle',
    name: 'Kühlhaus-Kalle',
    job: 'Arbeitet bei −24 °C. Im T-Shirt, wenn er könnte.',
    bio: 'Eiskalt im Abgang. Seine Grätsche ist spiegelglatt.',
    icon: '🧊',
    maxHp: 1100,
    walkSpeed: 0.05,
    jumpVel: 0.2,
    colors: { vest: 0x2196f3, shirt: 0x0d3c78, pants: 0x102027, skin: 0xf0c8b0, helmet: 0xb3e5fc },
    prop: 'none',
    hat: 'beanie',
    build: 1.2,
    moves: {
      light: mv('Frostbeulen-Faust', [6, 3, 10], 55, [16, 10], 0.06, 'mid', [0.35, 1.15, 0.75, 0.35]),
      heavy: mv('Tiefkühl-Tritt', [13, 4, 20], 110, [25, 15], 0.15, 'mid', [0.35, 0.85, 1.05, 0.45], 0.04),
      low: mv('Glatteis-Grätsche', [9, 6, 20], 85, [32, 12], 0.12, 'low', [0.3, 0, 1.1, 0.32], 0.07),
      air: mv('Lawine', [7, 8, 6], 90, [22, 12], 0.11, 'high', [0.2, 0.2, 0.85, 0.65]),
      special: special('Eisblock', [16, 24], 95, [26, 15], 0.14, { kind: 'ice', speed: 0.1, w: 0.7, h: 0.7, y: 0.95, life: 120 }),
    },
  },
  {
    id: 'rita',
    name: 'Retouren-Rita',
    job: 'Retourenabteilung. Hat alles schon zurückbekommen.',
    bio: 'Was du austeilst, schickt sie dir zurück – frankiert.',
    icon: '↩️',
    maxHp: 980,
    walkSpeed: 0.066,
    jumpVel: 0.22,
    colors: { vest: 0xffc107, shirt: 0x6d4c41, pants: 0x212121, skin: 0x7a4b2a, helmet: 0x2e7d32 },
    prop: 'wrench',
    hat: 'cap',
    build: 0.98,
    moves: {
      light: mv('Reklamations-Rechte', [5, 3, 8], 45, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.75, 0.33]),
      heavy: mv('Umtausch-Kick', [10, 4, 17], 92, [24, 14], 0.14, 'mid', [0.3, 0.85, 0.95, 0.42], 0.05),
      low: mv('Rücksende-Rutsche', [8, 5, 17], 66, [25, 11], 0.09, 'low', [0.3, 0, 0.95, 0.32], 0.06),
      air: mv('Paketband-Sprung', [6, 8, 6], 76, [21, 11], 0.1, 'high', [0.2, 0.25, 0.8, 0.6]),
      special: special('Rücksende-Paket', [13, 21], 78, [22, 13], 0.12, { kind: 'parcel', speed: 0.14, w: 0.45, h: 0.4, y: 1.0, life: 95 }),
    },
  },
  {
    id: 'robo',
    name: 'Robo-Picker RX-7',
    job: 'Autonomer Kommissionier-Roboter, Firmware 3.1',
    bio: 'Kein Urlaub, keine Pause, kein Erbarmen. Akku: 98 %.',
    icon: '🤖',
    maxHp: 1050,
    walkSpeed: 0.055,
    jumpVel: 0.19,
    colors: { vest: 0xff6d00, shirt: 0x9ea7ad, pants: 0x546e7a, skin: 0xb0bec5, helmet: 0x37474f },
    prop: 'none',
    hat: 'none',
    build: 1.08,
    robot: true,
    moves: {
      light: mv('Greifarm-Jab', [5, 3, 9], 45, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.8, 0.35]),
      heavy: mv('Servo-Stampfer', [12, 4, 19], 102, [25, 15], 0.15, 'mid', [0.3, 0.85, 1.0, 0.45], 0.04),
      low: mv('Fahrwerk-Feger', [9, 5, 19], 75, [27, 12], 0.09, 'low', [0.3, 0, 1.0, 0.33], 0.05),
      air: mv('Hydraulik-Hammer', [7, 8, 6], 86, [22, 12], 0.11, 'high', [0.2, 0.25, 0.85, 0.6]),
      special: special('Lidar-Strahl', [14, 20], 70, [21, 12], 0.1, { kind: 'lidar', speed: 0.19, w: 1.0, h: 0.14, y: 1.35, life: 75 }),
    },
  },
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function moveLength(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}
