// Eigene Animationen je Kämpfer: wie er seine Grundschläge ausführt, was er im Leerlauf macht,
// wie er die Runde eröffnet, wie er läuft und wie er jubelt. Nur Darstellung.
//
// Winkel in Radiant: arm 0 = hängt, π/2 = waagerecht nach vorn, π = nach oben; fore = Ellbogenbeugung.
// leg 0 = gerade, positiv = nach vorn; knee = Kniebeugung. lean > 0 = nach vorn gebeugt.

import type { MoveKey } from '../shared/characters';
import type { Pose } from './fighterModel';

type P = Partial<Pose>;
type Limb = 'handF' | 'handB' | 'footF' | 'footB';

export interface MoveAnim {
  windup: P;
  strike: P;
  limb?: Limb | null;
}

/** `t` = Sekunden (Echtzeit), `n` = Ticks im aktuellen Zustand. */
type Dyn = (t: number, n: number) => P;

export interface CharAnims {
  /** Eigene Ausführung von Grundmoves (überschreibt die Standard-Animation). */
  moves: Partial<Record<MoveKey, MoveAnim>>;
  /** Leerlauf-Geste, wenn man eine Weile still steht. */
  fidget: Dyn;
  /** Pose vor dem Rundenbeginn. */
  intro: Dyn;
  /** Siegerpose. */
  win: Dyn;
  /** Gangart. */
  walk: 'normal' | 'waddle' | 'bounce' | 'march' | 'prowl';
  /** Wie stark Treffer den Körper verbiegen (Schwergewichte wanken weniger). */
  flinch: number;
}

const s = Math.sin;
const pulse = (t: number, hz: number) => Math.max(0, s(t * hz * Math.PI * 2));

