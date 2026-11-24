# SA Live Hazards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This plan adds two fork-local layers, both in the "South Africa" panel group:
- "SA weather warnings": SAWS CAP polygons, coloured by warning band.
- "SA earthquakes (30 days)": EMSC events from SASN.

**Architecture:** Two keyless same-origin server routes, `/api/sa-weather-warnings` and `/api/sa-earthquakes`, read the upstream feeds with capped, bounded fetches. They keep results in memory and serve normalized rows. Two client layers draw those rows through the draw port, with click cards and legends. They are wired in the same way as the SA election layers (commit `888244efc` for the layer, `923e84fbf` for the provider).

**Tech Stack:** Plain ES modules, `node:test`, and the app's draw port (`src/render/contract/draw.d.ts`). There are no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-sa-live-hazards-design.md`. Read it first: it holds the facts, the update rule and why each choice was made.

## Global Constraints

- **No new npm dependencies.** XML is read with hand-written regex, in the style of `server/providers/jtwc.js` and `server/providers/regional/news.js`.
- **Upstream fetches:**
  - use `redirect: 'error'`;
  - keep TLS verification on;
  - read through the capped readers in `server/providers/common/http.js`;
  - send the User-Agent `GodsEyeView (sa-weather)` or `GodsEyeView (sa-quakes)`, with no URL, name or email.
- **Fixed hosts only:**
  - `https://caps.weathersa.co.za/Home/RssFeed`
  - `https://www.weathersa.co.za/Documents/Warnings/<checked name>`
  - `https://www.seismicportal.eu/fdsnws/event/1/query`
  - Feed links are never followed. A CAP URL is rebuilt from a name that matches `^([A-Z]{2,3})_CAP_([A-Za-z]+)_(\d{8})_(\d{6})\.xml$`.
- **No SAWS or EMSC data in git.** Tests use small synthetic XML and JSON written inline.
- **Hands off:** never read, print or write `.env`, never touch `compose.override.yaml`, and never commit `.env*`.
- **SAWS bands:** levels 1–4 `yellow`, 5–8 `orange`, 9–10 `red`; anything else `null`. Colours: yellow `#f2c94c`, orange `#f2994a`, red `#eb5757`, none `#9aa4ad`.
- **Times on screen are SAST:** `timeZone: 'Africa/Johannesburg'` with the suffix "SAST", never the machine's zone. The Docker server runs on UTC.
- **Layers:** ids `sa-weather-warnings` and `sa-earthquakes`.
  - Both are `local-only` in `LOCAL_ONLY_LAYER_METADATA`.
  - Both are in `VOICE_OFF_LAYERS`.
  - Both have `updateInterval: 600000`.
  - Both are in the "South Africa" group after the election ids.
- **Credits:** keys `za-saws` and `za-emsc`.
- **Picks:** neither layer registers in the pick-ownership registry (same contract as `droneAirspace`). Neither layer imports Cesium.
- **Git:** commit only on branch `sa-hazards`. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Running tests:** one file with `node --test <file>`; the whole suite with `npm test`.
- **Checks that write `dist/`:** `npm run build` and anything that builds run only in a detached scratch worktree, never in the main checkout. The Docker dev server watches the main checkout.

## Review Focus

1. **A CAP file listed in the RSS that answers 404 or 500 for now**, for example because it is not published yet. Skip it, don't cache the failure, and fetch it again on the next refresh (Task 3 test).
2. **A warning expiring while the page stays open.** Each client update drops expired warnings. A selected area left with none loses its card (Task 5 test).
3. **EMSC answering `204 No Content` when the 30-day window has no events.** That is an empty layer, not an error (Task 6 test).
4. **The server running on UTC.** 11:00Z shows as 13:00 SAST whatever the process's `TZ` is (Task 4 test, run under `TZ=UTC`).
5. **A CAP file's name time differing from its `sent`.** The name said 08:58:23 while `sent` said 08:56:52. The issue grouping uses `sent` from the file; the name time is used only to pick recent files (Task 2 test).

---

### Task 1: SAWS RSS and CAP parsers

**Files:**
- Create: `server/providers/saWeather/cap.js`
- Test: `server/providers/saWeather/cap.test.mjs`

