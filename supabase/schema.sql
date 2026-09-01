-- Dehna (Han's With Care) · Supabase schema, row-level security and storage
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- Design: one table per collection, each row = { id, doc jsonb, updated_at } plus key columns extracted by
-- trigger for policies and indexes. Patients are identified by the x-device-token request header; staff and
-- professionals by Supabase Auth + a profiles row. Nothing is readable without one of those.

create extension if not exists pgcrypto;

-- ---------- helpers ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('doctor','nurse','pharmacist','wellbeing','admin','verifier','safety','privacy','finance')),
  name text not null,
  linked text,               -- PR-x / PH-x / WB-x record the account acts for
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.hwc_device() returns text language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json->>'x-device-token', '')
$$;
create or replace function public.hwc_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;
create or replace function public.hwc_linked() returns text language sql stable security definer set search_path = public as $$
  select linked from public.profiles where user_id = auth.uid() and active
$$;
create or replace function public.hwc_is_staff() returns boolean language sql stable as $$
  select coalesce(public.hwc_role() in ('admin','verifier','safety','privacy','finance'), false)
$$;
create or replace function public.hwc_is_admin() returns boolean language sql stable as $$
  select coalesce(public.hwc_role() = 'admin', false)
$$;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (user_id = auth.uid() or public.hwc_is_staff());
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all using (public.hwc_is_admin()) with check (public.hwc_is_admin());

