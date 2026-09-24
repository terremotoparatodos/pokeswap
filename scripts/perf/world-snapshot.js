// Evaluated inside a measurement page (headless-capture --dump): what this
// client believes the shared world looks like around its player. Used to
// compare two clients standing in the same place. Reads engine internals
// through the VITE_PERF-only handle; changes nothing.
(() => {
  const g = window.__pokeswapPerf.game
  const near = a => Math.abs(a.tx - g.player.tx) <= 20 && Math.abs(a.ty - g.player.ty) <= 20
  const describe = a => ({
    id: a.id, kind: a.kind, tx: a.tx, ty: a.ty,
    species: a.pokemon ? a.pokemon.id : null, shiny: a.pokemon ? a.pokemon.shiny : null,
    wild: Boolean(a.wild), stationary: Boolean(a.stationary),
  })
  return JSON.stringify({
    area: g.area.id,
    player: { tx: g.player.tx, ty: g.player.ty },
    clock: Math.round(g.clock * 1000) / 1000,
    weather: { kind: g.weather.kind, intensity: Math.round(g.weather.intensity * 100) / 100 },
    wildPoolSize: g.wildPokemonIds.length,
    populace: g.populace.actors.filter(near).map(describe).sort((a, b) => a.id.localeCompare(b.id)),
    remotes: g.remoteActors.map(a => ({ id: a.id, tx: a.tx, ty: a.ty, trainerLoaded: a.trainer !== g.renderer.playerSprites })),
  })
})()