**Interfaces:**
- Produces:
  - `SAWS_FILE_NAME: RegExp` (the pattern in Global Constraints).
  - `sawsCapUrl(name: string): string` → `'https://www.weathersa.co.za/Documents/Warnings/' + name`. It throws `Error('invalid_saws_name')` when the name fails `SAWS_FILE_NAME`.
  - `sawsBand(level: number|null): 'yellow'|'orange'|'red'|null`.
  - `parseSawsFeed(xml: string): Array<{name, office, hazard, nameMs}>`.
    - Unique by name, in feed order.
    - `nameMs` is the name's date and time read as `+02:00`.
    - It takes the last path segment of each `<guid>` (or `<link>`), whatever its host. A name that fails the pattern is skipped.
    - It throws `Error('invalid_saws_feed')` when the text has no `<rss` or `<channel>`.
  - `parseCapAlert(xml: string)` → `{identifier, sentMs, status, msgType, infos}`.
    - Each info is `{event, severity, levelText, level: number|null, band, onsetMs: number|null, expiresMs, headline, description, instruction, areas: Array<{desc, ring: Array<[lon, lat]>}>}`.
    - `level` is read from `alertType` "Warning Level N".
    - It throws `Error('invalid_cap')` when there is no `<alert`, or no `sent`, `status` or `msgType`.
    - An info without `event` or a parseable `expires`, or with no valid area left, is dropped.

- [ ] **Step 1: Write the failing tests** in `cap.test.mjs`, building small XML strings inline:
  - `parseSawsFeed collapses repeated guids and parses the name`:
    - The same guid twice gives one entry.
    - `GP_CAP_SevereThunderstorms_20261124_085823.xml` gives `{office: 'GP', hazard: 'SevereThunderstorms', nameMs: Date.parse('2026-11-24T08:58:23+02:00')}`.
    - A guid on `http://www.weathersa.co.za/...` is still accepted by name.
  - `parseSawsFeed skips names that fail the pattern`: `../x.xml`, `GP_CAP_X_2026.xml` and `GP_CAP_Storm_20261124_085823.xml?y=1` all give no entry.
  - `parseSawsFeed rejects a non-RSS body`: `'<html></html>'` throws `/invalid_saws_feed/`.
  - `sawsCapUrl rebuilds the fixed URL and refuses bad names`.
  - `sawsBand maps levels to colours`: 1 → yellow, 4 → yellow, 5 → orange, 8 → orange, 9 → red, 10 → red, 0, 11 and null → null.
  - `parseCapAlert reads every info in a file`:
    - Two infos, "Warning Level 4" and "Warning Level 2", give `level` 4 and 2, `band` yellow.
    - `onsetMs` and `expiresMs` equal `Date.parse('2026-11-24T13:00:00+02:00')` and `Date.parse('2026-11-24T22:59:59+02:00')`.
    - `sentMs` comes from `<sent>`.
  - `parseCapAlert swaps lat,lon pairs and closes rings`:
    - `"-28.04722,32.20281 -28.1265,32.18901 -28.14261,32.15457 -28.04722,32.20281"` gives `ring[0]` = `[32.20281, -28.04722]` and 4 points.
    - An unclosed ring of 3 distinct points comes back closed (4 points).
  - `parseCapAlert skips a bad polygon but keeps the others`: an area with 2 points, or with `NaN`, or with latitude 95, is dropped, and its sibling area is kept.
  - `parseCapAlert decodes entities`: `&amp;`, `&lt;`, `&#8211;`, `&#x2019;` and `<![CDATA[…]]>` in `description` decode to `&`, `<`, `–`, `’` and the raw text.
  - `parseCapAlert keeps a level it cannot read as null`: `alertType` "Advisory" gives `level: null`, `band: null`, `levelText: 'Advisory'`.
  - `parseCapAlert rejects a file that is not CAP`.

- [ ] **Step 2: Run** `node --test server/providers/saWeather/cap.test.mjs`. Expected: FAIL, `cap.js` does not exist.
- [ ] **Step 3: Implement `cap.js`.**
  - Read tags with one helper, `capTag(block, tag)` (first match, entity-decoded, trimmed).
  - Split `<info>` and `<area>` blocks with a non-greedy regex.
  - Read `<parameter>` pairs by `valueName`.
- [ ] **Step 4: Run** the test file. Expected: all pass.
- [ ] **Step 5: Commit** with the message `Read SAWS warning feeds and CAP alerts`.

### Task 2: Which warnings are current, merged per area

**Files:**
- Create: `server/providers/saWeather/select.js`
- Test: `server/providers/saWeather/select.test.mjs`

**Interfaces:**
- Consumes: `parseSawsFeed` entries and `parseCapAlert` results (Task 1).
- Produces:
  - `ISSUE_GAP_MS = 3_600_000`, `RECENT_MAX_AGE_MS = 4 * 86_400_000`, `RECENT_MAX_FILES = 60`.
  - `recentWarningFiles(entries, nowMs)` → the entries with `nameMs` in `(nowMs − RECENT_MAX_AGE_MS, nowMs + 3_600_000]`, newest first, at most `RECENT_MAX_FILES`.
  - `currentWarningAreas(files, nowMs): Area[]`.
    - `files` is `Array<{name, office, hazard, alert}>`, where `alert` is a `parseCapAlert` result.
    - `Area` is `{stableId: string, name: string, polygons: Array<Array<Array<[lon, lat]>>>, band, warnings: Warning[]}`.
    - `Warning` is `{event, level, band, levelText, severity, onsetMs, expiresMs, sentMs, headline, description, instruction, office}`.
    - `description` is cut to 600 characters and `instruction` to 400, each ending in `…` when cut.
    - Areas are returned sorted by `stableId`.
    - Warnings in an area are sorted worst band first (red, then orange, yellow, null), then by `onsetMs`.
    - `stableId` is `'za-wx:' +` a stable hash of `name|ring` (coordinates at 5 decimals).
    - An area's `polygons` is `[[ring]]`.

