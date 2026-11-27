// Connects the ERP to your Supabase project. Both values are designed to be public: the data is
// protected by the database rules in supabase/schema.sql, not by keeping these secret.
// Find them in Supabase: Project Settings → API (Project URL, and the "anon" / "publishable" key).
// NEVER put the "service_role" / "secret" key here.
window.LOWCAPS_CONFIG = {
  supabaseUrl: 'https://uhtoxhvyqeldrhiigvjh.supabase.co',
  supabaseKey: 'sb_publishable_M5s-eGIczpyrZ8QR7zUniA__fxs-QeX',
  minPasswordLength: 10, // keep in step with Authentication → Password security in Supabase
};
