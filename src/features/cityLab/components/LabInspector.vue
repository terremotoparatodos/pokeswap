<script setup lang="ts">
// City Mapping Lab — properties of the selected entity, and hover info.

import { computed } from 'vue'
import type { Dir } from '../../wildlands/engine/characters'
import { canDelete, canDuplicate } from '../domain/editOps'
import { isSolidKind, propLabel, TERRAIN_LABEL } from '../domain/labCatalog'
import { isStreetProp, terrainAt, tilesOf, type TerrainKind } from '../domain/labCity'
import type { CityLab } from '../state/useCityLab'

const props = defineProps<{ lab: CityLab }>()
const emit = defineEmits<{ focus: [tx: number, ty: number] }>()
const lab = props.lab
const DIRS: Dir[] = ['down', 'up', 'left', 'right']

interface Row { label: string; value: string }

const info = computed(() => {
  const ref = lab.selection.value
  const city = lab.city.value
  const grid = lab.grid.value
  if (!ref) return null
  const rows: Row[] = [{ label: 'id', value: ref.id }, { label: 'tipo', value: ref.type }]
  let facing: Dir | null = null
  let sign: { id: string; text: string } | null = null
  const tiles = tilesOf(city, ref)
  switch (ref.type) {
    case 'prop': {
      const p = city.props.find(x => x.id === ref.id)
      if (!p) return null
      rows.push(
        { label: 'kind', value: `${p.kind} (${propLabel(p.kind)})` },
        { label: 'tx, ty', value: `${p.tx}, ${p.ty}` },
        { label: 'sólido', value: isSolidKind(p.kind) ? 'sí' : 'NO — se atraviesa' },
        { label: 'familia', value: isStreetProp(p.kind) ? 'mobiliario de ciudad (TownDef)' : 'objeto del mundo (fuera de TownDef)' },
      )
      if (p.board) rows.push({ label: 'tablón', value: 'abre el tablón de actividad' })
      if (p.kind === 'sign') sign = { id: p.id, text: p.text ?? '' }
      break
    }
    case 'building': {
      const b = city.buildings.find(x => x.id === ref.id)
      if (!b) return null
      rows.push(
        { label: 'nombre', value: b.name },
        { label: 'estilo', value: b.style },
        { label: 'x, y', value: `${b.x}, ${b.y}` },
        { label: 'footprint', value: `${b.w} × ${b.d} tiles (sólido)` },
        { label: 'puerta', value: b.door ? `${b.door.tx}, ${b.door.ty} → sale a ${b.door.tx}, ${b.door.ty + 1}` : '—' },
        { label: 'feature', value: b.feature ?? '—' },
        { label: 'tiles abiertos', value: b.open?.map(t => `${t.tx},${t.ty}`).join(' ') || '—' },
        { label: 'arte', value: b.image?.src ?? 'pintado en código' },
      )
      break
    }
    case 'fountain': {
      const f = city.fountains.find(x => x.id === ref.id)
      if (!f) return null
      rows.push({ label: 'rect', value: `${f.x0},${f.y0} → ${f.x1},${f.y1} (sólido)` })
      break
    }
    case 'gate':
    case 'arrival': {
      const g = city.gates.find(x => x.id === ref.id)
      if (!g) return null
      rows.push(
        { label: 'destino', value: g.label },
        { label: 'tiles portal', value: g.tiles.map(t => `${t.tx},${t.ty}`).join(' ') },
        { label: 'llegada', value: `${g.arrival.tx}, ${g.arrival.ty} (${g.arrival.dir})` },
      )
      if (ref.type === 'arrival') facing = g.arrival.dir
      break
    }
    case 'spawn':
      rows.push({ label: 'tx, ty', value: `${city.spawn.tx}, ${city.spawn.ty}` }, { label: 'vecinos caminables', value: String(grid.openNeighbours(city.spawn.tx, city.spawn.ty)) })
      facing = city.spawn.dir
      break
    case 'resident': {
      const r = city.residents.find(x => x.id === ref.id)
      if (!r) return null
      rows.push({ label: 'tx, ty', value: `${r.tx}, ${r.ty}` }, { label: 'dice', value: r.lines.join(' / ') })
      facing = r.dir
      break
    }
    case 'wanderer': {
      const w = city.wanderers.find(x => x.id === ref.id)
      if (!w) return null
      rows.push({ label: 'tx, ty (casa)', value: `${w.tx}, ${w.ty}` })
      break
    }
  }
  const solidTiles = tiles.filter(t => grid.solid(t.tx, t.ty)).length
  rows.push({ label: 'tiles', value: `${tiles.length} (${solidTiles} sólidos en el motor)` })
  return { rows, facing, sign, ref, anchor: tiles[0] }
})

