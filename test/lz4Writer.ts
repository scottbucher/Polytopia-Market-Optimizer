// A small greedy LZ4 block compressor, so tests exercise back-references
// (including long matches) the way real saves do.

function len(out: number[], n: number) {
  while (n >= 255) {
    out.push(255);
    n -= 255;
  }
  out.push(n);
}

function sequence(out: number[], lit: Uint8Array, matchLen: number | null, offset = 0) {
  const ml = matchLen === null ? 0 : matchLen - 4;
  out.push((Math.min(15, lit.length) << 4) | Math.min(15, ml));
  if (lit.length >= 15) len(out, lit.length - 15);
  for (const b of lit) out.push(b);
  if (matchLen === null) return;
  out.push(offset & 255, offset >> 8);
  if (ml >= 15) len(out, ml - 15);
}

export function lz4CompressBlock(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const last = new Map<number, number>();
  const key = (i: number) => data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
  let anchor = 0;
  let i = 0;
  while (i + 4 <= data.length) {
    const k = key(i);
    const prev = last.get(k);
    last.set(k, i);
    if (prev !== undefined && i - prev <= 65535) {
      let m = 4;
      while (i + m < data.length && data[prev + m] === data[i + m]) m++;
      sequence(out, data.subarray(anchor, i), m, i - prev);
      i += m;
      anchor = i;
    } else i++;
  }
  sequence(out, data.subarray(anchor), null);
  return new Uint8Array(out);
}

/** Wraps an LZ4 block in the .state container, with a 2- or 4-byte size field. */
export function compressState(data: Uint8Array, sizeBytes: 2 | 4 = 4): Uint8Array {
  const block = lz4CompressBlock(data);
  const diff = data.length - block.length;
  if (sizeBytes === 2 && (diff < 0 || diff > 0xffff)) throw new Error('size does not fit in 2 bytes');
  const out = new Uint8Array(1 + sizeBytes + block.length);
  const dv = new DataView(out.buffer);
  if (sizeBytes === 2) {
    out[0] = 0x80;
    dv.setUint16(1, diff, true);
  } else {
    out[0] = 0xc0;
    dv.setInt32(1, diff, true);
  }
  out.set(block, 1 + sizeBytes);
  return out;
}

/** Compress into the same container (literals only). Never shrinks, so the size field is negative. */
export function compressStateLiteral(data: Uint8Array): Uint8Array {
  // One sequence of literals: token 0xF0, then the length in 255-steps.
  const parts: number[] = [0xf0];
  let n = data.length - 15;
  while (n >= 255) {
    parts.push(255);
    n -= 255;
  }
  parts.push(n);
  const block = new Uint8Array(parts.length + data.length);
  block.set(parts, 0);
  block.set(data, parts.length);
  const diff = data.length - block.length; // negative: literals-only blocks grow
  // The container stores (decompressed - compressed), so a 4-byte field is needed when negative.
  const out = new Uint8Array(5 + block.length);
  out[0] = 0xc0;
  new DataView(out.buffer).setInt32(1, diff, true);
  out.set(block, 5);
  return out;
}
