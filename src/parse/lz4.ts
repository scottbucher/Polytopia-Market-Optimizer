/** Decompress a raw LZ4 block (no frame header). */
export function lz4DecompressBlock(src: Uint8Array, maxOut: number): Uint8Array {
  const out = new Uint8Array(maxOut);
  let si = 0;
  let di = 0;
  while (si < src.length) {
    const token = src[si++];
    let litLen = token >> 4;
    if (litLen === 15) {
      let b: number;
      do {
        b = src[si++];
        litLen += b;
      } while (b === 255);
    }
    if (di + litLen > out.length) throw new Error('LZ4: output overflow');
    out.set(src.subarray(si, si + litLen), di);
    si += litLen;
    di += litLen;
    if (si >= src.length) break; // last sequence has no match
    const offset = src[si] | (src[si + 1] << 8);
    si += 2;
    if (offset === 0 || offset > di) throw new Error('LZ4: bad offset');
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b: number;
      do {
        b = src[si++];
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
 * Polytopia .state files: 1 header byte whose top two bits give the size of a
 * little-endian "extra bytes" field (2 or 4), then an LZ4 block. Decompressed
 * size = compressed size + extra bytes.
 */
export function decompressState(bytes: Uint8Array): Uint8Array {
  const first = bytes[0];
  let size = (first >> 6) & 3;
  if (size === 3) size = 4;
  if (size !== 2 && size !== 4) throw new Error('Not a Polytopia save file (unknown header).');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const diff = size === 4 ? dv.getUint32(1, true) : dv.getUint16(1, true);
  const offset = 1 + size;
  return lz4DecompressBlock(bytes.subarray(offset), bytes.length - offset + diff);
}
