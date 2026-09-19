// Where an authoritative battle's randomness comes from (R32.4).
//
// The rules take an `RngState` — a seed and a cursor — and evolve it purely.
// That is deliberate and it does not change here. What changes is **who picks
// the seed**: from R32.4 on, the server does, always, and the client never
// sends one. A client that chose the seed could roll the battle offline until
// it found one where every capture lands, and then play it.
//
// AGENTS §11 already says it: randomness that moves ownership, rarity or
// reward is generated server-side. A capture is all three.
//
// The unsafe part of picking a seed is the only part that is not pure, so it
// sits behind this interface and nowhere else. Production uses the runtime's
// CSPRNG; a test injects a constant and gets the same battle every time.
// `Math.random()` appears in neither.

export interface AuthoritySeedSource {
  /** A fresh 32-bit unsigned seed. Never derived from a client value. */
  createSeed(): number
}

/**
 * The production source: `crypto.getRandomValues`, which exists in Node 19+,
 * in Deno, in workers and in browsers.
 *
 * Why a CSPRNG rather than a counter: the seed decides whether a capture lands,
 * and a predictable seed is a predictable capture. It is cheap to be correct
 * here, so it is not worth arguing about what an attacker could really do with
 * a guessable one.
 *
 * It throws when no CSPRNG is available rather than falling back to something
 * weaker, because a silent fallback is exactly how a weak seed reaches
 * production unnoticed.
 */
export function createRuntimeSeedSource(): AuthoritySeedSource {
  return {
    createSeed() {
      const source = globalThis.crypto
      if (!source?.getRandomValues) {
        throw new Error('no CSPRNG available: an authoritative seed cannot be generated here')
      }
      const buffer = new Uint32Array(1)
      source.getRandomValues(buffer)
      return buffer[0] >>> 0
    },
  }
}

/** A test's source: the same battle, every run. Never used in production. */
export function createFixedSeedSource(seed: number): AuthoritySeedSource {
  const value = seed >>> 0
  return { createSeed: () => value }
}

/** A test's source that walks a list, for two battles that must differ. */
export function createSequenceSeedSource(seeds: readonly number[]): AuthoritySeedSource {
  if (seeds.length === 0) throw new Error('a seed sequence needs at least one seed')
  let index = 0
  return {
    createSeed: () => {
      const seed = seeds[Math.min(index, seeds.length - 1)] >>> 0
      index += 1
      return seed
    },
  }
}
