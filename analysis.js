// Measures any polyline (optimized or user-supplied) against the same terrain model the router uses.
const Analysis = (() => {
  function analyze(latlngs, ctx) {
    const { grid, slope, maxTan, p } = ctx;
    const { w, h, mpp } = grid;
    const pts = latlngs.map((ll) => grid.fromLatLng(ll[0], ll[1]));

    const cx = [pts[0][0]], cy = [pts[0][1]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.ceil(len);
      for (let t = 1; t <= steps; t++) { cx.push(ax + ((bx - ax) * t) / steps); cy.push(ay + ((by - ay) * t) / steps); }
    }
    const n = cx.length;
    const z = new Float32Array(n), dist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      z[i] = grid.sample(cx[i], cy[i]);
      if (i) dist[i] = dist[i - 1] + Math.hypot(cx[i] - cx[i - 1], cy[i] - cy[i - 1]) * mpp;
    }

    let ascent = 0, descent = 0, cost = 0, steepLen = 0, maxTerrain = 0, maxGrade = 0;
    const flagged = [];
    let run = null;
    const win = Math.max(1, Math.round(10 / mpp));
    for (let i = 1; i < n; i++) {
      const d = dist[i] - dist[i - 1];
      if (d <= 0) continue;
      const dz = z[i] - z[i - 1];
      if (dz > 0) ascent += dz; else descent -= dz;
      cost += Terrain.stepCost(d, dz, maxTan, p.weight);
      if (i >= win) maxGrade = Math.max(maxGrade, Math.abs(z[i] - z[i - win]) / (dist[i] - dist[i - win]));
      const ix = Math.min(w - 1, Math.max(0, Math.round(cx[i]))), iy = Math.min(h - 1, Math.max(0, Math.round(cy[i])));
      const st = slope[iy * w + ix];
      if (st > maxTerrain) maxTerrain = st;
      if (st > maxTan) {
        steepLen += d;
        if (!run) { run = [grid.toLatLng(cx[i - 1], cy[i - 1])]; flagged.push(run); }
        run.push(grid.toLatLng(cx[i], cy[i]));
      } else run = null;
    }
    const total = dist[n - 1];
    return {
      distance: total, ascent, descent, elevChange: ascent + descent, cost,
      maxGrade: (Math.atan(maxGrade) * 180) / Math.PI,
      maxTerrain: (Math.atan(maxTerrain) * 180) / Math.PI,
      steepLen, flagged,
      hours: total / 5000 + ascent / 600, // Naismith's rule
      profile: { d: dist, z },
    };
  }
  return { analyze };
})();