**The rule** (the spec's "replace per area, by issue"):
1. Files whose `alert.status` is not `'Actual'` are ignored.
2. Group by `office|hazard`, sort each group by `alert.sentMs`, and number the issues. A file starts a new issue when its `sentMs` is more than `ISSUE_GAP_MS` after the previous file's.
3. Warning W (one info and area in issue k) is replaced when a file in the same group with issue > k has an info that lists an area with the same `desc` and whose window overlaps W's. A window is `[onsetMs ?? sentMs, expiresMs)`; overlap is `a.start < b.end && b.start < a.end`. Only a later warning that is itself shown (unexpired, not replaced) replaces; a Cancel info always replaces, whatever its own expiry, and never shows itself.
4. Drop warnings with `expiresMs <= nowMs`.
5. Merge the remaining (area, warning) pairs by `desc` plus ring. An area's `band` is its worst warning's band. Groups never replace each other, so KZN winds and KZN storms on one area both show.

- [ ] **Step 1: Write the failing tests.** They are synthetic copies of the real replay (spec, "Which warnings to show"). Use one helper `file(office, hazard, sentIso, infos, msgType = 'Update', status = 'Actual')` and areas `X`, `Y`, `Z` with distinct small rings.
  - `an evening warning stays when a next-day issue arrives`:
    - GP storms. File A was sent `2026-11-22T07:20+02:00`: L2, 22 Nov 15:00–23:59, areas X and Y. File B was sent `2026-11-22T17:33+02:00`: L2, 23 Nov 14:00–23:59, areas X and Y.
    - At `2026-11-22T18:00+02:00`, X and Y each have 2 warnings.
  - `files minutes apart are one issue and never replace each other`:
    - Files sent at 10:43, 10:53 and 11:04 on 23 Nov. The first is L4, 23 Nov 13:00–23:59, X. The second is L4, 24 Nov 00:00–18:59, X. The third is L2, 24 Nov 01:00–20:59, X and Y.
    - At `2026-11-23T12:00+02:00`, X has 3 warnings and Y has 1.
  - `a later issue replaces only the areas it names`:
    - Issue 1 was sent 22 Nov 17:33: L2, 23 Nov 14:00–23:59, X, Y and Z. Issue 2 was sent 23 Nov 10:43: L4, 23 Nov 13:00–23:59, X.
    - At 23 Nov 12:00, X has only the L4, and Y and Z have the L2.
  - `a morning re-issue replaces yesterday's for the same areas`:
    - Issue 1 is the 23 Nov 10:53 and 11:04 pair (as above). Issue 2 was sent 24 Nov 08:56: L4, 24 Nov 13:00–22:59, X; and L2, 24 Nov 13:00–20:59, X and Y.
    - At `2026-11-24T10:00+02:00`, every warning shown has `sentMs` = 24 Nov 08:56. X has 2 warnings and Y has 1.
  - `expired warnings are dropped and an area left empty is gone`: an info expiring 24 Nov 08:59, at 24 Nov 10:00, gives `[]`.
  - `a later Cancel removes the areas it lists`: issue 2 is a `Cancel` file listing X with an overlapping window. X is gone and Y stays.
  - `non-Actual files are ignored`: status `Test` gives `[]`.
  - `two hazards on one area merge into one area`:
    - KZN DamagingWinds L2 and KZN SevereThunderstorms L6 on X give one area.
    - Its band is `orange`, and its warnings are orange first, then yellow.
  - `issues are grouped by sent, not by the file name's time`:
    - Two files whose names are 2 hours apart but whose `sent` values are 20 minutes apart.
    - They form one issue, so neither replaces the other.
  - `recentWarningFiles keeps four days, newest first, at most sixty`: with 70 entries over 6 days, the result has at most 60, all within 4 days, sorted by `nameMs` descending.
  - `long texts are cut`: a 700-character description comes back as 600 characters ending in `…`.
- [ ] **Step 2: Run** `node --test server/providers/saWeather/select.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `select.js`** as described above. For the ring hash use a small FNV-1a over the string. Do not add a crypto import.
- [ ] **Step 4: Run** the test file. Expected: all pass.
- [ ] **Step 5: Commit** with the message `Choose the SAWS warnings in force, per area`.

### Task 3: The `/api/sa-weather-warnings` route

**Files:**
- Create: `server/providers/saWeather/index.js`
- Test: `server/providers/saWeather/provider.test.mjs`
- Modify: `server/providers/local.js`. Import and add `saWeatherWarningsProxy()` next to `saElections` (see `git show 923e84fbf -- server/providers/local.js`).
- Modify: `src/tooling/previewServing.test.mjs`. Add `assert.ok(plugins.some(({ name }) => name === 'sa-weather-warnings'))` and the route row `['/api/sa-weather-warnings/unknown', 404]`.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `saWeatherWarningsProxy({fetchImpl, now, log = console} = {})`.
  - It returns `{name: 'sa-weather-warnings', configureServer, configurePreviewServer}`, both mounting `/api/sa-weather-warnings`.
  - A GET on `/` answers `200 {fetchedAt, areas, stale?: true}` with `Cache-Control: no-store`, plus `X-Data-Stale: true` when stale.
- Constants:
  - `SAWS_RSS_URL = 'https://caps.weathersa.co.za/Home/RssFeed'`
  - `RSS_TTL_MS = 600_000`
  - `STALE_MAX_MS = 86_400_000`
  - `CAP_CACHE_MAX = 128`
  - `CAP_CONCURRENCY = 4`
  - RSS cap 4 MiB, CAP cap 2 MiB, both with 20 s timeouts.

**Behaviour.** Copy the skeleton of `server/providers/droneAirspace.js`: `admitSameSiteKeyless`, 405/404/429, `makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 })` and `coalesceProxyRequest`.

A refresh runs these steps:
1. Fetch the RSS, then run `parseSawsFeed` and `recentWarningFiles`.
2. Fetch every name not already in the CAP cache through `sawsCapUrl`, at most 4 at once, and parse each with `parseCapAlert`.
3. A failed or unparseable CAP file is logged by name only, skipped and not cached.
4. If there was at least one candidate and none could be read, the refresh fails.
5. The cache keeps the parsed files. `currentWarningAreas(files, now())` runs at serve time, so a stale snapshot is re-filtered for expiry.

Failures:
- A failed refresh with a snapshot under 24 h old serves it, marked stale.
- A failed refresh without one gives `502 {error: 'sa_weather_unavailable'}`.

- [ ] **Step 1: Write the failing tests.** Call the handler through `configureServer({middlewares: {use(path, fn)}})` with fake `req` and `res` objects, as `server/providers/saElections/provider.test.mjs` does. Use an injected `fetchImpl` stub and `now`.
  - `serves the warnings in force from the feed`:
    - The RSS lists 2 files. Both CAP files answer.
    - The body's `areas` hold the expected area names and bands.
    - Every fetch had `redirect: 'error'` and the User-Agent `GodsEyeView (sa-weather)`.
    - The CAP URLs are exactly `https://www.weathersa.co.za/Documents/Warnings/<name>`, even when the guid said `http://`.
  - `a CAP file that fails is skipped and fetched again next time`:
    - One CAP answers 404. The other's areas are served.
    - After `now` moves past `RSS_TTL_MS`, the failed name is requested again and the good one is not.
  - `stale data is re-filtered for expiry`:
    - The first refresh is fine. Then the RSS answers 500 and `now` moves past the TTL but before expiry: the body has `stale: true` and the same areas.
    - Then `now` moves past `expiresMs`: `areas` is `[]` and `stale` is still true.
  - `no snapshot and no feed answers 502`.
  - `unknown routes answer 404 and other methods 405`.
  - `cross-site browsers are refused`: the header `sec-fetch-site: cross-site` gives 403.
  - `concurrent requests share one refresh`: two requests at once give one RSS fetch.
