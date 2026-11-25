# SA Ready-Made Datasets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add batch 4 of the SA layers:
- seven Data Library entries: two from the Department of Forestry, Fisheries and the Environment (DFFE) and five from the Cape Town pack;
- a keyless server provider for HDX health sites and Giga schools;
- three fork-local core layers: "SA health facilities", "SA schools (Giga)" and "SA population (Kontur 2023)".

**Architecture:**
- **Library entries** are manifests only. DFFE rejects paging, so its two entries use `format: "geojson"` pointed at the ArcGIS `query` URL.
- **Health and schools** come from HDX, whose downloads redirect to signed S3 URLs. A same-origin provider (`server/providers/saFacilities/`) resolves each resource through HDX's CKAN API, follows one pinned redirect, parses, and caches in memory plus `.gev-cache/sa-facilities/`. One client module (`src/layers/saFacilities/`) draws both sets as ground-clamped points.
- **Population** is a committed 0.1° grid derived from Kontur (CC BY) by a one-off generator. The client draws it as flat ground fills in 5 bands.

**Tech Stack:** plain ES modules, `node:test`, `node:sqlite` (generator only) and the app's draw port. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-sa-datasets-design.md`. Read it first. It holds the measured facts (counts, sizes, field values) and the rulings.

## Global Constraints

- **Dependencies and secrets:** no new npm dependencies. Never read, print or write `.env`. Never touch `compose.override.yaml`.
- **Upstream code:** do not edit upstream library code (`src/library/*.js` other than `catalog.js`, the ledger and entries). Do not edit the upstream layers.
- **Fixed hosts only:**
  - `https://screening.environment.gov.za/server/rest/services/OC_CV/Gazetted_Boundaries/MapServer/{43,44}/query`
  - `https://esapqa.capetown.gov.za/agsext/rest/services/Theme_Based/…` (the five layers in Task 1)
  - `https://data.humdata.org/api/3/action/package_show?id=…` and `https://data.humdata.org/dataset/…/resource/<id>/download/…`
  - redirect target `https://s3.us-east-1.amazonaws.com/hdx-production-filestore/resources/<same id>/…`
  - generator only: `https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_ZA_20231101.gpkg.gz`
- **Fetch rules:** TLS on; capped reads (`readResponseTextCapped` in `src/sources/httpBody.js`, which returns a string and throws `RESPONSE_TOO_LARGE`); timeouts; User-Agent `GodsEyeView (sa-facilities)` (generator: `GodsEyeView (sa-population)`). `redirect: 'error'` everywhere except the single pinned HDX hop, which uses `redirect: 'manual'`.
- **Never log** a signed S3 URL, a response body or an error message. Log a code or name only.
- **What is committed:** manifests, code, tests, docs, and `src/layers/saPopulation/sa-population-grid.json` (Kontur, CC BY 4.0, credited). HDX data is never committed. It lives in memory and in the gitignored `.gev-cache/sa-facilities/`.
- **Layers:**

  | Layer id | Name | Icon | Credit key |
  | --- | --- | --- | --- |
  | `sa-health-facilities` | "SA health facilities" | `✚` | `za-health` |
  | `sa-schools` | "SA schools (Giga)" | `🏫` | `za-schools` |
  | `sa-population` | "SA population (Kontur 2023)" | `👥` | `za-population` |

  - All three are local-only (`LOCAL_ONLY_LAYER_METADATA`) and in `VOICE_OFF_LAYERS`.
  - Panel group "South Africa", after `sa-news`, in the order above.
- **Draw contract** (`src/render/contract/draw.d.ts`):
  - Point items use `pos`, `height: 'clampGround'`, `disableDepthTest: Number.POSITIVE_INFINITY`, and a set with `horizonCull: true` and `clampTo: 'both'`.
  - Fills use `draw.shapes({clampTo: 'both'})` polygons, as `src/layers/saElections/index.js` does.
  - Each layer has one test that places its first item through the real stub renderer.
  - No Cesium imports in `src/layers`. No pick-ownership registration.
