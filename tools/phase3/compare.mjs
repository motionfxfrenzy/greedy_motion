#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));

const dirA = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(HERE, "baseline");
const dirB = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : join(HERE, "after");
const diffDir = process.argv[4] ? resolve(process.cwd(), process.argv[4]) : join(HERE, "diff");

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("Invalid PNG signature");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idatParts));
  const pixels = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const curRow = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x++) {
      const byte = raw[rowStart + 1 + x];
      const left = x >= bpp ? curRow[x - bpp] : 0;
      const up = prevRow[x];
      const upLeft = x >= bpp ? prevRow[x - bpp] : 0;
      let val = byte;
      if (filter === 1) val = (byte + left) & 0xff;
      else if (filter === 2) val = (byte + up) & 0xff;
      else if (filter === 3) val = (byte + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) val = (byte + paethPredictor(left, up, upLeft)) & 0xff;
      curRow[x] = val;
    }

    for (let px = 0; px < width; px++) {
      const dst = (y * width + px) * 4;
      const src = px * bpp;
      pixels[dst] = curRow[src];
      pixels[dst + 1] = curRow[src + 1];
      pixels[dst + 2] = curRow[src + 2];
      pixels[dst + 3] = bpp === 4 ? curRow[src + 3] : 255;
    }
    prevRow.set(curRow);
  }

  return { width, height, data: pixels };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    const srcStart = y * stride;
    raw.set(rgba.subarray(srcStart, srcStart + stride), rowStart + 1);
  }

  const compressed = deflateSync(raw);
  return Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

function main() {
  mkdirSync(diffDir, { recursive: true });
  const filesA = readdirSync(dirA)
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (filesA.length === 0) {
    console.error(`No PNG files found in ${dirA}`);
    process.exit(1);
  }

  const results = [];
  let anyFailed = false;

  for (const file of filesA) {
    const pathA = join(dirA, file);
    const pathB = join(dirB, file);
    const imgA = decodePng(readFileSync(pathA));
    const imgB = decodePng(readFileSync(pathB));

    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      results.push({
        file,
        totalPixels: imgA.width * imgA.height,
        diffOver2Pixels: imgA.width * imgA.height,
        diffAnyPixels: imgA.width * imgA.height,
        pctOver2: 100,
        maxDelta: 255,
        pass: false,
        note: `Dimension mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`
      });
      anyFailed = true;
      continue;
    }

    const totalPixels = imgA.width * imgA.height;
    let diffOver2Pixels = 0;
    let diffAnyPixels = 0;
    let maxDelta = 0;
    const diffRgba = new Uint8Array(totalPixels * 4);

    for (let i = 0; i < totalPixels * 4; i += 4) {
      const dr = Math.abs(imgA.data[i] - imgB.data[i]);
      const dg = Math.abs(imgA.data[i + 1] - imgB.data[i + 1]);
      const db = Math.abs(imgA.data[i + 2] - imgB.data[i + 2]);
      const da = Math.abs(imgA.data[i + 3] - imgB.data[i + 3]);
      const d = Math.max(dr, dg, db, da);

      if (d > 0) {
        diffAnyPixels++;
        if (d > maxDelta) maxDelta = d;
        if (d > 2) diffOver2Pixels++;
        const amp = Math.min(255, Math.max(80, d * 12));
        diffRgba[i] = 255;
        diffRgba[i + 1] = Math.max(0, 255 - amp);
        diffRgba[i + 2] = 0;
        diffRgba[i + 3] = 255;
      } else {
        const lum = Math.round((imgA.data[i] + imgA.data[i + 1] + imgA.data[i + 2]) / 3);
        const dim = Math.round(lum * 0.25);
        diffRgba[i] = dim;
        diffRgba[i + 1] = dim;
        diffRgba[i + 2] = dim;
        diffRgba[i + 3] = 255;
      }
    }

    if (diffAnyPixels > 0) {
      const outPath = join(diffDir, file);
      writeFileSync(outPath, encodePng(imgA.width, imgA.height, diffRgba));
    }

    const pctOver2 = Number(((diffOver2Pixels / totalPixels) * 100).toFixed(4));
    const pass = diffAnyPixels === 0;
    if (!pass) anyFailed = true;

    results.push({
      file,
      totalPixels,
      diffAnyPixels,
      diffOver2Pixels,
      pctOver2,
      maxDelta,
      pass
    });
  }

  console.log("| Image | Differing px (>2 levels) | % > 2 levels | Any diff px | Max delta | Status |");
  console.log("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const r of results) {
    console.log(
      `| \`${r.file}\` | ${r.diffOver2Pixels} | ${r.pctOver2.toFixed(4)}% | ${r.diffAnyPixels} | ${r.maxDelta} | ${r.pass ? "PASS" : "FAIL"} |`
    );
  }

  const passedCount = results.filter((r) => r.pass).length;
  console.log(`\nSummary: ${passedCount}/${results.length} passed with 0 differing pixels.`);
  if (anyFailed) {
    process.exit(1);
  }
}

main();
