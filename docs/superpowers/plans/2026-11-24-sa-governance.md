# SA Governance Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show who runs each South African council on the fork's election map:
- audit opinions, section 139 interventions and metro mayors, as colour views and card lines on `sa-councils-2026`;
- a new `sa-districts-2026` outline layer.

**Architecture:**
- A keyless same-origin server provider, `server/providers/saGovernance/`, serves Treasury audit opinions, two committed curated tables (interventions and metro mayors) and a council-to-district map at `/api/sa-governance`. It serves MDB district polygons with their member councils at `/api/sa-governance/districts`.
- The councils layer gains a `view` param (party, audit or intervention) with a segmented switch.
- A small district layer draws pickable outlines.

**Tech Stack:** plain ES modules, `node:test`, and the app's draw port. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-sa-governance-design.md`. Read it first: it holds the checked facts, the decisions and the anti-goals.

## Global Constraints

- No new npm dependencies. No SAWS, EMSC, IEC, MDB or Treasury payloads in git. The committed curated tables are the only data, and the spec allows them.
- Never read, print or write `.env`. Never touch `compose.override.yaml`.
- Upstream fetches:
  - fixed hosts only: `https://municipaldata.treasury.gov.za/api/cubes/audit_opinions/…` and the MDB `services7.arcgis.com/oeoyTUJC8HEeYsRB` FeatureServers;
  - `redirect: 'error'`, TLS on, the capped readers from `server/providers/common/http.js`, and timeouts;
  - User-Agent `GodsEyeView (sa-governance)`. The existing `fetchBoundaries` keeps `GodsEyeView (sa-elections)`.
- The election provider's caches, results and routes must not change behaviour. `/api/sa-elections/districts` stays 404.
- Layer ids:
  - `sa-districts-2026` (new): local-only in `LOCAL_ONLY_LAYER_METADATA`, in `VOICE_OFF_LAYERS`, and in the "South Africa" panel group after the existing SA ids;
  - the councils layer keeps its id `sa-councils-2026`.
- Credit key: `za-governance`.
- Picks: no pick-ownership registration. No Cesium imports in `src/layers`. Every line or point item follows the draw contract (`src/render/contract/draw.d.ts`). Each layer gets one test that places an item through the real stub renderer (`createStubRenderer`, as `src/layers/saQuakes/layer.test.mjs` does).
- Overlay card detail lines do not wrap: every governance line is cut to 90 characters, ending in `…`.
- Dates shown are South African (`timeZone: 'Africa/Johannesburg'`). A date-only ISO string (`YYYY-MM-DD`) renders as `19 Nov 2026` whatever the machine's zone.
- Audit colours:
  - clean (`unqualified`) `#2e9e5b`;
  - with findings (`unqualified_emphasis_of_matter`) `#9ccc65`;
  - `qualified` `#f2c94c`;
  - `adverse` `#f2994a`;
  - `disclaimer` `#eb5757`;
  - `outstanding` `#9b6dd6`;
  - no data `#9aa4ad`.
