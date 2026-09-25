export interface DemoSkillPolicy {
  readonly settled: Map<string, { playerId: string; nodeId: string }>
  readonly cancelled: { actionId: string; playerId: string; reason: string }[]
  readonly authorized: string[]
  readonly grants: number
}
export declare function createDemoSkillPolicy(options?: { durationMs?: number; failSettlements?: number; refuse?: (attempt: unknown) => string | null }): DemoSkillPolicy
