// Minimal Bech32 (BIP-173) and Bech32m (BIP-350) codec.
// Zcash uses Bech32 for Sapling addresses and Bech32m for Unified Addresses
// (ZIP-316) and TEX addresses (ZIP-320). Implemented from the public specs so
// Zhield can verify address checksums in the browser with no dependencies.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHARMAP = new Map([...CHARSET].map((c, i) => [c, i]));

function polymod(values) {
  let chk = 1;
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

/**
 * Decode a bech32/bech32m string.
 * @returns {{hrp:string, words:number[], encoding:'bech32'|'bech32m'} | null}
 * Returns null on any structural or checksum failure.
 */
export function bech32Decode(str, maxLength = 10000) {
  if (typeof str !== 'string' || str.length < 8 || str.length > maxLength) return null;
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null; // mixed case is invalid
  const s = str.toLowerCase();
  const split = s.lastIndexOf('1');
  if (split < 1 || split + 7 > s.length) return null;
  const hrp = s.slice(0, split);
  const dataPart = s.slice(split + 1);
  const words = [];
  for (const c of dataPart) {
    if (!CHARMAP.has(c)) return null;
    words.push(CHARMAP.get(c));
  }
  const check = polymod([...hrpExpand(hrp), ...words]);
  let encoding = null;
  if (check === 1) encoding = 'bech32';
  else if (check === 0x2bc830a3) encoding = 'bech32m';
  else return null;
  return { hrp, words: words.slice(0, -6), encoding };
}

/** Encode words (5-bit) with the given hrp and encoding. Used for tests and fixtures. */
export function bech32Encode(hrp, words, encoding = 'bech32m') {
  const constVal = encoding === 'bech32' ? 1 : 0x2bc830a3;
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ constVal;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return hrp + '1' + [...words, ...checksum].map((w) => CHARSET[w]).join('');
}

/** Convert between bit widths (BIP-173 convertbits). Returns null on invalid padding when pad=false. */
export function convertBits(data, fromBits, toBits, pad = true) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxv = (1 << toBits) - 1;
  for (const v of data) {
    if (v < 0 || v >> fromBits !== 0) return null;
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}
