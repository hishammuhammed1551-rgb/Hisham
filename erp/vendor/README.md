# Vendored libraries

- `supabase-2.118.0.js`: [@supabase/supabase-js](https://github.com/supabase/supabase-js) 2.118.0, browser build (`dist/umd/supabase.js`), MIT licence (see `LICENSE-supabase-js.txt`).
  Kept in the repo so the ERP does not depend on a CDN. To upgrade, copy the same file from a newer npm release and update the `<script>` tag in `index.html`.
- `jspdf-4.2.1.umd.min.js`: [jsPDF](https://github.com/parallax/jsPDF) 4.2.1 (`dist/jspdf.umd.min.js`), MIT licence (`LICENSE-jspdf.txt`). Builds invoice PDFs in the browser.
- `jspdf-autotable-5.0.9.min.js`: [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) 5.0.9 (`dist/jspdf.plugin.autotable.min.js`), MIT licence (`LICENSE-jspdf-autotable.txt`). Draws the invoice line table.
