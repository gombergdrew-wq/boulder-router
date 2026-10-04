// Routing worker: snaps stops to safe ground, finds least-cost safe paths, orders boulder stops.
importScripts('terrain.js');

self.onmessage = (e) => {
  try {
    const out = solve(e.data);
    self.postMessage(out.msg, out.transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};

const progress = (text) => self.postMessage({ type: 'progress', text });

function solve(d) {
  const { elev, blocked, w, h, mpp, maxTan, W, optimize, points, labels } = d;
  const n = points.length;
  const router = new Terrain.Router(elev, blocked, w, h, mpp, maxTan, W);

  // Snap each stop to the nearest cell that isn't cliff/steep.
  const cells = [], snaps = [];
  const R = Math.ceil(150 / mpp);
  points.forEach((p, i) => {
    const ix = Math.min(w - 1, Math.max(0, Math.round(p.cx)));
    const iy = Math.min(h - 1, Math.max(0, Math.round(p.cy)));
    let best = iy * w + ix, bd = 0;
    if (blocked[best]) {
      best = -1; bd = Infinity;
      for (let r = 1; r <= R; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = ix + dx, y = iy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h || blocked[y * w + x]) continue;
          const dd = Math.hypot(x - p.cx, y - p.cy);
          if (dd < bd) { bd = dd; best = y * w + x; }
        }
        if (best >= 0 && bd <= r + 1) break;
      }
      if (best < 0) throw new Error(`${labels[i]} has no gentle ground within 150 m. Raise the max slope or lower the safety margin.`);
    } else {
      bd = Math.hypot(ix - p.cx, iy - p.cy);
    }
    cells.push(best);
    snaps.push({ cell: best, distM: bd * mpp });
  });

  // Which leg costs do we need? All pairs when reordering, otherwise just the chain.
  const need = [];
  for (let i = 0; i < n - 1; i++) need.push([]);
  if (optimize && n > 3) {
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) if (!(i === 0 && j === n - 1)) need[i].push(j);
  } else {
    for (let i = 0; i < n - 1; i++) need[i].push(i + 1);
  }

  const C = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  const P = {};
  for (let i = 0; i < n - 1; i++) {
    if (!need[i].length) continue;
    progress(`Searching from ${labels[i]}…`);
    router.search(cells[i], need[i].map((j) => cells[j]));
    for (const j of need[i]) {
      const c = router.g[cells[j]];
      C[i][j] = C[j][i] = c;
      if (isFinite(c)) P[i + ',' + j] = router.pathTo(cells[j]);
    }
  }

  const m = n - 2;
  if (m === 0) {
    if (!isFinite(C[0][1])) throw new Error('No route found without exceeding the slope limit. Try raising max slope or lowering the safety margin.');
  } else {
    for (let i = 0; i < n; i++) {
      let any = false;
      for (let j = 0; j < n; j++) if (j !== i && isFinite(C[i][j])) any = true;
      if (!any && !(i === 0 && n === 2)) throw new Error(`${labels[i]} can't be reached from the other stops without exceeding the slope limit.`);
    }
  }

  let order = [];
  for (let i = 1; i <= m; i++) order.push(i);
  if (optimize && m > 1) order = bestOrder(C, m, n);
  const route = [0, ...order, n - 1];

  const legs = [], transfer = [];
  let total = 0;
  for (let k = 0; k < route.length - 1; k++) {
    const a = route[k], b = route[k + 1];
    const c = C[a][b];
    if (!isFinite(c)) throw new Error(`No safe connection between ${labels[a]} and ${labels[b]}. Try raising max slope or lowering the safety margin.`);
    total += c;
    const p = a < b ? P[a + ',' + b] : Int32Array.from(P[b + ',' + a]).reverse();
    legs.push(p); transfer.push(p.buffer);
  }
  return { msg: { type: 'done', route, legs, snaps, total }, transfer };
}

// Best visiting order of boulders 1..m between fixed start (0) and end (n-1).
function bestOrder(C, m, n) {
  if (m <= 9) {
    let best = Infinity, bestOrd = null;
    const used = new Uint8Array(m + 1), ord = [];
    (function rec(last, cost) {
      if (cost >= best) return;
      if (ord.length === m) {
        const t = cost + C[last][n - 1];
        if (t < best) { best = t; bestOrd = ord.slice(); }
        return;
      }
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        used[j] = 1; ord.push(j);
        rec(j, cost + C[last][j]);
        ord.pop(); used[j] = 0;
      }
    })(0, 0);
    if (!bestOrd) throw new Error('No connected route visits every boulder under the current slope limit.');
    return bestOrd;
  }
  // Larger sets: nearest neighbour then 2-opt.
  const left = new Set(); for (let i = 1; i <= m; i++) left.add(i);
  const seq = [0];
  while (left.size) {
    let bj = -1, bc = Infinity;
    for (const j of left) if (C[seq[seq.length - 1]][j] < bc) { bc = C[seq[seq.length - 1]][j]; bj = j; }
    if (bj < 0) throw new Error('No connected route visits every boulder under the current slope limit.');
    seq.push(bj); left.delete(bj);
  }
  seq.push(n - 1);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < seq.length - 2; i++) for (let j = i + 1; j < seq.length - 1; j++) {
      const delta = C[seq[i - 1]][seq[j]] + C[seq[i]][seq[j + 1]] - C[seq[i - 1]][seq[i]] - C[seq[j]][seq[j + 1]];
      if (delta < -1e-9) {
        for (let a = i, b = j; a < b; a++, b--) { const t = seq[a]; seq[a] = seq[b]; seq[b] = t; }
        improved = true;
      }
    }
  }
  return seq.slice(1, -1);
}
