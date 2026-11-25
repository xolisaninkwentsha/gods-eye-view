# South African datasets (fork-local)

This fork adds three layers to the **South Africa** group (health facilities, schools and population) and seven entries to the data library (two national protected-area sets from DFFE and five Cape Town open-data sets). Upstream God’s Eye View has none of them. The layers sit in the group after **SA news (24h)**. Design: `docs/superpowers/specs/2026-11-25-sa-datasets-design.md`.

Everything is for personal display on this PC. The reference data is public, but it is a snapshot of what each publisher released, not a live or official service. HDX data is never committed to git: it lives in server memory and in the gitignored `.gev-cache/sa-facilities/` folder.

## The three layers

All three are local-only and in `VOICE_OFF_LAYERS` (see “Local-only behaviour”). Place, school and facility names are data and are not translated; every other new string is in all locales.

### SA health facilities (`sa-health-facilities`)

- **What it shows:** 3,279 health facilities across South Africa on 25 November 2026 (HDX dataset updated 2026-09-29), coloured by class: hospital, clinic, doctor’s practice, pharmacy, dentist and other.
- **Source:** healthsites.io, read through the Humanitarian Data Exchange (HDX). Licence ODbL, credit “© OpenStreetMap contributors (ODbL), via healthsites.io and HDX” (`za-health`).
- **Card:** name, class and a few address and operator lines when the record has them, each cut to 90 characters.

### SA schools (Giga) (`sa-schools`)

- **What it shows:** 25,539 schools (HDX dataset updated 2026-08-06), coloured by connectivity: connected, not connected or unknown. The school level is on the card.
- **Source:** Giga (ITU–UNICEF) school locations, from the Department of Basic Education, read through HDX. Licence CC BY 4.0, credit “Giga (ITU–UNICEF) school locations … via HDX” (`za-schools`).

### SA population (Kontur 2023) (`sa-population`)

- **What it shows:** a fill of about 10 km squares in five bands by population. The grid has 6,294 drawn squares; 60.5 million people in all.
- **Source:** Kontur Population: South Africa, 2023-11-01. Licence CC BY 4.0 (`za-population`). Committed as `src/layers/saPopulation/sa-population-grid.json`, so nothing is fetched at run time.
- **Not drawn:** squares with fewer than 100 people are left out. That is 178,183 people, **0.29%** of the total, and the layer’s info line says so.
- **Regenerate the grid:** `node scripts/sa-population.mjs`. It downloads Kontur’s 39 MB file to a temporary folder, checks the row count, the population total and the cell count, and writes the committed grid only if the guards pass. It is the only code that fetches Kontur.

### How health and schools draw

Health and schools draw as GPU icons, not as ordinary ground-clamped points. After you switch one on, the dots settle onto the ground over about 10 seconds. This is deliberate: drawing them as ordinary clamped points froze the app for 16 seconds.

## The facilities provider

`/api/sa-facilities?set=health|schools` serves both point layers.

- **Resolving:** each HDX dataset is resolved through HDX’s CKAN `package_show`, so the layer keeps working when HDX publishes a new file name.
- **One pinned redirect:** HDX answers the download with a redirect. The provider follows exactly one, and only when it points at HDX’s S3 file store. Every other redirect is refused.
- **Size caps:** health 8 MiB, schools 4 MiB.
- **Cache:** in memory and in `.gev-cache/sa-facilities/` (gitignored). The data is refreshed every 24 hours. If a refresh fails, the stale copy is served, marked stale, for up to 30 days. A refresh with fewer than half the previous records is refused as damaged.
- **Speed:** the first fetch takes about 10 to 13 seconds; after that, and after a restart, it is instant from the cache.
- **Logging:** only a code or name is logged, never a signed URL, a body or an error message.

## The library entries

Open **DATA LAYERS ▸ Browse data library** and search “Cape Town” or “DFFE”. An entry you add appears under **Library**. The data is fetched from the publisher when you add the entry. The generated catalogue is `docs/DATA-LIBRARY.md`; do not edit its rows by hand.

| Id                               | What it shows                                                                                                                            | Source and licence                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `za-dffe-protected-areas`        | 1,730 protected-area polygons (SAPAD Q4 2025), coloured by site type                                                                     | DFFE screening service. No licence stated; opt-in (below) |
| `za-dffe-marine-protected-areas` | 161 marine protected-area zones (SAMPAZ). Restricted, sanctuary and wilderness zones are coloured; every other zone is a controlled zone | DFFE screening service. No licence stated; opt-in (below) |
| `za-cpt-load-shedding-blocks`    | 19 load-shedding blocks                                                                                                                  | City of Cape Town Open Data Policy                        |
| `za-cpt-myciti-routes`           | 96 MyCiTi bus routes                                                                                                                     | City of Cape Town Open Data Policy                        |
| `za-cpt-myciti-stops`            | 969 MyCiTi stops                                                                                                                         | City of Cape Town Open Data Policy                        |
| `za-cpt-health-facilities`       | 159 City health facilities                                                                                                               | City of Cape Town Open Data Policy                        |
| `za-cpt-fire-stations`           | 32 fire stations                                                                                                                         | City of Cape Town Open Data Policy                        |

### The DFFE opt-in

DFFE publishes no licence for these two sets, so they are off until you enable them. Add this line to `.env` and restart:

```
GEV_LIBRARY_ENABLE=za-dffe-protected-areas,za-dffe-marine-protected-areas
```

The DFFE server rejects ArcGIS paging, so these two entries are plain `geojson` entries pointed at the query URL, with `maxAllowableOffset=0.0005` to keep the polygons small.

## Sources

- **DFFE screening service:** `https://screening.environment.gov.za/server/rest/services/OC_CV/Gazetted_Boundaries/MapServer/{43,44}/query`.
- **City of Cape Town:** `https://esapqa.capetown.gov.za/agsext/rest/services/Theme_Based/…` (five layers).
- **HDX:** `https://data.humdata.org/api/3/action/package_show?id=…` and `https://data.humdata.org/dataset/…/resource/<id>/download/…`, with the one pinned redirect to `https://s3.us-east-1.amazonaws.com/hdx-production-filestore/resources/<same id>/…`.
- **Kontur (generator only):** `https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_ZA_20231101.gpkg.gz`.

All fetches keep TLS verification on, read through capped readers, use timeouts and send a generic User-Agent (`GodsEyeView (sa-facilities)` or `GodsEyeView (sa-population)`) with no personal details.

## Local-only behaviour

The three layers are local-only, like the other South Africa layers: they get no permanent share-link token, so they are **not restored after a reload, cannot be shared by link, and cannot be shown through MCP**. None registers in the pick-ownership registry.

## Not included, and why

- **DFFE coastal hazard lines:** they are scattered regional drafts.
- **Cape Town wards:** the existing `sa-wards-2026` layer already covers them.
- **Cape Town service requests:** the set is 3.3 million rows.
- **KEMRI/WHO 2019 health-facility list:** left out; the health layer uses the healthsites.io set instead.
- **DBE EMIS (school register):** all rights reserved.
- **WorldPop:** left out; the population layer uses Kontur’s grid instead.
- **3D population columns:** a possible later follow-up, because they would need terrain-sampled bases.

## The ledger note

The seven library entries take permanent share-link tokens `2l` to `2r` in the library ledger. These tokens are fork-only. After an upstream merge, upstream’s next entries may take the same tokens, so they may need renumbering. Run `npm run library:check -- --base-ref origin/main` after any merge.
