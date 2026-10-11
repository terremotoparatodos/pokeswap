import { afterEach, describe, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ createClient: vi.fn(() => ({ SCRIPTED: true })) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); sdk.createClient.mockClear() })
describe('Supabase public configuration, SCRIPTED SDK (no Auth calls)', () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=/g, '')}.SCRIPTED_FAKE_SIGNATURE`
  it.each(['private-prefix', 'service-role'])('blocks %s before constructing the client', async kind => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://auth-scripted.invalid')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', kind === 'private-prefix' ? 'sb_secret_' + 'A'.repeat(32) : jwt('service_role'))
    await expect(import('./supabase')).rejects.toThrow('public configuration: VITE_SUPABASE_ANON_KEY')
    expect(sdk.createClient).not.toHaveBeenCalled()
  })
  it.each(['publishable', 'anon'])('keeps %s compatible with the existing client constructor', async kind => {
    const key = kind === 'publishable' ? 'sb_publishable_SCRIPTED_NOT_REAL' : jwt('anon')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://auth-scripted.invalid'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', key)
    await import('./supabase')
    expect(sdk.createClient).toHaveBeenCalledWith('https://auth-scripted.invalid', key)
  })
})
