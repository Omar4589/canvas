import zlib from 'node:zlib';
import { promisify } from 'node:util';

// The report logo's server-side check, then a RE-ENCODE (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F8
// and §O9's PNG note). The browser already drew the chosen image onto a canvas and exported a PNG; the
// server trusts none of that. It accepts PNG only, checks it strictly, and then WRITES A FRESH PNG
// from the validated fields — IHDR, one IDAT (its own deflate of the checked scanlines) and IEND,
// plus tRNS only for colour type 2 — so none of the uploaded chunk bytes is ever stored: no text
// chunk, no metadata, no second zlib stream, nothing after IEND can ride along to a client's PDF.
// Review round 3 found five malformed PNGs that passed a check-only approach; re-encoding closes
// that whole class rather than one file at a time.
//
// Both zlib steps run on libuv's threadpool, never on the event loop (code review SEC-2): this runs
// inside PUT /admin/branding/logo on the ONE web dyno every customer shares, and a crafted 255 KB
// upload (2000 × 2000 RGBA, low-entropy rows) held the loop about 4 s in a level-9 deflateSync — six
// at once stalled every other request for 16 s. The re-encode deflates at level 6, which bounds that
// worst case near 0.2 s of one pool thread (level 9: 3.8 s); the inflate keeps its exact bound.
const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);
const DEFLATE_LEVEL = 6;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const LOGO_MAX_BYTES = 256 * 1024;
export const LOGO_MAX_SIDE = 2000;
export const LOGO_MAX_PIXELS = 4_000_000;
// Truecolour (2) and truecolour with alpha (6), 8 bits per sample — what a canvas exports.
const BYTES_PER_PIXEL = { 2: 3, 6: 4 };

export class LogoError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const invalid = (why) => new LogoError('LOGO_INVALID', `This logo isn't a PNG the server can use (${why}). Choose the image again.`);

/**
 * Check a PNG strictly. Resolves { width, height, colorType, trns, scanlines } — the inflated,
 * still-filtered rows, every filter byte checked — or rejects with a LogoError. Checks: the signature;
 * exactly one IHDR, first; every chunk's CRC; width and height 1..2000 and at most 4 megapixels; bit
 * depth 8; colour type 2 or 6; compression, filter-method and interlace bytes 0; consecutive IDATs
 * that inflate (bounded by maxOutputLength, so a bomb stops at the expected size + 1) to EXACTLY
 * height × (1 + width × bytesPerPixel) bytes in one zlib stream with nothing after it; every row's
 * filter byte ≤ 4; tRNS only on colour type 2 with a 6-byte body, before the image data; nothing
 * after IEND.
 */
