// Kämpfer-Daten. Alle Werte in Ticks (60 pro Sekunde) bzw. Metern.

/** Grundmoves (pro Kämpfer von Hand abgestimmt). */
export type BaseMoveKey = 'light' | 'heavy' | 'low' | 'air' | 'special';
/** Abgeleitete Moves – Werte werden aus den Grundmoves berechnet, Namen sind individuell. */
export type ExtraMoveKey =
  | 'light2'
  | 'finisher'
  | 'kick'
  | 'kick2'
  | 'lowLight'
  | 'lowKick'
  | 'fwdLight'
  | 'fwdKick'
  | 'overhead'
  | 'launcher'
  | 'airKick'
  | 'rush'
  | 'throw';
/** Charakter-eigene Moves: zwei Signatur-Spezialmoves und ein eigener Kombo-Abschluss. */
export type SignatureMoveKey = 'sig1' | 'sig2' | 'ender';
export type MoveKey = BaseMoveKey | ExtraMoveKey | SignatureMoveKey;

/** Animationstyp für besondere Moves (nur Darstellung). */
export type AnimKind =
  | 'grab'
  | 'charge'
  | 'hop'
  | 'flurry'
  | 'parry'
  | 'uppercut'
  | 'poke'
  | 'stomp'
  | 'slide'
  | 'toss'
  | 'smash'
  | 'hammer'
  | 'pull'
  | 'spinKick'
  | 'drill'
  | 'lasso';

/** Tasten, mit denen sich ein Move in der Erholungsphase in den nächsten abbrechen lässt (Kombo-Ketten). */
export type ChainButton = 'light' | 'heavy' | 'kick';

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
  /** Wirft den Gegner zu Boden (Feger, Wurf, Rammen). */
  knockdown?: boolean;
  /** Schleudert den Gegner hoch – danach sind Juggles möglich. */
  launch?: number;
  /** Wurf: nicht blockbar, nur aus nächster Nähe, trifft keine Gegner in der Luft. */
  grab?: boolean;
  /** Geduckter Move (Hurtbox niedrig). */
  crouch?: boolean;
  /** Panzerung: steckt so viele Treffer im Anlauf weg (voller Schaden, aber kein Stun). Würfe brechen sie. */
  armor?: number;
  /** Unverwundbar von Tick a bis b (Anti-Air-Uppercut). */
  invuln?: [number, number];
  /** Konterhaltung: fängt mittlere/hohe Angriffe in der aktiven Phase ab. Tiefe Angriffe und Würfe gehen durch. */
  parry?: boolean;
  /** Mehrfachtreffer: so oft kann die Hitbox treffen (Schaden pro Treffer). */
  hits?: number;
  /** Sprung-Angriff vom Boden aus (Startgeschwindigkeit nach oben). */
  hop?: number;
  /** Rutscher: Hurtbox ganz flach – rutscht unter Geschossen durch. */
  slide?: boolean;
  /** Animationstyp für die Darstellung. */
  anim?: AnimKind;
}

export type ChainTable = Partial<Record<MoveKey, Partial<Record<ChainButton, MoveKey>>>>;

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
  /** Kampfstil in zwei, drei Worten (Auswahlkarte, Kampfschule). */
  style: string;
  moves: Record<MoveKey, MoveDef>;
  /** Kombo-Ketten dieses Kämpfers (Grundketten + eigene Routen). */
  chains: ChainTable;
  /** Eigene Kombo-Routen für die Kampfschule: Eingabe, Moves, Erklärung. */
  combos: ComboRoute[];
}

export interface ComboRoute {
  input: string;
  moves: MoveKey[];
  text: string;
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
  height: H = 'mid',
): MoveDef {
  // Fernangriffe gezielt schwächer als Nahkampf: weniger Schaden, längere Erholung (bestrafbar),
  // kürzerer Blockstun – sonst gewinnt, wer nur aus der Distanz wirft.
  return {
    name,
    startup,
    active: 1,
    recovery: recovery + 10,
    damage: Math.round(damage * 0.6),
    hitstun,
    blockstun: Math.round(blockstun * 0.7),
    knockback,
    height,
    hitbox: { x: 0, y: 0, w: 0, h: 0 },
    projectile,
    anim: height === 'low' ? 'toss' : undefined,
  };
}

// --- Bausteine für Signatur-Moves ------------------------------------------

/** Befehlswurf mit eigener Reichweite: nicht blockbar, aber langsam und bei Fehlgriff weit offen. */
function grabMove(name: string, startup: number, range: number, damage: number, anim: AnimKind = 'grab'): MoveDef {
  return { ...mv(name, [startup, 3, 32], damage, [30, 0], 0.1, 'mid', [0.05, 0.3, range, 1.3]), grab: true, knockdown: true, anim };
}

/** Konterhaltung: kein eigener Schaden, fängt den gegnerischen Schlag ab und macht ihn bestrafbar. */
function parryMove(name: string, startup: number, active: number, recovery: number): MoveDef {
  return { ...mv(name, [startup, active, recovery], 0, [0, 0], 0, 'mid', [0, 0, 0, 0]), parry: true, anim: 'parry' };
}

/** Uppercut mit Unverwundbarkeit im Anlauf – Antwort auf Sprungangriffe, geblockt aber stark bestrafbar. */
function risingMove(name: string, startup: number, damage: number, launch: number, invulnTo: number): MoveDef {
  return {
    ...mv(name, [startup, 6, 32], damage, [40, 10], 0.01, 'mid', [0.15, 0.9, 0.75, 1.3]),
    launch,
    invuln: [1, invulnTo],
    anim: 'uppercut',
  };
}

