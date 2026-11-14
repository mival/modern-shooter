// The 3D models of the weapons. The models come from a CAD program. See docs/weapon-models.md.
// A model points along the negative Z axis. The grip is at the origin.
import * as THREE from 'three';
import { WEAPONS, W_HAMMER, W_MG, W_SG, W_RL, W_ARC, W_RAIL, W_PG } from '../../shared/constants.js';
import hammer from './models/hammer.js';
import machineGun from './models/machine-gun.js';
import shotgun from './models/shotgun.js';
import rocketLauncher from './models/rocket-launcher.js';
import arcGun from './models/arc-gun.js';
import railgun from './models/railgun.js';
import plasmaGun from './models/plasma-gun.js';

const metal = new THREE.MeshStandardMaterial({ color: 0x566078, roughness: 0.42, metalness: 0.65 });
const dark = new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.7, metalness: 0.3 });
const glows = WEAPONS.map((w) => new THREE.MeshBasicMaterial({ color: w.color }));

// Each model has the model data and the Z position of the muzzle.
const MODELS = {
  [W_HAMMER]: { data: hammer, muzzle: -15 },
  [W_MG]: { data: machineGun, muzzle: -16 },
  [W_SG]: { data: shotgun, muzzle: -15.5 },
  [W_RL]: { data: rocketLauncher, muzzle: -15 },
  [W_ARC]: { data: arcGun, muzzle: -15 },
  [W_RAIL]: { data: railgun, muzzle: -19.5 },
  [W_PG]: { data: plasmaGun, muzzle: -12.5 },
};

// The geometries of the models. All copies of a model share them.
const geometries = new Map();

// Returns the geometries of a model as [material name, geometry] pairs.
function modelGeometries(data) {
  if (!geometries.has(data)) {
    geometries.set(data, Object.entries(data).map(([material, mesh]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.position, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normal, 3));
      geometry.setIndex(mesh.index);
      return [material, geometry];
    }));
  }
  return geometries.get(data);
}

// Returns the model of a weapon. "userData.muzzle" is the Z position of the muzzle.
export function buildWeaponModel(index) {
  const g = new THREE.Group();
  const model = MODELS[index];
  const materials = { metal, dark, glow: glows[index] };
  for (const [material, geometry] of modelGeometries(model.data)) g.add(new THREE.Mesh(geometry, materials[material]));
  g.userData.muzzle = model.muzzle;
  return g;
}