- [ ] **Step 2: Run** `node --test server/providers/saWeather/provider.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `index.js`** and mount it in `local.js`.
- [ ] **Step 4: Run** the provider test file and `node --test src/tooling/previewServing.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `Serve current SAWS warnings at /api/sa-weather-warnings`.

### Task 4: Weather client: source, records and cards

**Files:**
- Create: `src/layers/saWeather/source.js`, `records.js`, `cards.js`
- Test: `src/layers/saWeather/records.test.mjs`, `cards.test.mjs`, `source.test.mjs`

**Interfaces:**
- Consumes: the route's body (Task 3).
- Produces:
  - `createSaWeatherSource({fetchImpl} = {})` → `{getSnapshot({signal}), getSnapshotDetail({signal}) → {rows, stale, fetchedAt}}`.
    - It fetches `/api/sa-weather-warnings`, read through `readResponseJsonCapped` (from `src/sources/httpBody.js`) with a 16 MiB cap.
    - `rows` is `normalizeSaWeatherAreas(payload.areas)`.
    - It throws `SAWS HTTP <status>` or `Malformed SA weather warnings`.
    - Copy `src/layers/perimeters/source.js`.
  - `normalizeSaWeatherAreas(areas): Area[] | null`. It returns null when the input is not an array. It skips any item without a string `stableId`, a valid polygon or at least one warning with a finite `expiresMs`.
  - `SA_WEATHER_BANDS = ['yellow', 'orange', 'red']`.
  - `saWeatherBandRank(band)`: null 0, yellow 1, orange 2, red 3.
  - `saWeatherBandAccent(band)`: the hex colours in Global Constraints.
  - `SA_WEATHER_OVERLAY_SOURCE_ID = 'sa-weather-warnings'`.
  - `formatSastTime(ms)` → for example `Tue 24 Nov 13:00`.
    - Built with `formatDate` (`src/i18n/index.js`) and `timeZone: 'Africa/Johannesburg'`, `hourCycle: 'h23'`.
    - English output is exactly `Tue 24 Nov 13:00`. Build it from parts if Intl adds commas.
  - `formatSastRange(startMs, endMs)`:
    - `Tue 24 Nov 13:00–22:59 SAST` on one day.
    - Otherwise `Tue 24 Nov 13:00 – Wed 25 Nov 06:00 SAST`.
  - `buildSaWeatherCard(area)` → an overlay entry shaped like `entry()` in `src/layers/saElections/cards.js`:
    - `id: 'sa-weather-card:' + stableId`, `title: area.name`, accent = the worst band's accent.
    - Details for each warning, in order:
      1. `t('{band} · Level {level} · {event}')`, where band is `t('Yellow')`, `t('Orange')` or `t('Red')`; if the level is null, `'{levelText} · {event}'`.
      2. `formatSastRange(onsetMs ?? sentMs, expiresMs)`.
      3. `t('Issued {time}', {time: formatSastTime(sentMs)})`.
      4. The description, cut to 200 characters.
      5. The instruction, cut to 160 characters, when present.
    - Last line: `t('Source: South African Weather Service')`.

