import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = path.join(rootDir, "icons");
const sizes = [16, 32, 48, 128];
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

await mkdir(iconDir, { recursive: true });

for (const size of sizes) {
  const png = createIconPng(size);
  await writeFile(path.join(iconDir, `icon-${size}.png`), png);
}

console.log(`Generated ${sizes.length} Chrome extension icons in ${path.relative(rootDir, iconDir)}`);

function createIconPng(size) {
  const pixels = new Uint8Array(size * size * 4);

  fillRoundedRect(pixels, size, 0, 0, size, size, size * 0.2, (x, y) => {
    const t = (x + y) / Math.max(1, size * 2 - 2);
    return mix([31, 122, 90], [48, 95, 135], t);
  });

  fillCircle(pixels, size, size * 0.76, size * 0.74, size * 0.18, [255, 190, 94, 255]);
  fillCircle(pixels, size, size * 0.76, size * 0.74, size * 0.12, [255, 224, 157, 255]);

  fillRoundedRect(pixels, size, size * 0.23, size * 0.18, size * 0.5, size * 0.64, size * 0.08, [255, 255, 255, 245]);
  fillRoundedRect(pixels, size, size * 0.31, size * 0.29, size * 0.34, size * 0.07, size * 0.02, [31, 122, 90, 255]);
  fillRoundedRect(pixels, size, size * 0.31, size * 0.43, size * 0.24, size * 0.05, size * 0.02, [48, 95, 135, 230]);
  fillRoundedRect(pixels, size, size * 0.31, size * 0.54, size * 0.28, size * 0.05, size * 0.02, [48, 95, 135, 210]);
  fillRoundedRect(pixels, size, size * 0.31, size * 0.65, size * 0.2, size * 0.05, size * 0.02, [31, 122, 90, 210]);

  if (size >= 32) {
    fillRoundedRect(pixels, size, size * 0.71, size * 0.64, size * 0.1, size * 0.2, size * 0.025, [167, 101, 34, 255]);
    fillRoundedRect(pixels, size, size * 0.68, size * 0.705, size * 0.16, size * 0.04, size * 0.02, [167, 101, 34, 255]);
  }

  return encodePng(size, size, pixels);
}

function fillRoundedRect(pixels, size, x, y, width, height, radius, color) {
  const x1 = Math.max(0, Math.floor(x));
  const y1 = Math.max(0, Math.floor(y));
  const x2 = Math.min(size, Math.ceil(x + width));
  const y2 = Math.min(size, Math.ceil(y + height));
  const r = Math.max(0, radius);

  for (let py = y1; py < y2; py += 1) {
    for (let px = x1; px < x2; px += 1) {
      const dx = Math.max(x + r - px, 0, px - (x + width - r));
      const dy = Math.max(y + r - py, 0, py - (y + height - r));
      if ((dx * dx) + (dy * dy) > r * r) continue;
      putPixel(pixels, size, px, py, typeof color === "function" ? color(px, py) : color);
    }
  }
}

function fillCircle(pixels, size, cx, cy, radius, color) {
  const x1 = Math.max(0, Math.floor(cx - radius));
  const y1 = Math.max(0, Math.floor(cy - radius));
  const x2 = Math.min(size, Math.ceil(cx + radius));
  const y2 = Math.min(size, Math.ceil(cy + radius));
  const radiusSquared = radius * radius;

  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx) + (dy * dy) <= radiusSquared) putPixel(pixels, size, x, y, color);
    }
  }
}

function putPixel(pixels, size, x, y, color) {
  const offset = ((y * size) + x) * 4;
  const alpha = color[3] / 255;
  const inverseAlpha = 1 - alpha;
  pixels[offset] = Math.round((color[0] * alpha) + (pixels[offset] * inverseAlpha));
  pixels[offset + 1] = Math.round((color[1] * alpha) + (pixels[offset + 1] * inverseAlpha));
  pixels[offset + 2] = Math.round((color[2] * alpha) + (pixels[offset + 2] * inverseAlpha));
  pixels[offset + 3] = Math.min(255, Math.round(color[3] + (pixels[offset + 3] * inverseAlpha)));
}

function mix(from, to, t) {
  return [
    Math.round(from[0] + ((to[0] - from[0]) * t)),
    Math.round(from[1] + ((to[1] - from[1]) * t)),
    Math.round(from[2] + ((to[2] - from[2]) * t)),
    255,
  ];
}

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (width * 4 + 1);
    scanlines[scanlineOffset] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(scanlines, scanlineOffset + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
