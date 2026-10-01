// kofi-webhook Edge Function — donation receiver with no effects (PAYMENTS RETIRE-2).
//
// All logic is in handler.ts; this file only wires Deno and the secret.
// Deploy with `--no-verify-jwt` (Ko-fi cannot send a Supabase JWT); see
// scripts/payment-retire/webhook-deploy-guard.mjs for the exact command.

import { handleKofiWebhook } from './handler.ts'

Deno.serve(req => handleKofiWebhook(req, {
  verificationToken: () => Deno.env.get('KOFI_VERIFICATION_TOKEN'),
}))
