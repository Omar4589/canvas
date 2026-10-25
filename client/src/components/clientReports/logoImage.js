// The organization logo, turned into a clean PNG in the browser before it is sent
// (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F8): any image the browser can draw — PNG, JPEG, SVG —
// onto a canvas no larger than 800 × 320, exported as PNG, and shrunk until it fits in 256 KB. The
// server accepts PNG only and re-encodes it, so nothing riding along in the original file survives.
//
// SVG is sized explicitly: an SVG with no width/height draws at 0 × 0 (or the browser's 300 × 150)
// on a canvas, so the root element gets the size its viewBox implies. A canvas tainted by an SVG with
// embedded HTML throws a SecurityError on export, which the card turns into a plain message.

export const MAX_W = 800;
export const MAX_H = 320;
export const MAX_BYTES = 256 * 1024;
const MIN_SIDE = 24;

/** The largest size within the box, never larger than the original, at least 1 × 1. */
export const fitWithin = (w, h, maxW = MAX_W, maxH = MAX_H) => {
  const width = Math.max(1, Number(w) || 1);
  const height = Math.max(1, Number(h) || 1);
  const s = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
};

const num = (v) => {
  const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
};

/** An SVG's drawing size: its width/height in px, else its viewBox, else the logo box itself. */
export const svgSize = (text) => {
  const root = /<svg\b[^>]*>/i.exec(String(text || ''))?.[0] || '';
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1];
  const w = num(attr('width'));
  const h = num(attr('height'));
  if (w && h) return { width: w, height: h };
  const vb = (attr('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w) return { width: w, height: (w * vb[3]) / vb[2] };
    if (h) return { width: (h * vb[2]) / vb[3], height: h };
    return { width: vb[2], height: vb[3] };
  }
  return { width: MAX_W, height: MAX_H };
};

/** The SVG with explicit width and height on its root element (pixels, scaled into the logo box). */
export const sizedSvg = (text) => {
  const src = String(text || '');
  // A vector can be drawn larger than its nominal size, so a small viewBox is scaled up (up to 4×)
  // to fill the logo box — a crisp PNG — but never past it.
  const natural = svgSize(src);
  const { width, height } = fitWithin(natural.width * 4, natural.height * 4, MAX_W, MAX_H);
  return src.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
    const rest = attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');
    return `<svg${rest} width="${width}" height="${height}">`;
  });
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Object.assign(new Error('This image couldn’t be read. Try a PNG or JPEG.'), { code: 'BAD_IMAGE' }));
    img.src = src;
  });

const toBlob = (canvas) =>
  new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(Object.assign(new Error('This image couldn’t be converted.'), { code: 'BAD_IMAGE' }))), 'image/png');
    } catch (e) {
      reject(e);
    }
  });

/** Plain words for a conversion failure — a tainted canvas included. */
export const logoErrorText = (err) => {
  if (err?.name === 'SecurityError') {
    return 'Your browser wouldn’t convert this image — some SVG files block it. Save it as a PNG or JPEG and try again.';
  }
  if (err?.code === 'TOO_LARGE') return 'This image stays over 256 KB even at a small size. Try a simpler logo.';
  return err?.message || 'This image couldn’t be read. Try a PNG or JPEG.';
};

/**
 * File → PNG Blob within 800 × 320 and 256 KB. Browser only (Image, canvas, object URLs); every
 * object URL it makes is revoked before it returns.
 */
export const logoToPng = async (file) => {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
  let source = file;
  if (isSvg) source = new Blob([sizedSvg(await file.text())], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const natural = isSvg ? svgSize(await source.text()) : { width: img.naturalWidth, height: img.naturalHeight };
    let { width, height } = fitWithin(natural.width, natural.height);
    const canvas = document.createElement('canvas');
    for (let i = 0; i < 20; i += 1) {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await toBlob(canvas);
      if (blob.size <= MAX_BYTES) return { blob, width, height };
      if (Math.min(width, height) <= MIN_SIDE) break;
      width = Math.max(1, Math.round(width * 0.85));
      height = Math.max(1, Math.round(height * 0.85));
    }
    throw Object.assign(new Error('Too large'), { code: 'TOO_LARGE' });
  } finally {
    URL.revokeObjectURL(url);
  }
};
