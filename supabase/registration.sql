-- Dehna · self-registration of professionals and partners (run after schema.sql; idempotent)
-- An authenticated user may create ONE pending record they own and a profile linked to it. Nobody except staff can
-- change a record's verification block; if the owner edits licence or identity fields, the record returns to "pending".

create or replace function public.hwc_owner_ok(d jsonb) returns boolean language sql stable as $$
  select auth.uid() is not null and d->>'ownerUid' = auth.uid()::text and coalesce(d->'verification'->>'state', '') = 'pending'
$$;

drop policy if exists practitioners_register on public.practitioners;
create policy practitioners_register on public.practitioners for insert to authenticated with check (public.hwc_owner_ok(doc));
drop policy if exists facilities_register on public.facilities;
create policy facilities_register on public.facilities for insert to authenticated with check (public.hwc_owner_ok(doc) and doc->>'type' = 'pharmacy');
drop policy if exists wellbeing_register on public.wellbeing;
create policy wellbeing_register on public.wellbeing for insert to authenticated with check (public.hwc_owner_ok(doc));
-- owners can also update their own record before a profile exists (e.g. document path), never verification (trigger below)
drop policy if exists practitioners_owner on public.practitioners;
create policy practitioners_owner on public.practitioners for update to authenticated using (doc->>'ownerUid' = auth.uid()::text);
drop policy if exists facilities_owner on public.facilities;
create policy facilities_owner on public.facilities for update to authenticated using (doc->>'ownerUid' = auth.uid()::text);
drop policy if exists wellbeing_owner on public.wellbeing;
create policy wellbeing_owner on public.wellbeing for update to authenticated using (doc->>'ownerUid' = auth.uid()::text);

drop policy if exists profiles_register on public.profiles;
create policy profiles_register on public.profiles for insert to authenticated with check (
  user_id = auth.uid() and role in ('doctor','nurse','pharmacist','wellbeing') and (
    (role in ('doctor','nurse') and exists (select 1 from public.practitioners p where p.id = linked and p.doc->>'ownerUid' = auth.uid()::text)) or
    (role = 'pharmacist' and exists (select 1 from public.facilities f where f.id = linked and f.doc->>'ownerUid' = auth.uid()::text)) or
    (role = 'wellbeing' and exists (select 1 from public.wellbeing w where w.id = linked and w.doc->>'ownerUid' = auth.uid()::text))));

create or replace function public.hwc_guard_verification() returns trigger language plpgsql as $$
begin
  if not public.hwc_is_staff() then
    if new.doc->'verification' is distinct from old.doc->'verification' then
      new.doc := jsonb_set(new.doc, '{verification}', coalesce(old.doc->'verification', '{"state":"pending"}'::jsonb), true);
    end if;
    if new.doc->'licence' is distinct from old.doc->'licence' or new.doc->>'name' is distinct from old.doc->>'name'
       or new.doc->>'profession' is distinct from old.doc->>'profession' or new.doc->>'responsiblePharmacist' is distinct from old.doc->>'responsiblePharmacist' then
      new.doc := jsonb_set(new.doc, '{verification,state}', '"pending"', true);
      new.doc := jsonb_set(new.doc, '{verification,evidence}', to_jsonb('Identity or licence details changed by owner on ' || now()::date || '; re-review required'), true);
    end if;
    if new.doc->>'ownerUid' is distinct from old.doc->>'ownerUid' then
      new.doc := jsonb_set(new.doc, '{ownerUid}', coalesce(old.doc->'ownerUid', 'null'::jsonb), true);
    end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['practitioners','facilities','wellbeing'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_guard', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.hwc_guard_verification()', t || '_guard', t);
  end loop;
end $$;

-- licence documents: verification/<recordId>/<fileId>, readable by staff and by the owner
drop policy if exists verification_read on storage.objects;
create policy verification_read on storage.objects for select to authenticated using (
  bucket_id = 'attachments' and split_part(name, '/', 1) = 'verification' and (
    public.hwc_is_staff()
    or exists (select 1 from public.practitioners p where p.id = split_part(name, '/', 2) and p.doc->>'ownerUid' = auth.uid()::text)
    or exists (select 1 from public.facilities f where f.id = split_part(name, '/', 2) and f.doc->>'ownerUid' = auth.uid()::text)
    or exists (select 1 from public.wellbeing w where w.id = split_part(name, '/', 2) and w.doc->>'ownerUid' = auth.uid()::text)));
