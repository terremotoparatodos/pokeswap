// City Mapping Lab — editor state (DEV only).
//
// Owns the baseline (frozen, from the production `TownDef`), the undo history
// of working copies, the selection, the active tool and the debug layers.
// Components only render this and call its actions; the rules live in the
// pure domain modules.

import { computed, markRaw, reactive, ref, shallowRef, watch } from 'vue'
import { HEARTHOME, LOBBY_ID } from '../../wildlands/areas/atlas'
import type { Dir } from '../../wildlands/engine/characters'
import { EDIT_LENSES, type EditLens } from '../world/labProjection'
import type { Tile } from '../../wildlands/engine/pathfinding'
import { applyPatch, diffCities, parsePatch, patchIsEmpty, patchSummary, serializePatch } from '../domain/cityPatch'
import { CityGrid } from '../domain/cityGrid'
import { clearanceMap } from '../domain/clearance'
import {
  addBuilding, addProp, addWanderer, canDelete, deleteEntity, duplicateEntity, editBuilding, moveEntity, paintTerrain, previewAdd, previewAddBuilding,
  setFacing, setSignText, type BuildingChanges, type EditResult,
} from '../domain/editOps'
import { buildingTemplate } from '../domain/buildingCatalog'
import { deepFreeze, entityExists, fromTownDef, type EntityRef, type LabCity, type LabPropKind, type TerrainKind } from '../domain/labCity'
import { clearDraft, loadDraft, saveDraft, type DraftStore, type LabDraft } from '../domain/labDraft'
import { loadPrefs, savePrefs } from '../domain/labPrefs'
import { addAnchor } from '../domain/editOps'
import { isCityTreeId, treeVariantForTile } from '../../worldAssets/trees/cityTrees'
import { clampZoom } from '../world/editorCamera'
import { LabHistory } from '../domain/labHistory'
import { countBySeverity, validateMap, type Finding } from '../domain/validateMap'
import { PALETTE } from '../domain/labCatalog'
import { DEFAULT_LAYERS, type LayerToggles } from '../world/labOverlay'

export type LabMode = 'edit' | 'play'
export type LabTool = 'select' | 'add' | 'terrain'
/**
 * `random-tree`: a city tree variant picked from the tile (same tile → same tree).
 * `art:…` / `block:…`: a building template (buildingCatalog.ts).
 */
export type PaletteChoice = LabPropKind | 'wanderer' | 'random-tree' | `art:${string}` | `block:${string}`
export type StatusTone = 'ok' | 'warn' | 'error' | 'info'

const DRAFT_DELAY_MS = 700

function browserStore(): DraftStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isPaletteChoice(value: unknown): value is PaletteChoice {
  return value === 'random-tree' || value === 'wanderer' || (typeof value === 'string' && buildingTemplate(value) !== null) || isCityTreeId(value) || (typeof value === 'string' && PALETTE.some(p => p.kind === value))
}

