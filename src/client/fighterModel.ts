import * as THREE from 'three';
import { type CharacterDef, getCharacter, moveLength } from '../shared/characters';
import type { Fighter } from '../shared/game';

// Low-Poly-Lagerarbeiter aus Grundkörpern mit prozeduraler Animation.
// Modell blickt lokal nach +x; Gelenke drehen um die lokale z-Achse.

interface Pose {
  hipY: number;
  lean: number;
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
  hipY: 0, lean: 0, head: 0, armF: 0, foreF: 0, armB: 0, foreB: 0, legF: 0, kneeF: 0, legB: 0, kneeB: 0,
} satisfies Pose) as (keyof Pose)[];

const HIP_HEIGHT = 0.95;
const UPPER_LEG = 0.45;
const LOWER_LEG = 0.45;
const UPPER_ARM = 0.3;
const LOWER_ARM = 0.3;

function pose(p: Partial<Pose>): Pose {
  return { hipY: -0.05, lean: 0.1, head: 0, armF: 0.9, foreF: 1.6, armB: 0.5, foreB: 1.9, legF: 0.35, kneeF: 0.3, legB: -0.3, kneeB: 0.25, ...p };
}

const P = {
  idle: pose({}),
  crouch: pose({ hipY: -0.42, lean: 0.35, legF: 1.35, kneeF: 2.1, legB: 0.5, kneeB: 2.2, armF: 1.0, foreF: 1.7 }),
  guard: pose({ lean: -0.1, armF: 1.3, foreF: 2.1, armB: 1.1, foreB: 2.2, head: -0.1 }),
  crouchGuard: pose({ hipY: -0.42, lean: 0.2, legF: 1.35, kneeF: 2.1, legB: 0.5, kneeB: 2.2, armF: 1.3, foreF: 2.1, armB: 1.1, foreB: 2.2 }),
  jump: pose({ hipY: 0, legF: 1.3, kneeF: 1.9, legB: 0.5, kneeB: 1.7, armF: 1.2, foreF: 1.2, armB: 0.2, foreB: 1.0 }),
  hit: pose({ lean: -0.45, head: -0.35, armF: -0.3, foreF: 0.6, armB: -0.6, foreB: 0.4, legF: 0.5, kneeF: 0.2, legB: -0.4 }),
  ko: pose({ hipY: -0.75, lean: -1.45, head: -0.2, armF: 2.6, foreF: 0.2, armB: 2.9, foreB: 0.3, legF: 0.3, kneeF: 0.1, legB: 0.1, kneeB: 0.4 }),
  win: pose({ lean: -0.05, head: -0.2, armF: 2.9, foreF: 0.3, armB: 2.6, foreB: 0.6, legF: 0.25, legB: -0.25 }),
};

