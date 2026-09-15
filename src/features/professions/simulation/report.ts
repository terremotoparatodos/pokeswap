// Plain-text rendering of a simulation report for the CLI and docs.

import { ITEM_BY_ID } from '../domain/catalog/items'
import { PROFESSION_IDS } from '../domain/types'
import type { SimulationReport } from './economySim'

const pad = (value: string | number, width: number) => String(value).padStart(width)

export function formatReport(report: SimulationReport): string {
  const { config } = report
  const lines = [
    `Escenario: ${config.players} jugadores · ${config.days} días · semilla ${config.seed} · nivel inicial ${config.startingLevel} · herramienta T${config.startingToolTier}`,
    `Energía disponible ${report.energy.available} · gastada ${report.energy.spent} (${Math.round((report.energy.spent / Math.max(1, report.energy.available)) * 100)} %)`,
    `Acciones ${report.actions} · horas de gathering ${report.gatheringHours} · acciones a mano ${report.bareHandActions}`,
    `Durabilidad perdida ${report.durability.lost} · reparaciones ${report.durability.repairs} (sin materiales ${report.durability.repairsUnaffordable}) · herramientas equipadas ${report.durability.toolsEquipped} · retiradas ${report.durability.toolsRetired}`,
    '',
    'Niveles por profesión:',
    ...PROFESSION_IDS.map(id => {
      const level = report.levels[id]
      return `  ${id.padEnd(12)} jugadores ${pad(level.players, 3)} · media ${pad(level.average, 5)} · min ${pad(level.min, 2)} · max ${pad(level.max, 2)}`
    }),
    '',
    `${'ítem'.padEnd(20)}${pad('recolect.', 10)}${pad('PvE', 6)}${pad('crafteado', 10)}${pad('→crafting', 10)}${pad('equipado', 9)}${pad('repar.', 8)}${pad('mant.', 7)}${pad('consumo', 8)}${pad('faltante', 9)}${pad('stock', 8)}`,
  ]
  for (const [itemId, flow] of Object.entries(report.items)) {
    const name = ITEM_BY_ID.get(itemId)?.name ?? itemId
    lines.push(`${name.slice(0, 19).padEnd(20)}${pad(flow.gathered, 10)}${pad(flow.pveDropped, 6)}${pad(flow.crafted, 10)}${pad(flow.craftingInput, 10)}${pad(flow.equipped, 9)}${pad(flow.repair, 8)}${pad(flow.maintenance, 7)}${pad(flow.consumption, 8)}${pad(flow.shortage, 9)}${pad(flow.endStock, 8)}`)
  }
  lines.push(
    '',
    `Totales: generado ${report.totals.gathered} · transformado ${report.totals.transformed} · destruido ${report.totals.destroyed} · stock final ${report.totals.endStock} · demanda insatisfecha ${report.totals.shortage}`,
  )
  return lines.join('\n')
}
