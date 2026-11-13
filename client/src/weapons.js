// The 3D models of the weapons. Simple shapes make each model.
// A model points along the negative Z axis. The grip is at the origin.
import * as THREE from 'three';
import { WEAPONS, W_HAMMER, W_MG, W_SG, W_RL, W_ARC, W_RAIL, W_PG } from '../../shared/constants.js';

const metal = new THREE.MeshStandardMaterial({ color: 0x566078, roughness: 0.42, metalness: 0.65 });
const dark = new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.7, metalness: 0.3 });
const glows = WEAPONS.map((w) => new THREE.MeshBasicMaterial({ color: w.color }));

function box(g, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// A cylinder along the Z axis. "front" and "rear" are the two radii.
function tube(g, mat, front, rear, len, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rear, front, len, 14), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function ring(g, mat, radius, thick, x, y, z) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, thick, 6, 18), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function ball(g, mat, radius, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

const BUILDERS = {
  [W_HAMMER](g, glow) {
    tube(g, dark, 0.7, 0.8, 15, 0, 0, -4);
    box(g, metal, 1.9, 1.9, 2.4, 0, 0, 2.6);
    box(g, metal, 4.4, 7.5, 4.6, 0, 0, -12.5);
    box(g, glow, 3.4, 0.5, 3.6, 0, 3.9, -12.5);
    box(g, glow, 3.4, 0.5, 3.6, 0, -3.9, -12.5);
    box(g, dark, 4.8, 1.2, 5, 0, 0, -12.5);
    return -15;
  },
  [W_MG](g, glow) {
    box(g, metal, 2.2, 3.4, 9, 0, 0, -1);
    box(g, dark, 1.7, 1.7, 5, 0, 0.6, -7.5);
    tube(g, metal, 0.5, 0.5, 9, 0, 0.6, -11);
    box(g, dark, 1.4, 4.2, 2.4, 0, -3.4, -2);
    box(g, dark, 1.5, 3, 1.8, 0, -2.6, 2.6);
    box(g, glow, 0.8, 0.4, 6, 0, 1.9, -1);
    box(g, dark, 0.5, 0.9, 0.8, 0, 2.2, -4.6);
    return -16;
  },
  [W_SG](g, glow) {
    tube(g, metal, 0.95, 0.95, 14, -1, 0.5, -8);
    tube(g, metal, 0.95, 0.95, 14, 1, 0.5, -8);
    box(g, metal, 3.8, 3.2, 6, 0, 0.2, 1.5);
    box(g, glow, 3.2, 1.3, 4.2, 0, -1.2, -8);
    box(g, dark, 2.4, 2.8, 6, 0, -0.9, 7);
    box(g, dark, 1.4, 2.6, 1.8, 0, -2.6, 2);
    return -15.5;
  },
  [W_RL](g, glow) {
    tube(g, metal, 2.4, 2.4, 17, 0, 0, -3);
    tube(g, metal, 3, 2.5, 2.4, 0, 0, -12.6);
    tube(g, dark, 2.1, 2.1, 0.4, 0, 0, -13.9);
    tube(g, metal, 2.4, 1.5, 3, 0, 0, 7);
    ring(g, glow, 2.65, 0.38, 0, 0, -8.5);
    ring(g, glow, 2.65, 0.38, 0, 0, 1.5);
    box(g, dark, 1.3, 3.6, 2.2, 0, -3.8, -1);
    box(g, dark, 1.3, 2.4, 1.6, 0, -3.2, -7);
    return -15;
  },
  [W_ARC](g, glow) {
    box(g, metal, 3, 3.8, 7, 0, 0, 1.5);
    tube(g, glow, 0.7, 0.7, 10, 0, 0.3, -6.5);
    for (const z of [-3.2, -6.2, -9.2]) ring(g, metal, 1.55, 0.4, 0, 0.3, z);
    box(g, dark, 0.6, 0.6, 8, -2, 0.3, -9.5);
    box(g, dark, 0.6, 0.6, 8, 2, 0.3, -9.5);
    ball(g, glow, 1, 0, 0.3, -13.5);
    box(g, dark, 1.4, 3, 1.9, 0, -3, 2.4);
    return -15;
  },
  [W_RAIL](g, glow) {
    box(g, metal, 0.7, 2.4, 22, -1, 0, -8);
    box(g, metal, 0.7, 2.4, 22, 1, 0, -8);
    box(g, glow, 0.6, 0.9, 21, 0, 0, -8);
    for (const z of [-4, -10, -16]) box(g, dark, 3.1, 0.6, 0.9, 0, 1.4, z);
    box(g, metal, 3.4, 4, 6.5, 0, -0.2, 5.5);
    tube(g, dark, 0.8, 0.8, 6.5, 0, 2.9, 2);
    box(g, dark, 1.4, 3, 1.9, 0, -3.2, 5);
    return -19.5;
  },
  [W_PG](g, glow) {
    ball(g, glow, 1.7, 0, 1.5, 0.5);
    box(g, metal, 3.2, 3.2, 7, 0, -0.6, 2);
    tube(g, metal, 1.3, 1.3, 8, 0, 0.5, -6);
    ring(g, glow, 1.55, 0.3, 0, 0.5, -4.5);
    ring(g, glow, 1.55, 0.3, 0, 0.5, -7.5);
    tube(g, dark, 1.8, 1.6, 1.6, 0, 0.5, -10.6);
    box(g, dark, 1.4, 3, 1.9, 0, -3.6, 3.5);
    return -12.5;
  },
};

// Returns the model of a weapon. "userData.muzzle" is the Z position of the muzzle.
export function buildWeaponModel(index) {
  const g = new THREE.Group();
  g.userData.muzzle = BUILDERS[index](g, glows[index]);
  return g;
}
