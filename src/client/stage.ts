import * as THREE from 'three';

// Die Arena: eine Lagerhalle mit Hochregalen, Paletten, Rolltoren und einem
// geparkten Gabelstapler. Alles prozedural, keine externen Assets.

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

function floorTexture() {
  const tex = canvasTexture(1024, 1024, (g) => {
    g.fillStyle = '#8d8d88';
    g.fillRect(0, 0, 1024, 1024);
    // Betonflecken
    for (let i = 0; i < 2500; i++) {
      const v = 120 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v},${v - 5},${Math.random() * 0.15})`;
      const r = Math.random() * 18;
      g.beginPath();
      g.arc(Math.random() * 1024, Math.random() * 1024, r, 0, Math.PI * 2);
      g.fill();
    }
    // Fugen
    g.strokeStyle = 'rgba(60,60,60,0.35)';
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
  tex.repeat.set(10, 6);
  return tex;
}

function cardboardTexture(label: string) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#b98a55';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 40; i++) g.fillRect(0, Math.random() * 256, 256, 1 + Math.random() * 2);
    // Klebeband
    g.fillStyle = 'rgba(210,180,120,0.9)';
    g.fillRect(110, 0, 36, 256);
    g.fillStyle = '#3a2a1a';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, 128, 200);
    // Pfeile "oben"
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

function gateTexture(n: number) {
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
    g.fillText(`TOR ${n}`, 256, 46);
  });
}

function signTexture(text: string, bg: string, fg: string) {
  return canvasTexture(1024, 192, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 192);
    g.fillStyle = fg;
    g.font = 'bold 110px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 100);
  });
}

function makePallet(mat: THREE.Material) {
  const g = new THREE.Group();
  const board = new THREE.BoxGeometry(1.2, 0.03, 0.12);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(board, mat);
    m.position.set(0, 0.13, -0.36 + i * 0.12);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  const block = new THREE.BoxGeometry(0.12, 0.1, 0.8);
  for (const x of [-0.53, 0, 0.53]) {
    const m = new THREE.Mesh(block, mat);
    m.position.set(x, 0.06, 0);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function makeForklift() {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.5, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.4, metalness: 0.7 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(2.0, 0.8, 1.2), yellow, 0, 0.75, 0);
  add(new THREE.BoxGeometry(0.8, 0.9, 1.2), yellow, -0.6, 1.4, 0); // Gegengewicht/Sitz
  // Schutzdach
  for (const [x, z] of [[0.6, 0.55], [0.6, -0.55], [-0.4, 0.55], [-0.4, -0.55]]) add(new THREE.BoxGeometry(0.08, 1.4, 0.08), dark, x, 1.85, z);
  add(new THREE.BoxGeometry(1.2, 0.06, 1.2), dark, 0.1, 2.55, 0);
  // Mast und Gabeln
  add(new THREE.BoxGeometry(0.12, 3.0, 0.12), steel, 1.1, 1.5, 0.35);
  add(new THREE.BoxGeometry(0.12, 3.0, 0.12), steel, 1.1, 1.5, -0.35);
  add(new THREE.BoxGeometry(1.1, 0.06, 0.12), steel, 1.65, 0.2, 0.3);
  add(new THREE.BoxGeometry(1.1, 0.06, 0.12), steel, 1.65, 0.2, -0.3);
  const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 16);
  wheel.rotateX(Math.PI / 2);
  for (const [x, z] of [[0.6, 0.62], [0.6, -0.62], [-0.6, 0.62], [-0.6, -0.62]]) add(wheel, dark, x, 0.32, z);
  return g;
}

export function buildStage(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x1b2028);
  scene.fog = new THREE.Fog(0x1b2028, 18, 42);

  // Licht
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3328, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(4, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -4, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Boden
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 36),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Gelbe Fahrweg-Markierungen + Warnschraffur
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.6 });
  for (const z of [-1.6, 1.6]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.12), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.005, z);
    scene.add(line);
  }
  const hatch = canvasTexture(256, 64, (g) => {
    g.fillStyle = '#f5c400';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#111';
    for (let x = -64; x < 256; x += 48) {
      g.beginPath();
      g.moveTo(x, 64);
      g.lineTo(x + 24, 64);
      g.lineTo(x + 88, 0);
      g.lineTo(x + 64, 0);
      g.fill();
    }
  });
  hatch.wrapT = THREE.RepeatWrapping;
  hatch.repeat.set(1, 6);
  for (const x of [-7.6, 7.6]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 3.2), new THREE.MeshStandardMaterial({ map: hatch }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, 0);
    scene.add(m);
  }

  // Rückwand mit Rolltoren
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.9 }));
  wall.position.set(0, 8, -14);
  scene.add(wall);
  for (let i = 0; i < 5; i++) {
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(4, 4.5), new THREE.MeshStandardMaterial({ map: gateTexture(i + 1), roughness: 0.7 }));
    gate.position.set(-14 + i * 7, 2.25, -13.95);
    scene.add(gate);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 1.9),
    new THREE.MeshStandardMaterial({ map: signTexture('LAGER 3 · WARENEINGANG', '#0d47a1', '#ffffff'), emissive: 0x0d2a60, emissiveIntensity: 0.4 }),
  );
  sign.position.set(0, 7.8, -13.9);
  scene.add(sign);

  // Hochregale
  const upright = new THREE.MeshStandardMaterial({ color: 0x1565c0, roughness: 0.5, metalness: 0.3 });
  const beam = new THREE.MeshStandardMaterial({ color: 0xff6f00, roughness: 0.5, metalness: 0.3 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.9 });
  const boxMats = ['ZERBRECHLICH', 'LIEFERUNG', 'ART. 4711', 'EILT!'].map(
    (l) => new THREE.MeshStandardMaterial({ map: cardboardTexture(l), roughness: 0.9 }),
  );
  const levels = [0.0, 2.2, 4.4, 6.6];
  const bayWidth = 2.8;
  const rackZ = [-6.5, -10];
  const uprightGeo = new THREE.BoxGeometry(0.12, 8.2, 0.12);
  const beamGeo = new THREE.BoxGeometry(bayWidth, 0.14, 0.08);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxesPerMat = boxMats.map(() => [] as THREE.Matrix4[]);
  for (const z of rackZ) {
    for (let bay = -7; bay <= 7; bay++) {
      const x = bay * bayWidth;
      for (const dz of [-0.55, 0.55]) {
        const u = new THREE.Mesh(uprightGeo, upright);
        u.position.set(x - bayWidth / 2, 4.1, z + dz);
        u.castShadow = true;
        scene.add(u);
      }
      for (const y of levels) {
        if (y > 0) {
          for (const dz of [-0.55, 0.55]) {
            const b = new THREE.Mesh(beamGeo, beam);
            b.position.set(x, y, z + dz);
            scene.add(b);
          }
        }
        // Paletten mit Kartons (manche Fächer leer – realistisch)
        for (const px of [-0.68, 0.68]) {
          if (Math.random() < 0.18) continue;
          const pallet = makePallet(wood);
          pallet.position.set(x + px, y + 0.07, z);
          pallet.scale.setScalar(0.95);
          scene.add(pallet);
          const stack = 1 + Math.floor(Math.random() * 3);
          for (let k = 0; k < stack; k++) {
            const s = 0.5 + Math.random() * 0.15;
            const m = new THREE.Matrix4().compose(
              new THREE.Vector3(x + px + (Math.random() - 0.5) * 0.15, y + 0.22 + s / 2 + k * 0.58, z + (Math.random() - 0.5) * 0.2),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.2),
              new THREE.Vector3(s * 1.6, s, s * 1.3),
            );
            boxesPerMat[Math.floor(Math.random() * boxMats.length)].push(m);
          }
        }
      }
    }
  }
  boxesPerMat.forEach((list, i) => {
    const inst = new THREE.InstancedMesh(boxGeo, boxMats[i], list.length);
    list.forEach((m, j) => inst.setMatrixAt(j, m));
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);
  });

  // Requisiten im Vordergrund / an den Seiten
  const forklift = makeForklift();
  forklift.position.set(-10.5, 0, -3);
  forklift.rotation.y = 0.5;
  scene.add(forklift);
  for (const [x, z, n] of [[9.5, -2.5, 3], [11, -1, 2], [-12, 1.5, 1]] as const) {
    const pallet = makePallet(wood);
    pallet.position.set(x, 0, z);
    scene.add(pallet);
    for (let k = 0; k < n; k++) {
      const b = new THREE.Mesh(boxGeo, boxMats[k % boxMats.length]);
      b.scale.set(1.0, 0.6, 0.75);
      b.position.set(x, 0.47 + k * 0.6, z);
      b.rotation.y = (Math.random() - 0.5) * 0.3;
      b.castShadow = b.receiveShadow = true;
      scene.add(b);
    }
  }

  // Hallenleuchten
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2 });
  for (let i = -3; i <= 3; i++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.3), lampMat);
    lamp.position.set(i * 5, 11, -2);
    scene.add(lamp);
  }
  const warm = new THREE.PointLight(0xffb060, 30, 18);
  warm.position.set(0, 6, -4);
  scene.add(warm);
}