- [ ] **Step 1: Write the failing tests.**
  - `records`: valid areas pass. An area with no warnings, a bad ring, or a missing `stableId` is dropped. A non-array gives `null`.
  - `cards`:
    - `card lists warnings worst first with SAST times`: a red L9 and a yellow L2 on one area. The details start with `Red · Level 9 · Disruptive Rain`, and the accent is `#eb5757`.
    - `times are SAST whatever the machine zone`: `Date.parse('2026-11-24T11:00:00Z')` to `Date.parse('2026-11-24T20:59:00Z')` formats as `Tue 24 Nov 13:00–22:59 SAST`.
    - `a range over midnight names both days`.
    - `a null level shows the alert text`.
    - `long text is cut`.
  - `source`: a 500 gives a rejection matching `/SAWS HTTP 500/`. A body without `areas` gives `/Malformed/`. A stale body comes through as `stale: true`.
- [ ] **Step 2: Run** `TZ=UTC node --test src/layers/saWeather/` (all three files). Expected: FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** the step 2 command again, and once more with `TZ=Pacific/Auckland`. Expected: both pass.
- [ ] **Step 5: Commit** with the message `Add the SA weather warnings source, records and card`.

### Task 5: Weather layer and wiring

**Files:**
- Create: `src/layers/saWeather/index.js`, `src/layers/saWeather/layer.test.mjs`, `src/app/layers/saWeather.js`
- Modify, following `git show 888244efc` line by line:
  - `src/app/constructCatalog.js`: the import, a `LOCAL_ONLY_LAYER_METADATA` entry, and construction with `source: sources['sa-weather-warnings']`.
  - `src/app/sourceComposition.js`: `'sa-weather-warnings': contract(['sa-weather-warnings'], ['getSnapshot'])`.
  - `src/standalone/layerSources.js`: `'sa-weather-warnings': createSaWeatherSource()`.
  - `src/ui/layerPanel.js`: the "South Africa" ids become `['sa-councils-2026', 'sa-wards-2026', 'sa-weather-warnings']`.
  - `src/ui/layerNames.js`: `'sa-weather-warnings': msg('SA weather warnings')`.
  - `src/voice/layerManifest.js`: in `VOICE_OFF_LAYERS`, `'sa-weather-warnings': 'fork-local South African weather warnings layer; no room in the prompt budget'`.
  - `src/data/dataCredits.js`: key `za-saws`, html `South African weather warnings: <a href="https://www.weathersa.co.za/" target="_blank" rel="noopener">South African Weather Service</a> CAP feed`.
  - `src/data/dataCredits.test.mjs`: a test that the credit names "South African Weather Service" and links `https://www.weathersa.co.za/`.
  - `scripts/package-boundaries.json`, and `scripts/format-scope.json` if the precedent needs it.
  - `src/app/constructCatalog.test.mjs` and `src/app/sourceComposition.test.mjs`: layer count 43 → 44, and `assert.ok(first.get('sa-weather-warnings'))`.

