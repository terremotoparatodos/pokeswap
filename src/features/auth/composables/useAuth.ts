// Singleton reactive auth state — R07.
//
// All components share the same user/profile refs; one subscription to
// onAuthStateChange keeps them in sync (INV-ID-1).

import { ref, readonly } from 'vue'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '../../../shared/types/database'
import { supabase } from '../../../shared/api/supabase'
import { getProfile } from '../api/authApi'

const user = ref<User | null>(null)
const profile = ref<Profile | null>(null)
const isLoading = ref(true)

async function syncState(u: User | null): Promise<void> {
  user.value = u
  profile.value = u ? await getProfile(u.id) : null
}

// Initialize once at module load — shared across all useAuth() calls.
supabase.auth.getSession().then(({ data }) => {
  syncState(data.session?.user ?? null).finally(() => {
    isLoading.value = false
  })
})

supabase.auth.onAuthStateChange((_, session) => {
  syncState(session?.user ?? null)
})

export function useAuth() {
  return {
    user: readonly(user),
    profile: readonly(profile),
    isLoading: readonly(isLoading),
  }
}
