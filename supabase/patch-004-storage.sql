-- patch-004: storage upload hardening (idempotent)
--
-- Before: a single policy let anyone holding the publishable key upload ANY
-- object name into the private "attachments" bucket (only bucket_id checked),
-- so an abuser could spray arbitrary paths or spoof verification/ licence
-- paths, limited only by the 2 MB size cap and MIME allow-list.
--
-- After: two shape-constrained policies.
--   * Patient case attachments (anon + authenticated): the object name must be
--     "<caseId>/<fileId>" for a patient case (RQ-… request, RX-… prescription)
--     with an AT-… file id — two segments only, no traversal, no deep nesting.
--   * Licence / verification documents (authenticated only): the object name
--     must be "verification/<recordId>/<fileId>" — anonymous device users can
--     no longer write into the verification namespace at all.
--
-- The 2 MB file-size limit and image/pdf/audio MIME allow-list on the bucket
-- (see schema.sql) still apply on top of these.

drop policy if exists attachments_upload on storage.objects;
drop policy if exists attachments_upload_case on storage.objects;
drop policy if exists attachments_upload_verification on storage.objects;

create policy attachments_upload_case on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^(RQ|RX)-[A-Z0-9]{5,24}/AT-[A-Z0-9]{4,24}$'
  );

create policy attachments_upload_verification on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^verification/[^/]{4,40}/[^/]{4,40}$'
  );