const with_ = (m: MoveDef, extra: Partial<MoveDef>): MoveDef => ({ ...m, ...extra });


const EXTRA_ORDER: ExtraMoveKey[] = [
  'light2', 'finisher', 'kick', 'kick2', 'lowLight', 'lowKick', 'fwdLight', 'fwdKick', 'overhead', 'launcher', 'airKick', 'rush', 'throw',
];

/**
 * Leitet aus den fünf Grundmoves eines Kämpfers die komplette Moveliste ab
 * (Ketten, Tritte, Richtungs-Moves, Launcher, Rammen, Wurf). So bleiben die
 * Charaktere in sich stimmig: Wer schnelle Jabs hat, hat auch schnelle Tritte.
 */
function buildMoves(
  base: Record<BaseMoveKey, MoveDef>,
  names: string[],
  sig: Record<SignatureMoveKey, MoveDef>,
  tweaks: Partial<Record<MoveKey, Partial<MoveDef>>> = {},
): Record<MoveKey, MoveDef> {
  const all = buildBase(base, names);
  // Kombo-Abschlüsse rücken nach, damit sie nach dem Rückstoß der Kette noch erreichen
  const out = { ...all, ...sig, ender: { ...sig.ender, lunge: sig.ender.lunge ?? 0.06 } } as Record<MoveKey, MoveDef>;
  for (const [k, t] of Object.entries(tweaks) as [MoveKey, Partial<MoveDef>][]) out[k] = { ...out[k], ...t };
  return out;
}

function buildBase(base: Record<BaseMoveKey, MoveDef>, names: string[]): Record<BaseMoveKey | ExtraMoveKey, MoveDef> {
  const n = Object.fromEntries(EXTRA_ORDER.map((k, i) => [k, names[i]])) as Record<ExtraMoveKey, string>;
  const L = base.light;
  const Hv = base.heavy;
  const r = (v: number) => Math.max(1, Math.round(v));
  const kickStart = r((L.startup + Hv.startup) / 2);
  const kickDmg = r(((L.damage + Hv.damage) / 2) * 1.05);
  return {
    ...base,
    low: { ...base.low, knockdown: true, crouch: true },
    light2: mv(n.light2, [r(L.startup - 1), L.active, L.recovery + 2], r(L.damage * 0.9), [L.hitstun + 2, L.blockstun], L.knockback, 'mid', [L.hitbox.x, L.hitbox.y - 0.05, L.hitbox.w, L.hitbox.h + 0.05]),
    finisher: mv(n.finisher, [r(Hv.startup - 3), Hv.active, Hv.recovery], r(Hv.damage * 0.85), [Hv.hitstun + 6, Hv.blockstun], Hv.knockback * 1.6, 'mid', [Hv.hitbox.x, 0.95, Hv.hitbox.w, 0.55], 0.04),
    kick: mv(n.kick, [kickStart, 4, r((L.recovery + Hv.recovery) / 2)], kickDmg, [r((L.hitstun + Hv.hitstun) / 2), r((L.blockstun + Hv.blockstun) / 2)], 0.09, 'mid', [0.3, 0.65, Hv.hitbox.w, 0.4]),
    kick2: mv(n.kick2, [kickStart, 4, r(Hv.recovery)], r(kickDmg * 0.95), [Hv.hitstun, Hv.blockstun], 0.13, 'mid', [0.3, 1.05, Hv.hitbox.w, 0.45]),
    lowLight: { ...mv(n.lowLight, [L.startup, L.active, L.recovery], r(L.damage * 0.7), [L.hitstun - 2, L.blockstun], 0.04, 'low', [0.3, 0.25, L.hitbox.w * 0.9, 0.35]), crouch: true },
    lowKick: { ...mv(n.lowKick, [L.startup + 3, 4, L.recovery + 6], r(L.damage * 1.1), [L.hitstun, L.blockstun + 2], 0.06, 'low', [0.3, 0, Hv.hitbox.w * 0.95, 0.3]), crouch: true },
    fwdLight: mv(n.fwdLight, [L.startup + 4, L.active + 1, L.recovery + 4], r(L.damage * 1.4), [L.hitstun + 4, L.blockstun + 2], 0.1, 'mid', [L.hitbox.x, 1.1, L.hitbox.w + 0.1, 0.35], 0.07),
    fwdKick: mv(n.fwdKick, [Hv.startup - 2, 4, Hv.recovery], r(Hv.damage * 0.85), [Hv.hitstun, Hv.blockstun], 0.22, 'mid', [0.3, 0.8, Hv.hitbox.w + 0.05, 0.45], 0.03),
    overhead: { ...mv(n.overhead, [Hv.startup + 5, 5, Hv.recovery + 2], r(Hv.damage * 0.9), [Hv.hitstun, Hv.blockstun], 0.08, 'high', [0.3, 0.6, Hv.hitbox.w * 0.9, 1.1], 0.02), knockdown: true },
    launcher: { ...mv(n.launcher, [Hv.startup - 1, 4, Hv.recovery + 4], r(Hv.damage * 0.65), [40, Hv.blockstun], 0.008, 'mid', [0.25, 0.9, 0.8, 0.95]), launch: 0.21 },
    airKick: mv(n.airKick, [base.air.startup + 1, base.air.active, base.air.recovery], r(base.air.damage * 1.05), [base.air.hitstun, base.air.blockstun], 0.12, 'high', [0.15, 0, base.air.hitbox.w + 0.1, 0.55]),
    rush: { ...mv(n.rush, [12, 12, 22], r(base.special.damage * 1.8), [30, 14], 0.16, 'mid', [0.2, 0.5, 0.8, 1.0], 0.15), knockdown: true },
    throw: { ...mv(n.throw, [5, 2, 26], r(Hv.damage * 1.2), [30, 0], 0.12, 'mid', [0.05, 0.3, 0.95, 1.3]), knockdown: true, grab: true },
  };
}

