// Minimal encoder for a true 1-bit-per-pixel PNG (grayscale, bit depth 1).
//
// The browser's canvas always exports 8-bit-per-channel PNGs, so to get a
// genuinely 1bpp file we build the PNG by hand: pack 8 pixels per byte, and
// compress the IDAT with the platform's `CompressionStream("deflate")` (which
// emits exactly the zlib stream PNG expects).

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeBytes = new Uint8Array([0, 1, 2, 3].map((i) => type.charCodeAt(i)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  // Layout: length (4) + body (type+data) + crc (4).
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

async function zlibDeflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Encode an ImageData (already reduced to black/white) as a 1bpp grayscale PNG
 * Blob. A pixel is treated as ink (bit 0 = black) when its red channel < 128.
 */
export async function encode1bitPng(img: ImageData): Promise<Blob> {
  const { width, height, data } = img;
  const rowBytes = (width + 7) >> 3;

  // Each scanline: 1 filter byte (0 = none) + packed bits, MSB first.
  const raw = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const lum = data[(y * width + x) * 4]; // red channel (R=G=B here)
      if (lum >= 128) {
        // white -> bit 1; ink stays 0
        raw[rowStart + 1 + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = await zlibDeflate(raw);

  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  return new Blob(parts, { type: "image/png" });
}