- **Cards:**
  - Every line is cut to 90 characters, ending in `…`.
  - On selection loss, clear the overlay source without hiding it (copy `src/layers/saNews/index.js`).
- **Format scope:** add every new file to `scripts/format-scope.json`, tests included.
- **Git:** commit only on branch `sa-datasets`. Stage your own files only, never `.superpowers/`. End every message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014bF2NXE9haRvYkDKrwetUs
  ```
- **Tests:**
  - Run a file with `node --test <file>`. Use globs; the directory form fails on Node 24.
  - Wiring tests need `--import=./build/registerVue.js`.
  - Run the suite with `npm test`, on Node 24 via `source ~/.nvm/nvm.sh >/dev/null; nvm use 24.22.3 >/dev/null`.
  - Only files under `src/` and `server/` ending `.test.mjs` are discovered.
  - Never run `npm run build` in the main checkout; Task 7 builds in a scratch worktree.
- **Locale tests:** new `t()`/`msg()` strings fail the 13 per-locale "catalog matches the code" tests until Task 6. That is expected; confirm they are the only failures.

## Review Focus

1. **An HDX redirect elsewhere.** A `Location` on another host, a non-https scheme, or another resource id is refused and nothing is fetched from it (Task 3 test).
2. **The Giga CSV's quirks.** A BOM on the header, quoted names with commas, "Primary And Secondary", and a row with blank coordinates all parse as the spec says (Task 3 test).
3. **A shrunken refresh.** HDX returning a much smaller set (an outage page that parses, or a truncated file) never replaces a good cached set (Task 3 test).
4. **A restart.** The provider serves from `.gev-cache` without fetching, and a corrupt cache file is ignored, never fatal (Task 3 test).
5. **The population file.** It is the committed output of the generator's guards: 5,500–7,500 cells, a total of 55–66 million, and every cell inside the SA box (Task 2 test on the committed file).

---

### Task 1: Data Library entries

**Files:**
- Create `src/library/entries/za-dffe-protected-areas.json`, `za-dffe-marine-protected-areas.json`, `za-cpt-load-shedding-blocks.json`, `za-cpt-myciti-routes.json`, `za-cpt-myciti-stops.json`, `za-cpt-health-facilities.json` and `za-cpt-fire-stations.json`.
- Modify `src/library/catalog.js` (one import each, in file-name order) and `src/library/ledger.json` (rows from `npm run library:next -- <id>`, appended one at a time in the order above).
- Modify `DATA_SOURCES.md` with `npm run library:docs`.
- Create `src/library/zaEntries.test.mjs`.

**Shared values:**
- `kind: "dataset"`, `maintainer: "github:xolisaninkwentsha"`, `status: "community"` and `reviewed: "2026-11-25"`.
- `source.fetch: "browser-direct"` and `cacheSeconds: 86400`.
- DFFE entries:
  - `coverage {countries ["ZA"], bbox [16.3, -35, 33, -22]}`;
  - `licence {name "No licence stated on the service; display only", url "https://screening.environment.gov.za/", operatorOptIn true}`.
- Cape Town entries:
  - `coverage {countries ["ZA"], bbox [18.3, -34.4, 19.0, -33.4]}`;
  - `licence {name "City of Cape Town Open Data Policy", url "https://www.capetown.gov.za/general/city-of-cape-town-open-data-terms-of-use/"}`;
  - `attribution {text "City of Cape Town", url "https://odp-cctegis.opendata.arcgis.com/"}`;
  - `provider "City of Cape Town"`;
  - `source {format "arcgis", maxFeatures 2000, maxPages 2}`.

**DFFE entries (exact):**

```json
{
  "id": "za-dffe-protected-areas", "family": "environment", "provider": "DFFE", "icon": "◈",
  "title": "SA protected areas (SAPAD Q4 2025)",
  "description": "Gazetted South African protected areas from the DFFE screening service: national parks, nature reserves, protected environments and World Heritage Sites.",
  "source": { "format": "geojson",
    "url": "https://screening.environment.gov.za/server/rest/services/OC_CV/Gazetted_Boundaries/MapServer/44/query",
    "query": { "where": "1=1", "outFields": "CUR_NME,SITE_TYPE,D_DCLAR,PROVINCE", "f": "geojson", "outSR": "4326", "maxAllowableOffset": "0.0005", "geometryPrecision": "5" },
    "maxFeatures": 2000 },
  "display": { "color": "#3fa34d", "label": "CUR_NME", "fields": ["SITE_TYPE", "D_DCLAR"],
    "colorBy": { "field": "SITE_TYPE", "colors": {
      "National Park": "#1b7837", "Nature Reserve": "#5aae61", "Special Nature Reserve": "#00441b",
      "Forest Nature Reserve": "#7fbc41", "Forest Wilderness Area": "#4d9221", "Mountain Catchment Area": "#8c6bb1",
      "Protected Environment": "#a6dba0", "Marine Protected Area": "#2c7fb8", "World Heritage Site": "#f1a340" } } },
  "attribution": { "text": "Department of Forestry, Fisheries and the Environment (SAPAD)", "url": "https://screening.environment.gov.za/" }
}
```

```json
{
  "id": "za-dffe-marine-protected-areas", "family": "environment", "provider": "DFFE", "icon": "◈",
  "title": "SA marine protected area zones (SAMPAZ)",
  "description": "Zones inside South Africa’s marine protected areas from the DFFE screening service. Restricted, sanctuary and wilderness zones are coloured; every other zone is a controlled zone.",
  "source": { "format": "geojson",
    "url": "https://screening.environment.gov.za/server/rest/services/OC_CV/Gazetted_Boundaries/MapServer/43/query",
    "query": { "where": "1=1", "outFields": "CUR_NME,CUR_ZON_NM,CUR_ZON_TY", "f": "geojson", "outSR": "4326", "maxAllowableOffset": "0.0005", "geometryPrecision": "5" },
    "maxFeatures": 500 },
  "display": { "color": "#6baed6", "label": "CUR_ZON_NM", "fields": ["CUR_ZON_TY", "CUR_NME"],
    "colorBy": { "field": "CUR_ZON_TY",
      "colors": { "Restricted": "#d7301f", "Sanctuary": "#7f0000", "Wilderness": "#54278f", "Controlled": "#6baed6", "Controlled Large Pelagic": "#6baed6" },
      "labels": { "Controlled": "Controlled", "Controlled Large Pelagic": "Controlled" } } },
  "attribution": { "text": "Department of Forestry, Fisheries and the Environment (SAMPAZ)", "url": "https://screening.environment.gov.za/" }
}
```

**Cape Town entries:** the URL prefix is `https://esapqa.capetown.gov.za/agsext/rest/services/Theme_Based/`.