/** Grund-Kombo-Ketten aller Kämpfer: Move → Taste in der Erholungsphase → Folge-Move (nur nach Treffer oder Block). */
export const CHAINS: ChainTable = {
  light: { light: 'light2', kick: 'kick' },
  light2: { heavy: 'finisher', kick: 'kick2' },
  kick: { kick: 'kick2' },
  lowLight: { light: 'lowLight', kick: 'lowKick' },
  fwdLight: { heavy: 'finisher' },
  heavy: { kick: 'fwdKick' },
};

/** Für Befehlsliste und Hilfe: Eingabe in Kurzform. */
export const MOVE_INPUTS: Record<MoveKey, string> = {
  light: 'Leicht',
  light2: 'Leicht, Leicht',
  finisher: 'Leicht, Leicht, Schwer',
  heavy: 'Schwer',
  kick: 'Tritt',
  kick2: 'Tritt, Tritt',
  low: '↓ + Schwer',
  lowLight: '↓ + Leicht',
  lowKick: '↓ + Tritt',
  fwdLight: '→ + Leicht',
  fwdKick: '→ + Tritt',
  overhead: '→ + Schwer',
  launcher: '← + Schwer',
  air: 'Sprung + Leicht/Schwer',
  airKick: 'Sprung + Tritt',
  special: 'Spezial',
  rush: '→ + Spezial',
  throw: 'Leicht + Tritt (nah)',
  sig1: '↓ + Spezial',
  sig2: '← + Spezial',
  ender: 'Kombo-Abschluss',
};

