import { describe, expect, it, vi, afterEach } from 'vitest'
import { validateLimitedBuild } from './limitedBuildProfile'

const config = () => ({ NODE_ENV: 'production', VITE_ECO_RELEASE: 'limited', VITE_ECO_EXPERIMENT: 'on', VITE_PLAYTEST: 'on',
  VITE_REALTIME_URL: 'wss://realtime-scripted.invalid', VITE_SUPABASE_URL: 'https://auth-scripted.invalid', VITE_SUPABASE_ANON_KEY: 'SCRIPTED-publishable' })
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
describe('explicit limited build', () => {
  it('rejects recognizable private keys by content before any build, including normal builds', () => {
    const jwt = (role: string) => `${btoa('{"alg":"HS256"}')}.${btoa(JSON.stringify({ role })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.SCRIPTED_FAKE_SIGNATURE`
    for (const key of ['sb_secret_' + 'A'.repeat(32), jwt('service_role')]) {
      for (const env of [{ ...config(), VITE_SUPABASE_ANON_KEY: key }, { NODE_ENV: 'production', VITE_SUPABASE_ANON_KEY: key }]) {
        expect(() => validateLimitedBuild(env)).toThrow('public configuration: VITE_SUPABASE_ANON_KEY')
      }
    }
    for (const key of ['sb_publishable_SCRIPTED_NOT_REAL', jwt('anon'), 'SCRIPTED-public-placeholder']) expect(() => validateLimitedBuild({ ...config(), VITE_SUPABASE_ANON_KEY: key })).not.toThrow()
  })
  it('rejects incomplete configurations, dev tools and insecure endpoints', () => {
    expect(() => validateLimitedBuild(config())).not.toThrow()
    expect(() => validateLimitedBuild({ NODE_ENV: 'production' })).not.toThrow()
    for (const name of ['NODE_ENV', 'VITE_ECO_EXPERIMENT', 'VITE_PLAYTEST', 'VITE_REALTIME_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      expect(() => validateLimitedBuild({ ...config(), [name]: undefined })).toThrow(name)
    }
    for (const [name, value] of [['VITE_ECO_RELEASE', 'typo'], ['NODE_ENV', 'development'], ['VITE_PERF', 'on'], ['VITE_PRESENCE_BENCHMARK', 'on'], ['VITE_REALTIME_URL', 'ws://localhost:2567']]) {
      expect(() => validateLimitedBuild({ ...config(), [name]: value })).toThrow(name)
    }
  })
  it('keeps production excluded with the old opt-in, and allows only the explicit exception', async () => {
    vi.stubEnv('DEV', false); vi.stubEnv('PROD', true); vi.stubEnv('VITE_ECO_EXPERIMENT', 'on'); vi.stubEnv('VITE_ECO_RELEASE', '')
    expect((await import('./ecoExperiment')).ECO_EXPERIMENT).toBe(false)
    vi.resetModules(); vi.stubEnv('VITE_ECO_RELEASE', 'limited')
    expect((await import('./ecoExperiment')).ECO_EXPERIMENT).toBe(true)
    vi.resetModules(); vi.stubEnv('VITE_ECO_EXPERIMENT', '')
    expect((await import('./ecoExperiment')).ECO_EXPERIMENT).toBe(false)
  })
})