-- ---------- generic document tables ----------
create or replace function public.hwc_make_table(t text) returns void language plpgsql as $$
begin
  execute format('create table if not exists public.%I (id text primary key, doc jsonb not null, updated_at timestamptz not null default now(), device text, recipient text, recipients text[], referral_to text, seller text, notify_to text, state text, jurisdiction text)', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_idx', t);
  execute format('create index if not exists %I on public.%I (device)', t || '_device_idx', t);
end $$;

create or replace function public.hwc_keys() returns trigger language plpgsql as $$
begin
  new.updated_at := coalesce((new.doc->>'updatedAt')::timestamptz, now());
  new.device := new.doc->>'device';
  new.recipient := new.doc->'recipient'->>'id';
  new.recipients := case when jsonb_typeof(new.doc->'recipients') = 'array' then array(select jsonb_array_elements_text(new.doc->'recipients')) else null end;
  new.referral_to := new.doc->'referral'->>'to';
  new.seller := new.doc->>'seller';
  new.notify_to := new.doc->>'to';
  new.state := coalesce(new.doc->>'state', new.doc->>'status');
  new.jurisdiction := new.doc->>'jurisdiction';
  new.doc := jsonb_set(new.doc, '{updatedAt}', to_jsonb(new.updated_at::text), true);
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['geo','emergency','facilities','practitioners','pharmacy_products','hans_products','wellbeing','kb','red_flags','settings','cases','orders','consents','audit','complaints','notifications','approvals','guide_log'] loop
    perform public.hwc_make_table(t);
    execute format('drop trigger if exists %I on public.%I', t || '_keys', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.hwc_keys()', t || '_keys', t);
  end loop;
end $$;

-- ---------- policies: public directories ----------
do $$ declare t text; begin
  foreach t in array array['geo','facilities','practitioners','pharmacy_products','hans_products','wellbeing','kb','red_flags','settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format('create policy %I on public.%I for all using (public.hwc_is_staff()) with check (public.hwc_is_staff())', t || '_staff', t);
  end loop;
end $$;
-- emergency: hidden/invalid records are visible to staff only
drop policy if exists emergency_read on public.emergency;
create policy emergency_read on public.emergency for select using (coalesce(state,'') not in ('hidden','invalid') or public.hwc_is_staff());
drop policy if exists emergency_staff on public.emergency;
create policy emergency_staff on public.emergency for all using (public.hwc_is_staff()) with check (public.hwc_is_staff());
-- professionals may update their own record (availability, stock)
drop policy if exists practitioners_self on public.practitioners;
create policy practitioners_self on public.practitioners for update using (id = public.hwc_linked()) with check (id = public.hwc_linked());
drop policy if exists wellbeing_self on public.wellbeing;
create policy wellbeing_self on public.wellbeing for update using (id = public.hwc_linked()) with check (id = public.hwc_linked());
drop policy if exists pharmacy_products_self on public.pharmacy_products;
create policy pharmacy_products_self on public.pharmacy_products for all using (doc->>'pharmacy' = public.hwc_linked()) with check (doc->>'pharmacy' = public.hwc_linked());

-- ---------- policies: cases (requests) ----------
drop policy if exists cases_insert on public.cases;
create policy cases_insert on public.cases for insert with check (device = public.hwc_device() and public.hwc_device() <> '');
drop policy if exists cases_access on public.cases;
create policy cases_access on public.cases for select using (
  (device = public.hwc_device() and public.hwc_device() <> '')
  or recipient = public.hwc_linked() or public.hwc_linked() = any(recipients) or referral_to = public.hwc_linked()
  or public.hwc_role() in ('admin','safety'));
drop policy if exists cases_update on public.cases;
create policy cases_update on public.cases for update using (
  (device = public.hwc_device() and public.hwc_device() <> '')
  or recipient = public.hwc_linked() or public.hwc_linked() = any(recipients) or referral_to = public.hwc_linked()
  or public.hwc_role() in ('admin','safety'));

-- ---------- orders ----------
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert with check (device = public.hwc_device() and public.hwc_device() <> '');
drop policy if exists orders_access on public.orders;
create policy orders_access on public.orders for select using (
  (device = public.hwc_device() and public.hwc_device() <> '') or seller = public.hwc_linked()
  or (seller = 'HANS' and public.hwc_role() in ('admin','finance')) or public.hwc_is_admin());
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update using (
  (device = public.hwc_device() and public.hwc_device() <> '') or seller = public.hwc_linked()
  or (seller = 'HANS' and public.hwc_role() in ('admin','finance')) or public.hwc_is_admin());

-- ---------- consents, audit, complaints, notifications, approvals, guide log ----------
drop policy if exists consents_insert on public.consents;
create policy consents_insert on public.consents for insert with check (true);
drop policy if exists consents_read on public.consents;
create policy consents_read on public.consents for select using ((doc->>'subject') = public.hwc_device() or public.hwc_role() in ('admin','privacy'));

drop policy if exists audit_insert on public.audit;
create policy audit_insert on public.audit for insert with check (true);
drop policy if exists audit_read on public.audit;
create policy audit_read on public.audit for select using (public.hwc_role() in ('admin','privacy'));

drop policy if exists complaints_insert on public.complaints;
create policy complaints_insert on public.complaints for insert with check (true);
drop policy if exists complaints_staff on public.complaints;
create policy complaints_staff on public.complaints for all using (public.hwc_role() in ('admin','safety','privacy')) with check (public.hwc_role() in ('admin','safety','privacy'));

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert with check (true);
drop policy if exists notifications_access on public.notifications;
create policy notifications_access on public.notifications for select using (
  (notify_to = public.hwc_device() and public.hwc_device() <> '') or notify_to = public.hwc_linked()
  or (notify_to in ('HANS','safety','privacy') and public.hwc_is_staff()));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (
  (notify_to = public.hwc_device() and public.hwc_device() <> '') or notify_to = public.hwc_linked() or public.hwc_is_staff());

drop policy if exists approvals_staff on public.approvals;
create policy approvals_staff on public.approvals for all using (public.hwc_is_staff()) with check (public.hwc_is_staff());

drop policy if exists guide_log_insert on public.guide_log;
create policy guide_log_insert on public.guide_log for insert with check (true);
drop policy if exists guide_log_read on public.guide_log;
create policy guide_log_read on public.guide_log for select using (public.hwc_role() in ('admin','safety'));

-- ---------- server-side audit chain (tamper evidence independent of the client) ----------
alter table public.audit add column if not exists server_prev text;
alter table public.audit add column if not exists server_hash text;
create or replace function public.hwc_audit_chain() returns trigger language plpgsql as $$
declare prev text;
begin
  select server_hash into prev from public.audit order by updated_at desc, id desc limit 1;
  new.server_prev := coalesce(prev, '0');
  new.server_hash := encode(digest(new.server_prev || new.id || coalesce(new.doc::text, ''), 'sha256'), 'hex');
  return new;
end $$;
drop trigger if exists audit_chain on public.audit;
create trigger audit_chain before insert on public.audit for each row execute function public.hwc_audit_chain();
-- audit rows are append-only
drop policy if exists audit_no_update on public.audit;
create policy audit_no_update on public.audit for update using (false);
drop policy if exists audit_no_delete on public.audit;
create policy audit_no_delete on public.audit for delete using (false);

-- ---------- storage: private attachments bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 2097152, array['image/jpeg','image/png','image/webp','application/pdf','audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict (id) do update set public = false, file_size_limit = 2097152;
drop policy if exists attachments_upload on storage.objects;
create policy attachments_upload on storage.objects for insert to anon, authenticated with check (bucket_id = 'attachments');
drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated using (
  bucket_id = 'attachments' and exists (
    select 1 from public.cases c where c.id = split_part(name, '/', 1)
      and (c.recipient = public.hwc_linked() or public.hwc_linked() = any(c.recipients) or c.referral_to = public.hwc_linked() or public.hwc_role() in ('admin','safety'))));

-- ---------- grants (PostgREST roles) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
