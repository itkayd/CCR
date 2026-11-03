-- Money tracker: session-based sign-in (PIN no longer stored on devices) + stricter PIN lockout.
-- Non-destructive: adds new functions, keeps the old mt_load / mt_save working.
-- Run in Supabase → project "diesel-house" → SQL Editor.

create table if not exists money_tracker.sessions (
  token_hash text primary key,
  device text,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table money_tracker.sessions enable row level security;

create or replace function money_tracker.check_pin2(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f15 int; f24 int; last_fail timestamptz; good boolean;
begin
  delete from money_tracker.attempts where at < now() - interval '2 days';
  select count(*) filter (where at > now() - interval '15 minutes'), count(*), max(at)
    into f15, f24, last_fail from money_tracker.attempts where not ok and at > now() - interval '24 hours';
  if f24 >= 20 then return jsonb_build_object('ok', false, 'error', 'locked', 'retry_after', ceil(extract(epoch from (last_fail + interval '24 hours' - now())))); end if;
  if f15 >= 5 then return jsonb_build_object('ok', false, 'error', 'locked', 'retry_after', ceil(extract(epoch from (last_fail + interval '15 minutes' - now())))); end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,8}$' then good := false;
  else select (pin_hash = extensions.crypt(p_pin, pin_hash)) into good from money_tracker.config where id = 1; end if;
  insert into money_tracker.attempts (ok) values (coalesce(good, false));
  if good then delete from money_tracker.attempts where not ok; return jsonb_build_object('ok', true); end if;
  return jsonb_build_object('ok', false, 'error', 'bad_pin', 'tries_left', greatest(0, 4 - f15));
end $$;
revoke all on function money_tracker.check_pin2(text) from public, anon, authenticated;

create or replace function money_tracker.check_pin(p_pin text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin return coalesce((money_tracker.check_pin2(p_pin)->>'ok')::boolean, false); end $$;
revoke all on function money_tracker.check_pin(text) from public, anon, authenticated;

create or replace function money_tracker.session_ok(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  update money_tracker.sessions set last_used = now(), expires_at = greatest(expires_at, now() + interval '60 days')
    where token_hash = h and expires_at > now();
  return found;
end $$;
revoke all on function money_tracker.session_ok(text) from public, anon, authenticated;

create or replace function public.mt2_login(p_pin text, p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare chk jsonb; tok text; r record;
begin
  chk := money_tracker.check_pin2(p_pin);
  if not (chk->>'ok')::boolean then return chk; end if;
  delete from money_tracker.sessions where expires_at < now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into money_tracker.sessions (token_hash, device, expires_at)
    values (encode(extensions.digest(tok, 'sha256'), 'hex'), left(coalesce(p_device, ''), 80), now() + interval '60 days');
  select data, version into r from money_tracker.state where id = 1;
  return jsonb_build_object('ok', true, 'token', tok, 'data', r.data, 'version', r.version);
end $$;

create or replace function public.mt2_load(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not money_tracker.session_ok(p_token) then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select data, version into r from money_tracker.state where id = 1;
  return jsonb_build_object('ok', true, 'data', r.data, 'version', r.version);
end $$;

create or replace function public.mt2_save(p_token text, p_data jsonb, p_base_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not money_tracker.session_ok(p_token) then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'days') <> 'array'
     or jsonb_typeof(p_data->'goals') <> 'array' or pg_column_size(p_data) > 1000000 then
    return jsonb_build_object('ok', false, 'error', 'bad_data'); end if;
  select data, version into r from money_tracker.state where id = 1 for update;
  if r.version <> p_base_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'data', r.data, 'version', r.version); end if;
  update money_tracker.state set data = p_data, version = version + 1, updated_at = now() where id = 1 returning version into r;
  return jsonb_build_object('ok', true, 'version', r.version);
end $$;

create or replace function public.mt2_logout(p_token text, p_all boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  if not money_tracker.session_ok(p_token) then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  if p_all then delete from money_tracker.sessions where token_hash <> h;
  else delete from money_tracker.sessions where token_hash = h; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mt2_change_pin(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare chk jsonb; h text;
begin
  if not money_tracker.session_ok(p_token) then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_new is null or p_new !~ '^[0-9]{6,8}$' or p_new ~ '^(.)\1+$'
     or p_new in ('123456','1234567','12345678','654321','123123','121212','112233') then
    return jsonb_build_object('ok', false, 'error', 'weak_pin'); end if;
  chk := money_tracker.check_pin2(p_old);
  if not (chk->>'ok')::boolean then return chk; end if;
  update money_tracker.config set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = 1;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  delete from money_tracker.sessions where token_hash <> h;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mt2_login(text, text) from public, authenticated;
revoke all on function public.mt2_load(text) from public, authenticated;
revoke all on function public.mt2_save(text, jsonb, int) from public, authenticated;
revoke all on function public.mt2_logout(text, boolean) from public, authenticated;
revoke all on function public.mt2_change_pin(text, text, text) from public, authenticated;
grant execute on function public.mt2_login(text, text) to anon;
grant execute on function public.mt2_load(text) to anon;
grant execute on function public.mt2_save(text, jsonb, int) to anon;
grant execute on function public.mt2_logout(text, boolean) to anon;
grant execute on function public.mt2_change_pin(text, text, text) to anon;