| id | family | icon | url suffix | title | color | label | fields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `za-cpt-load-shedding-blocks` | infrastructure | ⚡ | `ODP_SPLIT_7/FeatureServer/13` | Cape Town load-shedding blocks | `#f2c94c` | `BlockID` | — |
| `za-cpt-myciti-routes` | movement | 🚌 | `ODP_SPLIT_6/FeatureServer/9` | Cape Town MyCiTi bus routes | `#e03c31` | `RT_NAME` | `RT_NMBR`, `RT_TYPE` |
| `za-cpt-myciti-stops` | movement | 🚏 | `ODP_SPLIT_6/FeatureServer/10` | Cape Town MyCiTi bus stops | `#e03c31` | `STOP_NAME` | `STOP_TYPE`, `STOP_STS` |
| `za-cpt-health-facilities` | infrastructure | ✚ | `ODP_SPLIT_2/FeatureServer/13` | Cape Town clinics and hospitals | `#eb5757` | `NAME` | `TYPE`, `ADR` |
| `za-cpt-fire-stations` | infrastructure | 🚒 | `ODP_SPLIT_5/FeatureServer/7` | Cape Town fire stations | `#f2994a` | `FIRE_STN_NAME` | `FIRE_STN_CLASS` |

Descriptions, in the same order:
1. "The City of Cape Town’s load-shedding block areas. The block number is what the City’s schedule refers to."
2. "MyCiTi integrated rapid transit bus routes in Cape Town."
3. "MyCiTi integrated rapid transit stations and stops in Cape Town."
4. "City and provincial clinics, community health centres and hospitals in Cape Town."
5. "City of Cape Town fire and rescue stations."