- Intervention colour `#eb5757`. District outline colours: `#eb5757` for districts on the section 139 list, `#d0d7de` for the rest.
- Git: commit only on branch `sa-governance`, staging only your own files and never `.superpowers/`. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014bF2NXE9haRvYkDKrwetUs
  ```
- Tests: one file with `node --test <file>` (the directory form fails on Node 24; use globs). The whole suite with `npm test`, using Node 24 via `source ~/.nvm/nvm.sh >/dev/null; nvm use 24.22.3 >/dev/null`.
- Never run `npm run build` in the main checkout. Task 9 builds in a scratch worktree.
- New `t()`/`msg()` strings fail the 13 per-locale "catalog matches the code" tests until Task 8. That is expected (controller ruling). Each implementer from Task 5 to Task 7 confirms those are the only failures.

## Review Focus

1. **Audits unavailable** (Treasury down on first boot). The audit view's legend says "Audit results unavailable" or "Loading audit results…", and cards say "Audit: unavailable". Councils are never silently painted all grey (Task 6 test).
2. **A new Treasury year that is mostly "outstanding".** The latest-year rule counts only rows that are not "outstanding", so the map stays on the last real year (Task 2 test).
3. **Switching views with no new fetch.** The colours, legend and card accent change at once, and the party view still works while governance is unavailable (Task 6 tests).
4. **Councils and districts both on.** District fills are not pickable, so clicking inside a council opens the council card. A district card opens only from its outline (Task 7 test).
5. **Long verbatim text** (intervention types, member lists, metro notes) never makes a card line longer than 90 characters (Task 5 tests).

---

### Task 1: Curated tables

**Files:**
- Create: `server/providers/saGovernance/interventions-2026-08.json`, `server/providers/saGovernance/metros.json` and `server/providers/saGovernance/tables.js`.
- Test: `server/providers/saGovernance/tables.test.mjs`.

**Interfaces:**
- Produces:
  - `INTERVENTIONS`: `{asOf: '2026-08', source: string, sourceUrl: string, rows: Array<{code, name, province, type, since}>}`.
  - `METROS`: `{rows: Array<{code, status: 'elected'|'unresolved', mayor?, party?, coalition?: string[], electedOn?: 'YYYY-MM-DD', note, asOf: 'YYYY-MM-DD', sourceUrl}>}`.
  - `validateInterventions(value)` and `validateMetros(value)`, each returning the value or throwing `Error('invalid_governance_table: <what>')`.
  - The tables are loaded with `readFileSync` and `JSON.parse` next to the module (server only), validated at import, and frozen.

**Data (exact).** `interventions-2026-08.json`:
- `asOf: "2026-08"`.
- `source: "CoGTA reply to parliamentary question NW4545, Annexure A (published by PMG, 14 Sep 2026)"`.
- `sourceUrl: "https://pmg.org.za/committee-question/40568/"`.
- `rows`, in this order. `type` and `since` are verbatim from the annexure.

| code | name | province | type | since |
|---|---|---|---|---|
| EC139 | Enoch Mgijima LM | EC | S139(7) – National intervention | April 2022 |
| DC12 | Amathole DM | EC | S139(5) | January 2021 |
| EC104 | Makana LM | EC | S139(5) | 2019 |
| DC15 | OR Tambo DM | EC | S139(5) and (c) | 8 Dec 2021 |
| EC145 | Walter Sisulu LM | EC | S139(5)(a) | 23 Feb 2022 |
| MAN | Mangaung Metropolitan Municipality | FS | S139(7) – National intervention | April 2022 |
| FS205 | Mafube LM | FS | S139(5)(a) and (c) | June 2022 |
| FS182 | Tokologo LM | FS | S139(5)(a) and (c) | June 2022 |
| FS162 | Kopanong LM | FS | S139(1)(b), read with S63 of the Water Services Act | September 2023 |
| FS184 | Matjhabeng LM | FS | S139(5)(a) and (c) | October 2024 |
| FS185 | Nala LM | FS | S139(1)(b) | 28 May 2025 |
| FS181 | Masilonyana LM | FS | S139(1)(b) | February 2026 |
| FS203 | Ngwathe LM | FS | S139(5)(a) and (b) | 26 June 2026 |
| KZN224 | Impendle LM | KZN | S139(1)(b) | 15 June 2026 |
| GT421 | Emfuleni LM | GT | S139(5) | June 2018 |
| GT484 | Merafong LM | GT | S139(5) | September 2022 |
| DC36 | Waterberg DM | LP | S139(5) | December 2025 |
| MP312 | Emalahleni LM | MP | S139(5) | October 2018 |
| MP307 | Govan Mbeki LM | MP | S139(5) | October 2018 |
| MP302 | Msukaligwa LM | MP | S139(5) | October 2018 |
| MP321 | Thaba Chweu LM | MP | S139(5) | October 2018 |
| MP305 | Lekwa LM | MP | S139(7) – National intervention | April 2021 |
| NC094 | Phokwane LM | NC | S139(5) | July 2020 |
| NC075 | Renosterberg LM | NC | S139(5) | August 2020 |
| NC091 | Sol Plaatje LM | NC | S139(1)(b) | May 2026 |
| NW372 | Madibeng LM | NW | S139(5) | January 2022 |
| NW382 | Tswaing LM | NW | S139(5) | January 2022 |
| DC39 | Dr Ruth Segomotsi Mompati DM | NW | S139(5) | January 2022 |
| NW374 | Kgetleng Rivier LM | NW | S139(5) | January 2022 |
| NW385 | Ramotshere LM | NW | S139(5) | January 2022 |
| NW392 | Naledi LM | NW | S139(5) | January 2022 |
| NW384 | Ditsobotla LM | NW | S139(5); national intervention under S139(7) approved 3 Sept 2025 | August 2025 |
| NW403 | Matlosana LM | NW | S139(5) | August 2024 |
| WC053 | Beaufort West LM | WC | S139(5)(a) | August 2021 |
| WC041 | Kannaland LM | WC | S139(5)(a) | December 2023 |
| DC4 | Garden Route DM | WC | S139(1)(a) | October 2024 |
| WC031 | Theewaterskloof LM | WC | S139(5)(a) | November 2024 |

`metros.json`: the controller supplies the exact 8 rows in the dispatch, after re-checking Nelson Mandela Bay. Their shape is in Interfaces above.

- [ ] **Step 1: Write the failing tests:**
  - `the intervention list holds the 37 annexure rows`: there are 37 rows, the code list equals the table above in order, and every row has a non-empty name, province, type and `since`;
  - `five listed councils are districts`: the codes matching `^DC\d+$` are exactly DC12, DC15, DC36, DC39 and DC4;
  - `the metro table covers the 8 metros`: its codes, sorted, are exactly `['BUF','CPT','EKU','ETH','JHB','MAN','NMA','TSH']`;
  - `an elected metro row names its mayor and date`: `status: 'elected'` requires `mayor`, `party` and a valid `electedOn`;
  - `every metro row has a valid ISO asOf and an https sourceUrl`;
  - `validation rejects bad rows`: a duplicate code, an empty type, `status: 'maybe'`, `asOf: '24 Nov'` and an `http:` sourceUrl each throw `/invalid_governance_table/`.
- [ ] **Step 2:** Run `node --test server/providers/saGovernance/tables.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Write both JSON files and `tables.js`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Add the section 139 and metro mayor tables`.

### Task 2: Audits reader

**Files:**
- Create: `server/providers/saGovernance/audits.js`.
- Test: `server/providers/saGovernance/audits.test.mjs`.

**Interfaces:**
- Produces:
  - `AUDIT_OPINIONS = ['unqualified','unqualified_emphasis_of_matter','qualified','adverse','disclaimer','outstanding']`.
  - `latestAuditYear(aggregate)`:
    - `aggregate` is the body of `…/audit_opinions/aggregate?drilldown=financial_year_end.year|opinion.code&pagesize=500`, whose `cells` are `{'financial_year_end.year', 'opinion.code', _count}`;
    - it returns the latest year with 200 or more non-`outstanding` rows, or `null`.
  - `normalizeAuditFacts(facts, year)`:
    - `facts` is the body of `…/audit_opinions/facts?cut=financial_year_end.year:<year>&pagesize=500`;
    - it returns `{year, byCode: {CODE: {opinion, label}}}`;
    - a row with an unknown `opinion.code` keeps `opinion: 'other'`;
    - it throws `invalid_audits` when `data` is not an array or has fewer than 200 rows.
  - `fetchAudits({fetchImpl, signal})`: both requests, each capped at 1 MiB with a 30 s timeout, `redirect: 'error'` and the User-Agent. It returns the normalised value.

- [ ] **Step 1: Write the failing tests:**
  - `the latest year skips a year that is mostly outstanding`: 2024 has 247 real rows and 10 outstanding; 2025 has 50 real rows and 207 outstanding. The result is 2024;
  - `null when no year qualifies`;
  - `facts normalise by code`, with `CPT` giving `{opinion: 'unqualified', label: 'Unqualified - No findings'}`;
  - `fewer than 200 rows is invalid`;
  - `fetchAudits asks the fixed URLs with the right options`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Read Treasury audit opinions for the latest real year`.

