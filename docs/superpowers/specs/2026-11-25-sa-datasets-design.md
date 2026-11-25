# SA ready-made datasets: design (batch 4 of the SA layers)

## Context

Approved by Xolisani in plan mode on 25 Nov 2026. Batch 4 is "ready-made datasets": builds 8, 9, 10, 12 and 14 of the research report (`reports/South Africa geo data sources.md`):
- DFFE protected areas;
- the Cape Town pack;
- health facilities;
- schools;
- population.

The fork is public: code, manifests and small CC BY data may be committed; fetched data stays in memory or the gitignored `.gev-cache`. Xolisani uses the app on localhost only.

### Checked on 25 Nov 2026 (about 12:00 SAST)

**DFFE screening server** (`screening.environment.gov.za/server/rest/services/OC_CV/Gazetted_Boundaries/MapServer`):
- It is keyless and sends CORS headers, but it **rejects paging** ("Pagination is not supported"). The Data Library's `arcgis` reader always pages (`src/library/formats.js:372`).
- An unpaged query works:
  - layer 44 (SAPAD Q4 2025): 1,730 polygons, 1.9 MB with `maxAllowableOffset=0.0005`;
  - layer 43 (SAMPAZ zones): 161 polygons, 157 KB.
- `SITE_TYPE` has 9 values, all 24 characters or fewer.
- `CUR_ZON_TY` has 7 values. Two of them, "Controlled-Pelagic Linefish with list" and "Controlled Catch and Release", exceed the validator's 24-character colour key. `CUR_ZON_CD` is a unique code per zone, so it is useless for colour.
- No licence is stated anywhere.

**Cape Town ODP** (`esapqa.capetown.gov.za/agsext/rest/services/Theme_Based/…`):
- All layers are keyless, send CORS headers, support paging, and answer the library's exact paged GeoJSON request in one page:
  - load-shedding blocks (19 polygons, 647 KB);
  - MyCiTi routes (96 lines, 1.8 MB);
  - MyCiTi stops (969 points);
  - health facilities (159 points);
  - fire stations (32 points).
- Wards (118) duplicate the existing `sa-wards-2026` layer.
- The Open Data Policy allows use "for any purpose".

**Validator.** I validated draft manifests for all 7 entries above with the repo's own `validateLibraryManifest`; all pass, including DFFE as `format: "geojson"` with the query URL and `f=geojson` in `source.query`.

**Opt-in path.** `server/standalone/vite.config.js:20` copies every `.env` value into `process.env`, which `libraryAvailability` reads (`src/library/proxy.js:74`). So `GEV_LIBRARY_ENABLE` in `.env` plus a restart switches an opt-in entry on. Xolisani edits `.env`; I never do.

**Ledger.** Tokens are sequential and append-only (`scripts/library.mjs` check), so the fork's entries take 2l–2r.

**HDX.** HDX download links answer 302 to signed S3 URLs (`s3.us-east-1.amazonaws.com/hdx-production-filestore/resources/<resource-id>/…`). The library refuses redirects, so health and schools need a server provider.
- **healthsites.io SA** (ODbL, updated 2026-09-29): 3,279 features, of which 1,884 are points and 1,395 polygons; 2,838 are named. Amenity counts:

  | Amenity | Count |
  | --- | --- |
  | pharmacy | 915 |
  | hospital | 894 |
  | clinic | 763 |
  | doctors | 352 |
  | dentist | 209 |
  | none | 144 |

- **Giga schools** (CC BY, updated 2026-08-06): a 1.5 MB CSV of 25,539 rows.
  - Columns: `school_name,longitude,latitude,education_level,connectivity`.
  - It has a BOM, and 23 rows contain quotes.
  - Connectivity: Yes 17,122, No 6,975, Unknown 1,442.
  - Levels: Primary 16,206, Secondary 6,332, Primary and Secondary 2,549 (plus 17 written "Primary And Secondary"), Unknown 416, Pre-Primary 18, Other 1.
  - All rows fall inside the SA bounding box.