export function useCityLab() {
  const base = HEARTHOME
  const baseline: LabCity = deepFreeze(fromTownDef(base))
  const history = new LabHistory(baseline)
  const city = shallowRef<LabCity>(baseline)
  const revision = ref(0)
  const mode = ref<LabMode>('edit')
  const tool = ref<LabTool>('select')
  const store = browserStore()
  const prefs = loadPrefs(store)
  const palette = ref<PaletteChoice>(isPaletteChoice(prefs.palette) ? prefs.palette : 'city-tree-pointed')
  const terrainKind = ref<TerrainKind>('g')
  const brushSize = ref<1 | 3>(1)
  const layers = reactive<LayerToggles>({ ...DEFAULT_LAYERS })
  const selection = shallowRef<EntityRef | null>(null)
  const status = shallowRef<{ text: string; tone: StatusTone } | null>(null)
  const findings = shallowRef<readonly Finding[] | null>(null)
  const findingsStale = ref(false)
  const highlight = shallowRef<readonly Tile[]>([])
  const hover = shallowRef<Tile | null>(null)
  /** Time of day for both modes (atmosphere.ts clock: 0.5 noon, 0.75 sunset, 0 midnight). */
  const clock = ref(0.4)
  /** EDIT camera: a near top-down lens by default; PLAY always uses the town's own lens. */
  const editLens = ref<EditLens>(prefs.lens && prefs.lens in EDIT_LENSES ? (prefs.lens as EditLens) : 'plan')
  const zoom = ref(clampZoom(prefs.zoom ?? 1))
  /**
   * EDIT camera focus in world pixels. Moved every frame while panning, so it
   * is a plain object (no reactivity); the stage reads and writes it.
   */
  const editCamera = markRaw({
    x: prefs.camX ?? baseline.spawn.tx * 16 + 8,
    y: prefs.camY ?? baseline.spawn.ty * 16 + 8,
  })
  /** Where PLAY starts: the working copy's spawn unless a tile was chosen. */
  const playFrom = shallowRef<Tile | null>(null)
  const pendingDraft = shallowRef<LabDraft | null>(null)
  const draftSavedAt = ref<string | null>(null)

  // Derived views of the current copy, rebuilt only when it changes.
  const grid = computed(() => new CityGrid(city.value, base))
  const clearance = computed(() => (layers.clearance ? clearanceMap(grid.value) : null))
  const patch = computed(() => diffCities(baseline, city.value, LOBBY_ID))
  const summary = computed(() => patchSummary(patch.value))
  const dirty = computed(() => !patchIsEmpty(patch.value))

  function commit(next: LabCity, ref: EntityRef | null | undefined = undefined): void {
    history.push(next)
    city.value = history.current
    revision.value++
    if (ref !== undefined) selection.value = ref
    if (selection.value && !entityExists(city.value, selection.value)) selection.value = null
    if (findings.value) findingsStale.value = true
  }

  function say(text: string, tone: StatusTone = 'info'): void {
    status.value = { text, tone }
  }

  /** Commits an operation result, or explains why it was refused. */
  function apply(result: EditResult, done: string): boolean {
    if (!result.ok) {
      say(`✖ ${result.errors.join(' ')}`, 'error')
      return false
    }
    commit(result.city, result.ref ?? null)
    say(result.warnings.length ? `⚠ ${done}. ${result.warnings.join(' ')}` : `✔ ${done}.`, result.warnings.length ? 'warn' : 'ok')
    return true
  }

  function select(ref: EntityRef | null): void {
    selection.value = ref
  }

  function moveTo(ref: EntityRef, to: Tile): boolean {
    return apply(moveEntity(base, city.value, ref, to), `Movido a (${to.tx}, ${to.ty})`)
  }

  /** The prop kind the palette would place at the cursor tile (resolves "Árbol aleatorio"). */
  function paletteKind(at: Tile): LabPropKind | null {
    const choice = palette.value
    if (choice === 'wanderer' || buildingTemplate(choice)) return null
    if (choice !== 'random-tree') return choice as LabPropKind
    const cell = addAnchor('city-tree-pointed', at)
    return treeVariantForTile(cell.tx, cell.ty)
  }

  /** What the Agregar tool would place with the cursor on `at` (footprint, solid part, validity). */
  function previewAt(at: Tile): { tiles: Tile[]; solid: Tile[]; valid: boolean; reason: string } | null {
    const choice = palette.value
    if (buildingTemplate(choice)) return previewAddBuilding(base, city.value, choice, at)
    const kind = paletteKind(at)
    return kind ? previewAdd(base, city.value, kind, at) : null
  }

  function addAt(at: Tile): boolean {
    const template = buildingTemplate(palette.value)
    if (template) return apply(addBuilding(base, city.value, template.id, at), `Edificio "${template.label}" agregado`)
    if (palette.value === 'wanderer') return apply(addWanderer(base, city.value, at), `Wanderer agregado en (${at.tx}, ${at.ty})`)
    const kind = paletteKind(at)!
    return apply(addProp(base, city.value, kind, at), `${kind} agregado en (${at.tx}, ${at.ty})`)
  }

  let prefsTimer: ReturnType<typeof setTimeout> | null = null
  /** Remembers the editor view and palette choice (browser-local, never in a patch). */
  function rememberView(): void {
    if (prefsTimer) clearTimeout(prefsTimer)
    prefsTimer = setTimeout(() => {
      prefsTimer = null
      savePrefs(store, { camX: Math.round(editCamera.x), camY: Math.round(editCamera.y), zoom: zoom.value, lens: editLens.value, palette: palette.value })
    }, 400)
  }
  watch([zoom, editLens, palette], rememberView)

  function deleteSelected(): void {
    const ref = selection.value
    if (!ref) return
    if (!canDelete(ref)) {
      say('✖ El PLAYER SPAWN no se borra: la ciudad necesita uno. Movelo.', 'error')
      return
    }
    apply(deleteEntity(city.value, ref), `${ref.id} borrado`)
  }

  function duplicateSelected(): void {
    const ref = selection.value
    if (ref) apply(duplicateEntity(base, city.value, ref), `${ref.id} duplicado`)
  }

  /** Inspector edits on the selected building (name, text, function, door, look, size). */
  function editSelectedBuilding(changes: BuildingChanges, done = 'Edificio actualizado'): boolean {
    const ref = selection.value
    if (ref?.type !== 'building') return false
    return apply(editBuilding(base, city.value, ref.id, changes), done)
  }

  function paint(tiles: readonly Tile[]): void {
    const next = paintTerrain(city.value, tiles, terrainKind.value)
    if (next === city.value) return
    commit(next)
    say(`✔ Terreno pintado (${tiles.length} tiles).`, 'ok')
  }

  function editSign(id: string, text: string): void {
    commit(setSignText(city.value, id, text))
  }

  function face(ref: EntityRef, dir: Dir): void {
    commit(setFacing(city.value, ref, dir))
  }

  function undo(): void {
    if (!history.canUndo) return
    city.value = history.undo()
    revision.value++
    if (selection.value && !entityExists(city.value, selection.value)) selection.value = null
    say('↶ Deshecho.')
  }

  function redo(): void {
    if (!history.canRedo) return
    city.value = history.redo()
    revision.value++
    say('↷ Rehecho.')
  }

  function resetToBaseline(): void {
    history.reset(baseline)
    city.value = baseline
    revision.value++
    selection.value = null
    findings.value = null
    highlight.value = []
    clearDraft(store)
    draftSavedAt.value = null
    say('Working copy reiniciada a la baseline. El LOCAL DRAFT se borró.', 'info')
  }

  function validate(): void {
    findings.value = validateMap(city.value, base)
    findingsStale.value = false
    const c = countBySeverity(findings.value)
    say(`Validate Map: ${c.error} errores · ${c.warning} avisos · ${c.info} info.`, c.error ? 'error' : c.warning ? 'warn' : 'ok')
  }

  function exportPatch(): string {
    return serializePatch(patch.value)
  }

  /** Replaces the working copy with baseline + patch (one undo step). */
  function importPatch(text: string): { ok: boolean; message: string } {
    const parsed = parsePatch(text)
    if (!parsed.ok) return { ok: false, message: parsed.error }
    const result = applyPatch(baseline, parsed.value)
    if (!result.ok) return { ok: false, message: result.errors.join('\n') }
    commit(result.city, null)
    const message = result.conflicts.length ? `Importado con conflictos:\n${result.conflicts.join('\n')}` : `Importado: ${patchSummary(patch.value)}`
    say(message.split('\n')[0], result.conflicts.length ? 'warn' : 'ok')
    return { ok: true, message }
  }

  // LOCAL DRAFT: offered on load, autosaved while editing, never applied silently.
  const found = loadDraft(store)
  if (found) pendingDraft.value = found

  function restoreDraft(): void {
    const draft = pendingDraft.value
    if (!draft) return
    const result = importPatch(draft.patch)
    pendingDraft.value = null
    if (!result.ok) say(`✖ El LOCAL DRAFT no se pudo cargar: ${result.message}`, 'error')
    else draftSavedAt.value = draft.savedAt
  }

  function discardDraft(): void {
    pendingDraft.value = null
    clearDraft(store)
  }

  let draftTimer: ReturnType<typeof setTimeout> | null = null
  watch(revision, () => {
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      draftTimer = null
      // Editing without restoring declines the old draft: this session's copy replaces it.
      if (pendingDraft.value) pendingDraft.value = null
      if (!dirty.value) {
        clearDraft(store)
        draftSavedAt.value = null
      } else if (saveDraft(store, exportPatch(), new Date())) draftSavedAt.value = new Date().toISOString()
    }, DRAFT_DELAY_MS)
  })

  function dispose(): void {
    if (draftTimer) clearTimeout(draftTimer)
    if (prefsTimer) clearTimeout(prefsTimer)
  }

  return {
    base, baseline, city, revision, grid, clearance, patch, summary, dirty,
    mode, tool, palette, terrainKind, brushSize, layers, selection, status, findings, findingsStale, highlight,
    hover, clock, editLens, zoom, editCamera, playFrom, paletteKind, previewAt, rememberView,
    pendingDraft, draftSavedAt,
    canUndo: computed(() => revision.value >= 0 && history.canUndo),
    canRedo: computed(() => revision.value >= 0 && history.canRedo),
    select, moveTo, addAt, deleteSelected, duplicateSelected, editSelectedBuilding, paint, editSign, face, undo, redo, resetToBaseline,
    validate, exportPatch, importPatch, restoreDraft, discardDraft, say, dispose,
  }
}

export type CityLab = ReturnType<typeof useCityLab>