### Task 3: District boundaries and council membership

**Files:**
- Modify: `server/providers/saElections/boundaries.js` (adds only).
- Test: `server/providers/saElections/boundaries.test.mjs` (extend, or create a new test file if none exists), plus one assertion in `server/providers/saElections/provider.test.mjs`.

**Interfaces:**
- `MDB_LAYERS.districts = 'https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_District_Municipalities_2026/FeatureServer/0'`.
- `OUT_FIELDS.districts = 'DISTRICT,DISTRICT_N,CATEGORY,PROVINCE'`.
- The `toArea('districts', f)` branch returns `{id: DISTRICT, name: DISTRICT_N ?? DISTRICT, code: DISTRICT, province, category, polygons}`.
- `fetchCouncilDistricts({fetchImpl, signal})` queries the councils layer with `outFields=CAT_B,MUNICNAME,DISTRICT,DISTRICT_N`, `returnGeometry=false` and `f=json`. It returns `Array<{code, name, district, districtName}>`. It throws `incomplete_membership` if the set is incomplete or empty.

- [ ] **Step 1: Write the failing tests:**
  - `fetchBoundaries reads districts`, with a stubbed FeatureServer page;
  - `fetchCouncilDistricts maps councils to districts`, where KZN212 maps to DC21 Ugu;
  - in the provider test, `/api/sa-elections/districts` still answers 404.

  First confirm with grep that nothing in `server/providers/saElections/` iterates `MDB_LAYERS`, and say so in the report.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Fetch MDB district boundaries and council membership`.

### Task 4: The governance provider

**Files:**
- Create: `server/providers/saGovernance/index.js` and `server/providers/saGovernance/provider.test.mjs`.
- Modify:
  - `server/providers/local.js`: mount `saGovernanceProxy()` after `saQuakesProxy()`;
  - `src/tooling/previewServing.test.mjs`: the plugin name `sa-governance` and the row `['/api/sa-governance/unknown', 404]`.

**Interfaces:**
- `saGovernanceProxy({fetchImpl, now, cacheDir = path.join(process.cwd(), '.gev-cache', 'sa-governance'), fsImpl = fs.promises, log = console} = {})`.
  - Plugin name: `sa-governance`. It mounts `/api/sa-governance` on both `configureServer` and `configurePreviewServer`.
- `GET /` returns `200 {audits: {year, fetchedAt, byCode} | null, auditsStatus: 'ok'|'stale'|'failed', interventions: INTERVENTIONS, metros: METROS, districtOf: {CAT_B: {code, name}} | null}`.
  - The curated tables are always present.
  - An audits failure never fails the route.
- `GET /districts` returns `200 {fetchedAt, areas: Array<district area + members: Array<{code, name}>>, stale?: true}`, or `502 {error: 'sa_districts_unavailable'}` when nothing is held and the fetch fails.
- Cache and stale behaviour:
  - Audits: refreshed daily, stale for up to 30 days, saved on disk as `audits.json` (`{version: 1, fetchedAt, year, byCode}`).
  - Districts and membership: refreshed weekly, stale for up to 90 days, saved as `districts.json` (`{version: 1, fetchedAt, areas, members}`).
  - Disk reads and writes use `readJsonFile` and `writeJsonAtomic` from `server/providers/saElections/cache.js`.
  - Requests are coalesced, run after the same-site gate, and rate-limited (`makeRateLimiter({windowMs: 60_000, max: 60, globalMax: 600})`). Unknown paths give 404, other methods 405.
  - Logs give a code or name only, never a message or body (same `errorLabel` as `server/providers/saQuakes.js`).

- [ ] **Step 1: Write the failing tests** (stubbed fetch and fs, injected `now`):
  - the main route serves all four parts;
  - an audits failure with no cache gives `auditsStatus: 'failed'`, `audits: null` and the tables;
  - a failure after success gives `stale` and the old audits; past 30 days it gives `failed`;
  - the disk cache is reused after a restart without fetching;
  - districts carry their member councils;
  - districts give 502 when nothing is held;
  - 404, 405 and cross-site 403;
  - concurrent requests share one refresh.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement and mount.
- [ ] **Step 4:** Run the provider tests and `node --test src/tooling/previewServing.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Serve SA governance data at /api/sa-governance`.

### Task 5: Client governance model

**Files:**
- Create in `src/layers/saGovernance/`:
  - `source.js`, `records.js` and `views.js`;
  - their `*.test.mjs` files.

**Interfaces:**
- `createSaGovernanceSource({fetchImpl} = {})` returns `{getSnapshot({signal}), getDistricts({signal})}`.
  - The responses are capped at 8 MiB and 40 MiB.
  - Errors: `SA governance HTTP <status>` and `Malformed SA governance data`.
- `normalizeGovernance(payload)` returns `{audits: {year, byCode: Map}|null, auditsStatus, interventions: Map<code,row>, interventionsAsOf, interventionsSource, metros: Map<code,row>, districtOf: Map<code,{code,name}>}`.
- `normalizeDistricts(payload)` returns `{areas, stale, fetchedAt}`. The area validation follows `src/layers/saElections/records.js`.
- `views.js`:
  - `SA_COUNCIL_VIEWS = ['party','audit','intervention']`.
  - `auditYearLabel(year)`: 2024 gives `'2023/24'`.
  - `AUDIT_BANDS`: an ordered list of `{key, label, color}` with the colours from the Global Constraints. The labels are `msg('Clean audit')`, `msg('Unqualified with findings')`, `msg('Qualified')`, `msg('Adverse')`, `msg('Disclaimer')`, `msg('Outstanding')` and `msg('No audit data')`.
  - `auditBand(opinion)`.
  - `saGovernanceColor(row, view, gov)` returns `{color, strength: 'strong'|'faint'}`, or `null` in the party view (the caller keeps using `saAreaColor`).
  - `governanceLines(code, gov)` returns `string[]` for cards, each cut to 90 characters:
    - `District: <name> (<code>)`;
    - `Audit <year label>: <band label>` (the translated `AUDIT_BANDS` label for the six known opinions, which need no Treasury label; Treasury's trimmed label for `other`), or `Audit: unavailable`;
    - for listed councils, `Section 139 since <since> (CoGTA list, <formatSaMonth(asOf)>)` and `Type: <type>`;
    - for metros, `Mayor: <name> (<party>), elected <19 Nov 2026>` or `Mayor: not yet elected (as of <24 Nov 2026>)`, then `<note>`.
  - `formatSaDate('2026-11-19')` returns `'19 Nov 2026'`, built from parts so the machine zone can't shift it.

- [ ] **Step 1: Write the failing tests** under `TZ=UTC`, and once under `TZ=Pacific/Kiritimati`:
  - the audit year label;
  - every band's colour;
  - the intervention colour is strong for listed councils and faint otherwise;
  - the lines for CPT (elected), JHB (unresolved), a listed council, and a council with no audit;
  - the 90-character cut on a long `type`;
  - the date format;
  - the normalisers reject malformed input.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Add the SA governance client model`.

