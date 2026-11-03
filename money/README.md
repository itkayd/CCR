# Money tracker

Mobile-first personal money tracker: savings and pay-off goals, work log, money in/out with goal splits, payday plan, chart.

- `public/` – source (`index.html`, `app.js`); `src/input.css` – Tailwind input
- `dist/` – what Vercel serves (static, no build step)
- Data: Supabase RPCs `mt_load` / `mt_save`, guarded by a PIN (hash stored in the `money_tracker` schema)

Rebuild:

```sh
npm install
npx @tailwindcss/cli -i src/input.css -o public/app.css --minify
npx esbuild public/app.js --minify --target=es2017 --outfile=dist/app.js
cp public/app.css public/index.html dist/
```