- [ ] **Step 1: Write the failing test** `src/library/zaEntries.test.mjs`:
  - all 7 ids are in the catalog and validate;
  - both DFFE entries are `geojson` with `query.f === 'geojson'` and no `maxPages` (DFFE rejects paging), and are `operatorOptIn: true`;
  - every `za-cpt-*` entry is `arcgis` on host `esapqa.capetown.gov.za`, not opt-in;
  - every id owns a ledger token.
- [ ] **Step 2:** Run it; it fails.
- [ ] **Step 3:** Write the manifests, imports and ledger rows, then run `npm run library:docs`.
- [ ] **Step 4:**
  - Run `node --test src/library/*.test.mjs`;
  - `npm run library:check -- --base-ref origin/main`, whose last line names the ledger as append-only;
  - `npm run library:probe` if it can target ids (otherwise run it whole and report only the 7 rows).
- [ ] **Step 5: Commit:** `Add the SA Data Library entries (DFFE, Cape Town)`.

### Task 2: Population generator and committed grid

**Files:**
- Create `src/layers/saPopulation/grid.js` and `grid.test.mjs`.
- Create `scripts/sa-population.mjs`.
- Create `src/layers/saPopulation/sa-population-grid.json` by running the script.

**Interfaces** (in `grid.js`, pure, no Node imports):
- `gpkgEnvelopeCentre(blob: Uint8Array): {x, y} | null` reads a GeoPackage geometry header: magic `GP`, flags byte 3, bit 0 for little-endian, and envelope code `(flags >> 1) & 7` in 1–4. The envelope starts at byte 8 as `[minx, maxx, miny, maxy]`. It returns `null` when the magic is wrong or there is no envelope.
- `mercatorToLonLat(x, y): {lon, lat}` converts EPSG:3857 to degrees (R = 6378137).
- `binPopulation(rows: Iterable<{lon, lat, people}>, cellDeg = 0.1): Map<string, {south, west, people}>` keys cells on `Math.floor(lat / cellDeg)` and `Math.floor(lon / cellDeg)`. `south` and `west` are rounded to 1 decimal.
- `POPULATION_BANDS`, frozen: `[{min: 100, color: '#ffffb2'}, {min: 1000, color: '#fecc5c'}, {min: 10000, color: '#fd8d3c'}, {min: 50000, color: '#f03b20'}, {min: 200000, color: '#bd0026'}]`.
- `populationBand(people): number`: the band index, or `-1` below 100.
- `POPULATION_FLOOR = 100` and `SA_GRID_BOX = {west: 16, south: -35.5, east: 33.5, north: -22}`.

**Script** `scripts/sa-population.mjs`:
1. Download the Kontur URL (Global Constraints) with a 48 MiB cap and a 300 s timeout.
2. Gunzip with `zlib.gunzipSync(buf, {maxOutputLength: 128 * 1024 * 1024})` to a temp file under `os.tmpdir()`.
3. Read it with `node:sqlite` (`DatabaseSync`, `readOnly: true`), iterating `select geom, population from population`.
4. Bin into 0.1° cells, keep cells of `POPULATION_FLOOR` or more, and round people to integers.
5. Write `{source: "Kontur Population: South Africa (2023-11-01)", licence: "CC BY 4.0", url: "https://data.humdata.org/dataset/kontur-population-south-africa", cellDeg: 0.1, total: <all people, rounded>, cells: [[south, west, people], …]}` sorted by south, then west, as one cell per line.
6. Stop, writing nothing, when: rows are outside 450,000–560,000; the total is outside 55–66 million; or the kept cells are outside 5,500–7,500.
7. Delete the temp files in `finally`.