### Task 6: Council views

**Files:**
- Modify:
  - `src/layers/saElections/index.js` and `src/layers/saElections/cards.js`;
  - `src/app/layers/saElections.js`, if options pass through;
  - `src/app/constructCatalog.js`, `src/app/sourceComposition.js` and `src/standalone/layerSources.js`.
- Test: `src/layers/saElections/layer.test.mjs` (extend) and the wiring tests.

**Interfaces:**
- `createSaElectionsLayer({…, governanceSource})`. The councils level uses it; wards ignore it.
- `setParams({view})` accepts only `SA_COUNCIL_VIEWS` (councils level only) and redraws at once from the held rows, without a refetch. `getParams()` returns `{view}`. The default is `'party'`.
- `update()` fetches governance alongside results. If governance fails, the layer keeps working with `gov = null`.
- Polygons are kept for recolouring. The signature includes the view and a governance digest.
- `getRowControls()`, councils level only, always includes the segmented switch, even on the early-return status branch: `segmented: {id: 'view', label: t('Colour by'), ariaLabel: t('Colour councils by'), options: [{id: 'view-party', label: t('Party')}, {id: 'view-audit', label: t('Audit')}, {id: 'view-intervention', label: t('Section 139')}]}`. Each option has `active` and `params: {view}`, following `src/layers/firms/queries.js:157-168`.
  - The audit view's legend is `AUDIT_BANDS` with counts. Its first-item blurb is `Audit <year label> · Treasury Municipal Money`, or the unavailable/loading line.
  - The intervention view's legend is `t('Section 139 (CoGTA list, {asOf})', {asOf})` in red, with a count, then `Not listed` in grey, where `asOf = formatSaMonth(gov.interventionsAsOf)`. Its blurb is `t('{total} councils on CoGTA's list as at {asOf}; {districts} of them are districts, shown on the districts layer. Not listed does not mean no intervention.', {total, asOf, districts})`, with `total` the listed codes and `districts` those matching `^DC\d+$`.
- The card accent follows the view. `buildSaCouncilCard` appends `governanceLines`.
- `sourceComposition`: `'sa-governance': contract(['sa-councils-2026', 'sa-districts-2026'], ['getSnapshot', 'getDistricts'])`.
- `layerSources`: `'sa-governance': createSaGovernanceSource()`.

- [ ] **Step 1: Write the failing tests:**
  - the switch exists on councils and not on wards;
  - `setParams({view: 'audit'})` recolours from held rows with no fetch;
  - the audit and intervention legends;
  - the audit view with governance failed shows the unavailable line, not silent grey;
  - the party view is unchanged with governance failed;
  - the card carries the governance lines;
  - an invalid view is rejected.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, the wiring tests (with `--import=./build/registerVue.js`) and `npm run check:boundaries`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Colour SA councils by audit or intervention`.

