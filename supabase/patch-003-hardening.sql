-- Dehna · patch 003: abuse limits (applied 2026-09-07)
-- Size caps on every document table (a client cannot flood a row with megabytes of JSON)
do $$ declare t text; begin
  foreach t in array array['geo','emergency','facilities','practitioners','pharmacy_products','hans_products','wellbeing','kb','red_flags','settings','cases','orders','consents','audit','complaints','notifications','approvals','guide_log'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_doc_size');
    execute format('alter table public.%I add constraint %I check (pg_column_size(doc) < 65536)', t, t || '_doc_size');
  end loop;
end $$;
-- Notifications: anyone may notify, but only short, addressed messages (no spam payloads)
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert with check (
  notify_to is not null and length(notify_to) between 3 and 80 and length(coalesce(doc->>'text', '')) between 1 and 200 and length(coalesce(doc->>'link', '')) <= 200);
-- Complaints and guide log: short texts only
drop policy if exists complaints_insert on public.complaints;
create policy complaints_insert on public.complaints for insert with check (length(coalesce(doc->>'text', '')) <= 4000);
drop policy if exists guide_log_insert on public.guide_log;
create policy guide_log_insert on public.guide_log for insert with check (pg_column_size(doc) < 2048);
-- Cases and orders: device token must look like a real token (128-bit hex) so old short tokens cannot be enumerated
drop policy if exists cases_insert on public.cases;
create policy cases_insert on public.cases for insert with check (device = public.hwc_device() and public.hwc_device() ~ '^DEV-[0-9a-f]{32}$');
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert with check (device = public.hwc_device() and public.hwc_device() ~ '^DEV-[0-9a-f]{32}$');
