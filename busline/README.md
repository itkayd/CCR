# Busline London

A Tube-style schematic map of every London bus route. Powered by TfL Open Data.

## Data pipeline

```
npm install
npm run data          # fetch (cached in scripts/.cache) + build → public/data/*.json
npm run data:build    # rebuild from cache only
```

- `TFL_APP_KEY` in `.env` is optional. Without it, TfL limits anonymous use to about 50 requests a minute, so a cold fetch takes about 25 minutes. With a key, it takes about 4 minutes.
- Behind an HTTP proxy, use Node ≥ 22.21 with `NODE_USE_ENV_PROXY=1`.

### Outputs
- `public/data/hubs.json`: `{ id, name, lat, lon, x, y, major, colour?, area?, rail?, routes }`
- `public/data/routes.json`: `{ id, night, school, a, b, path, via, inboundOnly }`
  - `path` is the outbound hub sequence, using the longest regular variant.
  - `via` lists the major hubs along `path`, in order.
  - `inboundOnly` lists hubs served only in the inbound direction.
- `public/data/meta.json`
- `scripts/majors.list.json`: the generated major stations, for review.

### Hand edits
`scripts/majors.override.json`:
```json
{ "add": ["hub-id"], "remove": ["hub-id"], "colours": { "hub-id": "#AA3311" } }
```