/** Ausholen (windup) → Treffer (active), jeweils als Pose. */
const ATTACKS: Record<string, { windup: Partial<Pose>; strike: Partial<Pose>; base?: Partial<Pose> }> = {
  light: { windup: { armF: 0.6, foreF: 2.3, lean: 0.05 }, strike: { armF: 1.6, foreF: 0.05, lean: 0.3, armB: 0.7, foreB: 2.1 } },
  heavy: {
    windup: { legF: 1.1, kneeF: 2.0, lean: -0.1 },
    strike: { legF: 1.6, kneeF: 0.05, lean: -0.35, legB: -0.05, kneeB: 0.1, armF: 0.4, armB: -0.3 },
  },
  low: {
    base: P.crouch,
    windup: { legF: 1.1, kneeF: 2.0 },
    strike: { hipY: -0.55, legF: 1.55, kneeF: 0.0, lean: 0.1, legB: 0.9, kneeB: 2.4 },
  },
  air: {
    base: P.jump,
    windup: { legF: 1.4, kneeF: 2.2 },
    strike: { legF: 0.9, kneeF: 0.0, lean: -0.25, legB: 1.3, kneeB: 2.2, armF: 2.0, armB: 1.2 },
  },
  special: {
    windup: { armF: -0.7, foreF: 1.0, armB: -0.9, foreB: 1.0, lean: -0.25 },
    strike: { armF: 1.55, foreF: 0.1, armB: 1.45, foreB: 0.2, lean: 0.35, legF: 0.6, kneeF: 0.4, legB: -0.5 },
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

function targetPose(f: Fighter, def: CharacterDef, t: number): Pose {
  const n = f.statusTime;
  switch (f.status) {
    case 'walk': {
      const ph = t * 9 * (def.walkSpeed / 0.06);
      const s = Math.sin(ph) * f.facing * Math.sign(f.vx || 1);
      return mix(P.idle, { legF: 0.35 + s * 0.45, legB: -0.3 - s * 0.45, kneeF: 0.35 + Math.max(0, -s) * 0.6, kneeB: 0.3 + Math.max(0, s) * 0.6, hipY: -0.05 - Math.abs(Math.cos(ph)) * 0.03 }, 1);
    }
    case 'crouch':
      return f.guarding ? P.crouchGuard : P.crouch;
    case 'jump':
      return P.jump;
    case 'hitstun':
      return mix(P.hit, {}, 1);
    case 'blockstun':
      return f.crouching ? P.crouchGuard : P.guard;
    case 'ko':
      return P.ko;
    case 'win': {
      const b = Math.abs(Math.sin(t * 6)) * 0.12;
      return mix(P.win, { hipY: -0.05 + b, armF: 2.9 - b * 2 }, 1);
    }
    case 'attack': {
      const m = def.moves[f.move!];
      const anim = ATTACKS[f.move!];
      const base = anim.base ? pose(anim.base) : P.idle;
      const windup = mix(base, anim.windup, 1);
      const strike = mix(windup, anim.strike, 1);
      if (n < m.startup) return mix(base, anim.windup, easeOut(n / m.startup));
      if (n < m.startup + m.active + 2) return mix(windup, anim.strike, Math.min(1, (n - m.startup + 1) / 2));
      const r = (n - m.startup - m.active - 2) / Math.max(1, moveLength(m) - m.startup - m.active - 2);
      return mix(strike, base, easeOut(Math.min(1, r)));
    }
    default: {
      if (f.guarding) return P.guard;
      const b = Math.sin(t * 4) * 0.025;
      return mix(P.idle, { hipY: -0.05 + b, foreF: 1.6 + b * 4 }, 1);
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

export class FighterModel {
  readonly root = new THREE.Group();
  private orient = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private headPivot = new THREE.Group();
  private j: Record<'armF' | 'foreF' | 'armB' | 'foreB' | 'legF' | 'kneeF' | 'legB' | 'kneeB', THREE.Group>;
  private current: Pose = { ...P.idle };
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private flash = 0;
  readonly def: CharacterDef;

  constructor(charId: string) {
    const def = (this.def = getCharacter(charId));
    const c = def.colors;
    const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
      this.flashMats.push(m);
      return m;
    };
    const skin = std(c.skin);
    const shirt = std(c.shirt);
    const pants = std(c.pants);
    const vest = std(c.vest, { roughness: 0.5 });
    const reflect = std(0xe0e0e0, { emissive: 0x888888, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3 });
    const helmet = std(c.helmet, { roughness: 0.35 });
    const boot = std(0x2a2118);

    const bulk = def.id === 'gerd' ? 1.15 : def.id === 'kim' ? 0.92 : 1;

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

    // Kopf mit Helm
    this.torso.add(this.headPivot);
    this.headPivot.position.y = 0.62;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin);
    neck.position.y = 0.03;
    this.headPivot.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
    head.position.y = 0.17;
    head.scale.set(1, 1.1, 0.95);
    head.castShadow = true;
    this.headPivot.add(head);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    hat.position.y = 0.21;
    hat.castShadow = true;
    this.headPivot.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 16), helmet);
    brim.position.set(0.03, 0.21, 0);
    this.headPivot.add(brim);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.14), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eyes.position.set(0.125, 0.18, 0);
    this.headPivot.add(eyes);
    if (def.id === 'gerd') {
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
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), std(0xd8a000));
      hand.position.y = -LOWER_ARM;
      fore.add(hand);
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
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.12), boot);
      foot.position.set(0.05, -LOWER_LEG, 0);
      foot.castShadow = true;
      lower.add(foot);
      return { upper, lower };
    };
    const legF = mkLeg(0.12);
    const legB = mkLeg(-0.12);

    this.j = {
      armF: armF.upper, foreF: armF.fore, armB: armB.upper, foreB: armB.fore,
      legF: legF.upper, kneeF: legF.lower, legB: legB.upper, kneeB: legB.lower,
    };

    // Requisiten
    if (def.prop === 'scanner') {
      const scanner = new THREE.Group();
      scanner.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x222222 })));
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 }));
      lens.position.x = 0.085;
      scanner.add(lens);
      scanner.position.set(0.05, -0.04, 0.03);
      scanner.rotation.z = Math.PI / 2;
      armF.hand.add(scanner);
    } else if (def.prop === 'tape') {
      const tape = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 8, 16), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.4 }));
      tape.position.set(0, -0.03, 0.06);
      armF.hand.add(tape);
    }
  }

  hitFlash() {
    this.flash = 1;
  }

  /** `smooth`: Online-Snapshots kommen mit 30 Hz – Position weich nachziehen. */
  update(f: Fighter, time: number, dt: number, smooth = false) {
    const target = new THREE.Vector3(f.x, f.y, 0);
    if (smooth && this.root.position.distanceTo(target) < 1.5) {
      this.root.position.lerp(target, 1 - Math.pow(0.000001, dt));
    } else {
      this.root.position.copy(target);
    }
    // 3/4-Ansicht zur Kamera, bei Blick nach links gespiegelt
    this.orient.scale.x = f.facing;
    this.orient.rotation.y = -0.35 * f.facing;

    const goal = targetPose(f, this.def, time);
    const speed = f.status === 'attack' || f.status === 'hitstun' ? 0.6 : f.status === 'ko' ? 0.15 : 0.25;
    const k = 1 - Math.pow(1 - speed, dt * 60);
    for (const key of POSE_KEYS) this.current[key] += (goal[key] - this.current[key]) * k;

    const p = this.current;
    this.hips.position.y = HIP_HEIGHT + p.hipY;
    this.hips.rotation.z = -p.lean * 0.3;
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

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
    }
    const e = this.flash;
    for (const m of this.flashMats) {
      if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
      if (e > 0) m.emissive.setRGB(e, e * 0.9, e * 0.7);
      else m.emissive.setHex(m.userData.baseEmissive);
    }
  }
}
