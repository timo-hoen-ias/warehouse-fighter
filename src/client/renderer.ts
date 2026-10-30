import * as THREE from 'three';
import type { FinisherKind, GameEvent, GameState, Projectile } from '../shared/game';
import { FighterModel } from './fighterModel';
import { type BuiltStage, buildStage } from './stage';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  /** Blutstropfen hinterlassen beim Aufprall einen Fleck am Boden. */
  splat?: THREE.Material;
}

interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
}

interface Decal {
  mesh: THREE.Mesh;
  life: number;
}

interface FinisherFx {
  kind: FinisherKind;
  loser: 0 | 1;
  t: number;
  impacted: boolean;
}

/** three.js-Szene: Lagerhalle, beide Kämpfer, Projektile, Effekte, Kamera. */
export class GameRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  private fighters: FighterModel[] = [];
  private projectiles = new Map<number, THREE.Object3D>();
  private particles: Particle[] = [];
  private particleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  private sparkMats = {
    hit: new THREE.MeshBasicMaterial({ color: 0xffd54f }),
    block: new THREE.MeshBasicMaterial({ color: 0x80d8ff }),
    peanut: new THREE.MeshStandardMaterial({ color: 0xf5f0e0 }),
  };
  private shake = 0;
  private camX = 0;
  private camDist = 9;
  private time = 0;
  private stage: BuiltStage | null = null;
  private stageId = '';
  private chars: [string, string] = ['gerd', 'kim'];
  private debris: Debris[] = [];
  private decals: Decal[] = [];
  private finisher: FinisherFx | null = null;
  private bloodGeo = new THREE.SphereGeometry(0.035, 6, 4);
  private decalGeo = new THREE.CircleGeometry(1, 14);
  private goreMats = {
    blood: new THREE.MeshStandardMaterial({ color: 0xa00000, roughness: 0.3 }),
    oil: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.2, metalness: 0.5 }),
    bloodSplat: new THREE.MeshBasicMaterial({ color: 0x6d0000, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    oilSplat: new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  smoothing = false;
  /** Bluteffekte an/aus (Pausenmenü). */
  blood = true;
  /** Retro-Pixelfilter: 0 = aus, 1 = leicht, 2 = mittel, 3 = stark. */
  retro = 0;
  private retroTarget: THREE.WebGLRenderTarget | null = null;
  private retroScene = new THREE.Scene();
  private retroCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private retroMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(1, 1) },
      levels: { value: 32 },
      dither: { value: 0 },
      scan: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float levels;
      uniform float dither;
      uniform float scan;
      varying vec2 vUv;
      float bayer(vec2 p) {
        // 4x4-Bayer-Matrix für geordnetes Dithering wie auf alten Konsolen
        int x = int(mod(p.x, 4.0));
        int y = int(mod(p.y, 4.0));
        int i = x + y * 4;
        float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
        for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0;
        return 0.0;
      }
      void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec2 px = floor(vUv * resolution);
        vec3 c = gl_FragColor.rgb * levels + (bayer(px) - 0.5) * dither;
        c = floor(c + 0.5) / levels;
        // Scanlines innerhalb jedes großen Pixels
        float fy = fract(vUv.y * resolution.y);
        c *= 1.0 - scan * smoothstep(0.55, 1.0, abs(fy - 0.5) * 2.0);
        // leichte Röhren-Vignette
        vec2 d = vUv - 0.5;
        c *= 1.0 - dot(d, d) * scan * 0.9;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  });

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private resize() {
    // Größe des Canvas selbst (auf dem Handy im Hochformat nur der obere Teil des Bildschirms)
    const canvas = this.renderer.domElement;
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.retroSize = '';
  }

  private retroSize = '';

  /** Szene in niedriger Auflösung rendern und mit Farbreduktion, Dithering und Scanlines hochskalieren. */
  private renderRetro() {
    const preset = [null, { px: 2, levels: 40, dither: 0, scan: 0 }, { px: 3, levels: 18, dither: 0.6, scan: 0.25 }, { px: 4.5, levels: 8, dither: 1, scan: 0.4 }][this.retro];
    if (!preset) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const w = Math.max(64, Math.floor(this.renderer.domElement.clientWidth / preset.px));
    const h = Math.max(48, Math.floor(this.renderer.domElement.clientHeight / preset.px));
    const key = `${w}x${h}`;
    if (!this.retroTarget) {
      this.retroTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, samples: 0 });
      this.retroScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.retroMat));
    }
    if (this.retroSize !== key) {
      this.retroTarget.setSize(w, h);
      this.retroSize = key;
    }
    const u = this.retroMat.uniforms;
    u.tDiffuse.value = this.retroTarget.texture;
    u.resolution.value.set(w, h);
    u.levels.value = preset.levels;
    u.dither.value = preset.dither;
    u.scan.value = preset.scan;
    this.renderer.setRenderTarget(this.retroTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.retroScene, this.retroCam);
  }

  setStage(id: string) {
    if (id === this.stageId) return;
    this.stage?.dispose();
    this.stage = buildStage(this.scene, id);
    this.stageId = id;
  }

  setFighters(chars: [string, string]) {
    this.chars = chars;
    this.clearFinisher();
    for (const d of this.decals) this.scene.remove(d.mesh);
    this.decals = [];
    for (const m of this.fighters) this.scene.remove(m.root);
    this.fighters = chars.map((c) => {
      const m = new FighterModel(c);
      this.scene.add(m.root);
      return m;
    });
  }

  private projectileMesh(p: Projectile): THREE.Object3D {
    const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    const basic = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    switch (p.kind) {
      case 'laser':
      case 'lidar': {
        const color = p.kind === 'laser' ? 0xff1744 : 0x00e5ff;
        add(new THREE.BoxGeometry(p.w, 0.05, 0.05), basic(0xffffff));
        add(new THREE.BoxGeometry(p.w, p.h, 0.14), basic(color, 0.55));
        for (let i = 0; i < 9; i++) {
          add(new THREE.BoxGeometry(0.02 + (i % 3) * 0.015, p.h * 1.8, 0.02), basic(color), -p.w / 2 + (i + 0.5) * (p.w / 9));
        }
        g.add(new THREE.PointLight(color, 4, 4));
        break;
      }
      case 'pallet': {
        const wood = std(0xc8a165, { roughness: 0.9 });
        for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.14, 0.04, 0.8), wood, -0.5 + i * 0.25, 0.12);
        for (const x of [-0.5, 0, 0.5]) add(new THREE.BoxGeometry(0.12, 0.1, 0.8), wood, x, 0.04);
        g.scale.set(p.w / 1.2, 1, 1);
        break;
      }
      case 'box':
        add(new THREE.BoxGeometry(p.w, p.h, p.h), std(0xb98a55, { roughness: 0.9 }));
        add(new THREE.BoxGeometry(p.w * 1.01, p.h * 0.2, p.h * 1.01), std(0xd9bf8c));
        break;
      case 'parcel':
        add(new THREE.BoxGeometry(p.w, p.h, p.h * 0.8), std(0xd7a35f, { roughness: 0.9 }));
        add(new THREE.BoxGeometry(p.w * 0.5, p.h * 0.4, 0.01), std(0x1e88e5), 0, 0, p.h * 0.41);
        break;
      case 'clipboard':
        add(new THREE.BoxGeometry(p.w, p.h, 0.03), std(0x8d6e63));
        add(new THREE.BoxGeometry(p.w * 0.85, p.h * 0.85, 0.035), std(0xffffff));
        add(new THREE.BoxGeometry(p.w * 0.3, 0.06, 0.05), std(0x9e9e9e, { metalness: 0.8 }), 0, p.h / 2);
        break;
      case 'cup': {
        add(new THREE.CylinderGeometry(p.w / 2, p.w / 2.4, p.h, 12), std(0xffffff));
        add(new THREE.CylinderGeometry(p.w / 2.1, p.w / 2.1, 0.02, 12), std(0x4e342e), 0, p.h / 2);
        for (let i = 0; i < 5; i++) add(new THREE.SphereGeometry(0.04, 6, 4), basic(0x6d4c41, 0.8), -0.1 - i * 0.08, (Math.random() - 0.5) * 0.15);
        break;
      }
      case 'label':
        for (let i = 0; i < 4; i++) {
          const l = add(new THREE.BoxGeometry(0.16, 0.1, 0.01), std(i % 2 ? 0xffffff : 0xffeb3b, { emissive: 0x333333 }), -i * 0.13, (i % 2 ? 1 : -1) * 0.06);
          l.rotation.z = i * 0.6;
        }
        break;
      case 'ice':
        add(new THREE.BoxGeometry(p.w, p.h, p.h), std(0xb3e5fc, { transparent: true, opacity: 0.75, roughness: 0.05, metalness: 0.1 }));
        add(new THREE.BoxGeometry(p.w * 0.5, p.h * 0.5, p.h * 0.5), basic(0xffffff, 0.5));
        g.add(new THREE.PointLight(0x80d8ff, 3, 3));
        break;
      case 'wave':
        for (let i = 0; i < 3; i++) {
          const r = add(new THREE.TorusGeometry(0.3 + i * 0.22, 0.03, 6, 24, Math.PI), basic(0xffeb3b, 0.8 - i * 0.2), -i * 0.15);
          r.rotation.z = -Math.PI / 2;
          r.rotation.y = Math.PI / 2 - 0.6;
        }
        break;
    }
    return g;
  }

  private burst(x: number, y: number, count: number, mat: THREE.Material, power: number, z = 0.3) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const v = (0.5 + Math.random()) * power;
      this.particles.push({ mesh, vel: new THREE.Vector3(Math.cos(a) * v, Math.sin(a) * v + 1, (Math.random() - 0.5) * v), life: 0.4 + Math.random() * 0.4 });
      this.scene.add(mesh);
    }
  }

  private isRobot(slot: 0 | 1) {
    return this.fighters[slot]?.def.robot ?? false;
  }

  /** Blut (bzw. Öl beim Roboter): Tropfen in eine Richtung, die am Boden Flecken hinterlassen. */
  private bleed(pos: THREE.Vector3, target: 0 | 1, count: number, dir: THREE.Vector3, spread: number) {
    if (!this.blood) return;
    const robot = this.isRobot(target);
    const mat = robot ? this.goreMats.oil : this.goreMats.blood;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.bloodGeo, mat);
      mesh.position.copy(pos);
      const vel = dir
        .clone()
        .multiplyScalar(0.6 + Math.random() * 0.8)
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.2) * spread, (Math.random() - 0.5) * spread));
      mesh.scale.setScalar(0.6 + Math.random() * 1.2);
      this.particles.push({ mesh, vel, life: 1.5, splat: robot ? this.goreMats.oilSplat : this.goreMats.bloodSplat });
      this.scene.add(mesh);
    }
  }

  private addDecal(mat: THREE.Material, x: number, y: number, z: number, size: number, vertical = false) {
    const mesh = new THREE.Mesh(this.decalGeo, mat);
    mesh.scale.setScalar(size);
    if (vertical) mesh.position.set(x, y, z);
    else {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.012 + (this.decals.length % 20) * 0.0004, z);
    }
    this.scene.add(mesh);
    this.decals.push({ mesh, life: 14 });
    if (this.decals.length > 160) this.scene.remove(this.decals.shift()!.mesh);
  }

  private clearFinisher() {
    this.finisher = null;
    for (const d of this.debris) d.obj.removeFromParent();
    this.debris = [];
  }

  private startFinisher(kind: FinisherKind, loser: 0 | 1, state: GameState | null) {
    const model = this.fighters[loser];
    if (!model) return;
    this.finisher = { kind, loser, t: 0, impacted: false };
    this.shake = 0.6;
    if (kind === 'wall') return;
    const winnerX = state ? state.fighters[loser === 0 ? 1 : 0].x : 0;
    const dir = Math.sign(model.root.position.x - winnerX) || 1;
    const part = model.detach(kind);
    this.scene.attach(part);
    this.debris.push({
      obj: part,
      vel: new THREE.Vector3(dir * (kind === 'head' ? 2.2 : 2.8), kind === 'head' ? 6 : 4.5, 1.2 + Math.random()),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 4, dir * -10),
      resting: false,
    });
  }

  handleEvents(events: GameEvent[], state: GameState | null = null) {
    for (const e of events) {
      if (e.type === 'hit') {
        const robot = this.isRobot(e.target);
        this.burst(e.x, e.y, (e.heavy ? 26 : 14) + (robot ? 12 : 0), this.sparkMats.hit, e.heavy ? 5 : 3.5);
        this.burst(e.x, e.y, e.heavy ? 8 : 3, this.sparkMats.peanut, 2.5); // Verpackungschips
        const attackerX = this.fighters[e.target === 0 ? 1 : 0]?.root.position.x ?? 0;
        const dir = new THREE.Vector3(Math.sign(e.x - attackerX) * 2.5, 2, 0.6);
        this.bleed(new THREE.Vector3(e.x, e.y, 0.2), e.target, Math.round(e.damage / 4), dir, 2.5);
        this.fighters[e.target]?.hitFlash();
        this.shake = Math.max(this.shake, e.heavy ? 0.25 : 0.1);
      } else if (e.type === 'block') {
        this.burst(e.x, e.y, 8, this.sparkMats.block, 2.5);
      } else if (e.type === 'ko') {
        this.startFinisher(e.finisher, e.loser, state);
      } else if (e.type === 'roundStart' && (this.finisher || this.debris.length)) {
        // Neue Runde: Kämpfer heil wiederherstellen
        this.setFighters(this.chars);
      }
    }
  }

  private updateFinisher(state: GameState, edt: number) {
    const fx = this.finisher;
    if (!fx) return;
    fx.t += edt;
    const model = this.fighters[fx.loser];
    if (!model) return;
    if (fx.kind === 'wall') {
      // Quer durch die Halle bis an Regal/Wand, dann Einschlag und Absturz
      const impactZ = this.stage?.impactZ ?? -5.3;
      const flight = 0.55;
      const p = Math.min(1, fx.t / flight);
      model.offset.z = impactZ * (1 - (1 - p) * (1 - p));
      model.offset.y = p < 1 ? Math.sin(p * Math.PI) * 1.6 + p * 0.6 : Math.max(0, model.offset.y - edt * 6);
      model.spin = p < 1 ? -p * Math.PI * 1.5 : 0;
      if (p >= 1 && !fx.impacted) {
        fx.impacted = true;
        this.shake = 1;
        const pos = model.root.position.clone().add(new THREE.Vector3(0, 1.2, 0.2));
        this.burst(pos.x, pos.y, 40, this.sparkMats.peanut, 4, pos.z);
        this.burst(pos.x, pos.y, 25, this.sparkMats.hit, 5, pos.z);
        this.bleed(pos, fx.loser, 40, new THREE.Vector3(0, 1.5, 2.5), 4);
        if (this.blood) this.addDecal(this.isRobot(fx.loser) ? this.goreMats.oilSplat : this.goreMats.bloodSplat, pos.x, pos.y, impactZ - 0.35, 0.7, true);
      }
    } else if (fx.t < 2.2 && this.blood) {
      // Fontäne aus dem Stumpf
      const pos = model.stumpPosition(fx.kind);
      const up = fx.kind === 'head' ? new THREE.Vector3(0, 4.5, 0) : new THREE.Vector3(model.root.position.x > 0 ? 1.5 : -1.5, 3, 0.5);
      this.bleed(pos, fx.loser, Math.ceil(edt * 140 * (1.2 - fx.t / 2.2)), up, 1.2);
    }
    void state;
  }

  render(state: GameState, dt: number) {
    // Zeitlupe nach dem finalen Schlag (die Simulation selbst läuft auch langsamer)
    const edt = dt * (state.slowmo > 0 ? 0.3 : 1);
    this.time += edt;
    this.setStage(state.stage);
    this.stage?.update(this.time, edt);
    state.fighters.forEach((f, i) => this.fighters[i]?.update(f, this.time, edt, this.smoothing));
    if (state.finisher && !this.finisher && state.phase === 'roundEnd') {
      // Online beigetreten oder Event verpasst: Finisher trotzdem zeigen
      this.startFinisher(state.finisher.kind, state.finisher.loser, state);
    }
    this.updateFinisher(state, edt);

    // Projektile
    const alive = new Set<number>();
    state.projectiles.forEach((p) => {
      const key = p.owner;
      alive.add(key);
      let obj = this.projectiles.get(key);
      if (!obj || obj.userData.kind !== p.kind) {
        if (obj) this.scene.remove(obj);
        obj = this.projectileMesh(p);
        obj.userData.kind = p.kind;
        this.projectiles.set(key, obj);
        this.scene.add(obj);
      }
      obj.position.set(p.x, p.y - (p.kind === 'pallet' ? 0.1 : 0), 0);
      obj.scale.x = Math.abs(obj.scale.x) * Math.sign(p.vx || 1);
      const spin = edt * Math.sign(p.vx);
      if (p.kind === 'box' || p.kind === 'parcel' || p.kind === 'ice') obj.rotation.z -= spin * 10;
      if (p.kind === 'clipboard' || p.kind === 'cup') obj.rotation.z -= spin * 18;
      if (p.kind === 'pallet') obj.rotation.y = Math.sin(this.time * 20) * 0.1;
      if (p.kind === 'wave') obj.scale.setScalar(1 + Math.sin(this.time * 30) * 0.1).multiply(new THREE.Vector3(Math.sign(p.vx || 1), 1, 1));
    });
    for (const [key, obj] of this.projectiles) {
      if (!alive.has(key)) {
        this.scene.remove(obj);
        this.projectiles.delete(key);
      }
    }

    // Partikel (Funken, Verpackungschips, Blut)
    this.particles = this.particles.filter((p) => {
      p.life -= edt;
      p.vel.y -= 9 * edt;
      p.mesh.position.addScaledVector(p.vel, edt);
      if (!p.splat) {
        p.mesh.rotation.x += edt * 8;
        p.mesh.scale.setScalar(Math.max(0.01, p.life * 2));
      }
      if (p.life <= 0 || p.mesh.position.y < 0) {
        if (p.splat && p.mesh.position.y < 0.05 && Math.random() < 0.35) {
          this.addDecal(p.splat, p.mesh.position.x, 0, p.mesh.position.z, 0.05 + Math.random() * 0.14);
        }
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });

    // Abgetrennte Körperteile
    for (const d of this.debris) {
      if (d.resting) continue;
      d.vel.y -= 9 * edt;
      d.obj.position.addScaledVector(d.vel, edt);
      d.obj.rotation.x += d.spin.x * edt;
      d.obj.rotation.y += d.spin.y * edt;
      d.obj.rotation.z += d.spin.z * edt;
      if (d.obj.position.y < 0.12) {
        d.obj.position.y = 0.12;
        if (Math.abs(d.vel.y) < 1.2) {
          d.resting = true;
          if (this.blood) this.addDecal(this.goreMats.bloodSplat, d.obj.position.x, 0, d.obj.position.z, 0.3);
        } else {
          d.vel.y *= -0.4;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
          d.spin.multiplyScalar(0.5);
        }
      }
    }

    // Blutflecken verblassen langsam
    this.decals = this.decals.filter((d) => {
      d.life -= dt;
      if (d.life < 3) d.mesh.scale.multiplyScalar(0.995);
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        return false;
      }
      return true;
    });

    // Kamera folgt der Mitte und zoomt mit dem Abstand – in der Zeitlupe nah an den Verlierer
    const [a, b] = state.fighters;
    let focusX = (a.x + b.x) / 2;
    const sep = Math.abs(a.x - b.x);
    // Schmale Bilder (Handy hochkant) weiter weg, aber nicht so weit, dass die Kämpfer winzig werden
    const aspectFix = this.camera.aspect < 1 ? Math.max(1, 1.05 / this.camera.aspect) : Math.max(1, 1.6 / this.camera.aspect);
    let dist = (6.5 + sep * 0.55) * aspectFix;
    let lookY = 1.2 + Math.max(a.y, b.y) * 0.3;
    let lookZ = 0;
    if (state.slowmo > 0 && this.finisher) {
      const loser = this.fighters[this.finisher.loser];
      if (loser) {
        focusX = loser.root.position.x;
        dist = this.finisher.kind === 'wall' ? 7.5 : 4.2;
        lookY = 1.0;
        lookZ = loser.root.position.z * 0.5;
      }
    }
    const k = 1 - Math.pow(state.slowmo > 0 ? 0.0005 : 0.02, dt);
    this.camX += (focusX - this.camX) * k;
    this.camDist += (dist - this.camDist) * k;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(this.camX + sx, 2.0 + sy + this.camDist * 0.06, this.camDist + lookZ);
    this.camera.lookAt(this.camX, lookY, lookZ);
    this.stage?.focus(focusX, lookZ, this.time);

    this.renderRetro();
  }
}