Expected output: about 502,814 rows, a total of 60,489,559, and 6,294 cells.

- [ ] **Step 1: Write the failing tests:**
  - envelope centre for a little-endian and a big-endian header;
  - `null` for a bad magic or envelope code 0;
  - known 3857 points, e.g. (0, 0) → (0, 0), and Johannesburg 3,117,000 / −3,005,000 within 0.01°;
  - binning sums two points in one cell and separates neighbours across a cell edge, including negative coordinates;
  - band edges 99 → −1, 100 → 0, 999 → 0, 1000 → 1, 200000 → 4.
  - The **committed file** has 5,500–7,500 cells, `cellDeg` 0.1, a total of 55–66 million, people of 100 or more in every cell, and every cell inside `SA_GRID_BOX`.
  - The script source contains `maxOutputLength: 128 * 1024 * 1024` and the three guard ranges, checked against the source as `server/providers/saNews/places.test.mjs` does for `sa-towns.mjs`.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3:** Implement `grid.js` and the script, run `node scripts/sa-population.mjs` once, and commit its output.
- [ ] **Step 4:** The tests pass. Report the row count, total and cell count the script printed.
- [ ] **Step 5: Commit:** `Add the SA population grid from Kontur`.

### Task 3: Facilities provider `/api/sa-facilities`

**Files:**
- Create in `server/providers/saFacilities/`: `hdx.js`, `parse.js` and `index.js`, plus `hdx.test.mjs`, `parse.test.mjs` and `provider.test.mjs`.
- Modify `server/providers/local.js`: mount `saFacilitiesProxy()` after `saNewsProxy()`.
- Modify `src/tooling/previewServing.test.mjs`.

**Interfaces:**
- `FACILITY_SETS`, frozen:
  - `health: {dataset: 'south-africa-healthsites', resource: 'south-africa-healthsites-geojson', maxBytes: 8 * 1024 * 1024}`;
  - `schools: {dataset: 'south-africa-school-geolocation-and-connectivity-status', resource: 'south-africa-school-geolocation-connectivity-data.csv', maxBytes: 4 * 1024 * 1024}`.
- `fetchHdxResource(set, {fetchImpl, signal}): Promise<string>` in `hdx.js`:
  1. Get `package_show` with a 2 MiB cap, and find the resource whose `name` equals `set.resource`.
  2. Its `url` must be https on `data.humdata.org` with `/resource/<resource.id>/download/` in its path.
  3. Fetch it with `redirect: 'manual'`. A 200 is read directly. A 301, 302, 303, 307 or 308 is followed once, only to `https://s3.us-east-1.amazonaws.com/hdx-production-filestore/resources/<resource.id>/…`, with `redirect: 'error'`. Anything else throws `HDX_REDIRECT_REFUSED` or `HDX_HTTP_<status>`.
  4. 60 s timeout per request.
- `parseHealthSites(text): Array<{id, name, kind, lat, lon, operator?, city?}>`:
  - `kind` is `amenity` when it is in hospital, clinic, doctors, pharmacy or dentist, else `other`;
  - points as they are; for polygons and multipolygons, the vertex mean of the first outer ring;
  - `id` is `` `${osm_type}/${osm_id}` ``;
  - an empty name becomes `null`;
  - strings are capped at 120 characters;
  - records without finite coordinates inside `SA_GRID_BOX` are dropped (use the same box values as Task 2).
