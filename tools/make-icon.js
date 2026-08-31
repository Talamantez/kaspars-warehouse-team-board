"use strict";

// Regenerates the home-screen / tab icons. Dev-only — not shipped to the
// browser, no dependencies. Run from the project root:
//
//   node tools/make-icon.js
//
// Produces icon-180.png (iOS apple-touch-icon) and icon-512.png (web
// manifest). The art is a 3-column "board" glyph on the app accent colour.

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const ACCENT = [0x25, 0x63, 0xeb]; // #2563eb — matches --accent in styles.css
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function renderPng(size) {
  const W = size;
  const H = size;
  const margin = Math.round(size * 0.19);
  const gap = Math.round(size * 0.07);
  const barW = Math.round((W - margin * 2 - gap * 2) / 3);
  const barTop = margin;
  const barBot = H - margin;

  const inBar = (x, y) => {
    if (y < barTop || y >= barBot) return false;
    for (let b = 0; b < 3; b++) {
      const x0 = margin + b * (barW + gap);
      if (x >= x0 && x < x0 + barW) return true;
    }
    return false;
  };

  // raw scanlines: each row is a filter byte (0) followed by W RGBA pixels.
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 4);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      const p = row + 1 + x * 4;
      const c = inBar(x, y) ? WHITE : ACCENT;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, "..");
for (const size of [180, 512]) {
  const file = path.join(root, `icon-${size}.png`);
  fs.writeFileSync(file, renderPng(size));
  console.log("wrote", path.relative(root, file));
}