export const checkPng = async (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < SIGNATURE.length || !buf.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new LogoError('LOGO_NOT_PNG', 'The logo must be a PNG image.');
  }
  let pos = SIGNATURE.length;
  let ihdr = null;
  let trns = null;
  const idat = [];
  let idatClosed = false;
  let ended = false;
  while (pos < buf.length) {
    if (pos + 12 > buf.length) throw invalid('a chunk is cut short');
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw invalid('an unreadable chunk');
    const dataEnd = pos + 8 + len;
    if (len > 0x7fffffff || dataEnd + 4 > buf.length) throw invalid('a chunk runs past the end of the file');
    const data = buf.subarray(pos + 8, dataEnd);
    if (zlib.crc32(buf.subarray(pos + 4, dataEnd)) !== buf.readUInt32BE(dataEnd)) throw invalid(`the ${type} chunk is damaged`);
    pos = dataEnd + 4;

    if (!ihdr && type !== 'IHDR') throw invalid('the header must come first');
    if (type === 'IHDR') {
      if (ihdr) throw invalid('it has two headers');
      if (len !== 13) throw invalid('the header is the wrong size');
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
      const { width, height } = ihdr;
      if (width < 1 || height < 1 || width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE || width * height > LOGO_MAX_PIXELS) {
        throw invalid(`it must be between 1 and ${LOGO_MAX_SIDE} pixels on each side`);
      }
      if (ihdr.bitDepth !== 8 || !BYTES_PER_PIXEL[ihdr.colorType]) throw invalid('it must be 8-bit colour, with or without transparency');
      if (ihdr.compression !== 0 || ihdr.filter !== 0) throw invalid('an unknown compression or filter method');
      if (ihdr.interlace !== 0) throw invalid('it is interlaced');
      continue;
    }
    if (type === 'IDAT') {
      if (idatClosed) throw invalid('its image data is split');
      idat.push(data);
      continue;
    }
    if (idat.length) idatClosed = true;
    if (type === 'IEND') {
      ended = true;
      break;
    }
    if (type === 'tRNS') {
      // Colour type 6 carries its own alpha, so a tRNS there is malformed; on type 2 it names one
      // transparent colour as three 16-bit samples, each within 8 bits.
      if (ihdr.colorType !== 2 || len !== 6 || idat.length || trns) throw invalid('a misplaced transparency chunk');
      if (data[0] !== 0 || data[2] !== 0 || data[4] !== 0) throw invalid('a transparency colour out of range');
      trns = Buffer.from(data);
      continue;
    }
    if (type === 'PLTE') {
      // A suggested palette for a truecolour image: allowed before the image data, and dropped.
      if (idat.length) throw invalid('a palette after the image data');
      continue;
    }
    // An ancillary chunk (lower-case first letter) is dropped; an unknown CRITICAL one (upper-case)
    // is refused, as the PNG spec requires of a decoder.
    if ((type.charCodeAt(0) & 0x20) === 0) throw invalid(`an unexpected ${type} chunk`);
  }
  if (!ihdr) throw invalid('it has no header');
  if (!ended) throw invalid('it has no end');
  if (pos !== buf.length) throw invalid('there is data after its end');
  if (!idat.length) throw invalid('it has no image data');

  const bpp = BYTES_PER_PIXEL[ihdr.colorType];
  const rowLen = 1 + ihdr.width * bpp;
  const expected = ihdr.height * rowLen;
  const compressed = Buffer.concat(idat);
  let scanlines;
  try {
    // maxOutputLength: a decompression bomb stops one byte past the size the header promises. `info`
    // says how much input the stream used: zlib quietly ignores anything after the first stream's end
    // (a second zlib stream, appended bytes), so that has to be checked here.
    const out = await inflate(compressed, { maxOutputLength: expected + 1, info: true });
    if (out.engine.bytesWritten !== compressed.length) throw invalid('extra data after its image data');
    scanlines = out.buffer;
  } catch (err) {
    if (err instanceof LogoError) throw err;
    throw invalid('its image data does not decompress to its size');
  }
  if (scanlines.length !== expected) throw invalid('its image data does not decompress to its size');
  for (let row = 0; row < ihdr.height; row += 1) {
    if (scanlines[row * rowLen] > 4) throw invalid('an unknown row filter');
  }
  return { width: ihdr.width, height: ihdr.height, colorType: ihdr.colorType, trns, scanlines };
};

const chunk = (type, data = Buffer.alloc(0)) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/**
 * A FRESH PNG from checked fields only: IHDR (compression, filter and interlace written as 0), tRNS
 * for colour type 2 when the upload had one, ONE IDAT holding our own deflate of the checked
 * scanlines (their filter bytes are already known to be 0-4, so any decoder unfilters them the same
 * way), and IEND.
 */
export const encodePng = async ({ width, height, colorType, trns = null, scanlines }) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    ...(colorType === 2 && trns?.length === 6 ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', await deflate(scanlines, { level: DEFLATE_LEVEL })),
    chunk('IEND'),
  ]);
};

/** Check an upload and re-encode it. Resolves { png, width, height, bytes } or rejects with a LogoError. */
export const sanitizeLogo = async (buf) => {
  const image = await checkPng(buf);
  const png = await encodePng(image);
  if (png.length > LOGO_MAX_BYTES) {
    throw new LogoError('LOGO_TOO_LARGE', 'This logo is too large — choose a smaller image (at most 256 KB).', 413);
  }
  return { png, width: image.width, height: image.height, bytes: png.length };
};