- `parseGigaSchools(text): Array<{id, name, lat, lon, level, connectivity}>`:
  - RFC 4180 CSV: quotes, doubled quotes, and commas inside quotes; strip a leading BOM;
  - columns are read by header name;
  - `level` is case-folded to the spec's spelling ("Primary and Secondary");
  - `connectivity` is `yes`, `no` or `unknown`;
  - `id` is `school:<row number>`;
  - rows with blank or out-of-box coordinates are dropped.
- `saFacilitiesProxy({fetchImpl, cacheDir = path.join(process.cwd(), '.gev-cache', 'sa-facilities'), now})`: a Vite middleware plugin like `saNewsProxy` (`server/providers/saNews/index.js`). For the route `/api/sa-facilities?set=health|schools`:
  - an unknown set answers 400 `{error: 'unknown-set'}`;
  - same-site gate and 60 requests a minute (copy saNews);
  - `Cache-Control: no-store`.
- **Cache:** copy `server/providers/saGovernance/index.js` (`KINDS` with ttl and staleMax, `readJsonFile`, atomic temp-and-rename, `removeOrphanTemps`):
  - ttl 24 h, staleMax 30 days, per set;
  - a background refresh when stale;
  - a fetch shared between concurrent requests;
  - a refresh with fewer than 50% of the held records is refused and logged as `shrunk`.
- **Payload:** `{set, fetchedAt, updated, stale, records}`. Failure with nothing held answers 503 `{error: <code>}`.

- [ ] **Step 1: Write the failing tests** with stubbed fetch and a temp `cacheDir`:
  - **Redirects:** follows one pinned redirect; refuses another host, an http scheme and another resource id; a 200 without a redirect works; the second fetch uses `redirect: 'error'`.
  - **Caps:** a body over the cap throws `RESPONSE_TOO_LARGE`.
  - **Health parsing:** point, polygon centroid, unknown amenity becomes `other`, and an empty name becomes `null`.
  - **Schools parsing:** BOM header, a quoted name with a comma and doubled quotes, "Primary And Secondary", blank coordinates dropped, and connectivity mapping.
  - **Provider:**
    - the first request fetches; a second within the ttl does not;
    - after a restart (new provider, same `cacheDir`) it serves without fetching;
    - a corrupt cache file is ignored;
    - a refresh that shrinks is refused and the old records are kept;
    - an unknown set answers 400;
    - an upstream failure with nothing held answers 503, and no log line contains a URL.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3:** Implement and mount.
- [ ] **Step 4:** The tests and `previewServing` pass.
- [ ] **Step 5: Commit:** `Add the SA facilities provider (HDX health sites and Giga schools)`.

### Task 4: Health and schools layers, with wiring

**Files:**
- Create in `src/layers/saFacilities/`: `source.js`, `records.js`, `cards.js` and `index.js`, plus `source.test.mjs`, `records.test.mjs`, `cards.test.mjs` and `layer.test.mjs`.
- Create `src/app/layers/saFacilities.js`.
- Wiring: follow `git show 0770695e3 --stat` (batch 3).

**Interfaces:**
- **Source:** `createSaFacilitiesSource({set, fetchImpl})` → `{getSnapshot({signal})}`. It fetches `/api/sa-facilities?set=<set>` and normalises the payload with `normaliseFacilities(payload, set)`, which drops records with non-finite coordinates or unknown classes.
- **Classes:**

  ```
  FACILITY_CLASSES = {
    health:  [hospital #eb5757, clinic #f2994a, doctors #bb6bd9, pharmacy #27ae60, dentist #56ccf2, other #bdbdbd],
    schools: [yes #27ae60 ('Connected'), no #eb5757 ('Not connected'), unknown #9e9e9e ('Unknown')],
  }
  ```

  Health labels are 'Hospital', 'Clinic', 'Doctor', 'Pharmacy', 'Dentist' and 'Other'. Every label goes through `t()`.