### Task 7: District layer

**Files:**
- Create in `src/layers/saDistricts/`: `index.js`, `cards.js`, `layer.test.mjs` and `cards.test.mjs`.
- Create `src/app/layers/saDistricts.js`.
- Modify the wiring files, following `git show d16dd985c --stat` (the weather layer):
  - `constructCatalog.js`: import, `LOCAL_ONLY_LAYER_METADATA` and construction with `source: sources['sa-governance']`;
  - `layerPanel.js`: the South Africa group, ending with `'sa-districts-2026'`;
  - `layerNames.js`: `msg('SA districts 2026')`;
  - `VOICE_OFF_LAYERS`;
  - `dataCredits.js` and its test: key `za-governance`, naming National Treasury Municipal Money, CoGTA via PMG, and "metro mayors kept by hand from news reports, dated per row";
  - `package-boundaries.json`;
  - layer counts 45 → 46.

**Interfaces:**
- `createSaDistrictsLayer({source, overlayHost, picking, inputFor})` with `id: 'sa-districts-2026'`, `name: 'SA districts 2026'`, `icon: '🗺️'`, `source: 'MDB'` and `updateInterval: 3600000`.
- Draw sets:
  - fills `sa-districts-2026:<n>:fills`, alpha 0.03, every item `pickable: false`;
  - lines `sa-districts-2026:<n>:lines`, draped, width 3, pickable, coloured `#eb5757` when the district is on the section 139 list and `#d0d7de` otherwise.
