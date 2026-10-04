// Tree canopy cover (percent per 30 m pixel) from the USGS/MRLC NLCD Tree Canopy WMS. Continental US, AK, HI, PR only.
// The service returns a colour-styled image, so each pixel colour is mapped back to its canopy percentage.
const Forest = (() => {
  const WMS = 'https://www.mrlc.gov/geoserver/ows';
  const PALETTE = [0xD1D2D1,0xCFD1CF,0xCDD0CD,0xC9CFC9,0xC7CEC7,0xC5CDC5,0xC4CCC4,0xC2C8C2,0xC0C7C0,0xBCC6BC,0xBAC5BA,0xB8C5B8,0xB8C5B8,0xB6C4B6,0xB4C3B4,0xAFC1AF,0xADC0AD,0xACBDAC,0xABBCAB,0xA9BBA9,0xA7BAA7,0xA3B9A3,0xA1B8A1,0x9FB89F,0x9EB79E,0x9CB69C,0x9AB59A,0x96B496,0x94B394,0x92B092,0x92AF92,0x90AE90,0x8DAD8D,0x89AC89,0x87AC87,0x85AB85,0x85AA85,0x83A983,0x81A881,0x7DA77D,0x7AA67A,0x79A379,0x78A178,0x76A076,0x749F74,0x709F70,0x6E9F6E,0x6C9E6C,0x6C9D6C,0x699C69,0x679A67,0x639963,0x619661,0x5F955F,0x5F945F,0x5D935D,0x5B925B,0x569256,0x549254,0x529052,0x528F52,0x508E50,0x4E8D4E,0x4A8A4A,0x488948,0x468846,0x458745,0x438643,0x418541,0x3D853D,0x3B843B,0x398339,0x398239,0x378137,0x348034,0x307D30,0x2E7C2E,0x2C7A2C,0x2C792C,0x2A792A,0x287928,0x247824,0x227722,0x1F761F,0x1F751F,0x1D731D,0x1B701B,0x176F17,0x156E15,0x136D13,0x136C13,0x106C10,0x0E6C0E,0x0A6B0A,0x086908,0x066806,0x066706,0x046604,0x026302,0x006200]; // PALETTE[i] is the colour for (i + 1) percent canopy
  const PR = PALETTE.map((c) => [c >> 16, (c >> 8) & 255, c & 255]);
  const R = 20037508.342789244;

  function nearest(r, g, b, cache) {
    const key = (r << 16) | (g << 8) | b;
    let q = cache.get(key);
    if (q !== undefined) return q;
    let best = 1e9;
    for (let i = 0; i < 100; i++) {
      const d = (PR[i][0] - r) ** 2 + (PR[i][1] - g) ** 2 + (PR[i][2] - b) ** 2;
      if (d < best) { best = d; q = i + 1; }
    }
    cache.set(key, q);
    return q;
  }

  // Returns Uint8Array(w*h) of canopy percent (0 where no canopy / no data) aligned with the DEM grid.
  async function load(grid) {
    const n = 2 ** grid.z * 256, { px0, py0, w, h } = grid;
    const mx = (px) => (px / n - 0.5) * 2 * R, my = (py) => (0.5 - py / n) * 2 * R;
    const bbox = [mx(px0), my(py0 + h), mx(px0 + w), my(py0)].join(',');
    const url = `${WMS}?service=WMS&version=1.1.1&request=GetMap&layers=NLCD_Canopy&styles=&srs=EPSG:3857&bbox=${bbox}&width=${w}&height=${h}&format=image/png&transparent=true`;
    const img = await new Promise((res, rej) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = () => rej(new Error('canopy service unavailable'));
      im.src = url;
    });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h), cache = new Map();
    let any = 0;
    for (let i = 0; i < out.length; i++) {
      if (px[i * 4 + 3] < 128) continue;
      out[i] = nearest(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], cache); any++;
    }
    return { canopy: out, covered: any > 0 };
  }
  return { load };
})();