export const CHAR_ANIMS: Record<string, CharAnims> = {
  gerd: {
    moves: {
      light: { windup: { armF: 2.5, foreF: 1.1, twist: -0.2, lean: -0.1 }, strike: { armF: 1.2, foreF: 0.2, twist: 0.55, lean: 0.35, hipTwist: 0.15 } },
      heavy: {
        // Gabelzinken: beide Arme stoßen parallel nach vorn
        windup: { armF: 0.5, foreF: 2.3, armB: 0.5, foreB: 2.3, lean: -0.15, hipX: -0.08, twist: 0 },
        strike: { armF: 1.55, foreF: 0, armB: 1.55, foreB: 0, lean: 0.5, hipX: 0.18, twist: 0, legF: 0.7, kneeF: 0.6, legB: -0.6 },
        limb: 'handF',
      },
      kick: { windup: { legF: 1.4, kneeF: 2.0, lean: -0.05, armF: 0.6 }, strike: { legF: 1.0, kneeF: 0.05, lean: -0.15, hipX: 0.1, legB: -0.2 }, limb: 'footF' },
    },
    fidget: (t) => ({ head: s(t * 3) * 0.45, armF: 0.4, foreF: 1.2, armB: 0.3, twist: s(t * 3) * 0.2 }),
    intro: (t) => ({ armF: 1.45, foreF: 2.2 + s(t * 10) * 0.25, armB: 1.4, foreB: 2.2 - s(t * 10) * 0.25, twist: 0, lean: 0.1 }),
    win: (t) => ({ armF: 1.5, foreF: 2.6 + s(t * 4) * 0.2, armB: 1.5, foreB: 2.6 - s(t * 4) * 0.2, twist: 0, lean: -0.1, hipY: -0.08, head: -0.15 }),
    walk: 'waddle',
    flinch: 0.6,
  },
  kim: {
    moves: {
      light: { windup: { armF: 1.25, foreF: 2.45, twist: -0.15 }, strike: { armF: 1.62, foreF: 0, twist: 0.5, lean: 0.3, hipX: 0.06 } },
      kick: {
        // hoher Roundhouse mit gezogenem Knie
        windup: { legF: 1.9, kneeF: 2.4, hipTwist: 0.5, lean: -0.15, armF: 1.3, foreF: 2.2 },
        strike: { legF: 1.85, kneeF: 0.05, hipTwist: 0.9, lean: -0.45, twist: -0.3, armF: 1.2, armB: -0.3 },
        limb: 'footF',
      },
      heavy: {
        windup: { legB: 0.9, kneeB: 2.1, twist: 0.8, hipTwist: 0.8 },
        strike: { legB: 1.9, kneeB: 0.05, lean: -0.55, hipTwist: -1.1, twist: -0.6, armF: 1.3, foreF: 2.2 },
        limb: 'footB',
      },
    },
    // zielt mit dem Scanner, piept, schaut nach
    fidget: (t) => ({ armF: 1.55, foreF: 0.25, head: 0.15 + s(t * 6) * 0.05, twist: 0.4, lean: 0.05 }),
    intro: (t) => ({ hipY: -0.1 + Math.abs(s(t * 8)) * 0.07, armF: 1.3, foreF: 2.3, armB: 1.1, foreB: 2.3, legF: 0.5, kneeF: 0.55 }),
    win: (t) => ({ armF: 3.0, foreF: 0.2 + pulse(t, 1.5) * 0.4, armB: 0.6, foreB: 2.2, hipY: -0.05 + Math.abs(s(t * 6)) * 0.12, head: -0.25 }),
    walk: 'bounce',
    flinch: 1.1,
  },
  piet: {
    moves: {
      light: {
        // Ohrfeige: offene Hand quer von außen
        windup: { armF: 1.4, foreF: 0.8, twist: -0.75, hipTwist: -0.2 },
        strike: { armF: 1.5, foreF: 0.4, twist: 0.65, hipTwist: 0.2, lean: 0.25 },
      },
      heavy: {
        // Kopfnuss
        windup: { lean: -0.35, head: -0.45, armF: 0.4, armB: 0.3, hipX: -0.06 },
        strike: { lean: 0.95, head: 0.65, armF: -0.3, foreF: 1.0, armB: -0.4, foreB: 1.0, hipX: 0.16, legF: 0.7, kneeF: 0.6, legB: -0.6 },
        limb: null,
      },
    },
    // reißt Klebeband ab
    fidget: (t) => ({ armF: 1.2, foreF: 1.2 + s(t * 7) * 0.3, armB: 1.3, foreB: 0.6 - s(t * 7) * 0.3, head: 0.3, twist: 0.1 }),
    intro: (t) => ({ armF: 1.3, foreF: 1.0, armB: 1.3, foreB: 1.0 + Math.abs(s(t * 3)) * 1.2, head: 0.2 }),
    win: (t) => ({ armF: 1.45, foreF: 1.6, twist: 0.3, armB: 0.3, foreB: 1.5, head: -0.1 + s(t * 2) * 0.05, hipY: -0.04 }),
    walk: 'normal',
    flinch: 0.9,
  },
  lena: {
    moves: {
      light: {
        // Klemmbrett von oben auf die Kante
        windup: { armF: 2.8, foreF: 0.9, lean: -0.15, twist: 0.1 },
        strike: { armF: 1.2, foreF: 0.25, lean: 0.4, twist: 0.3 },
      },
      heavy: {
        // Absatz-Tritt nach vorn
        windup: { legF: 1.8, kneeF: 2.3, lean: -0.25, armF: 0.9, armB: 0.6 },
        strike: { legF: 1.5, kneeF: 0.0, lean: -0.4, hipX: 0.08, armF: 0.6, armB: 0.2 },
        limb: 'footF',
      },
    },
    // schaut aufs Klemmbrett und hakt ab
    fidget: (t) => ({ armF: 1.2, foreF: 2.05, head: 0.45, armB: 1.0, foreB: 2.3 + s(t * 12) * 0.12, twist: 0.35 }),
    intro: () => ({ armF: 1.35, foreF: 2.55, armB: 1.35, foreB: 2.55, lean: -0.12, head: -0.15, twist: 0 }),
    win: (t) => ({ armB: 2.5, foreB: 2.75, armF: 1.5, foreF: 0.2, head: -0.1 + s(t * 2) * 0.03, lean: -0.1, twist: 0.4 }),
    walk: 'prowl',
    flinch: 0.9,
  },
  ludger: {
    moves: {
      light: {
        // weiter Schwinger wie am Lenkrad
        windup: { armF: 1.4, foreF: 1.3, twist: -0.9, hipTwist: -0.3 },
        strike: { armF: 1.5, foreF: 0.9, twist: 0.8, hipTwist: 0.35, lean: 0.3 },
      },
      heavy: {
        // Bauchramme
        windup: { lean: 0.25, hipX: -0.12, armF: -0.4, armB: -0.4, foreF: 0.5, foreB: 0.5 },
        strike: { lean: -0.45, hipX: 0.3, armF: -0.6, armB: -0.6, foreF: 0.3, foreB: 0.3, legF: 0.8, kneeF: 0.6, legB: -0.7, head: -0.2 },
        limb: null,
      },
    },
    // kratzt sich am Bauch, streckt den Rücken
    fidget: (t) => ({ lean: -0.3, armF: 0.35, foreF: 2.0 + s(t * 9) * 0.2, armB: -0.3, foreB: 1.5, head: -0.25 }),
    intro: (t) => ({ armF: 0.5, foreF: 2.1 + pulse(t, 2) * 0.4, armB: 0.5, foreB: 2.1 + pulse(t + 0.25, 2) * 0.4, lean: -0.15 }),
    // zieht an der Hupe
    win: (t) => ({ armF: 2.6 - pulse(t, 1.2) * 0.8, foreF: 0.7, armB: 0.4, foreB: 1.6, lean: -0.2, head: -0.3 }),
    walk: 'waddle',
    flinch: 0.55,
  },
  paul: {
    moves: {
      light: { windup: { armF: 1.0, foreF: 2.4, twist: -0.1, head: 0.2 }, strike: { armF: 1.6, foreF: 0.1, twist: 0.4, lean: 0.25, head: 0.25 } },
      heavy: {
        // tollpatschiger Tritt, Arme rudern
        windup: { legF: 1.6, kneeF: 2.2, armF: 2.6, foreF: 0.4, armB: 2.2, foreB: 0.6, lean: -0.2 },
        strike: { legF: 1.75, kneeF: 0.05, armF: 2.9, armB: 0.2, lean: -0.6, hipTwist: 0.4 },
        limb: 'footF',
      },
    },
    // trinkt einen Schluck Kaffee
    fidget: () => ({ armF: 2.3, foreF: 2.7, head: -0.35, lean: -0.05, twist: 0.3 }),
    intro: (t) => ({ hipX: s(t * 23) * 0.015, head: s(t * 17) * 0.08, armF: 1.3, foreF: 2.4, armB: 1.0, foreB: 2.3 }),
    win: (t) => ({ armF: 2.9 + s(t * 10) * 0.25, foreF: 0.3, armB: 2.9 - s(t * 10) * 0.25, foreB: 0.3, hipY: -0.05 + Math.abs(s(t * 7)) * 0.16, head: -0.3 }),
    walk: 'bounce',
    flinch: 1.2,
  },
  ingrid: {
    moves: {
      light: { windup: { armF: 1.1, foreF: 1.6, twist: -0.1 }, strike: { armF: 1.58, foreF: 0, twist: 0.25, lean: 0.2 } },
      heavy: {
        // Seitentritt
        windup: { legF: 1.5, kneeF: 2.3, hipTwist: 0.9, lean: -0.3, armF: 1.2, foreF: 2.0 },
        strike: { legF: 1.6, kneeF: 0, hipTwist: 1.2, lean: -0.6, twist: -0.4 },
        limb: 'footF',
      },
    },
    // tippt aufs Tablet
    fidget: (t) => ({ armF: 1.3, foreF: 2.1, armB: 1.15, foreB: 1.9 + pulse(t, 4) * 0.25, head: 0.4, twist: 0.25 }),
    intro: () => ({ armB: 2.65, foreB: 2.75, armF: 1.2, foreF: 2.0, head: -0.05 }),
    win: (t) => ({ head: 0.25 * pulse(t, 0.8), armF: 1.3, foreF: 2.1, armB: 0.2, foreB: 1.4, lean: 0.05 + 0.15 * pulse(t, 0.8) }),
    walk: 'prowl',
    flinch: 1,
  },
  kalle: {
    moves: {
      light: { windup: { armF: 2.2, foreF: 2.0, twist: -0.2 }, strike: { armF: 1.4, foreF: 0.3, lean: 0.4, twist: 0.4 } },
      heavy: {
        windup: { legF: 1.9, kneeF: 2.0, lean: -0.2, armF: 1.3, armB: 1.2 },
        strike: { legF: 1.2, kneeF: 0.05, lean: 0.05, hipX: 0.12, hipY: -0.1, armF: 0.8, armB: 0.6 },
        limb: 'footF',
      },
    },
    // reibt sich die kalten Hände
    fidget: (t) => ({ armF: 1.2, foreF: 2.2 + s(t * 14) * 0.15, armB: 1.25, foreB: 2.2 - s(t * 14) * 0.15, head: 0.25, lean: 0.15 }),
    intro: () => ({ armF: 1.7, foreF: 2.7, armB: 1.65, foreB: 2.7, head: 0.2, lean: 0.1 }),
    // trommelt auf die Brust
    win: (t) => ({ armF: 1.1, foreF: 2.4 - pulse(t, 3) * 0.5, armB: 1.1, foreB: 2.4 - pulse(t + 0.17, 3) * 0.5, lean: -0.25, head: -0.35 }),
    walk: 'waddle',
    flinch: 0.65,
  },
  rita: {
    moves: {
      light: { windup: { armB: 0.6, foreB: 2.3, twist: 0.4 }, strike: { armB: 1.6, foreB: 0.05, twist: -0.6, lean: 0.35, hipTwist: -0.2 }, limb: 'handB' },
      heavy: {
        windup: { legB: 1.0, kneeB: 2.1, twist: 0.9, hipTwist: 0.9 },
        strike: { legB: 2.0, kneeB: 0.05, lean: -0.5, hipTwist: -1.2, twist: -0.8, armF: 0.7 },
        limb: 'footB',
      },
    },
    // lässt den Schraubenschlüssel kreisen
    fidget: (t) => ({ armF: 1.4, foreF: 1.3 + s(t * 9) * 0.7, twist: 0.3, head: 0.1 }),
    intro: (t) => ({ armF: 1.2, foreF: 1.6 - pulse(t, 2) * 0.5, armB: 1.0, foreB: 2.3, head: 0.15 }),
    // Zeigefinger: „So nicht!“
    win: (t) => ({ armF: 1.65, foreF: 0.15 + s(t * 9) * 0.15, armB: -0.1, foreB: 2.4, lean: -0.1, twist: 0.4 }),
    walk: 'prowl',
    flinch: 1,
  },
  robo: {
    moves: {
      light: {
        // Kolbenstoß: Ellbogen 90°, dann schnurgerade
        windup: { armF: 1.57, foreF: 1.57, twist: 0, lean: 0 },
        strike: { armF: 1.57, foreF: 0, twist: 0.2, lean: 0.1, hipX: 0.08 },
      },
      heavy: {
        windup: { armF: 3.0, foreF: 0, armB: 3.0, foreB: 0, lean: -0.1, twist: 0 },
        strike: { armF: 1.4, foreF: 0, armB: 1.4, foreB: 0, lean: 0.5, hipY: -0.15, twist: 0 },
        limb: 'handF',
      },
    },
    // Kopf-Scan nach links und rechts, in Stufen
    fidget: (t) => ({ head: Math.round(s(t * 2) * 3) * 0.15, twist: Math.round(s(t * 2) * 2) * 0.2 }),
    // Hochfahren: hängt erst schlaff, richtet sich dann ruckartig auf
    intro: (_t, n) => (n < 40 ? { lean: 0.7, head: 0.6, armF: 0.1, foreF: 0.2, armB: 0.1, foreB: 0.2, hipY: -0.15 } : {}),
    win: (t) => {
      const k = Math.floor(t * 4) % 4;
      return [{ armF: 3.0, armB: 0.2 }, { armF: 1.57, foreF: 1.57, armB: 1.57, foreB: 1.57 }, { armF: 0.2, armB: 3.0 }, { armF: 1.57, foreF: 0, armB: 1.57, foreB: 0 }][k];
    },
    walk: 'march',
    flinch: 0.7,
  },
};