/** Grundketten um die eigenen Routen eines Kämpfers erweitern. */
function chains(extra: ChainTable): ChainTable {
  const out: ChainTable = {};
  for (const k of new Set([...Object.keys(CHAINS), ...Object.keys(extra)]) as Set<MoveKey>) out[k] = { ...CHAINS[k], ...extra[k] };
  return out;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'gerd',
    name: 'Gabelstapler-Gerd',
    job: 'Staplerfahrer, 27 Jahre Betriebszugehörigkeit',
    bio: 'Langsam, schwer, unaufhaltsam. Hebt 2,5 Tonnen – und dich.',
    icon: '🏗️',
    style: 'Koloss · Würfe & Panzerung',
    maxHp: 1000,
    walkSpeed: 0.042,
    jumpVel: 0.19,
    colors: { vest: 0xff7a00, shirt: 0x3a4a5c, pants: 0x2b3440, skin: 0xe0b48f, helmet: 0xffd200 },
    prop: 'none',
    hat: 'helmet',
    build: 1.15,
    mustache: true,
    moves: buildMoves(
      {
        light: mv('Klemmbrett-Klatscher', [6, 3, 10], 47, [16, 10], 0.06, 'mid', [0.35, 1.2, 0.75, 0.35]),
        heavy: mv('Gabelzinken-Stoß', [14, 4, 22], 108, [26, 16], 0.16, 'mid', [0.35, 0.9, 1.04, 0.4], 0.03),
        low: mv('Palettenrutscher', [10, 5, 22], 85, [30, 12], 0.1, 'low', [0.3, 0, 1.0, 0.35], 0.04),
        air: mv('Hubmast-Hammer', [7, 8, 6], 95, [22, 12], 0.1, 'high', [0.2, 0.3, 0.8, 0.6]),
        special: special('Europaletten-Wurf', [18, 26], 100, [26, 16], 0.14, { kind: 'pallet', speed: 0.09, w: 1.2, h: 0.35, y: 0.9, life: 140 }),
      },
      ['Klemmbrett-Nachschlag', 'Hubgerüst-Hammer', 'Stahlkappen-Tritt', 'Rangier-Kick', 'Fußraum-Jab', 'Bremspedal-Tritt', 'Rammbock-Faust', 'Schaufel-Stoß', 'Lastenaufzug', 'Gabelhub-Uppercut', 'Kipp-Tritt', 'Vollgas-Rammen', 'Palettenwurf-Griff'],
      {
        sig1: grabMove('Gabelhub', 9, 1.05, 150),
        sig2: with_(mv('Hydraulik-Panzer', [18, 10, 28], 85, [28, 18], 0.18, 'mid', [0.2, 0.4, 0.85, 1.1], 0.11), { armor: 1, knockdown: true, anim: 'charge' }),
        ender: with_(mv('Stapler-Hammer', [15, 5, 24], 110, [30, 16], 0.12, 'high', [0.3, 0.4, 1.0, 1.1]), { knockdown: true, anim: 'smash' }),
      },
    ),
    chains: chains({ heavy: { heavy: 'ender' } }),
    combos: [
      { input: 'Schwer, Schwer', moves: ['heavy', 'ender'], text: 'Gabelzinken-Stoß, danach der Stapler-Hammer von oben – muss stehend geblockt werden.' },
      { input: '↓ + Spezial (nah)', moves: ['sig1'], text: 'Gabelhub: Befehlswurf mit großer Reichweite, geht durch jeden Block.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Hydraulik-Panzer: Rammen, das einen Treffer wegsteckt und umwirft.' },
    ],
  },
  {
    id: 'kim',
    name: 'Kommi-Kim',
    job: 'Kommissioniererin, Rekord: 412 Picks/Stunde',
    bio: 'Schnell wie ein Scanner-Piep. Findet jede Lücke im Regal.',
    icon: '📟',
    style: 'Wirbelwind · Tempo & Druck',
    maxHp: 960,
    walkSpeed: 0.075,
    jumpVel: 0.235,
    colors: { vest: 0xc6ff00, shirt: 0x223344, pants: 0x1d2a3a, skin: 0x8d5a3b, helmet: 0x1e88e5 },
    prop: 'scanner',
    hat: 'helmet',
    build: 0.92,
    moves: buildMoves(
      {
        light: mv('Scanner-Jab', [4, 3, 7], 41, [14, 8], 0.05, 'mid', [0.3, 1.15, 0.7, 0.3]),
        heavy: mv('Picklisten-Kick', [9, 4, 15], 85, [22, 13], 0.13, 'mid', [0.3, 0.85, 0.95, 0.4], 0.05),
        low: mv('Rollwagen-Tritt', [7, 4, 16], 60, [24, 10], 0.08, 'low', [0.3, 0, 0.9, 0.3], 0.06),
        air: mv('Regalsprung-Kick', [5, 8, 5], 70, [20, 10], 0.1, 'high', [0.2, 0.2, 0.75, 0.55]),
        special: special('Barcode-Strahl', [12, 20], 65, [20, 12], 0.09, { kind: 'laser', speed: 0.2, w: 0.9, h: 0.12, y: 1.25, life: 70 }),
      },
      ['Doppel-Scan', 'Kommissionier-Finale', 'Pick-Kick', 'Regalfach-Tritt', 'Barcode-Stich', 'Fußleisten-Kick', 'Express-Jab', 'Laufzettel-Tritt', 'Höhenregal-Hieb', 'Hubwagen-Uppercut', 'Lagerfach-Flugtritt', 'Scanner-Sprint', 'Kommissionier-Griff'],
      {
        sig1: with_(mv('Regalsprung', [10, 8, 14], 75, [22, 12], 0.1, 'high', [0.15, 0.1, 0.8, 0.7], 0.075), { hop: 0.15, anim: 'hop' }),
        sig2: with_(mv('Scan-Gewitter', [7, 16, 16], 22, [14, 10], 0.03, 'mid', [0.3, 0.9, 0.8, 0.5], 0.02), { hits: 4, anim: 'flurry' }),
        ender: with_(mv('Express-Scan', [6, 8, 18], 34, [22, 12], 0.14, 'mid', [0.3, 1.0, 0.85, 0.5]), { hits: 2, anim: 'flurry' }),
      },
    ),
    chains: chains({ light2: { light: 'ender' } }),
    combos: [
      { input: 'Leicht, Leicht, Leicht', moves: ['light', 'light2', 'ender'], text: 'Drei schnelle Scans, der letzte trifft doppelt.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Regalsprung: springt nach vorn über tiefe Angriffe, muss stehend geblockt werden.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Scan-Gewitter: vier Treffer in einer Sekunde.' },
    ],
  },
  {
    id: 'piet',
    name: 'Packer Piet',
    job: 'Packstation 7, Spätschicht',
    bio: 'Verpackt alles. Auch Gegner. Mit extra viel Klebeband.',
    icon: '📦',
    style: 'Allrounder · Fesseln & Rollband',
    maxHp: 1000,
    walkSpeed: 0.058,
    jumpVel: 0.21,
    colors: { vest: 0xff2d55, shirt: 0x5c4033, pants: 0x30343b, skin: 0xf1c7a3, helmet: 0xffffff },
    prop: 'tape',
    hat: 'helmet',
    build: 1,
    moves: buildMoves(
      {
        light: mv('Klebeband-Ohrfeige', [5, 3, 8], 49, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.75, 0.35]),
        heavy: mv('Karton-Kopfnuss', [11, 4, 18], 100, [24, 14], 0.14, 'mid', [0.3, 1.0, 0.9, 0.5], 0.04),
        low: mv('Stretchfolien-Feger', [8, 5, 18], 70, [26, 11], 0.09, 'low', [0.3, 0, 0.95, 0.32], 0.05),
        air: mv('Paket-Bombe', [6, 8, 6], 80, [21, 11], 0.1, 'high', [0.2, 0.25, 0.8, 0.6]),
        special: special('Karton-Kanone', [14, 22], 80, [22, 14], 0.12, { kind: 'box', speed: 0.13, w: 0.55, h: 0.55, y: 1.0, life: 100 }),
      },
      ['Klebeband-Doppel', 'Versand-Finale', 'Karton-Kick', 'Packtisch-Tritt', 'Füllmaterial-Stoß', 'Polster-Kick', 'Paketschnur-Schlag', 'Etikettier-Tritt', 'Deckel drauf!', 'Karton-Hochwurf', 'Luftpolster-Tritt', 'Expressversand', 'Einpack-Griff'],
      {
        sig1: special('Rollband-Karton', [16, 22], 85, [24, 12], 0.1, { kind: 'box', speed: 0.11, w: 0.5, h: 0.4, y: 0.22, life: 110 }, 'low'),
        sig2: grabMove('Klebeband-Lasso', 14, 1.6, 95, 'lasso'),
        ender: with_(mv('Klebeband-Fessel', [10, 4, 22], 85, [30, 14], -0.05, 'mid', [0.3, 0.9, 0.95, 0.55]), { anim: 'pull' }),
      },
    ),
    chains: chains({ kick: { heavy: 'ender' } }),
    combos: [
      { input: 'Leicht, Tritt, Schwer', moves: ['light', 'kick', 'ender'], text: 'Die Klebeband-Fessel zieht den Gegner zu dir heran – danach ist er wieder in Reichweite.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Karton über das Rollband: flach am Boden, muss geduckt geblockt werden.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Klebeband-Lasso: Wurf auf mittlere Distanz.' },
    ],
  },
  {
    id: 'lena',
    name: 'Lagerleiterin Lena',
    job: 'Standortleitung, hat für alles eine Kennzahl',
    bio: 'Ihr Klemmbrett ist schärfer als jede Abmahnung.',
    icon: '📋',
    style: 'Strategin · Reichweite & Konter',
    maxHp: 1040,
    walkSpeed: 0.06,
    jumpVel: 0.21,
    colors: { vest: 0x00bcd4, shirt: 0xeceff1, pants: 0x263238, skin: 0xd9a07a, helmet: 0xffffff },
    prop: 'clipboard',
    hat: 'none',
    build: 0.95,
    moves: buildMoves(
      {
        light: mv('Klemmbrett-Kante', [5, 3, 9], 45, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.8, 0.35]),
        heavy: mv('Abmahnungs-Absatz', [10, 4, 17], 95, [24, 14], 0.14, 'mid', [0.3, 0.85, 1.0, 0.4], 0.04),
        low: mv('Dienstplan-Feger', [8, 5, 18], 70, [26, 11], 0.09, 'low', [0.3, 0, 0.95, 0.32], 0.05),
        air: mv('Chefinnen-Sturz', [6, 8, 6], 80, [21, 11], 0.1, 'high', [0.2, 0.25, 0.8, 0.6]),
        special: special('KPI-Klemmbrett', [13, 21], 75, [22, 13], 0.11, { kind: 'clipboard', speed: 0.15, w: 0.5, h: 0.5, y: 1.15, life: 90 }),
      },
      ['Kennzahlen-Konter', 'Jahresgespräch', 'Meeting-Kick', 'Zielvorgabe-Tritt', 'Protokoll-Stich', 'Spesen-Tritt', 'Weisungs-Stoß', 'Eskalations-Kick', 'Chefetagen-Hammer', 'Beförderungs-Uppercut', 'Vorstands-Sprungtritt', 'Budgetkürzung', 'Personalgespräch'],
      {
        sig1: risingMove('Beförderungsstopp', 5, 90, 0.17, 9),
        sig2: with_(mv('Zeigestock-Stoß', [14, 4, 22], 70, [20, 14], 0.16, 'mid', [0.3, 1.0, 1.75, 0.3], 0.02), { anim: 'poke' }),
        ender: with_(mv('Fristlose Kündigung', [12, 5, 22], 85, [30, 14], 0.2, 'mid', [0.3, 0.6, 1.05, 0.6]), { knockdown: true, anim: 'spinKick' }),
      },
    ),
    chains: chains({ finisher: { kick: 'ender' } }),
    combos: [
      { input: '→ + Leicht, Schwer, Tritt', moves: ['fwdLight', 'finisher', 'ender'], text: 'Vorstoß aus der Distanz, Jahresgespräch und zum Schluss die fristlose Kündigung.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Beförderungsstopp: unverwundbarer Uppercut gegen Sprungangriffe. Geblockt weit offen.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Zeigestock: die größte Reichweite im ganzen Lager.' },
    ],
  },
  {
    id: 'ludger',
    name: 'LKW-Ludger',
    job: 'Fernfahrer, 40-Tonner, immer zu früh am Tor',
    bio: 'Der Größte in der Halle. Seine Hupe zählt als Waffe.',
    icon: '🚚',
    style: 'Schwergewicht · Panzerung & Bodenwelle',
    maxHp: 1060,
    walkSpeed: 0.038,
    jumpVel: 0.18,
    colors: { vest: 0xffeb3b, shirt: 0x8d4b3b, pants: 0x1a3a7a, skin: 0xc68c6a, helmet: 0xd32f2f },
    prop: 'none',
    hat: 'cap',
    build: 1.25,
    mustache: true,
    moves: buildMoves(
      {
        light: mv('Lenkrad-Hieb', [7, 3, 11], 50, [16, 10], 0.07, 'mid', [0.35, 1.2, 0.8, 0.4]),
        heavy: mv('Ladebordwand', [16, 5, 24], 135, [28, 17], 0.18, 'mid', [0.35, 0.9, 1.02, 0.5], 0.03),
        low: mv('Reifenwechsel', [11, 5, 24], 90, [30, 13], 0.1, 'low', [0.3, 0, 1.05, 0.35], 0.04),
        air: mv('Führerhaus-Fall', [8, 8, 7], 105, [23, 13], 0.12, 'high', [0.15, 0.2, 0.9, 0.7]),
        special: special('Hupkonzert', [20, 26], 95, [26, 16], 0.16, { kind: 'wave', speed: 0.075, w: 0.8, h: 1.5, y: 0.95, life: 110 }),
      },
      ['Hupen-Hieb', 'Autobahn-Finale', 'Profil-Tritt', 'Kupplungs-Kick', 'Rastplatz-Jab', 'Radmutter-Tritt', 'Überholspur-Faust', 'Ladebordwand-Tritt', 'Plane drüber!', 'Kipper-Uppercut', 'Kabinen-Sprung', 'Vollbremsung', 'Ladungssicherung'],
      {
        sig1: with_(mv('Druckluftbremse', [18, 6, 24], 90, [30, 12], 0.1, 'low', [0.2, 0, 2.0, 0.4]), { knockdown: true, anim: 'stomp' }),
        sig2: with_(mv('Vierzigtonner', [20, 12, 30], 115, [30, 18], 0.2, 'mid', [0.2, 0.4, 0.9, 1.2], 0.12), { armor: 2, knockdown: true, anim: 'charge' }),
        ender: with_(mv('Sattelzug-Kombi', [14, 5, 26], 110, [30, 18], 0.22, 'mid', [0.35, 0.9, 1.1, 0.5], 0.1), { knockdown: true, anim: 'hammer' }),
      },
    ),
    chains: chains({ fwdKick: { heavy: 'ender' } }),
    combos: [
      { input: 'Schwer, Tritt, Schwer', moves: ['heavy', 'fwdKick', 'ender'], text: 'Ladebordwand, Tritt und der Sattelzug mit beiden Fäusten.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Druckluftbremse: Bodenwelle mit riesiger Reichweite, tief blocken.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Vierzigtonner: steckt zwei Treffer weg, aber sehr langsam.' },
    ],
  },
  {
    id: 'paul',
    name: 'Praktikant Paul',
    job: 'Erster Tag. Hat noch keinen Spind.',
    bio: 'Klein, flink, überkoffeiniert. Unterschätze ihn nicht.',
    icon: '☕',
    style: 'Flitzer · Rutscher & Hektik',
    maxHp: 890,
    walkSpeed: 0.082,
    jumpVel: 0.245,
    colors: { vest: 0xff9800, shirt: 0x43a047, pants: 0x37474f, skin: 0xf3d0b5, helmet: 0x7e57c2 },
    prop: 'mug',
    hat: 'beanie',
    build: 0.86,
    moves: buildMoves(
      {
        light: mv('Kaffee-Jab', [3, 3, 7], 37, [13, 8], 0.04, 'mid', [0.3, 1.1, 0.65, 0.3]),
        heavy: mv('Erster-Tag-Kick', [8, 4, 14], 75, [21, 12], 0.12, 'mid', [0.3, 0.85, 0.9, 0.4], 0.06),
        low: mv('Rutsch-Unfall', [6, 5, 15], 55, [24, 10], 0.08, 'low', [0.3, 0, 0.95, 0.3], 0.08),
        air: mv('Übermotiviert', [4, 8, 5], 65, [19, 10], 0.09, 'high', [0.2, 0.2, 0.7, 0.55]),
        special: special('Kaffeebecher-Wurf', [10, 18], 55, [20, 11], 0.08, { kind: 'cup', speed: 0.17, w: 0.3, h: 0.35, y: 1.2, life: 70 }),
      },
      ['Zweiter Kaffee', 'Überstunden-Finale', 'Praktikums-Kick', 'Feedback-Tritt', 'Stolper-Jab', 'Schnürsenkel-Tritt', 'Motivations-Faust', 'Probezeit-Kick', 'Kopierer-Hammer', 'Karrieresprung', 'Azubi-Flugtritt', 'Koffein-Rausch', 'Teamwork-Griff'],
      {
        sig1: with_(mv('Kaffeepfützen-Rutscher', [8, 14, 18], 60, [26, 10], 0.09, 'low', [0.25, 0, 0.9, 0.35], 0.13), { slide: true, crouch: true, knockdown: true, anim: 'slide' }),
        sig2: with_(mv('Espresso-Hektik', [5, 20, 18], 15, [13, 9], 0.025, 'mid', [0.3, 0.95, 0.75, 0.45]), { hits: 5, anim: 'flurry' }),
        ender: with_(mv('Koffein-Kick', [8, 4, 20], 65, [28, 13], 0.2, 'mid', [0.3, 0.9, 0.95, 0.5]), { knockdown: true, anim: 'spinKick' }),
      },
    ),
    chains: chains({ kick2: { kick: 'ender' } }),
    combos: [
      { input: 'Leicht, Leicht, Tritt, Tritt', moves: ['light', 'light2', 'kick2', 'ender'], text: 'Vier Treffer, der Koffein-Kick wirft um.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Rutscht unter Geschossen durch und fegt den Gegner um.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Espresso-Hektik: fünf schnelle Schläge.' },
    ],
  },
  {
    id: 'ingrid',
    name: 'Inventur-Ingrid',
    job: 'Zählt seit 1998 jedes Teil. Zweimal.',
    bio: 'Findet jede Differenz – und jede Deckungslücke.',
    icon: '🏷️',
    style: 'Kontrolle · Konter & Mixups',
    maxHp: 1030,
    walkSpeed: 0.065,
    jumpVel: 0.22,
    colors: { vest: 0xab47bc, shirt: 0x607d8b, pants: 0x3e2723, skin: 0xe8b796, helmet: 0x4a148c },
    prop: 'tablet',
    hat: 'cap',
    build: 0.95,
    moves: buildMoves(
      {
        light: mv('Zähl-Stoß', [4, 3, 8], 40, [14, 9], 0.05, 'mid', [0.3, 1.15, 0.75, 0.3]),
        heavy: mv('Differenz-Tritt', [10, 4, 16], 90, [23, 13], 0.13, 'mid', [0.3, 0.85, 0.95, 0.4], 0.04),
        low: mv('Bestands-Feger', [7, 5, 17], 65, [25, 10], 0.08, 'low', [0.3, 0, 0.95, 0.3], 0.05),
        air: mv('Stichproben-Sprung', [5, 8, 6], 75, [20, 10], 0.1, 'high', [0.2, 0.2, 0.8, 0.55]),
        special: special('Etiketten-Salve', [9, 18], 50, [18, 10], 0.07, { kind: 'label', speed: 0.22, w: 0.55, h: 0.25, y: 1.2, life: 60 }),
      },
      ['Gegenzählung', 'Jahresinventur', 'Bestands-Kick', 'Zähllisten-Tritt', 'Nullbestand-Stich', 'Lagerort-Tritt', 'Soll-Ist-Faust', 'Fehlbestand-Kick', 'Stichtag-Hammer', 'Bilanz-Uppercut', 'Stichproben-Sprungtritt', 'Inventur-Sturm', 'Erfassungs-Griff'],
      {
        sig1: parryMove('Doppelt gezählt', 4, 16, 20),
        sig2: special('Etiketten-Teppich', [14, 20], 70, [22, 12], 0.08, { kind: 'label', speed: 0.09, w: 0.8, h: 0.3, y: 0.2, life: 120 }, 'low'),
        ender: with_(mv('Nachzähl-Hieb', [14, 5, 22], 90, [28, 15], 0.14, 'high', [0.3, 0.5, 0.95, 1.0]), { knockdown: true, anim: 'smash' }),
      },
    ),
    chains: chains({ lowLight: { heavy: 'ender' } }),
    combos: [
      { input: '↓ Leicht, ↓ Leicht, Schwer', moves: ['lowLight', 'lowLight', 'ender'], text: 'Zweimal tief, dann von oben: Wer geduckt blockt, wird erwischt.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Konterhaltung: fängt mittlere und hohe Angriffe ab. Tiefe Angriffe und Würfe gehen durch.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Etiketten flach über den Boden, tief blocken.' },
    ],
  },
  {
    id: 'kalle',
    name: 'Kühlhaus-Kalle',
    job: 'Arbeitet bei −24 °C. Im T-Shirt, wenn er könnte.',
    bio: 'Eiskalt im Abgang. Seine Grätsche ist spiegelglatt.',
    icon: '🧊',
    style: 'Eisblock · Grätsche & Panzerung',
    maxHp: 990,
    walkSpeed: 0.05,
    jumpVel: 0.2,
    colors: { vest: 0x2196f3, shirt: 0x0d3c78, pants: 0x102027, skin: 0xf0c8b0, helmet: 0xb3e5fc },
    prop: 'none',
    hat: 'beanie',
    build: 1.2,
    moves: buildMoves(
      {
        light: mv('Frostbeulen-Faust', [6, 3, 10], 47, [16, 10], 0.06, 'mid', [0.35, 1.15, 0.75, 0.35]),
        heavy: mv('Tiefkühl-Tritt', [13, 4, 20], 100, [25, 15], 0.15, 'mid', [0.35, 0.85, 0.98, 0.45], 0.04),
        low: mv('Glatteis-Grätsche', [9, 6, 20], 85, [32, 12], 0.12, 'low', [0.3, 0, 1.1, 0.32], 0.07),
        air: mv('Lawine', [7, 8, 6], 90, [22, 12], 0.11, 'high', [0.2, 0.2, 0.85, 0.65]),
        special: special('Eisblock', [16, 24], 95, [26, 15], 0.14, { kind: 'ice', speed: 0.1, w: 0.7, h: 0.7, y: 0.95, life: 120 }),
      },
      ['Frost-Doppel', 'Schockfrost-Finale', 'Eiskristall-Tritt', 'Kühlketten-Kick', 'Raureif-Stich', 'Glatteis-Tritt', 'Kältebrücken-Faust', 'Gefrierbrand-Kick', 'Eiszapfen-Hammer', 'Tiefkühl-Uppercut', 'Schneeflocken-Tritt', 'Lawinen-Rammen', 'Kühlhaus-Umarmung'],
      {
        sig1: with_(mv('Eisglätte-Grätsche', [14, 12, 28], 70, [28, 12], 0.12, 'low', [0.25, 0, 1.0, 0.35], 0.12), { slide: true, crouch: true, knockdown: true, anim: 'slide' }),
        sig2: with_(mv('Kühlschrank-Stampfer', [20, 5, 26], 85, [30, 16], 0.1, 'high', [0.3, 0.3, 1.1, 1.1]), { armor: 1, knockdown: true, anim: 'smash' }),
        ender: with_(mv('Gefrierschock', [12, 5, 26], 80, [40, 14], 0.01, 'mid', [0.3, 0.8, 0.95, 0.7]), { launch: 0.19, anim: 'uppercut' }),
      },
    ),
    chains: chains({ heavy: { heavy: 'ender' } }),
    combos: [
      { input: 'Schwer, Schwer', moves: ['heavy', 'ender'], text: 'Tiefkühl-Tritt und Gefrierschock schleudern hoch – danach Juggle möglich.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Lange Grätsche übers Eis, rutscht unter Geschossen durch.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Kühlschrank-Stampfer: gepanzert, von oben, stehend blocken.' },
    ],
  },
  {
    id: 'rita',
    name: 'Retouren-Rita',
    job: 'Retourenabteilung. Hat alles schon zurückbekommen.',
    bio: 'Was du austeilst, schickt sie dir zurück – frankiert.',
    icon: '↩️',
    style: 'Konterspielerin · Wirbel & Uppercut',
    maxHp: 1040,
    walkSpeed: 0.066,
    jumpVel: 0.22,
    colors: { vest: 0xffc107, shirt: 0x6d4c41, pants: 0x212121, skin: 0x7a4b2a, helmet: 0x2e7d32 },
    prop: 'wrench',
    hat: 'none',
    build: 0.98,
    moves: buildMoves(
      {
        light: mv('Reklamations-Rechte', [5, 3, 8], 45, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.75, 0.33]),
        heavy: mv('Umtausch-Kick', [10, 4, 17], 92, [24, 14], 0.14, 'mid', [0.3, 0.85, 0.95, 0.42], 0.05),
        low: mv('Rücksende-Rutsche', [8, 5, 17], 66, [25, 11], 0.09, 'low', [0.3, 0, 0.95, 0.32], 0.06),
        air: mv('Paketband-Sprung', [6, 8, 6], 76, [21, 11], 0.1, 'high', [0.2, 0.25, 0.8, 0.6]),
        special: special('Rücksende-Paket', [13, 21], 78, [22, 13], 0.12, { kind: 'parcel', speed: 0.14, w: 0.45, h: 0.4, y: 1.0, life: 95 }),
      },
      ['Widerrufs-Hieb', 'Gutschrift-Finale', 'Umtausch-Tritt', 'Rückläufer-Kick', 'Mängel-Stich', 'Defekt-Tritt', 'Reklamations-Faust', 'Erstattungs-Kick', 'Kulanz-Hammer', 'Retouren-Uppercut', 'Rücksende-Flugtritt', 'Express-Retoure', 'Rücknahme-Griff'],
      {
        sig1: with_(mv('Schraubenschlüssel-Wirbel', [9, 15, 20], 30, [16, 10], 0.05, 'mid', [0.3, 0.8, 0.9, 0.6], 0.05), { hits: 3, anim: 'drill' }),
        sig2: risingMove('Rücksende-Uppercut', 6, 85, 0.16, 8),
        ender: with_(mv('Retourenschein-Dreher', [10, 5, 22], 80, [28, 14], 0.2, 'mid', [0.3, 0.7, 1.0, 0.6]), { knockdown: true, anim: 'spinKick' }),
      },
    ),
    chains: chains({ kick2: { heavy: 'ender' } }),
    combos: [
      { input: 'Leicht, Tritt, Tritt, Schwer', moves: ['light', 'kick', 'kick2', 'ender'], text: 'Vier Treffer, der Dreher wirft um.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Schraubenschlüssel-Wirbel: drei Treffer mit Vorwärtsdrang.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Rücksende-Uppercut: unverwundbar gegen Sprungangriffe.' },
    ],
  },
  {
    id: 'robo',
    name: 'Robo-Picker RX-7',
    job: 'Autonomer Kommissionier-Roboter, Firmware 3.1',
    bio: 'Kein Urlaub, keine Pause, kein Erbarmen. Akku: 98 %.',
    icon: '🤖',
    style: 'Maschine · Greifer & Bohrer',
    maxHp: 1040,
    walkSpeed: 0.055,
    jumpVel: 0.19,
    colors: { vest: 0xff6d00, shirt: 0x9ea7ad, pants: 0x546e7a, skin: 0xb0bec5, helmet: 0x37474f },
    prop: 'none',
    hat: 'none',
    build: 1.08,
    robot: true,
    moves: buildMoves(
      {
        light: mv('Greifarm-Jab', [5, 3, 9], 45, [15, 9], 0.05, 'mid', [0.3, 1.15, 0.8, 0.35]),
        heavy: mv('Servo-Stampfer', [12, 4, 19], 102, [25, 15], 0.15, 'mid', [0.3, 0.85, 1.0, 0.45], 0.04),
        low: mv('Fahrwerk-Feger', [9, 5, 19], 75, [27, 12], 0.09, 'low', [0.3, 0, 1.0, 0.33], 0.05),
        air: mv('Hydraulik-Hammer', [7, 8, 6], 86, [22, 12], 0.11, 'high', [0.2, 0.25, 0.85, 0.6]),
        special: special('Lidar-Strahl', [14, 20], 70, [21, 12], 0.1, { kind: 'lidar', speed: 0.19, w: 1.0, h: 0.14, y: 1.35, life: 75 }),
      },
      ['Servo-Doppel', 'Algorithmus-Finale', 'Rad-Kick', 'Sensor-Tritt', 'Diagnose-Stich', 'Fahrgestell-Tritt', 'Turbo-Greifer', 'Kolben-Tritt', 'Hydraulik-Presse', 'Hebebühnen-Uppercut', 'Raketen-Tritt', 'Overdrive', 'Greifarm-Wurf'],
      {
        sig1: grabMove('Magnetgreifer', 14, 1.6, 115),
        sig2: risingMove('Overclock-Uppercut', 6, 85, 0.17, 8),
        ender: with_(mv('Turbo-Bohrer', [9, 16, 20], 24, [16, 10], 0.04, 'mid', [0.3, 0.8, 0.9, 0.5]), { hits: 4, anim: 'drill' }),
      },
    ),
    chains: chains({ kick2: { kick: 'ender' } }),
    combos: [
      { input: 'Tritt, Tritt, Tritt', moves: ['kick', 'kick2', 'ender'], text: 'Zwei Tritte, dann bohrt der Turbo-Bohrer viermal.' },
      { input: '↓ + Spezial', moves: ['sig1'], text: 'Magnetgreifer: Wurf auf große Distanz.' },
      { input: '← + Spezial', moves: ['sig2'], text: 'Overclock-Uppercut: unverwundbar gegen Sprungangriffe.' },
    ],
  },
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function moveLength(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}
