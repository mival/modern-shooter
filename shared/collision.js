// Collision against axis-aligned boxes.

// A moved box stops at this distance from a surface.
const EPS = 0.03125;

export function makeWorld(map) {
  const n = map.brushes.length;
  const b = new Float64Array(n * 6);
  map.brushes.forEach((br, i) => {
    b.set(br.min, i * 6);
    b.set(br.max, i * 6 + 3);
  });
  return { b, n, pads: map.pads };
}

export function newTrace() {
  return { f: 1, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
}

// Moves a box from the start point to the end point.
// The box has the half width "hx" and the vertical range "lo".."hi".
// For a ray, set hx, lo and hi to 0.
// "out.f" is the fraction of the move. "out.n*" is the normal of the hit surface.
export function traceBox(w, sx, sy, sz, ex, ey, ez, hx, lo, hi, out) {
  const dx = ex - sx, dy = ey - sy, dz = ez - sz;
  const b = w.b;
  let best = 1, bestAxis = -1, bestSign = 0;
  for (let i = 0, o = 0; i < w.n; i++, o += 6) {
    let tEnter = -Infinity, tExit = Infinity, tAdj = 0, axis = -1, sign = 0;
    let lo1, hi1, t1, t2, a;

    lo1 = b[o] - hx; hi1 = b[o + 3] + hx;
    if (dx === 0) {
      if (sx <= lo1 || sx >= hi1) continue;
    } else {
      if (dx > 0) { t1 = (lo1 - sx) / dx; t2 = (hi1 - sx) / dx; a = (lo1 - sx - EPS) / dx; }
      else { t1 = (hi1 - sx) / dx; t2 = (lo1 - sx) / dx; a = (hi1 - sx + EPS) / dx; }
      if (t1 > tEnter) { tEnter = t1; tAdj = a; axis = 0; sign = dx > 0 ? -1 : 1; }
      if (t2 < tExit) tExit = t2;
    }

    lo1 = b[o + 1] - hi; hi1 = b[o + 4] - lo;
    if (dy === 0) {
      if (sy <= lo1 || sy >= hi1) continue;
    } else {
      if (dy > 0) { t1 = (lo1 - sy) / dy; t2 = (hi1 - sy) / dy; a = (lo1 - sy - EPS) / dy; }
      else { t1 = (hi1 - sy) / dy; t2 = (lo1 - sy) / dy; a = (hi1 - sy + EPS) / dy; }
      if (t1 > tEnter) { tEnter = t1; tAdj = a; axis = 1; sign = dy > 0 ? -1 : 1; }
      if (t2 < tExit) tExit = t2;
    }

    lo1 = b[o + 2] - hx; hi1 = b[o + 5] + hx;
    if (dz === 0) {
      if (sz <= lo1 || sz >= hi1) continue;
    } else {
      if (dz > 0) { t1 = (lo1 - sz) / dz; t2 = (hi1 - sz) / dz; a = (lo1 - sz - EPS) / dz; }
      else { t1 = (hi1 - sz) / dz; t2 = (lo1 - sz) / dz; a = (hi1 - sz + EPS) / dz; }
      if (t1 > tEnter) { tEnter = t1; tAdj = a; axis = 2; sign = dz > 0 ? -1 : 1; }
      if (t2 < tExit) tExit = t2;
    }

    // A start point inside a box has tEnter < 0. The trace ignores that box.
    if (tEnter < 0 || tEnter >= tExit) continue;
    const f = tAdj > 0 ? tAdj : 0;
    if (f < best) { best = f; bestAxis = axis; bestSign = sign; }
  }
  out.f = best;
  out.x = sx + dx * best; out.y = sy + dy * best; out.z = sz + dz * best;
  out.nx = bestAxis === 0 ? bestSign : 0;
  out.ny = bestAxis === 1 ? bestSign : 0;
  out.nz = bestAxis === 2 ? bestSign : 0;
  return out;
}

// Returns the fraction where the segment hits the box, or -1.
export function rayBox(sx, sy, sz, dx, dy, dz, x1, y1, z1, x2, y2, z2) {
  let tEnter = 0, tExit = 1;
  const s = [sx, sy, sz], d = [dx, dy, dz], lo = [x1, y1, z1], hi = [x2, y2, z2];
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) {
      if (s[i] < lo[i] || s[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - s[i]) / d[i], t2 = (hi[i] - s[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
      if (tEnter > tExit) return -1;
    }
  }
  return tEnter;
}
