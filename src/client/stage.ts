import * as THREE from 'three';

// Die zehn Arenen. Alles prozedural aus Grundkörpern und Canvas-Texturen,
// keine externen Assets. Jede Arena baut sich in eine eigene Gruppe, damit
// sie beim Wechsel komplett entfernt werden kann.

export interface BuiltStage {
  group: THREE.Group;
  /** Wo ein Kämpfer beim Finisher „gegen die Wand“ einschlägt (z-Koordinate). */
  impactZ: number;
  update(time: number, dt: number): void;
  /** Live-Schatten: Sonne und Hallenstrahler folgen dem Kampfgeschehen. */
  focus(x: number, z: number, time: number): void;
  dispose(): void;
}

// --- Texturen ---------------------------------------------------------------

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function floorTexture(base: string, speck: [number, number, number], joints: string, repeat: [number, number]) {
  const tex = canvasTexture(1024, 1024, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2500; i++) {
      const v = Math.random() * 40;
      g.fillStyle = `rgba(${speck[0] + v},${speck[1] + v},${speck[2] + v},${Math.random() * 0.15})`;
      g.beginPath();
      g.arc(Math.random() * 1024, Math.random() * 1024, Math.random() * 18, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = joints;
    g.lineWidth = 3;
    for (let i = 0; i <= 1024; i += 256) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 1024);
      g.moveTo(0, i);
      g.lineTo(1024, i);
      g.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  return tex;
}

function cardboardTexture(label: string, base = '#b98a55') {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 40; i++) g.fillRect(0, Math.random() * 256, 256, 1 + Math.random() * 2);
    g.fillStyle = 'rgba(210,180,120,0.9)';
    g.fillRect(110, 0, 36, 256);
    g.fillStyle = '#3a2a1a';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, 128, 200);
    g.beginPath();
    g.moveTo(40, 80);
    g.lineTo(60, 50);
    g.lineTo(80, 80);
    g.moveTo(176, 80);
    g.lineTo(196, 50);
    g.lineTo(216, 80);
    g.lineWidth = 6;
    g.strokeStyle = '#3a2a1a';
    g.stroke();
  });
}

function gateTexture(label: string) {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = '#7a8590';
    g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 24) {
      g.fillStyle = y % 48 ? '#6b757f' : '#87929c';
      g.fillRect(0, y, 512, 20);
    }
    g.fillStyle = '#ffcc00';
    g.fillRect(0, 0, 512, 60);
    g.fillStyle = '#111';
    g.font = 'bold 48px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, 256, 46);
  });
}

