// PokeSwap's own move-effect vocabulary (R32.1).
//
// The catalog must say *what a move does* in words our own battle rules will
// execute later (R32.3). We do not vendor anyone's engine: this maps the
// structured columns of the source tables — damage class, meta category,
// ailment, hit counts, drain, flags — onto a small taxonomy of our own, and
// marks everything it cannot express yet as unsupported instead of guessing.
//
// Showdown's `data/mods/gen6` was read as a *reference* while writing this, to
// check that the categories mean what we think they mean. No code or data from
// it is copied here.

/** Every effect id PokeSwap's catalog can emit. */
export const EFFECT_IDS = [
  'damage',
  'damage.multiHit',
  'damage.drain',
  'damage.recoil',
  'damage.selfKo',
  'damage.recharge',
  'damage.ailment',
  'damage.statChange',
  'damage.flinch',
  'ailment',
  'statChange',
  'heal',
  'protect',
  'ohko',
  'forceSwitch',
  'fieldEffect.side',
  'fieldEffect.all',
  'unique',
]

/**
 * Effects R32.3 is expected to be able to run with the rules the prototype
 * already has. Everything else is carried in the catalog with `supported:
 * false` so a move is never silently treated as a plain hit.
 */
export const SUPPORTED_EFFECTS = new Set([
  'damage',
  'damage.multiHit',
  'damage.drain',
  'damage.ailment',
  'damage.statChange',
  'damage.flinch',
  'ailment',
  'statChange',
  'heal',
  'protect',
])

/** Effects that additionally need resolved stat metadata to be runnable. */
const NEEDS_STAT_CHANGES = new Set(['statChange', 'damage.statChange'])

/** Major statuses our rules model; the rest are volatiles we do not run yet. */
export const SUPPORTED_AILMENTS = new Set(['paralysis', 'sleep', 'freeze', 'burn', 'poison', 'confusion'])

const BY_CATEGORY = {
  damage: 'damage',
  ailment: 'ailment',
  'net-good-stats': 'statChange',
  heal: 'heal',
  'damage+ailment': 'damage.ailment',
  swagger: 'damage.ailment',
  'damage+lower': 'damage.statChange',
  'damage+raise': 'damage.statChange',
  'damage+heal': 'damage.drain',
  ohko: 'ohko',
  'whole-field-effect': 'fieldEffect.all',
  'field-effect': 'fieldEffect.side',
  'force-switch': 'forceSwitch',
  unique: 'unique',
}

/**
 * The effect of one move, in our words.
 *
 * `input` carries the already-normalised columns: damage class, meta category
 * and ailment identifiers, hit counts, drain, flinch chance and the move's
 * flags. `sourceEffectId` is kept so a later phase can always go back to the
 * row this came from.
 */
export function describeEffect(input) {
  const {
    category, ailment, minHits, maxHits, flinchChance, drain, sourceEffectId, flags, identifier,
    damageClass, power, statChanges, statChangeReason,
  } = input

  // Protect and its family block instead of acting; the source tables file them
  // under "field effect", which is true but useless to a battle engine.
  const protectLike = identifier === 'protect' || identifier === 'detect' || identifier === 'kings-shield'
    || identifier === 'spiky-shield' || identifier === 'baneful-bunker' || identifier === 'quick-guard'
    || identifier === 'wide-guard' || identifier === 'crafty-shield' || identifier === 'mat-block'

  let effectId = protectLike ? 'protect' : (BY_CATEGORY[category] ?? 'unique')

  if (effectId === 'damage') {
    // Order matters: a move is first what it *costs* the user, then how it
    // hits. `drain` is negative for recoil in the source tables, and effect 8
    // is the family that knocks the user out (Explosion, Self-Destruct).
    if (sourceEffectId === 8) effectId = 'damage.selfKo'
    else if ((drain ?? 0) < 0) effectId = 'damage.recoil'
    else if (flags.includes('recharge')) effectId = 'damage.recharge'
    else if ((maxHits ?? 1) > 1 || (minHits ?? 1) > 1) effectId = 'damage.multiHit'
    else if (flinchChance > 0) effectId = 'damage.flinch'
  }

  // A damaging move with no power in the table computes its own: Seismic Toss,
  // Low Kick, Return, Gyro Ball, the counters. Each needs its own formula, so
  // the catalog says so instead of letting a rule read `null` as zero.
  const variablePower = damageClass !== 'status' && power === null

  // A stat-changing move is only runnable once the two pinned sources agree on
  // stat, amount, recipient and probability. Saying "supported" without that
  // would mean a rule reading a number nobody wrote down.
  const statChangesMissing = NEEDS_STAT_CHANGES.has(effectId) && !statChanges

  const ailmentSupported = ailment === 'none' || SUPPORTED_AILMENTS.has(ailment)
  const supported = SUPPORTED_EFFECTS.has(effectId)
    && !statChangesMissing
    && ailmentSupported
    && ailment !== 'unknown'
    // A charging or recharging move spends a turn we do not model yet; in a
    // realtime bar each needs its own rule (R32.3).
    && !flags.includes('charge')
    && !flags.includes('recharge')
    && !variablePower

  return {
    effectId,
    supported,
    /** Why it is not runnable yet, so the gap is legible without re-deriving it. */
    unsupportedReason: supported
      ? undefined
      : !SUPPORTED_EFFECTS.has(effectId) ? `effect ${effectId}`
        : statChangesMissing ? `stat changes: ${statChangeReason ?? 'not stated'}`
          : variablePower ? 'variable power'
            : flags.includes('charge') ? 'charge turn'
              : flags.includes('recharge') ? 'recharge turn'
                : `ailment ${ailment}`,
  }
}
