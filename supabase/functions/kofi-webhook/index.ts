// SEC-04 (R11): kofi-webhook — verification token moved to env var.
// Deploy the secret first:
//   supabase secrets set KOFI_VERIFICATION_TOKEN=<your-token>
// The hardcoded literal that was here is no longer in source control.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SWAP_SKIP_AMOUNT = 1.00;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const kofiToken = Deno.env.get('KOFI_VERIFICATION_TOKEN');
    if (!kofiToken) {
      console.error('KOFI_VERIFICATION_TOKEN env var is not set');
      return new Response('Server misconfiguration', { status: 500 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const formData = await req.formData();
    const raw = formData.get('data');
    if (!raw) return new Response('Missing data', { status: 400 });

    const data = JSON.parse(raw.toString());
    console.log('Ko-fi webhook:', JSON.stringify(data));

    if (data.verification_token !== kofiToken) {
      console.error('Token inválido');
      return new Response('Unauthorized', { status: 401 });
    }

    if (!data.is_public || data.type !== 'Donation') {
      return new Response('ok', { status: 200 });
    }

    const amount = parseFloat(data.amount || '0');
    if (amount < SWAP_SKIP_AMOUNT) {
      console.log('Monto insuficiente:', amount);
      return new Response('ok', { status: 200 });
    }

    const email = data.email || data.from_name;
    const message = (data.message || '').toLowerCase().trim();

    let userId: string | null = null;

    if (email && email.includes('@')) {
      const { data: user } = await supabase.auth.admin.listUsers();
      const found = user?.users?.find((u: { email?: string }) =>
        u.email?.toLowerCase() === email.toLowerCase()
      );
      if (found) userId = found.id;
    }

    if (!userId && message) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', message)
        .single();
      if (profile) userId = profile.id;
    }

    if (!userId) {
      console.log('Usuario no encontrado para:', email, message);
      await supabase.from('kofi_payments').insert({
        kofi_transaction_id: data.kofi_transaction_id,
        email: data.email,
        from_name: data.from_name,
        message: data.message,
        amount,
        status: 'user_not_found',
        raw: JSON.stringify(data),
      }).maybeSingle();
      return new Response('ok', { status: 200 });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ swap_cooldown_until: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      console.error('Error reseteando cooldown:', error);
      return new Response('Error', { status: 500 });
    }

    await supabase.from('kofi_payments').insert({
      kofi_transaction_id: data.kofi_transaction_id,
      email: data.email,
      from_name: data.from_name,
      message: data.message,
      amount,
      user_id: userId,
      status: 'processed',
      raw: JSON.stringify(data),
    }).maybeSingle();

    console.log('Cooldown reseteado para usuario:', userId);
    return new Response('ok', { status: 200 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('Ko-fi webhook error:', msg);
    return new Response('Error: ' + msg, { status: 500 });
  }
});