function signTexture(text: string, bg: string, fg: string) {
  return canvasTexture(1024, 192, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 192);
    g.fillStyle = fg;
    g.font = `bold ${text.length > 22 ? 78 : 104}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 100);
  });
}

function hatchTexture(a = '#f5c400', b = '#111') {
  const tex = canvasTexture(256, 64, (g) => {
    g.fillStyle = a;
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = b;
    for (let x = -64; x < 256; x += 48) {
      g.beginPath();
      g.moveTo(x, 64);
      g.lineTo(x + 24, 64);
      g.lineTo(x + 88, 0);
      g.lineTo(x + 64, 0);
      g.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function hazardTexture(symbol: string, color: string) {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    g.save();
    g.translate(64, 64);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#fff';
    g.fillRect(-36, -36, 72, 72);
    g.strokeStyle = '#d50000';
    g.lineWidth = 5;
    g.strokeRect(-32, -32, 64, 64);
    g.restore();
    g.fillStyle = '#111';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(symbol, 64, 66);
  });
}

// --- Baukasten ----------------------------------------------------------------

const rand = (a: number, b: number) => a + Math.random() * (b - a);

class Builder {
  readonly group = new THREE.Group();
  readonly animators: ((t: number, dt: number) => void)[] = [];
  private boxMats: THREE.MeshStandardMaterial[];
  readonly wood = new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.9 });
  readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  impactZ = -5.3;
  sun: THREE.DirectionalLight | null = null;
  sunOffset = new THREE.Vector3(4, 12, 8);
  spot: THREE.SpotLight | null = null;

  constructor(private scene: THREE.Scene, boxBase?: string) {
    this.boxMats = ['ZERBRECHLICH', 'LIEFERUNG', 'ART. 4711', 'EILT!'].map(
      (l) => new THREE.MeshStandardMaterial({ map: cardboardTexture(l, boxBase), roughness: 0.9 }),
    );
  }

  add<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0): T {
    o.position.set(x, y, z);
    this.group.add(o);
    return o;
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    return this.add(m, x, y, z);
  }

  boxMat(i = Math.floor(Math.random() * 4)) {
    return this.boxMats[i % this.boxMats.length];
  }

  env(o: {
    bg: number;
    fog: [number, number];
    fogColor?: number;
    hemi: [number, number, number];
    sun: [number, number];
    sunPos?: [number, number, number];
  }) {
    this.scene.background = new THREE.Color(o.bg);
    this.scene.fog = new THREE.Fog(o.fogColor ?? o.bg, o.fog[0], o.fog[1]);
    this.add(new THREE.HemisphereLight(o.hemi[0], o.hemi[1], o.hemi[2]));
    const sun = new THREE.DirectionalLight(o.sun[0], o.sun[1]);
    this.sunOffset.set(...(o.sunPos ?? [4, 12, 8]));
    sun.position.copy(this.sunOffset);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Enges Frustum um die Kämpfer – wandert mit (siehe focus) und bleibt dadurch scharf
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 7, bottom: -4, near: 1, far: 45 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.add(sun);
    this.group.add(sun.target);
    this.sun = sun;

    // Schwenkender Hallenstrahler über der Kampffläche – wirft einen zweiten, wandernden Schatten
    const spot = new THREE.SpotLight(o.sun[0], 90, 30, 0.42, 0.55, 1.6);
    spot.position.set(0, 9.5, 3.5);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0006;
    spot.shadow.normalBias = 0.02;
    spot.shadow.radius = 4;
    Object.assign(spot.shadow.camera, { near: 2, far: 30 });
    this.group.add(spot, spot.target);
    this.spot = spot;
  }

  floor(o: { base: string; speck?: [number, number, number]; joints?: string; roughness?: number; metalness?: number; repeat?: [number, number]; lines?: number | null }) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 40),
      new THREE.MeshStandardMaterial({
        map: floorTexture(o.base, o.speck ?? [120, 120, 115], o.joints ?? 'rgba(60,60,60,0.35)', o.repeat ?? [10, 6]),
        roughness: o.roughness ?? 0.85,
        metalness: o.metalness ?? 0,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.add(floor);
    if (o.lines !== null) {
      const lineMat = new THREE.MeshStandardMaterial({ color: o.lines ?? 0xf5c400, roughness: 0.6 });
      for (const z of [-1.6, 1.6]) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(44, 0.12), lineMat);
        line.rotation.x = -Math.PI / 2;
        this.add(line, 0, 0.005, z);
      }
    }
  }

  /** Warnschraffur am Rand der Kampfzone */
  arenaEdges(a?: string, b?: string) {
    const tex = hatchTexture(a, b);
    tex.repeat.set(1, 6);
    for (const x of [-7.6, 7.6]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 3.2), new THREE.MeshStandardMaterial({ map: tex }));
      m.rotation.x = -Math.PI / 2;
      this.add(m, x, 0.006, 0);
    }
  }

  wall(color: number, z = -14, height = 16) {
    return this.mesh(new THREE.PlaneGeometry(80, height), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), 0, height / 2, z, false);
  }

  sign(text: string, bg: string, fg: string, x: number, y: number, z: number, w = 10, glow = 0.4) {
    const tex = signTexture(text, bg, fg);
    return this.mesh(
      new THREE.PlaneGeometry(w, w * 0.19),
      new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow * 0.5 }),
      x,
      y,
      z,
      false,
    );
  }

  gates(labels: string[], z = -13.95, spacing = 7) {
    labels.forEach((l, i) => {
      this.mesh(new THREE.PlaneGeometry(4, 4.5), new THREE.MeshStandardMaterial({ map: gateTexture(l), roughness: 0.7 }), (i - (labels.length - 1) / 2) * spacing, 2.25, z, false);
    });
  }

  pallet(x: number, y: number, z: number, scale = 1) {
    const g = new THREE.Group();
    const board = new THREE.BoxGeometry(1.2, 0.03, 0.12);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(board, this.wood);
      m.position.set(0, 0.13, -0.36 + i * 0.12);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    const block = new THREE.BoxGeometry(0.12, 0.1, 0.8);
    for (const bx of [-0.53, 0, 0.53]) {
      const m = new THREE.Mesh(block, this.wood);
      m.position.set(bx, 0.06, 0);
      m.castShadow = true;
      g.add(m);
    }
    g.scale.setScalar(scale);
    return this.add(g, x, y, z);
  }

  palletStack(x: number, z: number, n: number, rot = 0, mat?: THREE.Material) {
    this.pallet(x, 0, z).rotation.y = rot;
    for (let k = 0; k < n; k++) {
      const b = this.mesh(this.boxGeo, mat ?? this.boxMat(k), x, 0.47 + k * 0.6, z);
      b.scale.set(1.0, 0.6, 0.75);
      b.rotation.y = rot + rand(-0.15, 0.15);
    }
  }

  racks(o: { z: number[]; bays?: number; levels: number[]; upright: number; beam: number; fill?: number; height?: number; boxMat?: THREE.Material[] }) {
    const upright = new THREE.MeshStandardMaterial({ color: o.upright, roughness: 0.5, metalness: 0.3 });
    const beam = new THREE.MeshStandardMaterial({ color: o.beam, roughness: 0.5, metalness: 0.3 });
    const bayWidth = 2.8;
    const height = o.height ?? o.levels[o.levels.length - 1] + 1.6;
    const uprightGeo = new THREE.BoxGeometry(0.12, height, 0.12);
    const beamGeo = new THREE.BoxGeometry(bayWidth, 0.14, 0.08);
    const mats = o.boxMat ?? [0, 1, 2, 3].map((i) => this.boxMat(i));
    const boxesPerMat = mats.map(() => [] as THREE.Matrix4[]);
    const bays = o.bays ?? 7;
    for (const z of o.z) {
      for (let bay = -bays; bay <= bays; bay++) {
        const x = bay * bayWidth;
        for (const dz of [-0.55, 0.55]) {
          this.mesh(uprightGeo, upright, x - bayWidth / 2, height / 2, z + dz).receiveShadow = false;
        }
        for (const y of o.levels) {
          if (y > 0) for (const dz of [-0.55, 0.55]) this.mesh(beamGeo, beam, x, y, z + dz, false);
          for (const px of [-0.68, 0.68]) {
            if (Math.random() > (o.fill ?? 0.82)) continue;
            this.pallet(x + px, y + 0.07, z, 0.95);
            const stack = 1 + Math.floor(Math.random() * 3);
            for (let k = 0; k < stack; k++) {
              const s = rand(0.5, 0.65);
              boxesPerMat[Math.floor(Math.random() * mats.length)].push(
                new THREE.Matrix4().compose(
                  new THREE.Vector3(x + px + rand(-0.07, 0.07), y + 0.22 + s / 2 + k * 0.58, z + rand(-0.1, 0.1)),
                  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(-0.1, 0.1)),
                  new THREE.Vector3(s * 1.6, s, s * 1.3),
                ),
              );
            }
          }
        }
      }
    }
    boxesPerMat.forEach((list, i) => {
      const inst = new THREE.InstancedMesh(this.boxGeo, mats[i], list.length);
      list.forEach((m, j) => inst.setMatrixAt(j, m));
      inst.castShadow = true;
      inst.receiveShadow = true;
      this.group.add(inst);
    });
  }

  forklift(x: number, z: number, rot: number, color = 0xf2b705) {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.4, metalness: 0.7 });
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    part(new THREE.BoxGeometry(2.0, 0.8, 1.2), body, 0, 0.75, 0);
    part(new THREE.BoxGeometry(0.8, 0.9, 1.2), body, -0.6, 1.4, 0);
    for (const [px, pz] of [[0.6, 0.55], [0.6, -0.55], [-0.4, 0.55], [-0.4, -0.55]]) part(new THREE.BoxGeometry(0.08, 1.4, 0.08), dark, px, 1.85, pz);
    part(new THREE.BoxGeometry(1.2, 0.06, 1.2), dark, 0.1, 2.55, 0);
    part(new THREE.BoxGeometry(0.12, 3.0, 0.12), steel, 1.1, 1.5, 0.35);
    part(new THREE.BoxGeometry(0.12, 3.0, 0.12), steel, 1.1, 1.5, -0.35);
    part(new THREE.BoxGeometry(1.1, 0.06, 0.12), steel, 1.65, 0.2, 0.3);
    part(new THREE.BoxGeometry(1.1, 0.06, 0.12), steel, 1.65, 0.2, -0.3);
    const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 16);
    wheel.rotateX(Math.PI / 2);
    for (const [px, pz] of [[0.6, 0.62], [0.6, -0.62], [-0.6, 0.62], [-0.6, -0.62]]) part(wheel, dark, px, 0.32, pz);
    g.rotation.y = rot;
    return this.add(g, x, 0, z);
  }

  container(x: number, y: number, z: number, color: number, rot = 0, label = '') {
    const g = new THREE.Group();
    const tex = canvasTexture(512, 128, (c) => {
      c.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      c.fillRect(0, 0, 512, 128);
      for (let i = 0; i < 512; i += 16) {
        c.fillStyle = i % 32 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.08)';
        c.fillRect(i, 0, 8, 128);
      }
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.font = 'bold 40px sans-serif';
      c.fillText(label, 24, 60);
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.3 }));
    m.castShadow = m.receiveShadow = true;
    m.position.y = 1.3;
    g.add(m);
    g.rotation.y = rot;
    return this.add(g, x, y, z);
  }

  barrel(x: number, z: number, color: number, symbol = '☢', y = 0) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
    const b = this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), mat, x, y + 0.45, z);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.35, 0.35),
      new THREE.MeshStandardMaterial({ map: hazardTexture(symbol, `#${color.toString(16).padStart(6, '0')}`), transparent: true }),
    );
    label.position.set(0, 0.05, 0.301);
    b.add(label);
    for (const ry of [-0.3, 0.3]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.015, 6, 20), mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = ry;
      b.add(ring);
    }
    return b;
  }

  /** Förderband mit laufenden Paketen */
  conveyor(x: number, y: number, z: number, length: number, speed = 0.8, parcels = 6, mat?: THREE.Material) {
    const frame = new THREE.MeshStandardMaterial({ color: 0x546e7a, metalness: 0.6, roughness: 0.4 });
    const belt = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
    this.mesh(new THREE.BoxGeometry(length, 0.08, 0.9), belt, x, y, z);
    for (const dz of [-0.48, 0.48]) this.mesh(new THREE.BoxGeometry(length, 0.18, 0.06), frame, x, y + 0.03, z + dz);
    for (let lx = -length / 2 + 0.5; lx < length / 2; lx += 2.5) {
      for (const dz of [-0.42, 0.42]) this.mesh(new THREE.BoxGeometry(0.08, y, 0.08), frame, x + lx, y / 2, z + dz);
    }
    const boxes: THREE.Mesh[] = [];
    for (let i = 0; i < parcels; i++) {
      const s = rand(0.35, 0.6);
      const b = this.mesh(this.boxGeo, mat ?? this.boxMat(i), 0, y + 0.04 + s * 0.4, z + rand(-0.15, 0.15));
      b.scale.set(s * 1.3, s * 0.8, s);
      b.userData.offset = (i / parcels) * length;
      boxes.push(b);
    }
    this.animators.push((t) => {
      for (const b of boxes) b.position.x = x - length / 2 + ((b.userData.offset + t * speed) % length);
    });
  }

  gitterbox(x: number, z: number, fill: number) {
    const frame = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, metalness: 0.7, roughness: 0.4, wireframe: false });
    const mesh = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, metalness: 0.7, roughness: 0.4, wireframe: true });
    const g = new THREE.Group();
    const cage = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.9, 6, 5, 5), mesh);
    cage.position.y = 0.55;
    g.add(cage);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.95), frame);
    base.position.y = 0.05;
    g.add(base);
    for (let i = 0; i < fill; i++) {
      const b = new THREE.Mesh(this.boxGeo, this.boxMat(i));
      const s = rand(0.25, 0.45);
      b.scale.set(s * 1.3, s, s);
      b.position.set(rand(-0.35, 0.35), 0.15 + s / 2 + Math.floor(i / 3) * 0.3, rand(-0.25, 0.25));
      b.rotation.set(rand(-0.3, 0.3), rand(0, 3), rand(-0.3, 0.3));
      b.castShadow = true;
      g.add(b);
    }
    return this.add(g, x, 0, z);
  }

  ceilingLamps(color: number, intensity: number, y = 11, z = -2) {
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: intensity });
    for (let i = -3; i <= 3; i++) this.mesh(new THREE.BoxGeometry(2.4, 0.08, 0.3), lampMat, i * 5, y, z, false);
  }

  point(color: number, intensity: number, distance: number, x: number, y: number, z: number) {
    return this.add(new THREE.PointLight(color, intensity, distance), x, y, z);
  }

  /** Rotierende Warnleuchte */
  beacon(x: number, y: number, z: number, color = 0xff6d00) {
    const housing = this.mesh(
      new THREE.CylinderGeometry(0.15, 0.18, 0.3, 12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, transparent: true, opacity: 0.85 }),
      x,
      y,
      z,
      false,
    );
    const spot = new THREE.SpotLight(color, 40, 16, 0.5, 0.6);
    spot.position.set(x, y, z);
    this.group.add(spot, spot.target);
    const phase = Math.random() * 6;
    this.animators.push((t) => {
      const a = t * 4 + phase;
      spot.target.position.set(x + Math.cos(a) * 5, 0, z + Math.sin(a) * 5);
      housing.rotation.y = a;
    });
  }

  /** Fallender Schnee / Staub als Partikelwolke */
  snow(count: number, color: number, size: number, speed: number) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand(-18, 18);
      pos[i * 3 + 1] = rand(0, 12);
      pos[i * 3 + 2] = rand(-12, 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.8, depthWrite: false }));
    this.group.add(pts);
    this.animators.push((t, dt) => {
      const a = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        a[i * 3 + 1] -= dt * speed;
        a[i * 3] += Math.sin(t + i) * dt * 0.3;
        if (a[i * 3 + 1] < 0) a[i * 3 + 1] = 12;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  /** Lichterkette (Peak Season) */
  garland(y: number, z: number, colors: number[]) {
    const bulbs: THREE.Mesh[] = [];
    for (let i = 0; i < 60; i++) {
      const x = -18 + i * 0.6;
      const sag = Math.abs(Math.sin((i / 10) * Math.PI)) * -0.8;
      const c = colors[i % colors.length];
      const m = this.mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2 }), x, y + sag, z, false);
      bulbs.push(m);
    }
    this.animators.push((t) => {
      bulbs.forEach((b, i) => {
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity = (Math.sin(t * 3 + i * 0.7) + 1.2) * 1.4;
      });
    });
  }
}