- **Layer:** `createSaFacilitiesLayer({set, source, overlayHost, picking, inputFor})`:
  - **health:** id `sa-health-facilities`, name 'SA health facilities', source label 'healthsites.io · OpenStreetMap', pixelSize 6 with a white outline;
  - **schools:** id `sa-schools`, name 'SA schools (Giga)', source label 'Giga · DBE', pixelSize 4, no outline;
  - both: `updateInterval: 21600000`, and one `draw.points` set `<id>:<n>:dots` with `clampTo: 'both'` and `horizonCull: true`.
- **Click handling** copies `src/layers/saNews/index.js`: card-on-top precedence, own-set checks, and clear without hide on selection loss. There is no `activate`; the card links nowhere.
- **Cards** (`cards.js`):
  - **health:** name, or `t('Unnamed {kind}')`; the kind label; `operator` or `city` when present; then `t('OpenStreetMap via healthsites.io')`.
  - **schools:** name; level; `t('Internet: {state}')` with connected / not connected / unknown; then `t('Giga school data (ITU–UNICEF)')`.
- **Legend:**
  - the classes with counts;
  - one blurb: health `t('Hospitals, clinics, doctors, pharmacies and dentists mapped in OpenStreetMap, via healthsites.io.')`; schools `t('School locations from Giga, coloured by whether the school is connected to the internet.')`;
  - status lines: `t('Showing the last copy from {date}; refresh failed')` when `stale`, and `t('Data unavailable')` when the source fails with nothing held.
- **`getAnalystRecords`** returns `{id, name, kind, lat, lon}`.
- **Wiring:**
  - `constructCatalog`: two local-only entries, constructed with `source: sources['sa-health-facilities']` and `sources['sa-schools']`;
  - `sourceComposition`: `contract(['<id>'], ['getSnapshot'])` for both;
  - `standalone/layerSources`;
  - `layerPanel`: South Africa group, after `'sa-news'`;
  - `layerNames`: `msg()` for both names;
  - `VOICE_OFF_LAYERS`;
  - `package-boundaries`;
  - counts 47 → 49.
- **Credits:**
  - `za-health`: "© OpenStreetMap contributors (ODbL), via healthsites.io and HDX";
  - `za-schools`: "Giga (ITU–UNICEF) school locations from the Department of Basic Education, CC BY 4.0, via HDX".
  - Both link to their HDX dataset pages, with a test.

- [ ] **Step 1: Write the failing tests** (`bindFakeDraw` plus one real stub-renderer placement per set):
  - item fields, and the set's `horizonCull` and `clampTo`;
  - class colours for both sets;
  - a click shows the card; after selection loss, the next click still shows a card;
  - card text, including the unnamed health record and the 90-character cut;
  - legend counts and the stale and failed lines;
  - disable clears the selection;
  - the normaliser drops bad records.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run the tests, the wiring tests (with `--import=./build/registerVue.js`) and `npm run check:boundaries`; they pass.
- [ ] **Step 5: Commit:** `Add the SA health facilities and schools layers`.

### Task 5: Population layer, with wiring

**Files:**
- Create in `src/layers/saPopulation/`: `index.js`, `cards.js`, `layer.test.mjs` and `cards.test.mjs`.
- Create `src/app/layers/saPopulation.js`, then wire.

**Interfaces:** `createSaPopulationLayer({overlayHost, picking, inputFor, loadGrid = () => loadBundledJson(new URL('./sa-population-grid.json', import.meta.url))})`:
- id `sa-population`, name 'SA population (Kontur 2023)', source label 'Kontur', and no periodic update; the grid loads once on first enable and is memoised.
- One `draw.shapes` set `sa-population:<n>:fills`, `clampTo: 'both'` and pickable.
  - Items are `{id: 'sa-population:' + index, geometry: {kind: 'polygon', rings: [[SW, SE, NE, NW, SW]]}, fill: band colour with alpha 0.55}`, using the positions format `src/layers/saElections/index.js` uses.