**Kontur population** (CC BY, 2023-11-01): a 39 MB gzipped GeoPackage, 98 MB unpacked.
- Table `population(fid, geom, h3, population)` in EPSG:3857: 502,814 H3 res-8 hexagons, 60,489,559 people.
- Node 24's `node:sqlite` reads it, and every geometry blob carries an envelope.
- Binned to 0.1° (about 10 km) squares: 11,582 cells, 6,294 of them with 100 or more people, and a maximum of 1,148,776 people in one cell.

**Draw port.** `extrudeHeight` is an absolute ellipsoid height (`src/render/cesium/draw.js:4703`). Extruded columns would sink under the Highveld (1,000–1,800 m) unless every base were raised from terrain samples. So population is drawn as flat ground fills, the proven council-fill path.

## Design (my calls)

### Part A: seven Data Library entries (manifests only, no code)

They appear under **DATA LAYERS ▸ Browse data library** (filter: South Africa), not in the South Africa group; that is how the library works. All are `browser-direct`, `status: community`, `reviewed: 2026-11-25`, coverage ZA.

| id | Source | Display |
| --- | --- | --- |
| `za-dffe-protected-areas` | DFFE layer 44 as `geojson` with `query {where 1=1, outFields CUR_NME,SITE_TYPE,D_DCLAR,PROVINCE, f geojson, outSR 4326, maxAllowableOffset 0.0005, geometryPrecision 5}`, maxFeatures 2000 | label `CUR_NME`, fields `SITE_TYPE`, `D_DCLAR`; colorBy `SITE_TYPE` (9 greens and blues) |
| `za-dffe-marine-protected-areas` | DFFE layer 43, same pattern | label `CUR_ZON_NM`; colorBy `CUR_ZON_TY`: Restricted red, Sanctuary dark red, Wilderness purple; the "Controlled" variants take the entry colour (the two long names cannot be colour keys); the description says so |
| `za-cpt-load-shedding-blocks` | CPT `ODP_SPLIT_7/FeatureServer/13` (`arcgis`) | label `BlockID` |
| `za-cpt-myciti-routes` | `ODP_SPLIT_6/FeatureServer/9` | label `RT_NAME`; fields `RT_NMBR`, `RT_TYPE` |
| `za-cpt-myciti-stops` | `ODP_SPLIT_6/FeatureServer/10` | label `STOP_NAME`; fields `STOP_TYPE`, `STOP_STS` |
| `za-cpt-health-facilities` | `ODP_SPLIT_2/FeatureServer/13` | label `NAME`; fields `TYPE`, `ADR` |
| `za-cpt-fire-stations` | `ODP_SPLIT_5/FeatureServer/7` | label `FIRE_STN_NAME` |

- **Licences.**
  - DFFE: "No licence stated on the service; display only", with `operatorOptIn: true`. Xolisani adds `GEV_LIBRARY_ENABLE=za-dffe-protected-areas,za-dffe-marine-protected-areas` to `.env` and restarts.
  - Cape Town: "City of Cape Town Open Data Policy", not opt-in, credited to "City of Cape Town".
- **Wiring.** One import line each in `src/library/catalog.js`, ledger rows from `npm run library:next`, and `npm run library:docs` to regenerate the DATA_SOURCES table.

### Part B: provider `server/providers/saFacilities/` (route `/api/sa-facilities?set=health|schools`)

- **`hdx.js`.** It resolves each dataset through HDX's CKAN API (`package_show?id=<dataset>`), picks the resource by its fixed name, and fetches its download URL with `redirect: 'manual'`. It follows **exactly one** 302, and only when the `Location` is https on host `s3.us-east-1.amazonaws.com` with path prefix `/hdx-production-filestore/resources/<that resource id>/`. That second fetch uses `redirect: 'error'`.
  - The signed `Location` is never logged.
  - Body caps: health 8 MiB, schools 4 MiB.
  - 60 s timeouts, User-Agent `GodsEyeView (sa-facilities)`, TLS untouched.