**Interfaces:**
- Consumes: Task 4's exports, and `droneAirspaceAnchorDegrees` (via `saAnchorDegrees` in `src/layers/saElections/cards.js`, or directly).
- Produces: `createSaWeatherLayer({source, overlayHost, picking, inputFor, now = () => Date.now()})`, the layer object.
  - `id: 'sa-weather-warnings'`, `name: 'SA weather warnings'`, `icon: '⛈️'`, `source: 'SAWS'`, `updateInterval: 600000`.
  - Methods: `init`, `enable`, `disable`, `update`, `destroy`, `getAnalystRecords`, `getRowControls`, `getStats`.
  - Copy `src/layers/droneAirspace/index.js`:
    - draw sets `sa-weather-warnings:<n>:fills` and `:lines`;
    - fill alpha 0.35;
    - draped outline, width 2, alpha 0.9;
    - pick prefix `sa-weather:`;
    - the same click handler and signature skip.
  - Differences from droneAirspace:
    - Before drawing, each update drops warnings with `expiresMs <= now()`, and drops areas left empty.
    - Items are pushed yellow, then orange, then red, so red is drawn last.
    - If the selected area has gone, its card is cleared.
    - `getRowControls()`: the legend is the three bands with counts. Its first item's blurb is `t('SAWS impact-based warnings. Colour is the impact, the number the likelihood. For decisions, check weathersa.co.za.')`. When no area is drawn, it is preceded by `{label: t('No warnings in force'), color: '#9aa4ad', count: 0}`.
    - `getAnalystRecords()` gives `{id, name, band, warnings: <count>, events: <unique event names joined by ', '>, lat, lon}`.

- [ ] **Step 1: Write `layer.test.mjs`**, copying the setup of `src/layers/saElections/layer.test.mjs` (`bindFakeDraw`, `fakeInputUnderLabel`). Tests:
  - `draws one fill per area, red last`: areas yellow, red, orange give the fill items in the order yellow, orange, red.
  - `drops warnings that expired since the server answered`: with `now` after one area's only warning ends, that area is not drawn.
  - `clicking an area shows its card and clicking empty ground clears it`.
  - `the selected area's card goes when its warnings expire`.
  - `an unchanged snapshot does not redraw`: the second `set` count stays the same.
  - `with no warnings the legend says so`.
  - `disable hides the sets and clears the card`.
  - `a source error is reported in getStats`.
- [ ] **Step 2: Run** `node --test src/layers/saWeather/layer.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the layer, the adapter (a copy of `src/app/layers/saElections.js`) and every wiring edit above.
- [ ] **Step 4: Run** the layer test, plus `node --test src/app/constructCatalog.test.mjs src/app/sourceComposition.test.mjs src/data/dataCredits.test.mjs` and `npm run check:boundaries`. Expected: all pass, with `check:boundaries` ending without errors.
- [ ] **Step 5: Commit** with the message `Add the SA weather warnings layer`.

### Task 6: The `/api/sa-earthquakes` route and its client source

**Files:**
- Create: `src/layers/saQuakes/records.js`, `src/layers/saQuakes/source.js`, `server/providers/saQuakes.js`
- Test: `src/layers/saQuakes/records.test.mjs`, `src/layers/saQuakes/source.test.mjs`, `server/providers/saQuakes.test.mjs`
- Modify: `server/providers/local.js` (mount it) and `src/tooling/previewServing.test.mjs` (plugin name `sa-earthquakes`, route row `['/api/sa-earthquakes/unknown', 404]`).

**Interfaces:**
- Produces:
  - `normalizeEmscSnapshot(geojson): Row[] | null`.
    - Row is `{stableId, lon, lat, depthKm, mag, magType, timeMs, region, network}`.
    - It returns null unless `geojson.features` is an array.
    - It skips a feature without a string `unid`, a finite `mag`, or a parseable `time`, and one with lat or lon out of range.
    - `stableId` = `properties.unid`.
    - `lon` and `lat` come from `properties.lon` and `properties.lat`, falling back to the geometry.
    - `depthKm` = `properties.depth`, or null.
    - `timeMs` = `Date.parse(time)`.
    - `region` = `flynn_region` in title case ("SOUTH AFRICA" → "South Africa").
    - `network` = `auth` or null.
    - Duplicate `unid`s keep the one with the later `lastupdate`.
    - The result is sorted newest first.
  - `SA_QUAKE_WINDOW_MS = 30 * 86_400_000`.
  - `createSaQuakesSource({fetchImpl} = {})` → `getSnapshot` / `getSnapshotDetail`, from `/api/sa-earthquakes`, with a 4 MiB cap. It throws `EMSC HTTP <status>` or `Malformed SA earthquake snapshot`.
  - `saQuakesProxy({fetchImpl, now} = {})` → plugin `sa-earthquakes` at `/api/sa-earthquakes`, built like `droneAirspace.js`.
    - TTL 600_000 ms, stale for up to 24 h, cap 4 MiB, timeout 20 s, User-Agent `GodsEyeView (sa-quakes)`.
    - The upstream URL is `https://www.seismicportal.eu/fdsnws/event/1/query?` + `URLSearchParams({format: 'json', minlat: '-35', maxlat: '-22', minlon: '16', maxlon: '33', orderby: 'time', limit: '500', starttime})`.
    - `starttime` is `new Date(now() − SA_QUAKE_WINDOW_MS).toISOString().slice(0, 19)`.
    - A `204` from upstream means `rows: []`.
    - At serve time, rows older than the 30-day window are dropped, so stale serving stays honest.
    - The body is `{fetchedAt, rows, stale?}`. A failure gives `502 {error: 'sa_earthquakes_unavailable'}`.

