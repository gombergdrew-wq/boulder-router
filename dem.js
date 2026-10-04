// Elevation grid built from AWS Terrain Tiles (Terrarium PNG, CORS-enabled, global, no API key).
const DEM = (() => {
  const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const MIN_Z = 13, MAX_Z = 15;

  const worldPx = (lat, lng, z) => {
    const s = 256 * 2 ** z;
    const sin = Math.sin((lat * Math.PI) / 180);
    return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
  };
  const pxToLatLng = (x, y, z) => {
    const s = 256 * 2 ** z;
    return [(180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / s)), (x / s) * 360 - 180];
  };

  function loadTile(z, x, y) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load elevation tile ${z}/${x}/${y} (offline?)`));
      img.src = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    });
  }

  function extent(b, z) {
    const [x0, y0] = worldPx(b.north, b.west, z), [x1, y1] = worldPx(b.south, b.east, z);
    const px0 = Math.floor(x0), py0 = Math.floor(y0);
    return { px0, py0, w: Math.ceil(x1) - px0 + 1, h: Math.ceil(y1) - py0 + 1 };
  }

  async function buildGrid(b, { maxPx = 1500, onProgress } = {}) {
    let z = MAX_Z, ex = extent(b, z);
    while (z > MIN_Z && (ex.w > maxPx || ex.h > maxPx)) ex = extent(b, --z);
    if (ex.w > maxPx || ex.h > maxPx) {
      const km = ((Math.max(ex.w, ex.h) * 40075016.686) / (256 * 2 ** z) * Math.cos(((b.north + b.south) / 2) * Math.PI / 180)) / 1000;
      throw new Error(`Area is too large (~${km.toFixed(0)} km across). Keep everything within roughly 15 km.`);
    }
    const { px0, py0, w, h } = ex;
    const mpp = (40075016.686 * Math.cos(((b.north + b.south) / 2) * Math.PI / 180)) / (256 * 2 ** z);
    const elev = new Float32Array(w * h);

    const tx0 = Math.floor(px0 / 256), tx1 = Math.floor((px0 + w - 1) / 256);
    const ty0 = Math.floor(py0 / 256), ty1 = Math.floor((py0 + h - 1) / 256);
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
    let done = 0;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const imgs = await Promise.all(jobs.map(([tx, ty]) => loadTile(z, tx, ty).then((img) => {
      onProgress && onProgress(++done, jobs.length);
      return img;
    })));
    jobs.forEach(([tx, ty], i) => {
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(imgs[i], 0, 0);
      const data = ctx.getImageData(0, 0, 256, 256).data;
      const xa = Math.max(px0, tx * 256), xb = Math.min(px0 + w, tx * 256 + 256);
      const ya = Math.max(py0, ty * 256), yb = Math.min(py0 + h, ty * 256 + 256);
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
        const p = ((y - ty * 256) * 256 + (x - tx * 256)) * 4;
        elev[(y - py0) * w + (x - px0)] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
      }
    });

    return {
      z, px0, py0, w, h, mpp, elev,
      // cell coordinates are fractional; integer values are cell centres
      fromLatLng(lat, lng) { const [x, y] = worldPx(lat, lng, z); return [x - px0 - 0.5, y - py0 - 0.5]; },
      toLatLng(cx, cy) { return pxToLatLng(cx + px0 + 0.5, cy + py0 + 0.5, z); },
      sample(cx, cy) {
        cx = Math.min(w - 1.001, Math.max(0, cx)); cy = Math.min(h - 1.001, Math.max(0, cy));
        const x = Math.floor(cx), y = Math.floor(cy), fx = cx - x, fy = cy - y, i = y * w + x;
        return (elev[i] * (1 - fx) + elev[i + 1] * fx) * (1 - fy) + (elev[i + w] * (1 - fx) + elev[i + w + 1] * fx) * fy;
      },
    };
  }

  return { buildGrid };
})();
