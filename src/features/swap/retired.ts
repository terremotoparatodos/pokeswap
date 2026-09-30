// Swap — retired (SWAP RETIRE-2).
//
// Swap is withdrawn from the product for good: the client never trades, never
// skips a cooldown and never calls `pokeswap-swap` or `skip_swap_cooldown`.
// Silph Co. keeps its door and says so; the building will later host egg
// research and incubation, which is its own feature and not built here.
// See docs/design/SWAP_RETIRE_2_REPORT.md.

/** What Silph Co. says, in every build, wherever Swap used to open. */
export const SWAP_RETIRED_NOTICE =
  'El intercambio fue retirado. Próximamente este edificio albergará investigación de huevos e incubación.'