- **Click card** (copy saElections' fill pick and card flow):
  - `t('About {people} people in this 10 km square')`, with `people` rounded to 2 significant figures and grouped;
  - `t('Kontur Population 2023 (modelled)')`.
- **Legend:**
  - the 5 bands with cell counts, labelled `100–999`, `1,000–9,999`, `10,000–49,999`, `50,000–199,999` and `200,000+`;
  - blurb `t('People per square of about 10 km, from Kontur’s 2023 population model. Squares with fewer than 100 people are not drawn.')`;
  - a line `t('{total} million people in all')` with one decimal.
- **`getAnalystRecords`** returns `{id, people, south, west}` for the 200 most populous cells.
- **Wiring:**
  - as Task 4: catalog (a static layer; it has no source, so check how a source-less local layer is wired and follow that), `layerNames`, the panel after `sa-schools`, `VOICE_OFF_LAYERS` and boundaries;
  - credit `za-population`: "Kontur Population: South Africa (2023-11-01), CC BY 4.0", linking to the HDX page;
  - counts 49 → 50.

- [ ] **Step 1: Write the failing tests:**
  - with an injected `loadGrid` of 3 cells: items, ring corners, band colours and alpha, and one stub-renderer placement;
  - clicking a fill shows the card;
  - legend band counts and total;
  - disable hides and clears;
  - `loadGrid` is called once across two enables.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run the tests, the wiring tests and boundaries; they pass.
- [ ] **Step 5: Commit:** `Add the SA population layer`.

### Task 6: Translations

- [ ] Translate every new string into ar, de, es, fr, he, it, ja, pt, ru, sv, uk and zh-CN, following **each** `docs/translations/<locale>.md`:
  - fr: U+202F before ":" or ";" and inside « »;
  - pt: "em" with dates;
  - ja: the glossary terms.
- [ ] Localise "SA" the way the existing SA layer names already are in each locale.
- [ ] Keep these unchanged: Giga, Kontur, OpenStreetMap, healthsites.io, ITU–UNICEF, and the placeholders `{kind}`, `{state}`, `{date}`, `{people}` and `{total}`.
- [ ] Run `npm run i18n -- --zh-hant`, then `npm run i18n` (all complete), then `npm test` (0 failures).
- [ ] **Commit:** `Translate the SA datasets layers`.

### Task 7: Docs and verification

- [ ] Write `docs/SOUTH_AFRICA_DATASETS.md`, covering:
  - each of the seven library entries and three layers: what it shows, the source, the licence, refresh, and where it appears (library entries are under DATA LAYERS ▸ Browse data library);
  - the DFFE opt-in: add `GEV_LIBRARY_ENABLE=za-dffe-protected-areas,za-dffe-marine-protected-areas` to `.env` and restart;
  - the HDX cache folder;
  - how to regenerate the population grid with `node scripts/sa-population.mjs`;
  - the 0.29% of people not drawn;
  - the spec's non-goals, each with its reason;
  - the ledger note: fork-only tokens 2l–2r may need renumbering after an upstream merge.
- [ ] Add `DATA_SOURCES.md` rows for the three core layers next to the SA rows. Update `scripts/format-scope.json`.
- [ ] Run `npm run format:check`, `npm run check:boundaries`, `npm run library:check -- --base-ref origin/main` and `npm test`, then the build in a scratch worktree. Remove its symlink with `rm` and the worktree with `git worktree remove`. Quote the last line of each.
- [ ] **Commit:** `Document the SA datasets layers`.
- [ ] The controller then checks live:
  - `/api/sa-facilities?set=health` returns about 3,279 records, and `?set=schools` about 25,539;
  - a restart serves both from `.gev-cache`.

  And in Chrome:
  - every layer and entry draws in place, and its card opens;
  - the far side of the globe is clean;
  - schools stay responsive (the spec's fallback if not).
