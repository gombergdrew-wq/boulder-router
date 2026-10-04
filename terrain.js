// Terrain math shared by the main thread and the routing worker (classic script, no imports).
(function (root) {
  'use strict';
  const T = {};

  // Horn's method. Returns slope as rise/run (tan of the slope angle) per cell.
  // The kernel is spread over ~7 m either side of the cell so lidar-scale roughness (rocks, shrubs)
  // doesn't read as cliffs; real cliff bands still show up.
  T.slopeGrid = function (elev, w, h, mpp, halfWidthM = 7) {
    const out = new Float32Array(w * h);
    const s = Math.max(1, Math.round(halfWidthM / mpp));
    const k = 1 / (8 * s * mpp);
    for (let y = 0; y < h; y++) {
      const r0 = Math.max(0, y - s) * w, r1 = y * w, r2 = Math.min(h - 1, y + s) * w;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - s), x2 = Math.min(w - 1, x + s);
        const a = elev[r0 + x0], b = elev[r0 + x], c = elev[r0 + x2];
        const d = elev[r1 + x0], f = elev[r1 + x2];
        const g = elev[r2 + x0], hh = elev[r2 + x], i = elev[r2 + x2];
        const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) * k;
        const dzdy = ((g + 2 * hh + i) - (a + 2 * b + c)) * k;
        out[r1 + x] = Math.hypot(dzdx, dzdy);
      }
    }
    return out;
  };

  // 1 where slope exceeds maxTan, grown by `r` cells (square dilation, O(N) via prefix sums).
  T.blockedMask = function (slope, w, h, maxTan, r) {
    const n = w * h;
    const base = new Uint8Array(n);
    for (let i = 0; i < n; i++) base[i] = slope[i] > maxTan ? 1 : 0;
    if (r <= 0) return base;
    const tmp = new Uint8Array(n), out = new Uint8Array(n);
    const cs = new Int32Array(Math.max(w, h) + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) cs[x + 1] = cs[x] + base[row + x];
      for (let x = 0; x < w; x++) tmp[row + x] = cs[Math.min(w, x + r + 1)] - cs[Math.max(0, x - r)] > 0 ? 1 : 0;
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) cs[y + 1] = cs[y] + tmp[y * w + x];
      for (let y = 0; y < h; y++) out[y * w + x] = cs[Math.min(h, y + r + 1)] - cs[Math.max(0, y - r)] > 0 ? 1 : 0;
    }
    return out;
  };

  // Effort in "flat-ground meters": distance, a steepness penalty, and a weight per meter of
  // vertical change (up or down, so routes are symmetric and total elevation change is what's minimised).
  T.stepCost = function (d, dz, maxTan, W) {
    const az = Math.abs(dz);
    const q = az / d / maxTan;
    return d * (1 + 2 * q * q) + W * az;
  };

  class Heap {
    constructor() { this.k = new Float64Array(1 << 18); this.v = new Int32Array(1 << 18); this.n = 0; }
    clear() { this.n = 0; }
    push(key, val) {
      if (this.n === this.k.length) {
        const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2);
        k.set(this.k); v.set(this.v); this.k = k; this.v = v;
      }
      const K = this.k, V = this.v;
      let i = this.n++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (K[p] <= key) break;
        K[i] = K[p]; V[i] = V[p]; i = p;
      }
      K[i] = key; V[i] = val;
    }
    pop() {
      const K = this.k, V = this.v;
      const top = V[0];
      const n = --this.n;
      if (n > 0) {
        const key = K[n], val = V[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && K[c + 1] < K[c]) c++;
          if (K[c] >= key) break;
          K[i] = K[c]; V[i] = V[c]; i = c;
        }
        K[i] = key; V[i] = val;
      }
      return top;
    }
  }

  const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

  T.Router = class Router {
    // fcost (optional): per-cell extra cost per meter walked, from forest density.
    constructor(elev, blocked, w, h, mpp, maxTan, W, fcost) {
      Object.assign(this, { elev, blocked, w, h, mpp, maxTan, W, fcost: fcost || null });
      const N = w * h;
      this.g = new Float64Array(N);
      this.parent = new Int32Array(N);
      this.closed = new Uint8Array(N);
      this.heap = new Heap();
      this.offs = NEIGHBOURS.map(([dx, dy]) => {
        const mids = [];
        if (Math.abs(dx) === 1 && Math.abs(dy) === 1) mids.push([dx, 0], [0, dy]);
        else if (Math.abs(dx) === 2) mids.push([dx / 2, 0], [dx / 2, dy]);
        else if (Math.abs(dy) === 2) mids.push([0, dy / 2], [dx, dy / 2]);
        return { dx, dy, dist: Math.hypot(dx, dy) * mpp, mids };
      });
    }

    // Least-cost search from `src` until every cell in `targets` is settled.
    // Uses an A* heuristic when there is a single target. Results live in this.g / this.parent.
    search(src, targets) {
      const { w, h, elev, blocked, maxTan, W, g, parent, closed, heap, offs, mpp, fcost } = this;
      g.fill(Infinity); parent.fill(-1); closed.fill(0); heap.clear();
      const remaining = new Set(targets);
      const single = targets.length === 1 ? targets[0] : -1;
      const tx = single >= 0 ? single % w : 0, ty = single >= 0 ? (single / w) | 0 : 0;
      const hf = single >= 0 ? (x, y) => Math.hypot(x - tx, y - ty) * mpp : () => 0;
      g[src] = 0; heap.push(hf(src % w, (src / w) | 0), src);
      while (heap.n) {
        const u = heap.pop();
        if (closed[u]) continue;
        closed[u] = 1;
        if (remaining.has(u)) { remaining.delete(u); if (!remaining.size) break; }
        const ux = u % w, uy = (u / w) | 0, gu = g[u], zu = elev[u];
        for (let k = 0; k < offs.length; k++) {
          const o = offs[k];
          const nx = ux + o.dx, ny = uy + o.dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const v = ny * w + nx;
          if (blocked[v] || closed[v]) continue;
          let bad = false;
          for (let m = 0; m < o.mids.length; m++) {
            if (blocked[(uy + o.mids[m][1]) * w + ux + o.mids[m][0]]) { bad = true; break; }
          }
          if (bad) continue;
          const dz = elev[v] - zu;
          if (Math.abs(dz) > maxTan * o.dist) continue; // single step too steep
          let ng = gu + T.stepCost(o.dist, dz, maxTan, W);
          if (fcost) ng += o.dist * 0.5 * (fcost[u] + fcost[v]);
          if (ng < g[v]) { g[v] = ng; parent[v] = u; heap.push(ng + hf(nx, ny), v); }
        }
      }
    }

    pathTo(t) {
      const p = [];
      for (let c = t; c !== -1; c = this.parent[c]) p.push(c);
      p.reverse();
      return Int32Array.from(p);
    }
  };

  root.Terrain = T;
})(typeof self !== 'undefined' ? self : this);
