/* config.js — cloud sync settings (Supabase).
 * Leave both empty to run fully local (no sync).
 * The "anon"/"publishable" key is designed to be public: access is protected by the
 * Row Level Security rules in supabase/schema.sql, so only your signed-in account can read your data. */
window.CT_CONFIG = {
  supabaseUrl: '',   // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseKey: '',   // the project's anon / publishable key
};
