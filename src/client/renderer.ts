import * as THREE from 'three';
import type { GameEvent, GameState, Projectile } from '../shared/game';
import { FighterModel } from './fighterModel';
import { buildStage } from './stage';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
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
  smoothing = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    buildStage(this.scene);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setFighters(chars: [string, string]) {
    for (const m of this.fighters) this.scene.remove(m.root);
    this.fighters = chars.map((c) => {
      const m = new FighterModel(c);
      this.scene.add(m.root);
      return m;
    });
  }

  private projectileMesh(p: Projectile): THREE.Object3D {
    if (p.kind === 'laser') {
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(p.w, p.h, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.55 }),
      );
      // Barcode-Striche
      for (let i = 0; i < 9; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02 + (i % 3) * 0.015, p.h * 1.8, 0.02), new THREE.MeshBasicMaterial({ color: 0xff5252 }));
        bar.position.x = -p.w / 2 + (i + 0.5) * (p.w / 9);
        g.add(bar);
      }
      g.add(core, glow);
      const light = new THREE.PointLight(0xff1744, 4, 4);
      g.add(light);
      return g;
    }
    if (p.kind === 'pallet') {
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.9 });
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.8), wood);
        b.position.set(-0.5 + i * 0.25, 0.12, 0);
        b.castShadow = true;
        g.add(b);
      }
      for (const x of [-0.5, 0, 0.5]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.8), wood);
        b.position.set(x, 0.04, 0);
        g.add(b);
      }
      g.scale.set(p.w / 1.2, 1, 1);
      return g;
    }
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(p.w, p.h, p.h),
      new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.9 }),
    );
    box.castShadow = true;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(p.w * 1.01, p.h * 0.2, p.h * 1.01), new THREE.MeshStandardMaterial({ color: 0xd9bf8c }));
    box.add(tape);
    return box;
  }

  private burst(x: number, y: number, count: number, mat: THREE.Material, power: number) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.set(x, y, 0.3);
      const a = Math.random() * Math.PI * 2;
      const v = (0.5 + Math.random()) * power;
      this.particles.push({ mesh, vel: new THREE.Vector3(Math.cos(a) * v, Math.sin(a) * v + 1, (Math.random() - 0.5) * v), life: 0.4 + Math.random() * 0.4 });
      this.scene.add(mesh);
    }
  }

  handleEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'hit') {
        this.burst(e.x, e.y, e.heavy ? 26 : 14, this.sparkMats.hit, e.heavy ? 5 : 3.5);
        this.burst(e.x, e.y, e.heavy ? 8 : 3, this.sparkMats.peanut, 2.5); // Verpackungschips
        this.fighters[e.target]?.hitFlash();
        this.shake = Math.max(this.shake, e.heavy ? 0.25 : 0.1);
      } else if (e.type === 'block') {
        this.burst(e.x, e.y, 8, this.sparkMats.block, 2.5);
      } else if (e.type === 'ko') {
        this.shake = 0.5;
      }
    }
  }

  render(state: GameState, dt: number) {
    this.time += dt;
    state.fighters.forEach((f, i) => this.fighters[i]?.update(f, this.time, dt, this.smoothing));

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
      if (p.kind === 'box') obj.rotation.z -= dt * 10 * Math.sign(p.vx);
      if (p.kind === 'pallet') obj.rotation.y = Math.sin(this.time * 20) * 0.1;
    });
    for (const [key, obj] of this.projectiles) {
      if (!alive.has(key)) {
        this.scene.remove(obj);
        this.projectiles.delete(key);
      }
    }

    // Partikel
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.vel.y -= 9 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 8;
      p.mesh.scale.setScalar(Math.max(0.01, p.life * 2));
      if (p.life <= 0 || p.mesh.position.y < 0) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });

    // Kamera folgt der Mitte und zoomt mit dem Abstand
    const [a, b] = state.fighters;
    const mid = (a.x + b.x) / 2;
    const sep = Math.abs(a.x - b.x);
    const aspectFix = Math.max(1, 1.6 / this.camera.aspect);
    const dist = (6.5 + sep * 0.55) * aspectFix;
    const k = 1 - Math.pow(0.02, dt);
    this.camX += (mid - this.camX) * k;
    this.camDist += (dist - this.camDist) * k;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const lookY = 1.2 + Math.max(a.y, b.y) * 0.3;
    this.camera.position.set(this.camX + sx, 2.0 + sy + this.camDist * 0.06, this.camDist);
    this.camera.lookAt(this.camX, lookY, 0);

    this.renderer.render(this.scene, this.camera);
  }
}
