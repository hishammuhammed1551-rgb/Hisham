# Vendored libraries

- `supabase-2.118.0.js`: [@supabase/supabase-js](https://github.com/supabase/supabase-js) 2.118.0, browser build (`dist/umd/supabase.js`), MIT licence (see `LICENSE-supabase-js.txt`).
  Kept in the repo so the ERP does not depend on a CDN. To upgrade, copy the same file from a newer npm release and update the `<script>` tag in `index.html`.
