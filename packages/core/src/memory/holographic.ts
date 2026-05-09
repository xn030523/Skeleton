/**
 * Holographic Reduced Representation (HRR) — vector-symbolic memory.
 * Uses circular convolution (via FFT) for binding/unbinding.
 * Inspired by Plate (1995) and Hermes holographic memory.
 */

export type HRRVector = Float32Array;

const TAU = 2 * Math.PI;

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = TAU / len * (inverse ? -1 : 1);
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < (len >> 1); j++) {
        const a = i + j;
        const b = a + (len >> 1);
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function toF64(vec: HRRVector): Float64Array {
  const out = new Float64Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i];
  return out;
}

function circularConvolve(a: HRRVector, b: HRRVector): HRRVector {
  const n = nextPow2(a.length);
  const aRe = new Float64Array(n);
  const aIm = new Float64Array(n);
  const bRe = new Float64Array(n);
  const bIm = new Float64Array(n);
  aRe.set(toF64(a));
  bRe.set(toF64(b));

  fft(aRe, aIm, false);
  fft(bRe, bIm, false);

  const cRe = new Float64Array(n);
  const cIm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cRe[i] = aRe[i] * bRe[i] - aIm[i] * bIm[i];
    cIm[i] = aRe[i] * bIm[i] + aIm[i] * bRe[i];
  }
  fft(cRe, cIm, true);

  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = cRe[i];
  return out;
}

function circularCorrelate(a: HRRVector, bundle: HRRVector): HRRVector {
  // Inverse convolution = correlate: FFT(a)* x FFT(b), where * = conjugate
  const n = nextPow2(a.length);
  const aRe = new Float64Array(n);
  const aIm = new Float64Array(n);
  const bRe = new Float64Array(n);
  const bIm = new Float64Array(n);
  aRe.set(toF64(a));
  bRe.set(toF64(bundle));

  fft(aRe, aIm, false);
  fft(bRe, bIm, false);

  const cRe = new Float64Array(n);
  const cIm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // conjugate of a
    const aConjRe = aRe[i];
    const aConjIm = -aIm[i];
    cRe[i] = aConjRe * bRe[i] - aConjIm * bIm[i];
    cIm[i] = aConjRe * bIm[i] + aConjIm * bRe[i];
  }
  fft(cRe, cIm, true);

  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = cRe[i];
  return out;
}

function cosineSimilarity(a: HRRVector, b: HRRVector): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class HolographicMemory {
  private items: Map<string, HRRVector> = new Map();
  private dim: number;

  constructor(dim: number = 512) {
    this.dim = dim;
  }

  /** Encode an item as a random unit-normalized vector */
  encode(item: string): HRRVector {
    if (this.items.has(item)) return this.items.get(item)!;
    const vec = new Float32Array(this.dim);
    let norm = 0;
    for (let i = 0; i < this.dim; i++) {
      vec[i] = (Math.random() * 2 - 1);
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < this.dim; i++) vec[i] /= norm;
    this.items.set(item, vec);
    return vec;
  }

  /** Bind two vectors via circular convolution */
  bind(a: HRRVector, b: HRRVector): HRRVector {
    return circularConvolve(a, b);
  }

  /** Unbind via circular correlation (approximate inverse) */
  unbind(a: HRRVector, bundle: HRRVector): HRRVector {
    return circularCorrelate(a, bundle);
  }

  /** Query a bundle with a probe, returning similarity scores against known items */
  query(bundle: HRRVector, probe: HRRVector): number {
    const unbound = this.unbind(probe, bundle);
    return cosineSimilarity(probe, unbound);
  }

  /** Look up a stored item by name */
  getVector(item: string): HRRVector | undefined {
    return this.items.get(item);
  }

  /** Get all stored item names */
  listItems(): string[] {
    return [...this.items.keys()];
  }

  /** Get the vector dimension */
  getDimension(): number {
    return this.dim;
  }
}