- Pick prefix `sa-district:`. The click handler copies `src/layers/saWeather/index.js`, including no hide of the overlay source on selection loss.
- The card (`sa-district-card:<code>`), every line cut to 90 characters:
  - title `<name> (<code>)`;
  - province;
  - `t('District municipality')` or `t('Metro (also a council)')`;
  - `Councils: a, b, … (+N)`;
  - the district's audit line;
  - section 139 lines when listed.
- Legend: `t('Section 139 (CoGTA list, {asOf})', {asOf})` in red with the listed count, then `District` in grey with the unlisted count (all districts when governance never arrived). The blurb is `t('Click a district outline for its card.')`.

- [ ] **Step 1: Write the failing tests:**
  - outlines drawn red for listed districts and grey for others;
  - fill items are not pickable;
  - clicking an outline opens the card, and clicking a fill does nothing;
  - the card lines, including the members cut;
  - the stub renderer places a line;
  - disable clears.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run the tests, the wiring tests and `npm run check:boundaries`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Add the SA districts layer`.

### Task 8: Translations

- [ ] Translate every new string into ar, de, es, fr, he, it, ja, pt, ru, sv, uk and zh-CN, following `docs/translations/<locale>.md` for each locale. Keep the placeholders and proper names (CoGTA, PMG, Municipal Money, MDB, the section numbers) unchanged.
- [ ] Run `npm run i18n -- --zh-hant`, then `npm run i18n` (all complete), then `npm test` (0 failures).
- [ ] **Commit** with the message `Translate the SA governance views`.

### Task 9: Docs and verification

- [ ] Write `docs/SOUTH_AFRICA_GOVERNANCE.md`:
  - what the views and the districts layer show;
  - sources, terms and dates;
  - how to update `metros.json` and the intervention table;
  - limits: 2023/24 audits; the list as at Aug 2026, 5 of whose councils are districts; mayors only for metros; no district party colours.
- [ ] Add `DATA_SOURCES.md` rows next to the SA rows, and update `scripts/format-scope.json` if needed.
- [ ] Run `npm run format:check`, `npm run check:boundaries` and `npm test`, then build in a scratch worktree, removing the symlink with `rm` and the worktree with `git worktree remove`. Quote the last line of each.
- [ ] **Commit** with the message `Document the SA governance views`.
- [ ] The controller then checks the live routes and Chrome, as the spec's Verification section describes.
