-- Dehna · patch 002: server-authoritative updated_at (applied 2026-09-01)
create or replace function public.hwc_keys() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
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
