// Auth API — R07 service layer.
//
// All auth state changes go through Supabase Auth (INV-ID-1).
// Username uniqueness is enforced by a DB unique constraint (INV-ID-3);
// the client pre-check here is belt-and-suspenders only.

import { supabase } from '../../../shared/api/supabase'
import type { Profile } from '../../../shared/types/database'
import type { User, Session } from '@supabase/supabase-js'

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function loginWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function loginWithEmail(emailOrUsername: string, password: string): Promise<User> {
  let email = emailOrUsername

  if (!emailOrUsername.includes('@')) {
    // Username login: resolve to email via profiles → get_email_by_id RPC.
    const { data: prof } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', emailOrUsername)
      .maybeSingle()

    if (prof) {
      const { data: resolved } = await supabase
        .rpc('get_email_by_id', { user_id: prof.id })
        .catch(() => ({ data: null }))
      if (!resolved) throw new Error('No se pudo resolver el usuario')
      email = resolved as string
    } else {
      // Fallback: legacy auth_usernames table.
      const { data: authUser } = await supabase
        .from('auth_usernames')
        .select('email')
        .eq('username', emailOrUsername)
        .maybeSingle()
        .catch(() => ({ data: null }))
      if (!authUser) throw new Error('No existe ningún usuario con ese nombre')
      email = (authUser as { email: string }).email
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.message?.toLowerCase().includes('invalid login'))
      throw new Error('Email, usuario o contraseña incorrectos')
    throw error
  }
  if (!data.session) throw new Error('Confirmá tu email antes de ingresar. Revisá tu bandeja.')
  return data.session.user
}

export async function signUp(
  username: string,
  email: string,
  password: string,
): Promise<{ user: User | null; needsConfirmation: boolean }> {
  // Belt-and-suspenders: DB unique constraint is the authority (INV-ID-3).
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (existing) throw new Error('Ese nombre de usuario ya está en uso')

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  })
  if (error) {
    const msg = error.message?.toLowerCase() ?? ''
    if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('user already'))
      throw new Error('Ya existe una cuenta con ese email. Iniciá sesión.')
    throw error
  }

  if (data.user) {
    await supabase
      .from('profiles')
      .upsert({ id: data.user.id, username }, { onConflict: 'id', ignoreDuplicates: false })
  }

  return { user: data.user ?? null, needsConfirmation: !data.session }
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  })
  if (error) throw error
}

export async function logout(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
  return data
}
