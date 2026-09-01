/* Generates supabase/seed.sql from js/seed.js (public directories, knowledge base, red flags, settings).
   Run: node tools/gen-seed-sql.js  → paste supabase/seed.sql into the Supabase SQL editor after schema.sql */
const fs = require('fs'), path = require('path');
eval(fs.readFileSync(path.join(__dirname, '../js/seed.js'), 'utf8') + ';global.SEED=SEED;');
const map = { geo: 'geo', emergency: 'emergency', facilities: 'facilities', practitioners: 'practitioners', pharmacyProducts: 'pharmacy_products', hansProducts: 'hans_products', wellbeing: 'wellbeing', kb: 'kb', redFlags: 'red_flags' };
const q = o => { const s = JSON.stringify(o); if (s.includes('$j$')) throw new Error('tag collision'); return '$j$' + s + '$j$'; };
let out = '-- Dehna seed data, generated ' + new Date().toISOString() + ' from js/seed.js (' + SEED.version + ')\n-- Re-runnable: rows are upserted by id. Replace with authority-validated data through the admin import.\n';
for (const c of Object.keys(map)) {
  const rows = SEED[c]; if (!rows.length) continue;
  out += '\ninsert into public.' + map[c] + ' (id, doc) values\n' + rows.map(r => '  (' + q(r.id) .replace('$j$"', "'").replace('"$j$', "'") + ', ' + q(r) + '::jsonb)').join(',\n') + '\non conflict (id) do update set doc = excluded.doc;\n';
}
out += "\ninsert into public.settings (id, doc) values ('flags', " + q(SEED.flags) + "::jsonb), ('fees', " + q(SEED.fees) + "::jsonb)\non conflict (id) do update set doc = excluded.doc;\n";
fs.writeFileSync(path.join(__dirname, '../supabase/seed.sql'), out);
console.log('seed.sql', out.length, 'bytes');