- [ ] **Step 1: Write the failing tests.**
  - `records`:
    - `reads EMSC's ISO time, positive depth and region`: with properties `depth: 10` and geometry z `-10`, `depthKm` is 10; `timeMs === Date.parse('2026-11-21T15:11:16.0Z')`; `region === 'South Africa'`; `network === 'SASN'`.
    - `skips events without a magnitude or time`.
    - `keeps the latest update of a repeated event`.
    - `returns null for a non-collection`.
  - `provider`:
    - `asks EMSC for the SA box over the last 30 days`: the URL's params are exactly as above, with `starttime` 30 days before the injected `now`; `redirect` is `'error'`; the User-Agent is as above.
    - `a 204 is an empty list, not an error`.
    - `serves stale rows on failure and drops those past 30 days`.
    - `502 without a snapshot`.
    - `404 and 405`.
    - `cross-site 403`.
  - `source`: the error messages, and that `stale` passes through.
- [ ] **Step 2: Run** `node --test src/layers/saQuakes/ server/providers/saQuakes.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files and mount the provider.
- [ ] **Step 4: Run** the step 2 command again, plus `node --test src/tooling/previewServing.test.mjs`. Expected: pass.
- [ ] **Step 5: Commit** with the message `Serve SA earthquakes from EMSC at /api/sa-earthquakes`.

### Task 7: Quake layer, card and wiring

**Files:**
- Create: `src/layers/saQuakes/cards.js`, `src/layers/saQuakes/index.js`, `src/layers/saQuakes/cards.test.mjs`, `src/layers/saQuakes/layer.test.mjs`, `src/app/layers/saQuakes.js`
- Modify: the same wiring files as Task 5, for id `sa-earthquakes`:
  - The source key `'sa-earthquakes'` uses `createSaQuakesSource()`.
  - The panel ids become `[..., 'sa-weather-warnings', 'sa-earthquakes']`.
  - Name `msg('SA earthquakes (30 days)')`.
  - Voice-off reason `'fork-local South African earthquake layer; no room in the prompt budget'`.
  - Credit `za-emsc`, html `SA earthquakes: <a href="https://www.seismicportal.eu/" target="_blank" rel="noopener">EMSC-CSEM SeismicPortal</a> (CC BY 4.0), recorded by the South African National Seismograph Network (Council for Geoscience)`.
  - Its test checks for "EMSC-CSEM SeismicPortal" and "CC BY 4.0".
  - Layer counts 44 → 45.

**Interfaces:**
- Consumes: Task 6 rows, and `earthquakeMagnitudeTitle` and `earthquakeSeverityName` from `src/layers/earthquakes/model.js`. Add the `package-boundaries` entry the import needs. Also `formatSastTime` from `src/layers/saWeather/cards.js`.
- Produces:
  - `SA_QUAKES_OVERLAY_SOURCE_ID = 'sa-earthquakes'`.
  - `saQuakeAgeBand(timeMs, nowMs): 'day' | 'week' | 'month'`: under 24 h is `day`, under 7 days is `week`, otherwise `month`.
  - `SA_QUAKE_AGE_ACCENTS = {day: '#eb5757', week: '#f2994a', month: '#f2c94c'}`.
  - `saQuakeDotPx(mag)` = `Math.min(16, Math.max(6, 6 + 3 * (mag − 2)))`.
  - `buildSaQuakeCard(row, nowMs)`:
    - title `` `${earthquakeMagnitudeTitle(mag)} · ${earthquakeSeverityName(mag, t)}` ``;
    - details `[region, formatSastTime(timeMs) + ' SAST', t('Network: {network}') (when present), t('Source: EMSC-CSEM SeismicPortal')]`;
    - accent = the age band's accent.
  - `createSaQuakesLayer({source, overlayHost, picking, inputFor, now = () => Date.now()})`.
    - `id: 'sa-earthquakes'`, `name: 'SA earthquakes (30 days)'`, `icon: '〰️'`, `source: 'EMSC'`, `updateInterval: 600000`.
    - One `draw.points` set `sa-earthquakes:<n>:dots` with `clampTo: 'both'`.
    - Each item is `{id: 'sa-quake:' + stableId, position: fromDegrees(lon, lat), pixelSize: saQuakeDotPx(mag), color: <age colour>, outlineColor: [1, 1, 1, 0.9], outlineWidth: 1}`, ordered oldest first so the newest is drawn on top.
    - The click card copies the weather layer's handling.
    - The legend is the three age bands, labelled `t('Last 24 hours')`, `t('Last 7 days')` and `t('Last 30 days')`, with counts. The first item's blurb is `t('Events recorded by the South African seismograph network (SASN), via EMSC. Includes mine tremors, which are not labelled separately. Depth is not measured, so it is not shown.')`.
    - `getAnalystRecords` gives `{id, magnitude, timeMs, region, lat, lon}`.

- [ ] **Step 1: Write the failing tests.**
  - `cards`:
    - `the card shows magnitude, class, place and SAST time`: an M2.6 at `2026-11-21T15:11:16Z` gives the title `M2.6 · Minor` and the details `South Africa` and `Sat 21 Nov 17:11 SAST`.
    - `age bands split at a day and a week`.
    - `dot size grows with magnitude within 6 to 16 px`.
  - `layer` (`bindFakeDraw`):
    - `draws a dot per event, newest last, coloured by age`.
    - `clicking a dot shows its card`.
    - `an empty list draws nothing and is not an error`.
    - `disable clears`.
- [ ] **Step 2: Run** `TZ=UTC node --test src/layers/saQuakes/`. Expected: FAIL on the new files.
- [ ] **Step 3: Implement** the layer, cards, adapter and wiring.
- [ ] **Step 4: Run** the step 2 command again, plus `node --test src/app/constructCatalog.test.mjs src/app/sourceComposition.test.mjs src/data/dataCredits.test.mjs` and `npm run check:boundaries`. Expected: pass.
- [ ] **Step 5: Commit** with the message `Add the SA earthquakes layer`.

### Task 8: Translations

**Files:**
- Modify: `src/i18n/locales/{ar,de,es,fr,he,it,ja,pt,ru,sv,uk,zh-CN}.json` by hand, then `zh-Hant.json` through `npm run i18n -- --zh-hant`.

- [ ] **Step 1:** List the missing strings with `npm run i18n -- --missing de`. Expected: the new strings from Tasks 4, 5 and 7.
- [ ] **Step 2:** Translate each string into the 12 locales. Keep the placeholders (`{band}`, `{level}`, `{event}`, `{time}`, `{network}`) and the proper names (SAWS, SASN, EMSC-CSEM SeismicPortal, weathersa.co.za) unchanged. Where a string is legitimately identical to the English, add it to `src/i18n/same-as-english.json` as the precedent does.
- [ ] **Step 3:** Run `npm run i18n -- --zh-hant`, then `npm run i18n`. Expected: no missing strings in any locale.
- [ ] **Step 4:** Run `npm test`. Expected: the i18n tests and the whole suite pass. Quote the last line.
- [ ] **Step 5: Commit** with the message `Translate the SA weather and earthquake layers`.

### Task 9: Docs and full verification

**Files:**
- Create: `docs/SOUTH_AFRICA_HAZARDS.md`. It covers:
  - what each layer shows;
  - the sources and their terms: SAWS RSS "Public Domain" versus the CAP files' `scope: Restricted`, and EMSC's CC BY 4.0 with no bulk mirroring;
  - the update rule and its known cost (the KZN case);
  - the refresh times;
  - that nothing is cached to disk;
  - the limits: tremors are not labelled, depth is a placeholder, and the box includes neighbouring countries.
- Modify: `DATA_SOURCES.md`. Add one row per source, next to the election row at line 57, in that table's format.
- Modify: `scripts/format-scope.json`, if the new files need it (the precedent is commit `0a89a07e2`).

- [ ] **Step 1:** Write the two docs.
- [ ] **Step 2:** Run `npm run format:check`, then `npm run check:boundaries`, then `npm test`. Expected: each passes. Quote the last line of each.
- [ ] **Step 3:** Build in a scratch worktree:
  ```
  git worktree add --detach <scratch>/sa-hazards-build HEAD
  ln -s "$PWD/node_modules" <scratch>/sa-hazards-build/node_modules
  cd <scratch>/sa-hazards-build && npm run build
  ```
  Then remove the symlink with `rm`, and remove the worktree with `git worktree remove`. Expected: the build succeeds. Quote the last line.
- [ ] **Step 4: Commit** with the message `Document the SA weather and earthquake layers`.

The controller then checks the live routes and Chrome:
- `curl -s localhost:4173/api/sa-weather-warnings` returns current areas; run `docker compose restart` first if the route answers 404.
- `/api/sa-earthquakes` returns rows from the last 30 days.
- In Chrome, both layers sit under South Africa; warning areas are coloured and their cards show SAST times; dots show cards; turning a layer off clears it.
