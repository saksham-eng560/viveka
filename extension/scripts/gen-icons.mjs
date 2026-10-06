// Generates simple lighthouse-on-indigo PNG icons without external deps.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets");
mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling
  const inTower = (x, y) => {
    // normalized 0..1 coords; tapered tower
    if (y < 0.3 || y > 0.82) return false;
    const t = (y - 0.3) / 0.52;
    const half = 0.08 + t * 0.09;
    return Math.abs(x - 0.5) <= half;
  };
  const inLamp = (x, y) => y >= 0.2 && y < 0.3 && Math.abs(x - 0.5) <= 0.07;
  const inRoof = (x, y) => y >= 0.13 && y < 0.2 && Math.abs(x - 0.5) <= 0.08 * (1 - (0.2 - y) / 0.07 * 0.9);
  const inBeam = (x, y) => y >= 0.2 && y < 0.3 && Math.abs(x - 0.5) > 0.07 && Math.abs(x - 0.5) < 0.38 && Math.abs(y - 0.25) < 0.05 * (1 - (Math.abs(x - 0.5) - 0.07) / 0.31 * 0.5);
  const inStripe = (x, y) => (y > 0.46 && y < 0.54) || (y > 0.64 && y < 0.7);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
        const x = (i + (si + 0.5) / S) / size;
        const y = (j + (sj + 0.5) / S) / size;
        const d = Math.hypot(x - 0.5, y - 0.5);
        if (d > 0.5) continue;
        let c = [79, 70, 229]; // indigo-600
        if (inBeam(x, y)) c = [253, 224, 71];
        else if (inLamp(x, y)) c = [254, 240, 138];
        else if (inRoof(x, y)) c = [255, 255, 255];
        else if (inTower(x, y)) c = inStripe(x, y) ? [244, 63, 94] : [255, 255, 255];
        r += c[0]; g += c[1]; b += c[2]; a += 255;
      }
      const n = S * S;
      const o = (j * size + i) * 4;
      const cov = a / 255;
      px[o] = cov ? Math.round(r / cov) : 0;
      px[o + 1] = cov ? Math.round(g / cov) : 0;
      px[o + 2] = cov ? Math.round(b / cov) : 0;
      px[o + 3] = Math.round(a / n);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) {
    raw[j * (size * 4 + 1)] = 0;
    px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const s of [16, 48, 128]) writeFileSync(join(outDir, `icon-${s}.png`), render(s));
console.log("icons written");
