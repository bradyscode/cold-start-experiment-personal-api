// Writes the PWA icons to public/icons/ using only node:zlib (no image dependencies).
// Usage: node scripts/make-icons.mjs   (from personal-web/; output is committed)
// Design: flat steel #10141A background, brass #E3A72F rounded square mark.
// icon-192/icon-512 use a mark at 60% of the canvas; icon-maskable-512 uses 50% so it stays inside the maskable safe zone.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STEEL = [0x10, 0x14, 0x1a];
const BRASS = [0xe3, 0xa7, 0x2f];
const SS = 4;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function insideRoundedSquare(x, y, size, markRatio) {
  const side = size * markRatio;
  const lo = (size - side) / 2;
  const hi = lo + side;
  const r = side * 0.18;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + r), hi - r);
  const cy = Math.min(Math.max(y, lo + r), hi - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function render(size, markRatio) {
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (insideRoundedSquare(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, size, markRatio)) hits++;
        }
      }
      const t = hits / (SS * SS);
      for (let ch = 0; ch < 3; ch++) row[1 + px * 3 + ch] = Math.round(STEEL[ch] + (BRASS[ch] - STEEL[ch]) * t);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-192.png'), render(192, 0.6));
writeFileSync(join(outDir, 'icon-512.png'), render(512, 0.6));
writeFileSync(join(outDir, 'icon-maskable-512.png'), render(512, 0.5));
console.log('Wrote icons to', outDir);
