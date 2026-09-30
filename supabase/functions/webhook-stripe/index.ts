// webhook-stripe Edge Function — RETIRED (PAYMENTS RETIRE-2). Answers an empty 200.
//
// The provider is disabled; see ../_shared/retiredPaymentWebhook.ts. Deploy with
// `--no-verify-jwt` (the provider cannot send a Supabase JWT); see
// scripts/payment-retire/webhook-deploy-guard.mjs for the exact command.

import { handleRetiredPaymentWebhook } from '../_shared/retiredPaymentWebhook.ts'

Deno.serve(handleRetiredPaymentWebhook)
