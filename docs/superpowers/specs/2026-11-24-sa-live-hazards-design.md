# SA live hazards: design

Approved by Xolisani on 24 November 2026 (plan mode). This is batch 1 of the South African layers agreed after the geo-data research (`reports/South Africa geo data sources.md`, local only).

## Intent

Xolisani wants South Africa's live hazards on the globe. They run the fork on localhost only. The fork is public on GitHub, so code is committed and data is not.

Two layers:

- **SA weather warnings.** The South African Weather Service (SAWS) impact-based warnings, drawn as coloured municipal areas.
- **SA earthquakes (30 days).** Events recorded by the SA seismograph network (SASN, run by the Council for Geoscience), served by EMSC. Mine tremors are included but cannot be labelled as tremors, because EMSC marks every event `ke` (known earthquake).

## Goals

- Show every SAWS warning that is in force or upcoming, coloured yellow, orange or red, with a click card in South African time.
- Show South Africa's small seismic events, which the global earthquake layer (USGS, M2.5+, 24 h) leaves out.
- Leave upstream code untouched where possible, so pulling from upstream stays clean.

## Non-goals

- An official warning service. The legend sends people to weathersa.co.za for decisions.
- SAWS's internal website APIs (`/api/WarningAlerts`, `/api/StormTrack`). Their terms forbid reuse.
- Changes to the existing earthquake layer, its MCP tool or its voice records.
- District outlines, news, governance views and the other later batches.

## Anti-goals

- A warning that is still in force must never be hidden. Showing an old one by mistake is the lesser error.
- No SAWS or EMSC data may enter git.
- No keys, no `.env` changes, nothing in `compose.override.yaml`.

## Facts the design rests on (checked 24 Nov 2026)

### The SAWS feed

`https://caps.weathersa.co.za/Home/RssFeed` is RSS 2.0: 531 KB, 793 items, 513 of them unique, back to May 2025. It is an archive, not a current list.
- Each item's `guid` links one CAP 1.2 file at `https://www.weathersa.co.za/Documents/Warnings/{OFFICE}_CAP_{Hazard}_{YYYYMMDD}_{HHMMSS}.xml`, 15–85 KB.
- The channel's `<copyright>` says "Public Domain". Each CAP file says `scope: Restricted`.

What a CAP file holds:
- `sent`, `status` ("Actual") and `msgType`. Every file seen says "Update", and none has `references`.
- One or more `<info>` blocks. Each has:
  - `event`, for example "Severe Thunderstorms";
  - `severity`, `urgency` and `certainty`;
  - `onset` and `expires`, ISO times with `+02:00`;
  - `headline`, `description` (the impacts) and `instruction`;
  - `<parameter><valueName>alertType</valueName><value>Warning Level 4</value></parameter>`;
  - `<area>` blocks, each an `areaDesc` plus a `<polygon>` of space-separated `lat,lon` pairs (up to 164 points), closed.
- There are no geocodes and no circles.
- The file prefix names the issuing office, not the province: a "GP" file held Limpopo municipalities.

### Warning colours