// --- Die Arenen -------------------------------------------------------------

type StageFn = (b: Builder) => void;

const STAGE_BUILDERS: Record<string, StageFn> = {
  wareneingang(b) {
    b.env({ bg: 0x1b2028, fog: [18, 42], hemi: [0xdfe8ff, 0x3a3328, 1.1], sun: [0xfff2dd, 2.4] });
    b.floor({ base: '#8d8d88' });
    b.arenaEdges();
    b.wall(0x4a525c);
    b.gates(['TOR 1', 'TOR 2', 'TOR 3', 'TOR 4', 'TOR 5']);
    b.sign('LAGER 3 · WARENEINGANG', '#0d47a1', '#ffffff', 0, 7.8, -13.9);
    b.racks({ z: [-6.5, -10], levels: [0, 2.2, 4.4, 6.6], upright: 0x1565c0, beam: 0xff6f00 });
    b.forklift(-10.5, -3, 0.5);
    b.palletStack(9.5, -2.5, 3);
    b.palletStack(11, -1, 2);
    b.palletStack(-12, 1.5, 1);
    b.ceilingLamps(0xfff4e0, 2);
    b.point(0xffb060, 30, 18, 0, 6, -4);
  },

  kuehlhaus(b) {
    b.env({ bg: 0xbcd7e6, fog: [8, 30], hemi: [0xe8f6ff, 0x8fb3c9, 1.6], sun: [0xdff3ff, 1.6] });
    b.floor({ base: '#d8e6ee', speck: [200, 215, 225], joints: 'rgba(120,150,170,0.35)', roughness: 0.25, metalness: 0.1, lines: 0x29b6f6 });
    b.arenaEdges('#29b6f6', '#ffffff');
    b.wall(0xdbe9f2);
    const frost = [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: 0xeef6fb, roughness: 0.6 }));
    frost[1].color.set(0xcfe3ef);
    frost[2].map = cardboardTexture('TK −24°C', '#c7d8e2');
    b.racks({ z: [-6.5, -10], levels: [0, 2.2, 4.4, 6.6], upright: 0xe0e0e0, beam: 0x1976d2, boxMat: frost });
    // Eiszapfen an den vorderen Traversen
    const ice = new THREE.MeshStandardMaterial({ color: 0xe1f5fe, transparent: true, opacity: 0.8, roughness: 0.1 });
    for (let i = 0; i < 70; i++) {
      const h = rand(0.15, 0.5);
      const m = b.mesh(new THREE.ConeGeometry(0.04, h, 6), ice, rand(-20, 20), 0, -5.95, false);
      m.rotation.x = Math.PI;
      m.position.y = [2.2, 4.4, 6.6][i % 3] - 0.07 - h / 2;
    }
    b.sign('KÜHLHAUS · TÜR SCHLIESSEN!', '#0277bd', '#ffffff', 0, 8.3, -13.9);
    b.palletStack(9.5, -2, 3, 0.2, frost[0]);
    b.palletStack(-10, -1.5, 2, -0.2, frost[1]);
    // Kältevorhang (PVC-Streifen)
    const pvc = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.1, side: THREE.DoubleSide });
    for (let i = 0; i < 12; i++) b.mesh(new THREE.PlaneGeometry(0.3, 4), pvc, -2 + i * 0.33, 2, -13.8, false);
    b.snow(1500, 0xffffff, 0.06, 0.8);
    b.ceilingLamps(0xe0f7ff, 3);
  },

  laderampe(b) {
    b.env({ bg: 0x070a14, fog: [14, 40], hemi: [0x7788cc, 0x332818, 1.0], sun: [0xffb35c, 2.2], sunPos: [-6, 10, 6] });
    b.impactZ = -11.3;
    b.floor({ base: '#5a5a58', speck: [80, 80, 78], lines: 0xffffff });
    b.arenaEdges();
    b.wall(0x2a2f38, -12);
    // Offene Tore mit Aufliegern
    for (let i = 0; i < 4; i++) {
      const x = -10.5 + i * 7;
      b.mesh(new THREE.PlaneGeometry(3.6, 3.8), new THREE.MeshBasicMaterial({ color: 0x0b1230 }), x, 1.9 + 0.6, -11.97, false);
      // Auflieger-Heck mit Ladung
      const trailer = b.mesh(new THREE.BoxGeometry(3.2, 3.2, 0.2), new THREE.MeshStandardMaterial({ color: [0xeeeeee, 0x1565c0, 0xc62828, 0x2e7d32][i] }), x, 2.6, -12.6, false);
      trailer.scale.y = 1;
      for (let k = 0; k < 6; k++) b.mesh(b.boxGeo, b.boxMat(k), x - 1 + (k % 3) * 1, 1.6 + Math.floor(k / 3) * 0.9, -12.4).scale.set(0.9, 0.8, 0.5);
      // Rampenpuffer
      for (const dx of [-1.9, 1.9]) b.mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111 }), x + dx, 0.5, -11.8);
      b.point(0xff9a3c, 18, 12, x, 5, -10);
    }
    b.sign('VERLADUNG · NACHTSCHICHT', '#212121', '#ff9800', 0, 7, -11.9, 10, 1);
    b.palletStack(8.5, -4, 3);
    b.palletStack(-9, -5, 2);
    b.forklift(11, -6, -0.6, 0xd32f2f);
    // Mond über der Halle
    b.mesh(new THREE.SphereGeometry(1.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff8e1 }), 14, 13, -30, false);
  },

  hochregal(b) {
    b.env({ bg: 0x08121e, fog: [16, 45], hemi: [0x9fd8ff, 0x10202a, 0.9], sun: [0xd6f4ff, 2.0] });
    b.floor({ base: '#5f6e6a', speck: [100, 120, 115], joints: 'rgba(30,40,40,0.3)', roughness: 0.3, lines: 0x00e5ff });
    b.arenaEdges('#00e5ff', '#0d1b2a');
    b.wall(0x1c2833, -16, 30);
    const levels = Array.from({ length: 10 }, (_, i) => i * 2.0);
    b.racks({ z: [-6.5, -10, -13.5], levels, upright: 0x90a4ae, beam: 0x00838f, fill: 0.9, height: 21 });
    // Regalbediengeräte, die auf und ab fahren
    const steel = new THREE.MeshStandardMaterial({ color: 0xffca28, metalness: 0.5, roughness: 0.4 });
    for (const [x, speed] of [[-5.6, 0.7], [4.2, 0.5], [11.2, 0.9]] as const) {
      b.mesh(new THREE.BoxGeometry(0.2, 21, 0.2), steel, x, 10.5, -8.25);
      const carriage = b.mesh(new THREE.BoxGeometry(1.2, 0.5, 1.4), steel, x, 2, -8.25);
      const load = new THREE.Mesh(b.boxGeo, b.boxMat());
      load.scale.set(0.8, 0.5, 0.6);
      load.position.y = 0.5;
      carriage.add(load);
      carriageLamp(carriage);
      b.animators.push((t) => {
        carriage.position.y = 1 + (Math.sin(t * speed + x) + 1) * 8;
      });
    }
    b.sign('AKL · ZUTRITT NUR FÜR ROBOTER', '#00363a', '#00e5ff', 0, 1.6, -5.4, 6, 1.5);
    b.ceilingLamps(0x80deea, 3, 22);
    b.point(0x00e5ff, 25, 20, 0, 5, -3);
  },

  packstation(b) {
    b.env({ bg: 0x2b2018, fog: [16, 40], hemi: [0xffe8c8, 0x3a2a1a, 1.4], sun: [0xffd9a0, 2.3] });
    b.impactZ = -3.9;
    b.floor({ base: '#7d746a', speck: [110, 100, 90] });
    b.arenaEdges();
    b.wall(0x6d5c4a);
    b.sign('PACKSTATION 7 · BITTE LÄCHELN', '#ff7043', '#ffffff', 0, 7.5, -13.9);
    b.conveyor(0, 1.0, -4.5, 30, 1.2, 12);
    b.conveyor(0, 2.4, -8, 30, 0.9, 10);
    // Packtische mit Klebebandrollen und Luftpolsterfolie
    const table = new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 0.7 });
    const leg = new THREE.MeshStandardMaterial({ color: 0x455a64, metalness: 0.5 });
    const tape = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.4 });
    const wrap = new THREE.MeshStandardMaterial({ color: 0xe3f2fd, transparent: true, opacity: 0.7, roughness: 0.2 });
    for (const x of [-11, -6.5, 6.5, 11]) {
      b.mesh(new THREE.BoxGeometry(2.6, 0.08, 1.2), table, x, 0.95, -2.8);
      for (const [dx, dz] of [[-1.2, -0.5], [1.2, -0.5], [-1.2, 0.5], [1.2, 0.5]]) b.mesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), leg, x + dx, 0.47, -2.8 + dz);
      b.mesh(new THREE.TorusGeometry(0.1, 0.04, 8, 16), tape, x - 0.6, 1.05, -2.6).rotation.x = Math.PI / 2;
      b.mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), b.boxMat(), x + 0.5, 1.2, -2.9);
      const roll = b.mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 16), wrap, x + 0.9, 0.35, -1.8);
      roll.rotation.z = Math.PI / 2;
    }
    // Hängelampen über den Tischen
    for (const x of [-11, -6.5, 6.5, 11]) {
      b.mesh(new THREE.ConeGeometry(0.35, 0.3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x263238, side: THREE.DoubleSide }), x, 3.4, -2.8, false);
      b.point(0xffcc80, 8, 6, x, 3.1, -2.8);
    }
  },

  retouren(b) {
    b.env({ bg: 0x1e1a18, fog: [14, 38], hemi: [0xf0e6dc, 0x3a3028, 1.3], sun: [0xfff0e0, 2.2] });
    b.floor({ base: '#77716b', speck: [100, 95, 90] });
    b.arenaEdges();
    b.wall(0x57493f);
    b.sign('RETOUREN · BITTE NICHT STAPELN', '#bf360c', '#ffffff', 0, 7.5, -13.9);
    for (let i = 0; i < 18; i++) b.gitterbox(rand(-16, 16), rand(-11, -5), Math.floor(rand(2, 9)));
    // Kartons kreuz und quer
    for (let i = 0; i < 45; i++) {
      const s = rand(0.3, 0.8);
      const z = rand(-12, -3.5);
      const x = rand(-18, 18);
      const m = b.mesh(b.boxGeo, b.boxMat(), x, s / 2, z);
      m.scale.set(s * 1.3, s, s);
      m.rotation.set(0, rand(0, Math.PI), Math.random() < 0.3 ? Math.PI / 2 : 0);
    }
    b.racks({ z: [-12.5], levels: [0, 2.2, 4.4], upright: 0x6d4c41, beam: 0xffb300, fill: 0.55 });
    // Seitlich einzelne Stapel
    b.palletStack(9, -2.5, 4, 0.5);
    b.palletStack(-10, -2.5, 3, -0.4);
    b.ceilingLamps(0xfff0d0, 1.5);
    b.point(0xffffff, 15, 14, 0, 6, -5);
  },

  hafen(b) {
    b.env({ bg: 0x8ec0e8, fog: [25, 70], fogColor: 0xa9cfee, hemi: [0xcfe8ff, 0x6b6b5a, 1.4], sun: [0xfff4d6, 3.0], sunPos: [10, 18, 6] });
    b.floor({ base: '#4e5052', speck: [70, 72, 74], joints: 'rgba(0,0,0,0)', lines: 0xffffff });
    b.arenaEdges();
    const colors = [0xd84315, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6a1b9a, 0x00838f, 0x8d6e63];
    const labels = ['WFTU 401123', 'LGST 778812', 'PALE 220044', 'KRTN 100001', 'HUB 3', 'EILT 4711'];
    for (let row = 0; row < 2; row++) {
      for (let i = -3; i <= 3; i++) {
        const stack = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < stack; k++) {
          b.container(i * 6.3 + rand(-0.2, 0.2), k * 2.6, -8 - row * 3.2, colors[Math.floor(Math.random() * colors.length)], 0, labels[(i + 3 + k) % labels.length]);
        }
      }
    }
    // Containerbrücke
    const crane = new THREE.MeshStandardMaterial({ color: 0xd32f2f, metalness: 0.4, roughness: 0.5 });
    for (const x of [-12, -4]) for (const z of [-5, -18]) b.mesh(new THREE.BoxGeometry(0.6, 20, 0.6), crane, x, 10, z);
    b.mesh(new THREE.BoxGeometry(10, 1, 1), crane, -8, 20, -5);
    b.mesh(new THREE.BoxGeometry(10, 1, 1), crane, -8, 20, -18);
    b.mesh(new THREE.BoxGeometry(1, 1, 30), crane, -12, 20, -12);
    b.mesh(new THREE.BoxGeometry(1, 1, 30), crane, -4, 20, -12);
    const spreader = b.mesh(new THREE.BoxGeometry(6.2, 0.4, 2.4), new THREE.MeshStandardMaterial({ color: 0xffeb3b }), -8, 14, -11.5);
    b.animators.push((t) => {
      spreader.position.y = 12 + Math.sin(t * 0.4) * 3;
    });
    // Wasser hinten
    b.mesh(new THREE.PlaneGeometry(200, 60), new THREE.MeshStandardMaterial({ color: 0x1f5c8a, roughness: 0.2, metalness: 0.3 }), 0, -0.3, -50, false).rotation.x = -Math.PI / 2;
    b.impactZ = -6.6;
    b.palletStack(10, -3, 2);
    b.forklift(-10, -2.5, 0.4, 0x1e88e5);
  },

  sortieranlage(b) {
    b.env({ bg: 0x0f0f1e, fog: [14, 38], hemi: [0xb39ddb, 0x2a1838, 1.2], sun: [0xf3e5f5, 2.3] });
    b.impactZ = -4.4;
    b.floor({ base: '#3f4250', speck: [70, 72, 85], joints: 'rgba(20,20,30,0.4)', roughness: 0.5, lines: 0xe040fb });
    b.arenaEdges('#e040fb', '#120a1e');
    b.wall(0x24243a);
    b.sign('PAKETZENTRUM · SORTER 2', '#4a148c', '#ffffff', 0, 9, -13.9, 10, 1.2);
    const parcelMat = new THREE.MeshStandardMaterial({ color: 0xffca28, roughness: 0.6 });
    b.conveyor(0, 1.2, -5, 36, 2.2, 14);
    b.conveyor(0, 3.2, -7.5, 36, 3.0, 14, parcelMat);
    b.conveyor(0, 5.2, -10, 36, 1.6, 12);
    // Rutschen
    const chute = new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide });
    for (let i = -4; i <= 4; i++) {
      const c = b.mesh(new THREE.PlaneGeometry(1.2, 3), chute, i * 4, 1.6, -6.3, false);
      c.rotation.x = -0.9;
      const lightColor = [0xe040fb, 0x00e5ff, 0x76ff03][(i + 4) % 3];
      b.mesh(new THREE.BoxGeometry(0.5, 0.15, 0.1), new THREE.MeshStandardMaterial({ color: lightColor, emissive: lightColor, emissiveIntensity: 2 }), i * 4, 3, -5.6, false);
    }
    b.point(0xe040fb, 30, 18, -6, 6, -3);
    b.point(0x00e5ff, 30, 18, 6, 6, -3);
    b.gitterbox(10, -2.5, 6);
    b.gitterbox(-10.5, -2.5, 5);
  },

  gefahrgut(b) {
    b.env({ bg: 0x101410, fog: [12, 36], fogColor: 0x1a2418, hemi: [0xd8ffd0, 0x303828, 1.2], sun: [0xfff6d0, 2.4] });
    b.impactZ = -5.6;
    b.floor({ base: '#5c5f55', speck: [80, 85, 75], lines: 0xffd600 });
    b.arenaEdges('#ffd600', '#111');
    b.wall(0x2f352c);
    b.sign('GEFAHRGUTLAGER · RAUCHEN VERBOTEN', '#ffd600', '#111111', 0, 7.5, -13.9);
    // Auffangwannen mit Fässern
    const tray = new THREE.MeshStandardMaterial({ color: 0xffd600, roughness: 0.6 });
    const kinds: [number, string][] = [[0x1565c0, '☠'], [0xffd600, '☢'], [0xc62828, '🔥'], [0x2e7d32, '♻'], [0x424242, '⚠']];
    for (let row = 0; row < 2; row++) {
      for (let i = -5; i <= 5; i++) {
        const x = i * 3;
        const z = -6.5 - row * 3.5;
        b.mesh(new THREE.BoxGeometry(2.6, 0.25, 1.6), tray, x, 0.12, z);
        const [color, sym] = kinds[Math.floor(Math.random() * kinds.length)];
        for (const dx of [-0.8, 0, 0.8]) for (const dz of [-0.35, 0.35]) if (Math.random() < 0.85) b.barrel(x + dx, z + dz, color, sym, 0.25);
      }
    }
    for (const x of [-10, -3.5, 3.5, 10]) b.beacon(x, 6, -5.5, 0xff1744);
    b.barrel(9, -2, 0xc62828, '🔥');
    b.barrel(9.7, -2.6, 0xc62828, '🔥');
    b.barrel(-9.5, -2.2, 0x1565c0, '☠');
    // Not-Dusche
    const green = new THREE.MeshStandardMaterial({ color: 0x00c853, emissive: 0x00c853, emissiveIntensity: 0.6 });
    b.mesh(new THREE.BoxGeometry(0.12, 3, 0.12), green, -12, 1.5, -3);
    b.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16), green, -12, 3, -2.7);
    b.ceilingLamps(0xe8ffd8, 1.2);
  },

  peak(b) {
    b.env({ bg: 0x1a0b3a, fog: [16, 42], hemi: [0xffd0e0, 0x2a1040, 1.1], sun: [0xffe0f0, 2.1] });
    b.impactZ = -3.9;
    b.floor({ base: '#5e5568', speck: [90, 80, 100], lines: 0xff1744 });
    b.arenaEdges('#ff1744', '#ffffff');
    b.wall(0x2c1850);
    b.sign('PEAK SEASON · 1.000.000 PAKETE', '#d50000', '#ffffff', 0, 9.5, -13.9, 11, 1.5);
    // Der Paketberg
    for (let i = 0; i < 260; i++) {
      const r = Math.pow(Math.random(), 0.6) * 9;
      const a = rand(-Math.PI / 2, Math.PI / 2);
      const x = Math.sin(a) * r * 1.8;
      const h = Math.max(0, 8 - r) * rand(0.7, 1);
      const s = rand(0.4, 0.9);
      const m = b.mesh(b.boxGeo, b.boxMat(), x, h * 0.85 + s / 2, -10 + Math.cos(a) * -r * 0.3);
      m.scale.set(s * 1.3, s, s);
      m.rotation.set(rand(-0.4, 0.4), rand(0, Math.PI), rand(-0.4, 0.4));
    }
    b.garland(6, -6, [0xff1744, 0xffd600, 0x00e676, 0x2979ff]);
    b.garland(8, -9, [0xffd600, 0xff1744]);
    b.conveyor(0, 1.1, -4.5, 30, 2.5, 14);
    b.palletStack(10, -2.5, 4, 0.3);
    b.palletStack(-10.5, -2, 4, -0.3);
    b.point(0xff4081, 30, 18, -6, 5, -3);
    b.point(0xffd740, 30, 18, 6, 5, -3);
  },
};

