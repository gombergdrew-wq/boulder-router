// KML / KMZ / GPX parsing. Returns { lines: [{name, coords:[[lat,lng]...]}], points: [{name, lat, lng}] }.
const GeoFiles = (() => {
  const kids = (el, name) => Array.from(el.getElementsByTagNameNS('*', name));
  const nameOf = (el) => { const c = Array.from(el.children).find((x) => x.localName === 'name'); return c ? c.textContent.trim() : ''; };

  function parseKML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('That file is not valid KML.');
    const lines = [], points = [];
    const ll = (parts) => [parseFloat(parts[1]), parseFloat(parts[0])];
    kids(doc, 'Placemark').forEach((pm, idx) => {
      const name = nameOf(pm) || `Placemark ${idx + 1}`;
      kids(pm, 'LineString').forEach((ls) => {
        const el = kids(ls, 'coordinates')[0];
        if (!el) return;
        const coords = el.textContent.trim().split(/\s+/).map((s) => ll(s.split(','))).filter((c) => isFinite(c[0]) && isFinite(c[1]));
        if (coords.length > 1) lines.push({ name, coords });
      });
      kids(pm, 'Track').forEach((tr) => {
        const coords = kids(tr, 'coord').map((c) => ll(c.textContent.trim().split(/\s+/))).filter((c) => isFinite(c[0]) && isFinite(c[1]));
        if (coords.length > 1) lines.push({ name, coords });
      });
      kids(pm, 'Point').forEach((pt) => {
        const el = kids(pt, 'coordinates')[0];
        if (!el) return;
        const c = ll(el.textContent.trim().split(','));
        if (isFinite(c[0]) && isFinite(c[1])) points.push({ name, lat: c[0], lng: c[1] });
      });
    });
    return { lines, points };
  }

  function parseGPX(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('That file is not valid GPX.');
    const lines = [], points = [];
    const pt = (e) => [parseFloat(e.getAttribute('lat')), parseFloat(e.getAttribute('lon'))];
    kids(doc, 'trk').forEach((trk, i) => {
      const coords = kids(trk, 'trkpt').map(pt);
      if (coords.length > 1) lines.push({ name: nameOf(trk) || `Track ${i + 1}`, coords });
    });
    kids(doc, 'rte').forEach((rte, i) => {
      const coords = kids(rte, 'rtept').map(pt);
      if (coords.length > 1) lines.push({ name: nameOf(rte) || `Route ${i + 1}`, coords });
    });
    kids(doc, 'wpt').forEach((w, i) => { const c = pt(w); points.push({ name: nameOf(w) || `Waypoint ${i + 1}`, lat: c[0], lng: c[1] }); });
    return { lines, points };
  }

  function loadJSZip() {
    if (window.JSZip) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not load KMZ support (offline?)'));
      document.head.appendChild(s);
    });
  }

  async function read(file) {
    const name = file.name.toLowerCase();
    let out;
    if (name.endsWith('.kmz')) {
      await loadJSZip();
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'));
      if (!entry) throw new Error('No .kml inside that KMZ.');
      out = parseKML(await entry.async('string'));
    } else if (name.endsWith('.gpx')) {
      out = parseGPX(await file.text());
    } else {
      out = parseKML(await file.text());
    }
    if (!out.lines.length) throw new Error('No route line (LineString / gx:Track) found in that file.');
    return out;
  }

  function toKML(name, polyline, elevAt, stops) {
    const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const coords = polyline.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)},${elevAt(p).toFixed(1)}`).join(' ');
    const pms = stops.map((s) => `<Placemark><name>${esc(s.name)}</name><Point><coordinates>${s.lng.toFixed(6)},${s.lat.toFixed(6)},0</coordinates></Point></Placemark>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>` +
      `<Style id="r"><LineStyle><color>ff0859e8</color><width>4</width></LineStyle></Style>` +
      `<Placemark><name>${esc(name)}</name><styleUrl>#r</styleUrl><LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark>${pms}</Document></kml>`;
  }

  return { read, toKML };
})();
