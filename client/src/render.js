// The 3D view. It draws the arena, the players, the items and the effects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WEAPONS, ITEMS, PM } from '../../shared/constants.js';
import { traceBox, newTrace } from '../../shared/collision.js';

const SURFACE = {
  floor: [0x4a5268, null], wall: [0x55607c, null], stair: [0x5a6688, 0x2a5d80],
  plat: [0x3f6a80, 0x35d0ff], walk: [0x3f6a80, 0x35d0ff], ped: [0x6a4a90, 0xd45cff],
  pillar: [0x8a6844, 0xffa040], cover: [0x5c6c90, 0x7fa0ff], crate: [0x86764c, 0xffd060],
};
// Graphics quality. "pixels" is the maximum number of pixels that the game draws.
// A 4K screen has 8 million pixels. That is too much for an integrated GPU.
export const QUALITY = {
  low: { pixels: 1.3e6, bloom: false },
  medium: { pixels: 2.2e6, bloom: true },
  high: { pixels: 4.2e6, bloom: true },
  native: { pixels: Infinity, bloom: true },
};
const UP = new THREE.Vector3(0, 1, 0);
const tr = newTrace();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

function panelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c9c9';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const s = 180 + Math.random() * 60;
    g.fillStyle = `rgba(${s},${s},${s},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  g.strokeStyle = '#6f6f6f'; g.lineWidth = 4;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#a5a5a5'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  g.fillStyle = '#8a8a8a';
  for (const [x, y] of [[12, 12], [244, 12], [12, 244], [244, 244]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = '600 28px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 128, 24);
  g.fillStyle = color;
  g.fillText(text, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(64, 12, 1);
  return s;
}

export function playerColor(id) {
  return new THREE.Color().setHSL((id * 0.618034) % 1, 0.85, 0.58);
}

export class Renderer {
  constructor(canvas, map, world, opts = {}) {
    this.map = map; this.world = world;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.3;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060c);
    this.scene.fog = new THREE.FogExp2(0x05060c, 0.00028);
    this.camera = new THREE.PerspectiveCamera(100, 1, 1, 8000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.time = 0;
    this.effects = [];
    this.players = new Map();
    this.projectiles = new Map();
    this.names = new Map();
    this.kick = 0;
    this.viewWeapon = -1;

    this.buildLevel();
    this.buildItems();
    this.buildViewModel();

    this.quality = QUALITY[opts.quality] || QUALITY.medium;
    this.composer = new EffectComposer(this.r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.8));
    this.composer.addPass(new OutputPass());
    this.sphere = new THREE.SphereGeometry(1, 16, 12);
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.puffPool = []; this.beamPool = [];
    this.projectileMats = WEAPONS.map((w, i) => new THREE.MeshBasicMaterial({ color: i === 2 ? 0xffb060 : w.color }));
    this.warm();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Makes one object of each type and compiles all shaders before the game starts.
  warm() {
    const p = { id: -1, x: 0, y: 300, z: 0, yaw: 0, pitch: 0, dead: false, beam: true, amp: true };
    this.setPlayers([p], 0);
    this.setProjectiles([{ id: -1, w: 2, x: 0, y: 300, z: 0 }]);
    this.puff(0, 300, 0, 0xffffff, 1, 1);
    this.beamEffect({ x: 0, y: 300, z: 0 }, [0, 310, 0], 0xffffff, 1, 1);
    this.view.visible = true;
    this.setViewWeapon(0);
    this.r.compile(this.scene, this.camera);
    this.setPlayers([], 0);
    this.setProjectiles([]);
    for (const e of this.effects) { e.obj.visible = false; e.pool.push(e.obj); }
    this.effects.length = 0;
  }

  setQuality(name) {
    this.quality = QUALITY[name] || QUALITY.medium;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ratio = Math.min(dpr, Math.sqrt(this.quality.pixels / (w * h)));
    this.r.setPixelRatio(ratio);
    this.r.setSize(w, h, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.setFov(this.fov || 100);
  }

  // "fov" is the horizontal field of view for a 4:3 screen, in degrees.
  setFov(fov) {
    this.fov = fov;
    const h = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 0.75);
    this.camera.fov = (h * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  buildLevel() {
    const geos = [], lines = [], lineColors = [];
    const col = new THREE.Color();
    for (const b of this.map.brushes) {
      if (b.invisible) continue;
      const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(b.min[0] + sx / 2, b.min[1] + sy / 2, b.min[2] + sz / 2);
      // Scale the texture with the size of each face.
      const uv = g.attributes.uv;
      const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
      const colors = new Float32Array(24 * 3);
      const [base, edge] = SURFACE[b.c] || SURFACE.wall;
      for (let f = 0; f < 6; f++) {
        const shade = f === 2 ? 1.25 : f === 3 ? 0.5 : f < 2 ? 0.95 : 0.8;
        col.setHex(base).multiplyScalar(shade);
        for (let i = f * 4; i < f * 4 + 4; i++) {
          uv.setXY(i, (uv.getX(i) * dims[f][0]) / 128, (uv.getY(i) * dims[f][1]) / 128);
          colors.set([col.r, col.g, col.b], i * 3);
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geos.push(g);
      if (edge !== null) {
        // Bright lines on the top edges.
        const y = b.max[1] + 0.3, [x1, , z1] = b.min, [x2, , z2] = b.max;
        lines.push(x1, y, z1, x2, y, z1, x2, y, z1, x2, y, z2, x2, y, z2, x1, y, z2, x1, y, z2, x1, y, z1);
        col.setHex(edge);
        for (let i = 0; i < 8; i++) lineColors.push(col.r, col.g, col.b);
      }
    }
    const mat = new THREE.MeshStandardMaterial({ map: panelTexture(), vertexColors: true, roughness: 0.82, metalness: 0.15 });
    this.scene.add(new THREE.Mesh(mergeGeometries(geos), mat));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    this.scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true })));

    this.scene.add(new THREE.HemisphereLight(0xb4c4ff, 0x4a3a5c, 3.4));
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.6);
    sun.position.set(500, 900, 300);
    this.scene.add(sun);
    const lamp = (x, y, z, color, power, dist) => {
      const l = new THREE.PointLight(color, power, dist, 0);
      l.position.set(x, y, z);
      this.scene.add(l);
    };
    lamp(0, 260, 0, 0xd45cff, 2.2, 700);
    for (const [x, z, c] of [[900, 0, 0xff5a4a], [-900, 0, 0xffc04a], [0, 900, 0x4dff88], [0, -900, 0x4aa8ff]]) lamp(x, 300, z, c, 1.6, 800);

    // Jump pads.
    this.padMats = [];
    for (const p of this.map.pads) {
      const w = p.max[0] - p.min[0];
      const m = new THREE.MeshBasicMaterial({ color: 0x35ffd0 });
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.48, w * 0.5, 3, 24), m);
      plate.position.set(p.pos[0], 1.5, p.pos[2]);
      this.scene.add(plate);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.4, 1.5, 6, 24), m);
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(plate.position);
      this.scene.add(ring);
      this.padMats.push({ m, ring });
    }

    // Stars above the arena.
    const stars = [];
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * Math.PI * 2, h = Math.random() * 0.9 + 0.1, r = 5000;
      stars.push(Math.cos(a) * r * Math.sqrt(1 - h * h), h * r, Math.sin(a) * r * Math.sqrt(1 - h * h));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfd0ff, size: 14, fog: false })));
  }

  buildItems() {
    const glow = (color, k = 1) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 * k, roughness: 0.4 });
    const cross = (s, mat) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(s, s / 3, s / 3), mat), new THREE.Mesh(new THREE.BoxGeometry(s / 3, s, s / 3), mat));
      return g;
    };
    this.items = this.map.items.map((it) => {
      const d = ITEMS[it.type];
      let m;
      if (d.kind === 'health') {
        m = cross(d.amount >= 100 ? 30 : d.amount >= 50 ? 22 : d.amount >= 25 ? 18 : 10,
          glow(d.amount >= 100 ? 0x4aa8ff : d.amount >= 50 ? 0xffc04a : d.amount >= 25 ? 0xffe14a : 0x5dff7a));
      } else if (d.kind === 'armor') {
        const c = d.amount >= 100 ? 0xff4a3c : d.amount >= 50 ? 0xffd23c : 0x6fe08a;
        const s = d.amount >= 50 ? 15 : 6;
        m = new THREE.Mesh(new THREE.OctahedronGeometry(s), glow(c));
        m.scale.y = 1.25;
      } else if (d.kind === 'weapon') {
        const c = WEAPONS[d.weapon].color;
        m = new THREE.Group();
        const gun = new THREE.Mesh(new THREE.BoxGeometry(34, 7, 7), glow(c));
        const grip = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 6), glow(0x444a5a, 0.2));
        grip.position.set(-9, -8, 0);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(22, 1.2, 6, 28), new THREE.MeshBasicMaterial({ color: c }));
        ring.rotation.x = Math.PI / 2; ring.position.y = -20;
        m.add(gun, grip, ring);
      } else if (d.kind === 'ammo') {
        m = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 12), glow(WEAPONS[d.weapon].color, 0.6));
      } else {
        m = new THREE.Mesh(new THREE.IcosahedronGeometry(17, 0), glow(0xe04aff, 2));
      }
      m.position.set(it.pos[0], it.pos[1], it.pos[2]);
      m.userData.y = it.pos[1] - (d.kind === 'weapon' || d.kind === 'amp' ? 0 : 8);
      this.scene.add(m);
      return m;
    });
  }

  buildViewModel() {
    this.view = new THREE.Group();
    this.viewBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.5, metalness: 0.5 }));
    this.viewGlow = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.viewFlash = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    // Draw the weapon after the arena and without the depth test.
    // Then a near wall does not cut the weapon.
    [this.viewBody, this.viewGlow, this.viewFlash].forEach((m, i) => {
      m.material.depthTest = false;
      m.renderOrder = 10 + i;
    });
    this.view.add(this.viewBody, this.viewGlow, this.viewFlash);
    this.camera.add(this.view);
  }

  setViewWeapon(w) {
    if (w === this.viewWeapon) return;
    this.viewWeapon = w;
    const shape = [[3, 3.2, 16], [4.2, 3.4, 15], [5, 5, 19], [3.4, 4.4, 14], [2.6, 3.6, 24], [4, 4.4, 15]][w];
    this.viewBody.scale.set(shape[0], shape[1], shape[2]);
    this.viewGlow.scale.set(shape[0] * 0.5, 0.6, shape[2] * 0.8);
    this.viewGlow.position.set(0, shape[1] / 2 + 0.2, -1);
    this.viewGlow.material.color.setHex(WEAPONS[w].color);
    this.viewFlash.material.color.setHex(WEAPONS[w].color);
    this.viewFlash.position.set(0, 0, -shape[2] / 2 - 2);
    this.lower = 1;
  }

  // The local player fired. Moves the weapon back for a short time.
  fireKick() { this.kick = 1; }

  setName(id, name) { this.names.set(id, name); }

  playerObject(id) {
    let o = this.players.get(id);
    if (o) return o;
    const color = playerColor(id);
    const group = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, emissive: color, emissiveIntensity: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x20242e, roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(12, 20, 4, 12), suit);
    body.position.y = -2;
    const head = new THREE.Group();
    head.position.y = 24;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(8.5, 14, 10), dark);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(11, 3.5, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    visor.position.set(0, 1, -7);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 22), dark);
    gun.position.set(9, -6, -12);
    head.add(skull, visor, gun);
    const aura = new THREE.Mesh(new THREE.SphereGeometry(30, 14, 10), new THREE.MeshBasicMaterial({ color: 0xe04aff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.visible = false;
    const label = labelSprite(this.names.get(id) || '', '#' + color.getHexString());
    label.position.y = 48;
    group.add(body, head, aura, label);
    const beam = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30), 3)),
      new THREE.LineBasicMaterial({ color: WEAPONS[3].color }));
    beam.frustumCulled = false;
    beam.visible = false;
    this.scene.add(group, beam);
    o = { group, head, aura, beam, label, labelText: this.names.get(id) || '' };
    this.players.set(id, o);
    return o;
  }

  removePlayerObject(id) {
    const o = this.players.get(id);
    if (!o) return;
    this.scene.remove(o.group, o.beam);
    this.players.delete(id);
  }

  // "list" has one entry for each player: { id, x, y, z, yaw, pitch, dead, beam, amp }.
  setPlayers(list, myId) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      const o = this.playerObject(p.id);
      const name = this.names.get(p.id) || '';
      if (name !== o.labelText) {
        o.group.remove(o.label);
        o.label = labelSprite(name, '#' + playerColor(p.id).getHexString());
        o.label.position.y = 48;
        o.group.add(o.label);
        o.labelText = name;
      }
      const mine = p.id === myId;
      o.group.visible = !p.dead && !mine;
      o.group.position.set(p.x, p.y, p.z);
      o.group.rotation.y = p.yaw;
      o.head.rotation.x = p.pitch;
      o.aura.visible = p.amp;
      o.beam.visible = p.beam && !p.dead;
      if (o.beam.visible) this.updateBeam(o.beam, p, mine);
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayerObject(id);
  }

  updateBeam(line, p, mine) {
    const cp = Math.cos(p.pitch), range = WEAPONS[3].range;
    const dx = -Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * cp;
    const ox = p.x, oy = p.y + PM.eye, oz = p.z;
    traceBox(this.world, ox, oy, oz, ox + dx * range, oy + dy * range, oz + dz * range, 0, 0, 0, tr);
    const a = this.muzzle(p, mine, v1);
    const pos = line.geometry.attributes.position;
    for (let i = 0; i < 10; i++) {
      const k = i / 9, j = i === 0 || i === 9 ? 0 : 7;
      pos.setXYZ(i, a.x + (tr.x - a.x) * k + (Math.random() - 0.5) * j, a.y + (tr.y - a.y) * k + (Math.random() - 0.5) * j, a.z + (tr.z - a.z) * k + (Math.random() - 0.5) * j);
    }
    pos.needsUpdate = true;
  }

  // Returns the point where the shots of a player start.
  muzzle(p, mine, out) {
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const f = mine ? 22 : 24, r = mine ? 7 : 9, d = mine ? 7 : 6;
    return out.set(p.x - sy * cp * f + cy * r, p.y + PM.eye + sp * f - d, p.z - cy * cp * f - sy * r);
  }

  // "list" has one entry for each projectile: { id, w, x, y, z }.
  setProjectiles(list) {
    const seen = new Set();
    for (const q of list) {
      seen.add(q.id);
      let m = this.projectiles.get(q.id);
      if (!m) {
        m = new THREE.Mesh(this.sphere, this.projectileMats[q.w]);
        m.scale.setScalar(q.w === 2 ? 5 : 4);
        this.scene.add(m);
        this.projectiles.set(q.id, m);
      }
      m.position.set(q.x, q.y, q.z);
      if (q.w === 2 && Math.random() < 0.5) this.puff(q.x, q.y, q.z, 0x8a8f9c, 6, 0.45, 0.35);
    }
    for (const [id, m] of this.projectiles) if (!seen.has(id)) { this.scene.remove(m); this.projectiles.delete(id); }
  }

  setItems(avail) {
    for (let i = 0; i < this.items.length; i++) this.items[i].visible = avail[i] === '1';
  }

  // Effects use again their meshes and materials.
  // A new material for each effect makes the GPU compile the shader again, and the game stops for a moment.
  effectMesh(pool, geometry, side) {
    const m = pool.pop() || new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side }));
    m.visible = true;
    return m;
  }

  addEffect(obj, pool, life, fn) {
    if (!obj.parent) this.scene.add(obj);
    fn(0);
    this.effects.push({ obj, pool, life, age: 0, fn });
  }

  puff(x, y, z, color, size, life, opacity = 0.9, grow = 2) {
    if (this.effects.length > 400) return;
    const m = this.effectMesh(this.puffPool, this.sphere, THREE.FrontSide);
    m.material.color.set(color);
    m.position.set(x, y, z);
    this.addEffect(m, this.puffPool, life, (k) => { m.scale.setScalar(size * (1 + k * grow)); m.material.opacity = opacity * (1 - k); });
  }

  explosion(p, weapon) {
    const rocket = weapon === 2;
    this.puff(p[0], p[1], p[2], rocket ? 0xffa040 : WEAPONS[weapon].color, rocket ? 28 : 7, rocket ? 0.45 : 0.2, 0.9, rocket ? 2.4 : 1.5);
    if (rocket) {
      this.puff(p[0], p[1], p[2], 0xffffff, 14, 0.18, 1, 2);
      this.puff(p[0], p[1], p[2], 0xff4020, 40, 0.7, 0.35, 1.6);
    }
  }

  burst(x, y, z, color) {
    for (let i = 0; i < 7; i++) {
      this.puff(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 44, z + (Math.random() - 0.5) * 30, color, 9, 0.5 + Math.random() * 0.3, 0.8, 1.5);
    }
  }

  beamEffect(a, b, color, width, life) {
    const m = this.effectMesh(this.beamPool, this.beamGeo, THREE.DoubleSide);
    m.material.color.set(color);
    v2.set(b[0] - a.x, b[1] - a.y, b[2] - a.z);
    const len = v2.length();
    m.position.set(a.x + v2.x / 2, a.y + v2.y / 2, a.z + v2.z / 2);
    m.quaternion.setFromUnitVectors(UP, v2.normalize());
    this.addEffect(m, this.beamPool, life, (k) => { m.scale.set(width * (1 - k * 0.7), len, width * (1 - k * 0.7)); m.material.opacity = 1 - k; });
  }

  // Draws the effect of a shot from the point "a" to each end point in "ends".
  shot(a, ends, weapon) {
    const color = WEAPONS[weapon].color;
    for (let i = 0; i < ends.length; i += 3) {
      const b = [ends[i], ends[i + 1], ends[i + 2]];
      if (weapon === 4) {
        this.beamEffect(a, b, color, 2.2, 0.8);
        this.beamEffect(a, b, 0xffffff, 0.7, 0.4);
        this.puff(b[0], b[1], b[2], color, 8, 0.5);
      } else {
        this.beamEffect(a, b, 0xfff0c0, 0.35, 0.07);
        // An impact near the camera would hide the view.
        if (this.camera.position.distanceToSquared(v2.set(b[0], b[1], b[2])) > 60 * 60) this.puff(b[0], b[1], b[2], 0xffe0a0, 2.5, 0.15);
      }
    }
  }

  // "view" is the camera state: { x, y, z, yaw, pitch, roll, weapon, alive }.
  render(dt, view) {
    this.time += dt;
    const t = this.time;
    this.camera.position.set(view.x, view.y, view.z);
    this.camera.rotation.set(view.pitch, view.yaw, view.roll);

    for (const m of this.items) {
      if (!m.visible) continue;
      m.rotation.y = t * 1.6;
      m.position.y = m.userData.y + Math.sin(t * 2.5 + m.position.x) * 3;
    }
    for (const p of this.padMats) {
      const k = (t * 1.2) % 1;
      p.ring.position.y = 2 + k * 40;
      p.ring.scale.setScalar(1 - k * 0.5);
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      if (e.age >= e.life) {
        e.obj.visible = false;
        e.pool.push(e.obj);
        this.effects.splice(i, 1);
      } else e.fn(e.age / e.life);
    }

    this.view.visible = view.alive;
    if (view.alive) {
      this.setViewWeapon(view.weapon);
      this.kick = Math.max(0, this.kick - dt * 9);
      this.lower = Math.max(0, (this.lower || 0) - dt * 5);
      const bob = Math.sin(t * 9) * Math.min(1, view.speed / 320) * (view.ground ? 0.35 : 0);
      this.view.position.set(8, -8 + bob - this.lower * 8, -22 + this.kick * 2.5);
      this.view.rotation.x = this.kick * 0.08 - this.lower * 0.6;
      this.viewFlash.material.opacity = this.kick > 0.6 ? 0.9 : 0;
      this.viewFlash.scale.setScalar(2 + this.kick * 2);
    }
    if (this.quality.bloom) this.composer.render(dt);
    else this.r.render(this.scene, this.camera);
  }
}