/** Kleine Warnlampe am Regalbediengerät */
function carriageLamp(parent: THREE.Object3D) {
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff6d00, emissive: 0xff6d00, emissiveIntensity: 3 }));
  lamp.position.set(0, 0.35, 0.7);
  parent.add(lamp);
}

export function buildStage(scene: THREE.Scene, id: string): BuiltStage {
  const b = new Builder(scene);
  (STAGE_BUILDERS[id] ?? STAGE_BUILDERS.wareneingang)(b);
  scene.add(b.group);
  return {
    group: b.group,
    impactZ: b.impactZ,
    update(t, dt) {
      for (const a of b.animators) a(t, dt);
    },
    focus(x, z, t) {
      if (b.sun) {
        // auf Texelgröße runden, damit die Schattenkanten beim Mitwandern nicht flimmern
        const texel = 16 / 2048;
        const fx = Math.round(x / texel) * texel;
        b.sun.position.set(fx + b.sunOffset.x, b.sunOffset.y, z + b.sunOffset.z);
        b.sun.target.position.set(fx, 0, z);
      }
      if (b.spot) {
        b.spot.position.set(x + Math.sin(t * 0.35) * 3, 9.5, 3.5);
        b.spot.target.position.set(x + Math.sin(t * 0.6) * 1.5, 0, z + Math.cos(t * 0.45) * 0.8);
      }
    },
    dispose() {
      scene.remove(b.group);
      b.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          (mat as THREE.MeshStandardMaterial).map?.dispose();
          mat.dispose();
        }
      });
    },
  };
}
