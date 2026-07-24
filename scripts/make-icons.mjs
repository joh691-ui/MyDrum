// Generates PNG app icons (no external deps) — a PO-style orange square
// with a black "▮" mark. Run: node scripts/make-icons.mjs
import zlib from "zlib";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePng(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y);
      const i = (y * size + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  // add filter byte (0) at the start of each row
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const pad = size * 0.16;
  const barW = size * 0.14;
  const barH = size * 0.5;
  const bx = (size - barW) / 2;
  const by = (size - barH) / 2;
  return (x, y) => {
    // rounded-ish background
    const inset = size * 0.06;
    if (x < inset || y < inset || x > size - inset || y > size - inset)
      return [13, 13, 15, 255]; // dark border
    // orange field
    let col = [255, 77, 46, 255];
    // black bar mark
    if (x >= bx && x <= bx + barW && y >= by && y <= by + barH) col = [13, 13, 15, 255];
    return col;
  };
}

await fs.mkdir(outDir, { recursive: true });
for (const size of [192, 512]) {
  const png = makePng(size, draw(size));
  await fs.writeFile(join(outDir, `icon-${size}.png`), png);
  console.log("wrote icon-" + size + ".png");
}