const hoverInfo = computed(() => {
  const t = lab.hover.value
  if (!t) return null
  const grid = lab.grid.value
  const kind = terrainAt(lab.city.value, t.tx, t.ty) as TerrainKind | null
  const parts = [`(${t.tx}, ${t.ty})`, kind ? TERRAIN_LABEL[kind] : '', grid.solid(t.tx, t.ty) ? 'SÓLIDO' : 'caminable']
  const building = grid.building(t.tx, t.ty)
  if (building) parts.push(`edificio ${building}`)
  const props = grid.props(t.tx, t.ty)
  if (props.length) parts.push(props.join(', '))
  if (grid.portal(t.tx, t.ty)) parts.push(`portal ${grid.portal(t.tx, t.ty)}`)
  if (grid.door(t.tx, t.ty)) parts.push(`puerta de ${grid.door(t.tx, t.ty)!.buildingId}`)
  if (lab.clearance.value && !grid.solid(t.tx, t.ty)) parts.push(`ancho ${lab.clearance.value[t.ty * grid.width + t.tx]}`)
  return parts.filter(Boolean).join(' · ')
})

function playHere(): void {
  const i = info.value
  if (!i?.anchor) return
  lab.playFrom.value = { ...i.anchor }
  lab.mode.value = 'play'
}
</script>

<template>
  <aside class="insp">
    <h3>Propiedades</h3>
    <p v-if="!info" class="muted">Nada seleccionado. Click sobre un objeto, edificio, NPC, portal o el spawn.</p>
    <template v-else>
      <dl>
        <template v-for="r in info.rows" :key="r.label">
          <dt>{{ r.label }}</dt>
          <dd>{{ r.value }}</dd>
        </template>
      </dl>
      <label v-if="info.facing" class="field">Mira hacia
        <select :value="info.facing" @change="lab.face(info.ref, ($event.target as HTMLSelectElement).value as Dir)">
          <option v-for="d in DIRS" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>
      <label v-if="info.sign" class="field">Texto del cartel
        <input :value="info.sign.text" maxlength="120" @change="lab.editSign(info.sign.id, ($event.target as HTMLInputElement).value)">
      </label>
      <div class="actions">
        <button type="button" @click="info.anchor && emit('focus', info.anchor.tx, info.anchor.ty)">Centrar</button>
        <button type="button" :disabled="!canDuplicate(info.ref)" title="Ctrl+D" @click="lab.duplicateSelected()">Duplicar</button>
        <button type="button" :disabled="!canDelete(info.ref)" title="Supr" @click="lab.deleteSelected()">{{ info.ref.type === 'arrival' ? 'Borrar portal' : 'Borrar' }}</button>
        <button type="button" @click="playHere()">▶ Jugar desde acá</button>
      </div>
      <p class="muted">Flechas: mover 1 tile. Arrastrar: mover con snap.</p>
    </template>

    <h3>Capas</h3>
    <div class="layers">
      <label><input v-model="lab.layers.grid" type="checkbox"> Grid (G)</label>
      <label><input v-model="lab.layers.coords" type="checkbox"> Coordenadas</label>
      <label><input v-model="lab.layers.solids" type="checkbox"> Sólidos</label>
      <label><input v-model="lab.layers.walkable" type="checkbox"> Caminable</label>
      <label><input v-model="lab.layers.footprints" type="checkbox"> Footprints / puertas</label>
      <label><input v-model="lab.layers.bounds" type="checkbox"> Sprite bounds / tap hitbox</label>
      <label><input v-model="lab.layers.accesses" type="checkbox"> <b>Entradas y salidas</b></label>
      <label><input v-model="lab.layers.markers" type="checkbox"> Spawn / NPC</label>
      <label><input v-model="lab.layers.trees" type="checkbox"> Árboles: F bosque / P placed</label>
      <label><input v-model="lab.layers.clearance" type="checkbox"> Anchos (multijugador)</label>
      <label><input v-model="lab.layers.zones" type="checkbox"> Plazas / manzanas</label>
    </div>
    <p v-if="lab.layers.clearance" class="legend">
      <i style="background:#e62828" /> 1 tile <i style="background:#f5961e" /> 2 <i style="background:#f0dc28" /> 3 <i style="background:#3cc85a" /> 4+ plaza
    </p>
    <p class="hover">{{ hoverInfo ?? 'Pasá el mouse por el mapa.' }}</p>
  </aside>
</template>

<style scoped>
.insp { overflow-y: auto; padding: 10px; background: #111626; border-left: 1px solid #2a3350; color: #dfe7ff; font: 12px system-ui, sans-serif; }
h3 { margin: 4px 0 6px; font-size: 13px; color: #ffd84a; }
h3 + * { margin-top: 0; }
.muted { color: #8f9bc4; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin: 0 0 8px; }
dt { color: #8f9bc4; }
dd { margin: 0; word-break: break-word; }
.field { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; color: #8f9bc4; }
.field input, .field select { padding: 4px 6px; border: 1px solid #34406a; border-radius: 5px; background: #1d2540; color: #dfe7ff; }
.actions { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.actions button { padding: 4px 8px; border: 1px solid #34406a; border-radius: 6px; background: #1d2540; color: #dfe7ff; cursor: pointer; }
.actions button:disabled { opacity: 0.4; cursor: default; }
.layers { display: grid; gap: 3px; margin-bottom: 8px; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; color: #aab4d4; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.hover { margin-top: 10px; padding: 6px; border-radius: 6px; background: #0b0f1a; color: #cfe0ff; font-family: ui-monospace, monospace; }
</style>