SAWS levels 1–4 are yellow, 5–8 orange and 9–10 red. The colour is the impact; the number is the likelihood within the colour ([eNCA](https://enca.com/news-top-stories/understanding-sas-weather-warnings-alert-system), [Cape Town ETC](https://www.capetownetc.com/things-to-do-cape-town/yellow-level-1-red-level-10-what-do-weather-warnings-mean/)).

### EMSC

`https://www.seismicportal.eu/fdsnws/event/1/query?format=json&…` returns a GeoJSON FeatureCollection. It sends `Access-Control-Allow-Origin: *` and `max-age=15`.

Each feature's properties are:
- `unid` (for example `20261121_0000203`);
- `time` (ISO, `Z`);
- `lat`, `lon`, `depth` (+10) and `mag`;
- `magtype` ("m"), `evtype` ("ke"), `auth` ("SASN") and `flynn_region` ("SOUTH AFRICA").

The geometry's third coordinate is −10.

The SA box (lat −35 to −22, lon 16 to 33) gave 200 events from 25 Jul to 21 Nov 2026:
- About 1–2 a day, with gaps of several days.
- 199 of the 200 are SASN, and 188 are in "SOUTH AFRICA".
- Magnitudes run M2–M4, and 125 of 200 are below M2.5.
- Depth is the 10 km placeholder in 199.

Licence: CC BY 4.0, credit "EMSC-CSEM SeismicPortal". Bulk mirroring needs written permission ([terms](https://seismicportal.eu/terms.html)).

## Approaches

### Where SA quakes go

- **A. A second source on the existing earthquake layer.** It would show SA quakes beside the world's. Rejected for three reasons:
  - That layer shows 24 hours, so SA events would usually be absent.
  - Its M2.5 floor is written into about 10 upstream files: the MCP `get_earthquakes` schema and summary, the `Source: USGS` card, the exact-summary tests and four places that build the source.
  - Each of those edits would conflict with future upstream pulls.
- **B. A fork-local layer for the last 30 days (chosen).** It changes no upstream files beyond the shared wiring lists the election map already touches.
- **C. A Data Library manifest.** It needs the least code, but it gives no age colouring, no SAST card and no magnitude styling. The library caps also make no sense for a feed this small. Rejected.

### Which warnings to show

SAWS sends no `references`, so the app must infer which warning replaces which. I replayed the 37 files from 17–24 Nov at 20 Nov 18:00, 22 Nov 18:00, 23 Nov 12:00, and 24 Nov at 10:00 and 12:16.

1. **Newest file per office and hazard.** Rejected. At 22 Nov 18:00 it hid GP's Level 2 that was in force that evening, because a 17:33 file had arrived for the next day. Afternoon files are next-day outlooks.
2. **A newer file with an overlapping time window replaces the older one.** Rejected. At 23 Nov 12:00 it hid GP's Level 4 for 24 Nov, because a Level 2 file followed 11 minutes later.
3. **Never replace.** Rejected. It shows yesterday's GP warnings beside today's re-issue for the same areas.
4. **Replace per area, by issue (chosen).**
   - Files from one office and hazard form *issues*: a gap of more than 60 minutes between consecutive files starts a new issue. Files in one issue never replace each other.
   - An earlier warning stops showing for an area only when a later issue warns for the same `areaDesc` with an overlapping time window.
   - In the replay this kept every warning that was in force. At 23 Nov 12:00, the 14 GP areas upgraded to Level 4 showed Level 4, and the other 22 kept Level 2.
   - **Cost if wrong.** SAWS may drop a warning without re-issuing it. In KZN on 24 Nov, the 23 Nov issue had Level 2 for 38 areas and the 24 Nov issue only Level 4 for 10. The layer then shows the old Level 2 until it expires that night. Every card block says when it was issued, so an older warning reads as older.

### Caching

- **In memory only (chosen).** The data is short-lived.
- **A `.gev-cache` file.** Rejected: a restart costs only about 20 small fetches.

## Design

### Server: weather warnings (`server/providers/saWeather/`)

- `cap.js` (pure):
  - `parseSawsFeed` reads the RSS into unique `{name, office, hazard, nameMs}`, where `nameMs` is the time in the file name. Issue grouping uses each file's own `sent` instead. Only names matching `^[A-Z]{2,3}_CAP_[A-Za-z]+_\d{8}_\d{6}\.xml$` pass. The fetch URL is rebuilt from the checked name; feed links are never followed.
  - `parseCapAlert` reads one CAP file.
  - The reader is hand-written regex in the house style (`server/providers/jtwc.js`, `server/providers/regional/news.js`). It decodes named and numeric entities, swaps `lat,lon` to `[lon, lat]` and skips a bad polygon.
- `select.js` (pure):
  - Picks the recent files: those sent in the last 4 days, at most 60.
  - Applies the per-area issue rule and drops expired warnings.
  - Merges the result into one record per drawn area.
- `index.js` serves the route `/api/sa-weather-warnings`, built like `server/providers/droneAirspace.js`:
  - It checks the same site, rate-limits and coalesces requests.
  - Reads are capped (4 MiB for the RSS, 2 MiB per CAP file), use `redirect: 'error'`, keep TLS on and send the User-Agent `GodsEyeView (sa-weather)`.
  - At most 4 CAP fetches run at once. CAP files are cached by name, up to 128, since a published file never changes.
  - The RSS is cached for 10 minutes. Stale data is served for up to 24 hours, re-filtered by expiry each time it is served.
  - A bad CAP file is skipped, not fatal.

### Server: SA earthquakes (`server/providers/saQuakes.js`)

- Route `/api/sa-earthquakes`.
- One EMSC query: the SA box, `orderby=time`, `limit=500`, `starttime` = now − 30 days.
- 10-minute cache, stale data for up to 24 hours, 4 MiB cap.
- Rows `{stableId, lon, lat, depthKm, mag, magType, timeMs, region, network}`. Depth comes from `properties.depth`. An event without a finite magnitude or time is skipped.

### Client layers

Both are fork-local, `local-only`, voice-off, and in the "South Africa" panel group. Both refresh every 10 minutes.

**`sa-weather-warnings`, "SA weather warnings"**
- Drawn as ground fills plus draped outlines, built like `src/layers/droneAirspace/`.
- One area per merged record, coloured by its worst band. Red is drawn over orange, and orange over yellow.
- The card's title is the area name. Each warning gets a block:
  - "Yellow · Level 4 · Severe Thunderstorms";
  - "Tue 24 Nov 13:00–22:59 SAST";
  - "Issued Mon 23 Nov 08:45";
  - the impacts text;
  - the instruction.
- Footer: "Source: South African Weather Service".
- The legend shows Yellow, Orange and Red with counts. Its note reads: "SAWS impact-based warnings. Colour is the impact, the number the likelihood. For decisions, check weathersa.co.za."
- With nothing in force, it shows "No warnings in force" (not an error).

**`sa-earthquakes`, "SA earthquakes (30 days)"**
- Screen-space dots sized by magnitude, so they stay visible at country scale.
- Coloured by age: last 24 h red, last 7 days orange, older yellow.
- The card shows "M2.6 · Minor", then the region, the time in SAST, "Network: SASN" and "Source: EMSC-CSEM SeismicPortal".
- Depth is not shown, because it is a placeholder.
- The legend shows the three age bands with counts.

**Credits:** `za-saws` and `za-emsc` (CC BY 4.0).

**Docs:** `DATA_SOURCES.md` rows and `docs/SOUTH_AFRICA_HAZARDS.md`, covering sources, terms (including the Restricted-scope note), the update rule and limits.

## Left to the builder

- Exact copy within the lines above, file-internal helpers, the test fixture layout and the dot sizes.
- The order of draw items, as long as red ends up visibly on top.
