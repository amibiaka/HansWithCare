-- Dehna · demo staff and professional accounts
-- 1) Create these users in Supabase → Authentication → Users → "Add user" (email + password, auto-confirm).
-- 2) Then run this file to attach roles. Re-runnable.
insert into public.profiles (user_id, role, name, linked)
select u.id, p.role, p.name, p.linked
from (values
  ('dr.selam@dehna.demo',   'doctor',     'Dr. Selamawit Bekele',    'PR-1'),
  ('dr.yonas@dehna.demo',   'doctor',     'Dr. Yonas Tesfaye',       'PR-2'),
  ('sr.hiwot@dehna.demo',   'nurse',      'Sr. Hiwot Alemu',         'PR-3'),
  ('dr.abdi@dehna.demo',    'doctor',     'Dr. Abdirahman Mohamed',  'PR-4'),
  ('dr.chaltu@dehna.demo',  'doctor',     'Dr. Chaltu Gemechu',      'PR-6'),
  ('ph.bole@dehna.demo',    'pharmacist', 'Ph. Bethlehem Worku',     'PH-AA-1'),
  ('ph.hawassa@dehna.demo', 'pharmacist', 'Ph. Tigist Lemma',        'PH-SD-1'),
  ('wb.mimi@dehna.demo',    'wellbeing',  'Mimi Home Massage',       'WB-1'),
  ('admin1@dehna.demo',     'admin',      'Operations admin 1',      null),
  ('admin2@dehna.demo',     'admin',      'Operations admin 2',      null),
  ('safety@dehna.demo',     'safety',     'Clinical safety officer', null),
  ('privacy@dehna.demo',    'privacy',    'Privacy / DPO',           null)
) as p(email, role, name, linked)
join auth.users u on u.email = p.email
on conflict (user_id) do update set role = excluded.role, name = excluded.name, linked = excluded.linked, active = true;