- **`parse.js`.**
  - **Health GeoJSON.** Points as they are; polygons become the vertex mean of the outer ring. Each record is `{id: "<osm_type>/<osm_id>", name|null, kind: hospital|clinic|doctors|pharmacy|dentist|other, operator?, city?}`.
  - **Schools CSV.** A real CSV parser (strip the BOM, handle quotes, read columns by header name). Each record is `{name, lat, lon, level, connectivity: yes|no|unknown}`. The level is case-folded, so "Primary And Secondary" becomes "Primary and Secondary". Rows outside lon 16–33.5 / lat −35.5 to −22, and rows without coordinates, are dropped.
  - Every string is capped at 120 characters.
- **`index.js`.** It copies the `saGovernance` cache pattern (`server/providers/saGovernance/index.js`): memory plus `.gev-cache/sa-facilities/<set>.json`, with atomic writes and orphan-temp cleanup.
  - TTL is 24 h, and stale data is served up to 30 days, marked `stale`.
  - A refresh that would shrink a set below 50% of the last good one is refused (the shipwrecks rule).
  - The first request waits for the fetch, up to 60 s.
  - Same-site gate, 60 requests a minute, `Cache-Control: no-store`.
  - Payload: `{set, fetchedAt, updated, stale, records}`. Errors answer 503 with a code, never upstream text.
  - It is mounted in `server/providers/local.js` after `saNewsProxy`, and added to `src/tooling/previewServing.test.mjs`.

### Part C: three core layers (South Africa group, local-only, voice-off)

1. **"SA health facilities"** (`sa-health-facilities`): 3,279 points coloured by kind:

   | Kind | Colour |
   | --- | --- |
   | hospital | `#eb5757` |
   | clinic | `#f2994a` |
   | doctors | `#bb6bd9` |
   | pharmacy | `#27ae60` |
   | dentist | `#56ccf2` |
   | other | `#bdbdbd` |

   - Card: name (or "Unnamed {kind}"), kind, then operator or city, then "OpenStreetMap via healthsites.io".
2. **"SA schools (Giga)"** (`sa-schools`): 25,539 points coloured by connectivity: connected `#27ae60`, not connected `#eb5757`, unknown `#9e9e9e`.
   - Card: name, level, and an internet line.
   - Health and schools share one client module, `src/layers/saFacilities/`: source, records, cards and a layer factory, configured per set.
   - Points use `pos`, `height: 'clampGround'`, `disableDepthTest` and a set-level `horizonCull` (batch 1 lesson). The legend shows counts per class, plus a status line when the data is stale or failed.
3. **"SA population (Kontur 2023)"** (`sa-population`): about 6,300 flat, ground-clamped 0.1° squares in 5 bands:

   | People | Colour |
   | --- | --- |
   | 100–999 | `#ffffb2` |
   | 1k–9.9k | `#fecc5c` |
   | 10k–49.9k | `#fd8d3c` |
   | 50k–199k | `#f03b20` |
   | 200k+ | `#bd0026` |

   - Fill alpha is 0.55, drawn like the council fills (`src/layers/saElections/index.js`).
   - Card: "About {n} people in this 10 km square", then "Kontur Population 2023 (modelled)".
   - The legend shows the bands and "60.5 million people", the file's `total` of all people, drawn or not.
   - Measured on 25 Nov 2026: 6,294 kept cells. Per band: 3,167 / 2,111 / 803 / 160 / 53. Cells under 100 people hold 178,183 people (0.29%), which are not drawn.
   - Data comes from the committed `src/layers/saPopulation/sa-population-grid.json`, loaded with `loadBundledJson(new URL(…, import.meta.url))` (`src/data/bundledJson.js`).
   - **Generator** `scripts/sa-population.mjs`:
     - download with a 48 MiB cap and a 300 s timeout;
     - gunzip into a temp file with a 128 MiB output cap;
     - read with `node:sqlite`, taking each hexagon's centre from its GeoPackage envelope (3857 → 4326);
     - bin into 0.1° cells, keep cells of 100 or more people, and write `{source, cellDeg: 0.1, total, cells: [[south, west, people], …]}`;
     - guards that stop the script: 450k–560k hexagon rows, total 55–66 million, 5,500–7,500 kept cells;
     - delete the temp files.
