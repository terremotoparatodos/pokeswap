-- SKILLS-1 — PROPUESTA de persistencia. NO ES UNA MIGRACIÓN.
--
-- Vive en docs/ a propósito, fuera de supabase/migrations, para que ningún
-- `supabase db push` la aplique. Hoy no hay datos de Skills en la base (ver
-- SKILLS_0_AUDIT.md §2), así que no hace falta migrar ni retirar nada: esto es
-- sólo el esquema que el servidor de WORLD-1 necesitará para implementar el
-- puerto WorkLedger / SkillProgressStore (src/features/skills/service/ports.ts).
--
-- Decisiones abiertas antes de convertirla en migración forward-only:
--   * inventario: no existe una tabla de items aprobada; los rewards quedan
--     registrados en el settlement (jsonb) hasta que se decida;
--   * quién ejecuta: sólo el servidor (service role). El cliente sólo lee lo suyo.

create table if not exists public.player_skill_xp (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  skill_id   text        not null check (skill_id in ('woodcutting', 'mining', 'farming')),
  -- 497216 = umbral del nivel 50 (tope provisional, balance.ts / xpCurve.ts).
  xp         integer     not null default 0 check (xp >= 0 and xp <= 497216),
  updated_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

create table if not exists public.skill_work_settlements (
  action_id     text        primary key,                 -- idempotencia: un settle por acción
  user_id       uuid        not null references auth.users (id) on delete cascade,
  skill_id      text        not null check (skill_id in ('woodcutting', 'mining', 'farming')),
  outcome       text        not null check (outcome in ('completed', 'cancelled')),
  xp_gained     integer     not null check (xp_gained >= 0),
  rewards       jsonb       not null default '[]'::jsonb, -- [{ itemId, quantity, bonus }]
  level_before  smallint    not null,
  level_after   smallint    not null,
  rules_version text        not null,
  settled_at    timestamptz not null default now()
);

create index if not exists skill_work_settlements_user_idx on public.skill_work_settlements (user_id, settled_at desc);

alter table public.player_skill_xp enable row level security;
alter table public.skill_work_settlements enable row level security;

-- Lectura de lo propio; ninguna escritura desde el cliente (AGENTS §2, §8).
create policy "read own skill xp" on public.player_skill_xp
  for select to authenticated using (user_id = auth.uid());
create policy "read own settlements" on public.skill_work_settlements
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.player_skill_xp from anon, authenticated;
revoke insert, update, delete on public.skill_work_settlements from anon, authenticated;

-- WorkLedger.commitSettlement: una transacción, un ganador por action_id.
create or replace function public.skills_commit_settlement(
  p_action_id text, p_user_id uuid, p_skill_id text, p_outcome text, p_xp_gained integer,
  p_rewards jsonb, p_level_before smallint, p_level_after smallint, p_rules_version text
) returns boolean
language plpgsql
as $$
declare
  inserted integer;
begin
  insert into public.skill_work_settlements
    (action_id, user_id, skill_id, outcome, xp_gained, rewards, level_before, level_after, rules_version)
  values
    (p_action_id, p_user_id, p_skill_id, p_outcome, p_xp_gained, p_rewards, p_level_before, p_level_after, p_rules_version)
  on conflict (action_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return false;                                            -- ya liquidada: no conceder nada
  end if;

  insert into public.player_skill_xp (user_id, skill_id, xp)
  values (p_user_id, p_skill_id, least(p_xp_gained, 497216))
  on conflict (user_id, skill_id)
  do update set xp = least(public.player_skill_xp.xp + excluded.xp, 497216), updated_at = now();

  -- TODO(inventario): acreditar p_rewards cuando exista la tabla de items aprobada.
  return true;
end;
$$;

revoke all on function public.skills_commit_settlement from public, anon, authenticated;
