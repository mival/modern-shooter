// Changes an OBJ file from the CAD program into a JavaScript module for the client.
// Usage: node tools/obj-to-model.mjs <file.obj> <file.js> [--triangles 3000]
//
// The name of each body in the OBJ file starts with the name of its material:
// "metal_", "dark_" or "glow_". The tool joins all bodies of one material into one mesh.
// The CAD model points along +X with +Z up. The tool turns it to the game axes:
// the model points along -Z with +Y up.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const MATERIALS = ['metal', 'dark', 'glow'];
// The simplify step does not change a body with fewer triangles than this.
const SMALL_BODY = 60;
// Two faces with a larger angle between them get a sharp edge.
const CREASE_ANGLE = (35 * Math.PI) / 180;

const args = process.argv.slice(2);
const flag = args.indexOf('--triangles');
const target = flag >= 0 ? Number(args.splice(flag, 2)[1]) : 3000;
const [objPath, outPath] = args;
if (!objPath || !outPath || !(target > 0)) {
  console.error('Usage: node tools/obj-to-model.mjs <file.obj> <file.js> [--triangles 3000]');
  process.exit(1);
}

// Reads the bodies. Each body is { name, positions }, 9 numbers for each triangle.
function readBodies(text) {
  const vertices = [];
  const bodies = [];
  let body = null;
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') {
      // CAD (x, y, z) becomes game (-y, z, -x).
      vertices.push([-Number(parts[2]), Number(parts[3]), -Number(parts[1])]);
    } else if (parts[0] === 'o') {
      body = { name: parts[1], positions: [] };
      bodies.push(body);
    } else if (parts[0] === 'f') {
      const ids = parts.slice(1).map((p) => {
        const n = parseInt(p, 10);
        return n > 0 ? n - 1 : vertices.length + n;
      });
      for (let i = 1; i + 1 < ids.length; i++) {
        for (const id of [ids[0], ids[i], ids[i + 1]]) body.positions.push(...vertices[id]);
      }
    }
  }
  return bodies;
}

async function simplify(positions, keep) {
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry = mergeVertices(geometry, 1e-4);
  const triangles = geometry.index.count / 3;
  if (triangles > SMALL_BODY && keep < 1) {
    const remove = Math.floor(geometry.attributes.position.count * (1 - keep));
    geometry = await new SimplifyModifier().modify(geometry, remove);
  }
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

const bodies = readBodies(readFileSync(objPath, 'utf8'));
const total = bodies.reduce((sum, b) => sum + b.positions.length / 9, 0);
const keep = Math.min(1, target / total);

const model = {};
let written = 0;
for (const material of MATERIALS) {
  const positions = [];
  for (const body of bodies.filter((b) => b.name.startsWith(material + '_'))) {
    positions.push(...(await simplify(body.positions, keep)).attributes.position.array);
  }
  if (positions.length === 0) continue;
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry = mergeVertices(toCreasedNormals(geometry, CREASE_ANGLE), 1e-3);
  const round = (array, scale) => Array.from(array, (v) => Math.round(v * scale) / scale);
  model[material] = {
    position: round(geometry.attributes.position.array, 1000),
    normal: round(geometry.attributes.normal.array, 100),
    index: Array.from(geometry.index.array),
  };
  written += geometry.index.count / 3;
}

const unknown = bodies.filter((b) => !MATERIALS.some((m) => b.name.startsWith(m + '_')));
for (const body of unknown) console.warn(`The tool ignores the body "${body.name}". Its name has no material.`);

const source = `// The tool tools/obj-to-model.mjs made this file from ${basename(objPath)}. Do not edit it.\n`
  + `export default ${JSON.stringify(model)};\n`;
writeFileSync(outPath, source);
console.log(`${bodies.length} bodies, ${total} triangles in, ${written} triangles out, ${source.length} bytes.`);