4. **Wiring**, as for the batch 3 layers:
   - local-only entries in `src/app/constructCatalog.js`;
   - `src/app/sourceComposition.js`, `src/standalone/layerSources.js`;
   - `src/ui/layerNames.js`, `src/ui/layerPanel.js` (after `sa-news`);
   - `src/voice/layerManifest.js` (VOICE_OFF);
   - `scripts/package-boundaries.json`;
   - credits `za-health`, `za-schools`, `za-population` in `src/data/dataCredits.js`;
   - layer counts 47 → 50;
   - 13 locales and `src/i18n/same-as-english.json`.

**Docs.** `docs/SOUTH_AFRICA_DATASETS.md` covers what each layer and entry is, licences, refresh, the `.env` line for DFFE, and where library entries appear. `DATA_SOURCES.md` gets rows for the three core layers. The spec goes to `docs/superpowers/specs/2026-11-25-sa-datasets-design.md` and the plan to `docs/superpowers/plans/2026-11-25-sa-datasets.md`.

**Non-goals** (each named in the doc):
- DFFE coastal hazard lines: scattered regional drafts;
- Cape Town wards: `sa-wards-2026` covers them;
- Cape Town service requests: 3.3 million rows;
- KEMRI/WHO 2019;
- DBE EMIS: all rights reserved;
- WorldPop;
- 3D population columns: a later follow-up that needs terrain-sampled bases.

## Tasks (subagent-driven, one implementer at a time; branch `sa-datasets` from main 0770695e3)

0. Commit the spec and plan.
1. **Library entries.** The 7 manifests, catalog imports, ledger rows and `library:docs`. Then `library:check -- --base-ref origin/main`, `library:probe` for the 7 ids, and the `src/library` tests.
2. **Population generator and grid.** Pure functions (envelope centre, 3857→4326, binning, banding) with tests; the script; the committed grid.
3. **Facilities provider.** The HDX resolver with redirect pinning, caps, parsers, cache, route, mount and previewServing. Tests use stubbed fetch, including:
   - a redirect to a foreign host is refused;
   - the BOM and quoted CSV rows parse;
   - a refresh that shrinks below 50% is refused.
4. **Health and schools layers** with their wiring (counts 47→49).
5. **Population layer** with its wiring (counts 49→50).
6. **Translations** of all new strings in 13 locales.
7. **Docs and full checks**, with the build in a scratch worktree.

**Chrome gates, which I run after tasks 1, 4 and 5.** Every layer and entry draws where expected, a click opens its card, and the far side of the globe is clean.
- **Schools at 25,539 points.** If the globe stutters, the ruling is to draw only the schools inside the view when the camera is below 400 km. Above that height, the legend asks the viewer to zoom in.
- **DFFE.** Its 1,730 stems are thinned by the library's globe LOD; I check that it stays responsive.

## Rulings (cost if wrong)

- **DFFE as opt-in `geojson`, not `arcgis`.** It skips paging and colours by type. Cost: a one-line `.env` step for Xolisani.
- **Ledger tokens 2l–2r are fork-only.** Upstream's next entries will clash on a merge, and the fork then renumbers its tokens. Cost: the fork's share links to those entries break.
- **Flat population squares, not 3D.** Cost: less striking, but correct on every terrain.
- **0.1° grid, cells of 100+ people.** Cost: 0.29% of people (178,183, in cells under 100) are not drawn; the doc says so.
- **Health polygons drawn at the vertex mean of the outer ring.** Cost: an odd-shaped hospital site's dot sits slightly off its centre.
- **Schools coloured by connectivity, not level.** That is Giga's purpose; the level is on the card. Cost: a colour swap.

## Verification

- Tests come first in every task, with a review after each task and a final whole-branch review on the strongest model.
- **Live checks:**
  - `/api/sa-facilities?set=health` returns about 3,279 records and `?set=schools` about 25,539;
  - a restart serves both from `.gev-cache` without refetching.
- **Full checks**, quoting the last line of each:
  - `npm run format:check`;
  - `npm run check:boundaries`;
  - `npm run library:check -- --base-ref origin/main`;
  - `npm test` with 0 failures;
  - the scratch-worktree build.
- **Chrome** gates as above. DFFE is checked after Xolisani adds the `.env` line; until then, its row in Browse shows the opt-in notice.
- **Finish:** report, then the merge/push choice.
