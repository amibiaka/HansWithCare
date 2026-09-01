/* Dehna runtime configuration. Committed on purpose: the Supabase anon key is a public key protected by
   row-level security; never put the service key here. Leave supabaseUrl empty for the on-device demo mode. */
window.DEHNA_CONFIG = {
  appName: 'Dehna',
  owner: "Han's With Care",
  supabaseUrl: 'https://efmffpzdkbizucoyecjd.supabase.co',
  supabaseAnonKey: 'sb_publishable_lBMBOjq863Aj_dQe8dSXKw_RAl9ijKW',
  syncIntervalSec: 20
};
