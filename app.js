(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);

  // ---------- map ----------
  const map = L.map('map').setView([40.015, -105.27], 11);
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap, © OpenStreetMap contributors' }).addTo(map);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
  L.control.layers({ Topo: topo, Satellite: sat, Street: osm }).addTo(map);
  map.attributionControl.addAttribution('Elevation: Mapzen/AWS Terrain Tiles');
  const overlayLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const userLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);

  // ---------- units & formatting ----------
  let imperial = true;
  try { imperial = localStorage.getItem('units') !== 'metric'; } catch (e) {}
  $('#units').value = imperial ? 'imperial' : 'metric';
  const fmtD = (m) => imperial ? `${(m / 1609.344).toFixed(2)} mi` : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  const fmtE = (m) => imperial ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`;
  const fmtT = (h) => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const fmtA = (d) => `${d.toFixed(0)}°`;

  // ---------- settings ----------
  function readParams() {
    return { maxSlope: +$('#maxSlope').value, margin: +$('#margin').value, weight: +$('#weight').value, optimize: $('#optimize').checked };
  }
  function refreshSettingLabels() {
    const p = readParams();
    $('#maxSlopeOut').textContent = `${p.maxSlope}°`;
    $('#marginOut').textContent = fmtE(p.margin);
    $('#weightOut').textContent = p.weight === 0 ? 'off' : `${p.weight}×`;
  }
  ['maxSlope', 'margin', 'weight'].forEach((id) => $('#' + id).addEventListener('input', refreshSettingLabels));
  $('#units').addEventListener('change', (e) => {
    imperial = e.target.value === 'imperial';
    try { localStorage.setItem('units', e.target.value); } catch (err) {}
    refreshSettingLabels(); renderList();
  });
  refreshSettingLabels();

  const statusEl = $('#status');
  function status(msg, isError) {
    if (!msg) { statusEl.hidden = true; return; }
    statusEl.hidden = false; statusEl.textContent = msg; statusEl.classList.toggle('error', !!isError);
  }

  // ---------- tabs ----------
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
    document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.id !== b.dataset.tab; });
  }));

  // ---------- plan state ----------
  const S = { start: null, end: null, boulders: [], mode: 'start', last: null };
  const HINTS = { start: 'Click the map to place the start.', end: 'Click the map to place the end.', boulder: 'Click the map to add boulders. Drag any pin to adjust.' };
  function setMode(m) {
    S.mode = m;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    $('#modeHint').textContent = HINTS[m];
  }
  document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function makePin(pt, cls, text) {
    const m = L.marker([pt.lat, pt.lng], { draggable: true, icon: L.divIcon({ className: '', html: `<div class="pin pin-${cls}">${text}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) });
    m.on('dragend', () => { const ll = m.getLatLng(); pt.lat = ll.lat; pt.lng = ll.lng; renderList(); clearResults(); });
    m.addTo(markerLayer);
    pt.marker = m; pt.cls = cls;
  }
  function placePoint(kind, ll) {
    const pt = { lat: ll.lat, lng: ll.lng };
    if (kind === 'start') { if (S.start) markerLayer.removeLayer(S.start.marker); S.start = pt; makePin(pt, 'start', 'S'); }
    else if (kind === 'end') { if (S.end) markerLayer.removeLayer(S.end.marker); S.end = pt; makePin(pt, 'end', 'E'); }
    else { S.boulders.push(pt); makePin(pt, 'boulder', S.boulders.length); }
    renderList(); clearResults();
  }
  map.on('click', (e) => {
    placePoint(S.mode, e.latlng);
    if (S.mode === 'start') setMode('end'); else if (S.mode === 'end') setMode('boulder');
  });

  function renumber() {
    S.boulders.forEach((b, i) => { b.marker.setIcon(L.divIcon({ className: '', html: `<div class="pin pin-boulder">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })); });
  }
  function renderList() {
    renumber();
    const li = (cls, label, pt, del) => `<li><span class="dot ${cls}">${cls === 'start' ? 'S' : cls === 'end' ? 'E' : label.replace('Boulder ', '')}</span>${cls === 'boulder' ? label : label}<small>${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}</small>${del !== undefined ? `<button data-del="${del}" title="Remove">×</button>` : ''}</li>`;
    const rows = [];
    if (S.start) rows.push(li('start', 'Start', S.start));
    S.boulders.forEach((b, i) => rows.push(li('boulder', `Boulder ${i + 1}`, b, i)));
    if (S.end) rows.push(li('end', 'End', S.end));
    $('#pointList').innerHTML = rows.join('');
    $('#pointList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const [pt] = S.boulders.splice(+b.dataset.del, 1);
      markerLayer.removeLayer(pt.marker); renderList(); clearResults();
    }));
  }
  function clearResults() {
    routeLayer.clearLayers(); $('#planResults').innerHTML = ''; S.last = null;
  }
  $('#clearAll').addEventListener('click', () => {
    markerLayer.clearLayers(); S.start = S.end = null; S.boulders = [];
    clearResults(); overlayLayer.clearLayers(); renderList(); setMode('start');
  });

  $('#searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#search').value.trim(); if (!q) return;
    try {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`)).json();
      if (!r.length) return status('No match for that search.', true);
      map.flyTo([+r[0].lat, +r[0].lon], 14); status('');
    } catch (err) { status('Search failed: ' + err.message, true); }
  });

  // ---------- terrain context + solver ----------
  function boundsOf(latlngs) {
    let south = 90, north = -90, west = 180, east = -180;
    for (const [la, lo] of latlngs) { south = Math.min(south, la); north = Math.max(north, la); west = Math.min(west, lo); east = Math.max(east, lo); }
    const midLat = (north + south) / 2, kx = 111320 * Math.cos(midLat * Math.PI / 180), ky = 111320;
    const pad = Math.max(0.3 * Math.max((north - south) * ky, (east - west) * kx), 400);
    return { south: south - pad / ky, north: north + pad / ky, west: west - pad / kx, east: east + pad / kx };
  }

  async function buildContext(latlngs) {
    const p = readParams();
    status('Fetching elevation tiles…');
    const grid = await DEM.buildGrid(boundsOf(latlngs), { onProgress: (a, b) => status(`Fetching elevation tiles… ${a}/${b}`) });
    status('Analyzing slopes…');
    await new Promise((r) => setTimeout(r, 0));
    const maxTan = Math.tan((p.maxSlope * Math.PI) / 180);
    const slope = Terrain.slopeGrid(grid.elev, grid.w, grid.h, grid.mpp, +$('#detail').value);
    const blocked = Terrain.blockedMask(slope, grid.w, grid.h, maxTan, Math.round(p.margin / grid.mpp));
    return { grid, slope, blocked, maxTan, p };
  }

  function drawOverlay(ctx) {
    overlayLayer.clearLayers();
    const { grid, slope, blocked, maxTan } = ctx;
    const c = document.createElement('canvas'); c.width = grid.w; c.height = grid.h;
    const g = c.getContext('2d'), img = g.createImageData(grid.w, grid.h), d = img.data;
    for (let i = 0; i < slope.length; i++) {
      let r = 0, gg = 0, b = 0, a = 0;
      if (slope[i] > maxTan) { r = 230; gg = 40; b = 40; a = 150; }
      else if (blocked[i]) { r = 255; gg = 130; b = 0; a = 120; }
      else if (slope[i] > maxTan * 0.7) { r = 255; gg = 205; b = 0; a = 80; }
      else continue;
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
    const nw = grid.toLatLng(-0.5, -0.5), se = grid.toLatLng(grid.w - 0.5, grid.h - 0.5);
    const layer = L.imageOverlay(c.toDataURL(), [[se[0], nw[1]], [nw[0], se[1]]], { opacity: 0.8, interactive: false });
    if ($('#showOverlay').checked) overlayLayer.addLayer(layer);
    overlayLayer._img = layer;
  }
  $('#showOverlay').addEventListener('change', (e) => {
    const l = overlayLayer._img; if (!l) return;
    if (e.target.checked) overlayLayer.addLayer(l); else overlayLayer.removeLayer(l);
  });

  function solve(ctx, stops, onProgress) {
    const { grid, blocked, maxTan, p } = ctx;
    return new Promise((resolve, reject) => {
      const worker = new Worker('worker.js');
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') return status(m.text);
        worker.terminate();
        if (m.type === 'error') return reject(new Error(m.message));
        const poly = [];
        m.legs.forEach((leg, k) => {
          for (let i = k ? 1 : 0; i < leg.length; i++) poly.push(grid.toLatLng(leg[i] % grid.w, (leg[i] / grid.w) | 0));
        });
        const connectors = [];
        m.route.forEach((idx) => {
          const s = m.snaps[idx], sp = grid.toLatLng(s.cell % grid.w, (s.cell / grid.w) | 0);
          if (s.distM > grid.mpp) connectors.push({ idx, from: [stops[idx].lat, stops[idx].lng], to: sp, distM: s.distM });
        });
        resolve({ route: m.route, polyline: poly, connectors, snaps: m.snaps });
      };
      worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker failed')); };
      const elev = grid.elev.slice(), bl = blocked.slice();
      worker.postMessage({
        elev, blocked: bl, w: grid.w, h: grid.h, mpp: grid.mpp, maxTan, W: p.weight, optimize: p.optimize,
        points: stops.map((s) => { const [cx, cy] = grid.fromLatLng(s.lat, s.lng); return { cx, cy }; }),
        labels: stops.map((s) => s.label),
      }, [elev.buffer, bl.buffer]);
    });
  }

  // ---------- result rendering ----------
  function drawProfile(canvas, series) {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.scale(dpr, dpr);
    const css = getComputedStyle(document.body);
    let maxD = 0, zmin = Infinity, zmax = -Infinity;
    series.forEach((s) => { maxD = Math.max(maxD, s.d[s.d.length - 1]); s.z.forEach((v) => { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }); });
    if (zmax - zmin < 10) zmax = zmin + 10;
    const L0 = 46, R0 = 6, T0 = 6, B0 = 16;
    const X = (d) => L0 + (d / maxD) * (W - L0 - R0), Y = (z) => H - B0 - ((z - zmin) / (zmax - zmin)) * (H - B0 - T0);
    g.font = '10px system-ui'; g.fillStyle = css.getPropertyValue('--muted'); g.strokeStyle = css.getPropertyValue('--line');
    [zmin, zmax].forEach((z) => { g.beginPath(); g.moveTo(L0, Y(z)); g.lineTo(W - R0, Y(z)); g.stroke(); g.fillText(fmtE(z), 2, Y(z) + 3); });
    g.fillText('0', L0, H - 3); g.textAlign = 'right'; g.fillText(fmtD(maxD), W - R0, H - 3); g.textAlign = 'left';
    series.forEach((s) => {
      g.strokeStyle = s.color; g.lineWidth = 2; g.beginPath();
      const step = Math.max(1, Math.floor(s.d.length / 400));
      for (let i = 0; i < s.d.length; i += step) { const x = X(s.d[i]), y = Y(s.z[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    });
  }

  function warnings(ctx, sol, stops) {
    const out = [];
    sol.connectors.forEach((c) => {
      if (c.distM > 40) out.push(`${stops[c.idx].label} is ${fmtE(c.distM)} from the nearest gentle ground. The last stretch (dashed) wasn't checked for cliffs. Scout it.`);
    });
    return out;
  }

  function drawRoute(layer, sol, color) {
    L.polyline(sol.polyline, { color, weight: 5, opacity: 0.9 }).addTo(layer);
    sol.connectors.forEach((c) => L.polyline([c.from, c.to], { color: '#555', weight: 3, dashArray: '4 6' }).addTo(layer));
  }

  // ---------- Plan: find route ----------
  $('#runPlan').addEventListener('click', async () => {
    if (!S.start || !S.end) return status('Place a start and an end point first.', true);
    const btn = $('#runPlan'); btn.disabled = true;
    try {
      clearResults();
      const stops = [{ ...S.start, label: 'Start' }, ...S.boulders.map((b, i) => ({ ...b, label: `Boulder ${i + 1}` })), { ...S.end, label: 'End' }];
      const ctx = await buildContext(stops.map((s) => [s.lat, s.lng]));
      drawOverlay(ctx);
      status('Finding safest low-gain route…');
      const sol = await solve(ctx, stops);
      // renumber boulders in visiting order
      const old = S.boulders.slice();
      S.boulders = sol.route.slice(1, -1).map((i) => old[i - 1]);
      renderList();
      const stat = Analysis.analyze(sol.polyline, ctx);
      drawRoute(routeLayer, sol, '#e8590c');
      map.fitBounds(L.polyline(sol.polyline).getBounds().pad(0.2));
      const warns = warnings(ctx, sol, stops.map((s, i) => (i > 0 && i < stops.length - 1 ? { ...s, label: `Boulder ${sol.route.indexOf(i)}` } : s)));
      S.last = { sol, ctx, stat };
      $('#planResults').innerHTML = `
        <div class="card"><h3>Optimized route</h3>
          <table>
            <tr><td>Distance</td><td>${fmtD(stat.distance)}</td></tr>
            <tr><td>Climb / descent</td><td>${fmtE(stat.ascent)} / ${fmtE(stat.descent)}</td></tr>
            <tr><td>Total elevation change</td><td>${fmtE(stat.elevChange)}</td></tr>
            <tr><td>Steepest 10 m stretch</td><td>${fmtA(stat.maxGrade)}</td></tr>
            <tr><td>Est. hiking time</td><td>${fmtT(stat.hours)}</td></tr>
          </table>
          <canvas class="profile"></canvas>
          ${warns.map((w) => `<p class="warn">${w}</p>`).join('')}
          <p class="ok">No path cell is steeper than ${p0().maxSlope}° (with a ${fmtE(p0().margin)} margin).</p>
          <div class="row"><button id="exportKml">Download KML</button></div>
        </div>`;
      drawProfile($('#planResults canvas'), [{ ...stat.profile, color: '#e8590c' }]);
      $('#exportKml').addEventListener('click', exportKml);
      status('');
    } catch (err) { console.error(err); status(err.message, true); }
    btn.disabled = false;
  });
  const p0 = readParams;

  function exportKml() {
    const { sol, ctx } = S.last;
    const stops = [S.start, ...S.boulders, S.end].map((p, i, a) => ({ name: i === 0 ? 'Start' : i === a.length - 1 ? 'End' : `Boulder ${i}`, lat: p.lat, lng: p.lng }));
    const kml = GeoFiles.toKML('Optimized boulder approach', sol.polyline, (ll) => { const [cx, cy] = ctx.grid.fromLatLng(ll[0], ll[1]); return ctx.grid.sample(cx, cy); }, stops);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
    a.download = 'boulder-approach.kml'; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- Score a KML ----------
  let K = null;
  const drop = $('#drop');
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]));
  $('#file').addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));

  async function loadFile(file) {
    try {
      K = await GeoFiles.read(file);
      const longest = K.lines.reduce((bi, l, i, a) => (l.coords.length > a[bi].coords.length ? i : bi), 0);
      $('#lineSel').innerHTML = K.lines.map((l, i) => `<option value="${i}">${l.name} (${l.coords.length} pts)</option>`).join('');
      $('#lineSel').value = longest;
      $('#usePoints').disabled = !K.points.length;
      $('#usePoints').parentElement.style.opacity = K.points.length ? 1 : 0.5;
      $('#kmlInfo').hidden = false;
      $('#analyzeResults').innerHTML = '';
      showKmlPreview(); status('');
    } catch (err) { status(err.message, true); }
  }
  function showKmlPreview() {
    userLayer.clearLayers(); routeLayer.clearLayers();
    const line = K.lines[+$('#lineSel').value].coords;
    const pl = L.polyline(line, { color: '#1c7ed6', weight: 4 }).addTo(userLayer);
    if ($('#usePoints').checked) K.points.forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#6b4f2a', fillOpacity: 1 }).bindTooltip(p.name).addTo(userLayer));
    map.fitBounds(pl.getBounds().pad(0.15));
  }
  $('#lineSel').addEventListener('change', showKmlPreview);
  $('#usePoints').addEventListener('change', showKmlPreview);

  $('#runAnalyze').addEventListener('click', async () => {
    const btn = $('#runAnalyze'); btn.disabled = true;
    try {
      routeLayer.clearLayers(); $('#analyzeResults').innerHTML = '';
      const line = K.lines[+$('#lineSel').value].coords;
      const stops = [{ lat: line[0][0], lng: line[0][1], label: 'Start of your route' }];
      if ($('#usePoints').checked) K.points.forEach((p) => stops.push({ lat: p.lat, lng: p.lng, label: p.name }));
      const last = line[line.length - 1];
      stops.push({ lat: last[0], lng: last[1], label: 'End of your route' });
      const ctx = await buildContext([...line, ...stops.map((s) => [s.lat, s.lng])]);
      drawOverlay(ctx);
      const user = Analysis.analyze(line, ctx);
      status('Finding the optimized route…');
      const sol = await solve(ctx, stops);
      const opt = Analysis.analyze(sol.polyline, ctx);
      userLayer.clearLayers();
      L.polyline(line, { color: '#1c7ed6', weight: 4 }).addTo(userLayer);
      user.flagged.forEach((f) => L.polyline(f, { color: '#e03131', weight: 7, opacity: 0.9 }).addTo(userLayer));
      drawRoute(routeLayer, sol, '#e8590c');
      stops.slice(1, -1).forEach((s) => L.circleMarker([s.lat, s.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#6b4f2a', fillOpacity: 1 }).bindTooltip(s.label).addTo(userLayer));
      renderCompare(user, opt, sol, stops, ctx);
      status('');
    } catch (err) { console.error(err); status(err.message, true); }
    btn.disabled = false;
  });

  function renderCompare(u, o, sol, stops, ctx) {
    const score = u.cost > 0 ? Math.min(100, Math.round((100 * o.cost) / u.cost)) : 100;
    const color = score >= 85 ? 'var(--good)' : score >= 60 ? '#e8a400' : 'var(--bad)';
    const row = (label, a, b, fa, lowerBetter = true) => {
      const better = lowerBetter ? b < a - 1e-6 : false;
      return `<tr><td>${label}</td><td>${fa(a)}</td><td class="${better ? 'win' : ''}">${fa(b)}</td></tr>`;
    };
    const saved = u.elevChange - o.elevChange;
    const savedPct = u.elevChange ? Math.round((100 * saved) / u.elevChange) : 0;
    const warns = warnings(ctx, sol, stops);
    let verdict = u.steepLen > 0
      ? `<p class="warn">${fmtD(u.steepLen)} of your route crosses ground steeper than ${ctx.p.maxSlope}° (red on the map): possible cliff or scramble sections, up to ${fmtA(u.maxTerrain)}.</p>`
      : `<p class="ok">No part of your route crosses ground steeper than ${ctx.p.maxSlope}°.</p>`;
    verdict += saved > 1
      ? `<p class="${savedPct > 15 ? 'warn' : 'ok'}">The optimized route cuts total elevation change by ${fmtE(saved)} (${savedPct}%).</p>`
      : `<p class="ok">Your route is already as low-elevation-change as the optimizer found.</p>`;
    $('#analyzeResults').innerHTML = `
      <div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="score" style="color:${color}">${score}<small>efficiency score<br>(100 = matches optimizer)</small></div>
        <div class="score" style="font-size:15px;text-align:right;color:${u.steepLen > 0 ? 'var(--bad)' : 'var(--good)'}">${u.steepLen > 0 ? '⚠ Cliff check failed' : '✓ Cliff check passed'}<small>${u.steepLen > 0 ? fmtD(u.steepLen) + ' over ' + ctx.p.maxSlope + '°' : 'nothing over ' + ctx.p.maxSlope + '°'}</small></div></div>
        <table style="margin-top:10px">
          <tr><th></th><th>Yours</th><th>Optimized</th></tr>
          ${row('Distance', u.distance, o.distance, fmtD)}
          ${row('Climb', u.ascent, o.ascent, fmtE)}
          ${row('Descent', u.descent, o.descent, fmtE)}
          ${row('Total elev. change', u.elevChange, o.elevChange, fmtE)}
          ${row('Steepest 10 m', u.maxGrade, o.maxGrade, fmtA)}
          ${row('Over-limit terrain', u.steepLen, o.steepLen, fmtD)}
          ${row('Est. time', u.hours, o.hours, fmtT)}
        </table>
        <canvas class="profile"></canvas>
        <div class="legend"><i style="background:#1c7ed6"></i>yours <i style="background:#e03131"></i>over limit <i style="background:#e8590c"></i>optimized</div>
        ${verdict}${warns.map((w) => `<p class="warn">${w}</p>`).join('')}
        ${K.points.length && $('#usePoints').checked ? '' : '<p class="hint">No boulder placemarks were used, so the optimized route only connects your start and end. Add Point placemarks for the boulders you visit for a fair comparison.</p>'}
      </div>`;
    drawProfile($('#analyzeResults canvas'), [{ ...u.profile, color: '#1c7ed6' }, { ...o.profile, color: '#e8590c' }]);
  }
})();
