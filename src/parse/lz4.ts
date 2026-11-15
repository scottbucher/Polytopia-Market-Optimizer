/** Largest decompressed save we accept (real saves are well under 1 MB). */
export const MAX_STATE_BYTES = 8 * 1024 * 1024;

const TRUNCATED = 'The save file is cut short (LZ4 data ends early).';

/** Decompress a raw LZ4 block (no frame header). */
export function lz4DecompressBlock(src: Uint8Array, maxOut: number): Uint8Array {
  if (maxOut > MAX_STATE_BYTES) throw new Error('This file is too large to be a Polytopia save.');
  const out = new Uint8Array(maxOut);
  let si = 0;
  let di = 0;
  const byte = () => {
    if (si >= src.length) throw new Error(TRUNCATED);
    return src[si++];
  };
  while (si < src.length) {
    const token = byte();
    let litLen = token >> 4;
    if (litLen === 15) {
      let b: number;
      do {
        b = byte();
        litLen += b;
      } while (b === 255);
    }
    if (si + litLen > src.length) throw new Error(TRUNCATED);
    if (di + litLen > out.length) throw new Error('LZ4: output overflow');
    out.set(src.subarray(si, si + litLen), di);
    si += litLen;
    di += litLen;
    if (si >= src.length) break; // last sequence has no match
    if (si + 2 > src.length) throw new Error(TRUNCATED);
    const offset = src[si] | (src[si + 1] << 8);
    si += 2;
    if (offset === 0 || offset > di) throw new Error('LZ4: bad offset');
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b: number;
      do {
        b = byte();
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4;
    if (di + matchLen > out.length) throw new Error('LZ4: output overflow');
    let mi = di - offset;
    for (let k = 0; k < matchLen; k++) out[di++] = out[mi++];
  }
  return out.subarray(0, di);
}

/**
 * Polytopia .state files use the LZ4 "pickle" container: 1 header byte whose top two
 * bits give the size of a little-endian "extra bytes" field (0, 1, 2 or 4), then an LZ4
 * block. Decompressed size = compressed size + extra bytes. With no extra bytes the
 * data is stored uncompressed.
 */
export function decompressState(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 16) throw new Error('This file is too small to be a Polytopia save.');
  const first = bytes[0];
  let size = (first >> 6) & 3;
  if (size === 3) size = 4;
  const offset = 1 + size;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Read as signed: real saves always grow when decompressed, so this equals the unsigned value.
  const diff = size === 4 ? dv.getInt32(1, true) : size === 2 ? dv.getUint16(1, true) : size === 1 ? bytes[1] : 0;
  if (diff === 0) {
    if (bytes.length - offset > MAX_STATE_BYTES) throw new Error('This file is too large to be a Polytopia save.');
    return bytes.slice(offset);
  }
  const outSize = bytes.length - offset + diff;
  if (outSize <= 0) throw new Error('Not a Polytopia save file (bad size).');
  return lz4DecompressBlock(bytes.subarray(offset), outSize);
}
