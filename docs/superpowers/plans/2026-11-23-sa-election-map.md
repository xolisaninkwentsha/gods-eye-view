# South African Election Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two local-only globe layers show the 2026 local election winners
(213 councils by seats with a majority flag, 4,485 wards by ward-ballot
winner), fed by a server join of MDB boundaries and IEC result files, plus a
South Africa button beside "Go to my location".

**Architecture:** A server provider (`/api/sa-elections/{councils,wards}`)
fetches simplified MDB polygons from ArcGIS and, only when
`SA_ELECTIONS_RESULTS=1`, stream-parses the nine IEC province CSVs and reads
the 213 IEC seat `.xls` files with a small BIFF8 reader. It caches only
derived results in `.gev-cache/sa-elections/`. One client layer factory,
modelled on `src/layers/droneAirspace/`, draws ground fills and draped
outlines with its own click card and legend. The omnibar gets a toggle
button that flies to South Africa and turns the councils layer on.

**Tech Stack:** Node 24 (server providers are Vite plugins), plain ES
modules, Vue 3 SFC (`Omnibar.vue`), node:test with happy-dom for Vue.

**Spec:** `docs/superpowers/specs/2026-11-23-sa-election-map-design.md`

## Global Constraints

- Run every command under Node 24: prefix shell commands with `source ~/.nvm/nvm.sh >/dev/null; nvm use 24.22.3 >/dev/null;` (nvm's default stays Node 22).
- **No IEC or MDB data in git.**
  - Test fixtures are synthetic and built in code.
  - The two real samples stay in `/tmp/claude-1000/-home-xolisani-nkwentsha-Desktop-gods-eye-view/6cf5119e-95b4-44c3-ab4a-75d945004b92/scratchpad/iec-samples/` (`NC.csv`, `CPT.xls`) and are never copied into the repo.
- IEC downloads happen only when `process.env.SA_ELECTIONS_RESULTS === '1'`.
  - Xolisani sets that line in `.env` himself.
  - Never read, print or write `.env`.
  - Never put the switch in `compose.override.yaml`, which is public.
- Never disable TLS verification; use `redirect: 'error'` and capped bodies on every upstream fetch.
- Use the generic User-Agent `GodsEyeView (sa-elections)` on IEC and MDB requests, with no URL, name or email.
- Layer ids are `sa-councils-2026` and `sa-wards-2026`, both `local-only` in `LOCAL_ONLY_LAYER_METADATA`, both in `VOICE_OFF_LAYERS`.
- Every new UI string goes through `t()`/`msg()` and is translated in Task 10. Party names, place names and ward numbers are data and are not translated.
- Do not commit `.env*`. Commit only on branch `sa-elections`. Never push without Xolisani asking.

## Rulings made while planning (deviations from the spec's letter)

- **The render spike runs in Task 8, not first.** Fills can only be measured through the layer's own draw path, and that path needs Tasks 1–7. The fallback (`maxCameraHeightM` on the wards layer) is built in Task 7, so Task 8 only sets a number.
  - Cost if wrong: Task 7's ward draw might need rework. That is limited, because the fallback is already there.
- **A council with no readable seat file, or a ward with an exact tie, draws as an outline only.** Its card says why ("Seat count unavailable" / "Tie"). The spec is silent here, and its anti-goal forbids guessing seats.
- **The button glyph is the Material symbol `how_to_vote`,** added to `index.html`'s `icon_names` subset.

## Review Focus

1. **Party names that differ between the CSV and the seat file** must still match. Examples: `ACTIONSA (PF)` against `ACTIONSA`, doubled spaces, and a line break inside a cell. Names that still fail to match are logged once per council, never silently dropped. (Task 2 test.)
2. **A failure in one province** (a timeout or a 404 on one CSV) must not blank the other eight. That province keeps its previous results, or its areas draw as outlines, and the status reads `stale`. (Task 5 test.)
3. **A restart in the middle of a write** must not leave a half-written cache read as valid. Writes go to a temp file and are then renamed. (Task 5 test.)
4. **Turning a layer off while the 30-second re-poll is pending** must stop all further fetching. (Task 7 test.)
5. **The button must not throw** when the layer is missing from the catalog or the omnibar controls are disconnected. It is disabled instead. (Task 9 test.)

---

### Task 1: BIFF8 `.xls` reader

**Files:**
- Create: `server/providers/saElections/xls.js`, `server/providers/saElections/testWorkbook.mjs` (test support; it writes synthetic workbooks)
- Test: `server/providers/saElections/xls.test.mjs`

**Interfaces:**
- Produces: `readXlsSheets(bytes: Uint8Array) → Array<Array<Array<string|number|null>>>`, a list of sheets, each a list of rows, each a list of cells. It throws `Error('xls_unreadable')` on input it cannot read.
- Produces (test support): `buildXls(sheets, { sstChunkBytes = 8224 } = {}) → Uint8Array`.

**What the reader must do.** The signature does not determine this:

- **Container.** The file is a compound file (CFB v3) with 512-byte sectors.
  - From the header it reads the sector shift (0x1E), the FAT sector count (0x2C), the first directory sector (0x30), the mini-stream cutoff (0x38) and the DIFAT array (0x4C, 109 entries; extra DIFAT sectors from 0x44/0x48).
  - Directory entries are 128 bytes each: a UTF-16 name, the type at 0x42, the start sector at 0x74 and the size at 0x78.
  - It reads the `Workbook` stream (or `Book`) by following the FAT chain.
  - It handles a stream under the cutoff by reading through the mini FAT and the root entry's mini stream.
- **Records.** Each record is `[type u16][length u16][data]`.
  - `BOF 0x0809` opens a sheet. Sheets come after the workbook globals, in order. `EOF 0x000A` closes it.
  - `SST 0x00FC` holds shared strings. Each string is `cch u16`, `flags u8` (0x01 means UTF-16, 0x04 an ext block, 0x08 rich text), then `cRun u16` if rich, `cbExtRst u32` if ext, then the chars, then rich runs (4 × cRun bytes), then the ext block.
  - A string that crosses into a `CONTINUE 0x003C` record restarts with a fresh flags byte at the start of that record.
  - The cell records are `LABELSST 0x00FD` (row, col, xf, isst u32), `NUMBER 0x0203` (f64), `RK 0x027E`, `MULRK 0x00BD`, `LABEL 0x0204` and `FORMULA 0x0006`. For `FORMULA`, take the cached number only when bytes 6–7 of the result are not 0xFFFF.
- **RK decoding.** If bit 1 is set, the value is the integer `rk >> 2` (signed). Otherwise the upper 30 bits are the high bits of a double. If bit 0 is set, divide by 100.

- [ ] **Step 1: Write the failing tests.**
  - `'reads strings and numbers from a synthetic workbook'`: `buildXls([[['Party Name','Total Party Seats (x)'],['DEMOCRATIC ALLIANCE',140]]])`, then `readXlsSheets(...)`, deep-equals that grid.
  - `'reads a string split across CONTINUE records'`: a 300-char UTF-16 party name with `sstChunkBytes: 64` round-trips.
  - `'decodes RK integers and RK hundredths'`: RK cells for 7 and 12.34 read back as `7` and `12.34`.
  - `'reads a stream stored in the mini stream'`: a tiny workbook under 4,096 bytes still reads.
  - `'refuses bytes that are not a compound file'`: throws `/xls_unreadable/`.
- [ ] **Step 2: Watch them fail.** Run `node --test server/providers/saElections/xls.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `buildXls` (test support, ~100 lines) and `readXlsSheets` (~200 lines).
- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Real-sample check (nothing committed).** Run `node -e "import('./server/providers/saElections/xls.js').then(({readXlsSheets})=>{const s=readXlsSheets(require('fs').readFileSync(process.argv[1]));console.log(s.length, s[0].flat().filter(v=>typeof v==='string').slice(0,5))})" "<scratchpad>/iec-samples/CPT.xls"`. Expected: at least one sheet whose strings include `Seat Calculation Detail` and `CPT - City of Cape Town`.
- [ ] **Step 6: Commit.** Run `git add server/providers/saElections/xls.js server/providers/saElections/testWorkbook.mjs server/providers/saElections/xls.test.mjs && git commit -m "Read the IEC's old-format Excel seat reports"` (with the Co-Authored-By trailer).

### Task 2: Party names and the seat sheet

**Files:**
- Create: `src/layers/saElections/parties.js`, `server/providers/saElections/seats.js`
- Test: `src/layers/saElections/parties.test.mjs`, `server/providers/saElections/seats.test.mjs`

**Interfaces:**
- Consumes: `readXlsSheets` (Task 1).
- Produces:
  - `normalizePartyName(name: string) → string`: drops a trailing `(PF)`, folds all whitespace (including newlines) to single spaces, trims, and uppercases.
  - `partyStyle(name: string) → { short: string, color: string }`: a fixed table keyed by normalized IEC name for ANC, DA, MK, EFF, IFP, ActionSA, PA, FF Plus, ATM, UDM, GOOD, BOSA, ACDP, PAC, Al Jama-ah, COPE and Rise Mzansi, plus `INDEPENDENT` → short `Independent`. Any other name gets `{ short: <title-cased name>, color: OTHER_COLOR }`.
    - ANC and MK must have clearly different hues.
    - Export `OTHER_COLOR` and `PARTY_STYLES`.
  - `parseSeatSheet(rows: Array<Array<string|number|null>>) → { totalSeats: number, independentWardSeats: number, parties: Array<{ party: string, seats: number, wardSeats: number, prSeats: number }> }`.
    - `totalSeats` is the first number on the row whose label starts `Total Seats Available in Municipality`.
    - `independentWardSeats` is the first number on the row whose label starts `Independent Ward Councillors Elected`.
    - `parties` comes from the table whose header row holds `Total Party Seats (x)`: one row per party until the `Total` row. Party names are normalized and zero-seat parties are dropped.
    - It throws `Error('seat_sheet_unreadable')` when either total or that table is missing.
  - `readSeatFile(bytes: Uint8Array) → ReturnType<parseSeatSheet>`: the first sheet that parses.

- [ ] **Step 1: Write the failing tests.**
  - `'normalizes forfeiture marks, spacing and case'`: `normalizePartyName(' ActionSA (PF) ')` gives `'ACTIONSA'`, and `normalizePartyName('VRYHEIDSFRONT PLUS \n FREEDOM FRONT PLUS')` gives `'VRYHEIDSFRONT PLUS FREEDOM FRONT PLUS'`.
  - `'ANC and MK are told apart'`: their `partyStyle(...).color` values differ, and so do their hue buckets (round hue to 30°).
  - `'an unknown party is Other'`: its color is `OTHER_COLOR`.
  - `'parses totals and the per-party seat table'`: a synthetic grid matching the IEC layout gives `{ totalSeats: 231, independentWardSeats: 0, parties: [{ party: 'DEMOCRATIC ALLIANCE', seats: 140, wardSeats: 100, prSeats: 40 }, …] }`. The layout is: the quota block with `Total Seats Available in Municipality - (B)`, 231; the first table's `Total Party Seats`; then a second header `Party Name | Total Party Seats (x) | Ward Seats (y) | PR List Seats (x-y)`.
  - `'refuses a sheet without the seat table'`.
- [ ] **Step 2: Watch them fail.** Run `node --test src/layers/saElections/parties.test.mjs server/providers/saElections/seats.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Real-sample check.** Run `readSeatFile` on `CPT.xls` (as in Task 1 Step 5). Expected: the party seats sum to `totalSeats`, and `wardSeats` sums to the number of CPT wards on the MDB (count it with `curl` on the wards layer: `where=CAT_B='CPT'&returnCountOnly=true`).
- [ ] **Step 6: Commit.** Message: "Read seat counts and normalize party names".

### Task 3: Results aggregation and the winner rules

**Files:**
- Create: `server/providers/saElections/results.js`
- Test: `server/providers/saElections/results.test.mjs`

**Interfaces:**
- Consumes: `normalizePartyName` (Task 2), and the `parseSeatSheet` result shape (Task 2).
- Produces:
  - `csvRecords(lines: AsyncIterable<string>) → AsyncIterable<string[]>`: RFC 4180 records. It strips a leading BOM; quoted fields may hold commas, doubled quotes and newlines.
  - `aggregateProvince(records: AsyncIterable<string[]>) → Promise<ProvinceTally>`. It uses the header row's column names (`Municipality, Ward, VotingDistrict, RegisteredVoters, BallotType, SpoiltVotes, PartyName, TotalValidVotes`) and fails with `Error('csv_header')` if any is missing. `ProvinceTally` is:
    - `councils: Map<catB, { prVotes: Map<party, n>, registered, wardCast, prCast }>`;
    - `wards: Map<wardId, { catB, wardNo, votes: Map<party, n>, registered, wardCast, prCast }>`.
  - **Counting rules:**
    - `catB` is the `Municipality` text before ` - `.
    - `wardId` is the digits of `Ward`, and `wardNo` is the last 3 digits as a number.
    - Registered voters are counted once per voting district.
    - Cast is valid votes plus spoilt; spoilt is counted once per voting district and ballot.
    - `DC 40%` rows are ignored.
  - `councilOutcome(tally, seats|null) → CouncilResult`. `CouncilResult` is `{ largest: {party, seats}|null, totalSeats|null, majority: boolean|null, parties: [{party, seats, wardSeats, prSeats, prVotes, prShare}], turnout: number|null, seatCheck: 'ok'|'mismatch'|'unchecked' }`.
    - Parties are sorted by seats, then by PR votes.
    - A seat tie goes to the higher PR vote.
    - `majority` is `seats > totalSeats / 2`.
    - With no seats file, `largest`, `totalSeats` and `majority` are null and `seatCheck` is `'unchecked'`.
  - `wardOutcome(tally) → WardResult`. `WardResult` is `{ winner: {party, votes, share}|null, runnerUp: {…}|null, tie: boolean, margin: number|null, turnout: number|null, confirmed: boolean }`. `share` is a 0–1 fraction of the ward's valid votes; a tie gives `winner: null, tie: true`.
  - `seatCheck(wardResults: WardResult[], seats) → 'ok'|'mismatch'`. It compares ward wins per party with `wardSeats`, and wins by `INDEPENDENT` with `independentWardSeats`.
  - Turnout is `max(wardCast, prCast) / registered`, or `null` when `registered` is 0.

- [ ] **Step 1: Write the failing tests.** All CSV text is synthetic and inline.
  - `'parses quoted fields with commas, quotes and newlines'`.
  - `'sums ward votes across voting districts and counts registered voters once'`: two voting districts with four party rows each give the right sums, and registered equals the sum of the two districts.
  - `'ignores the district council ballot'`: `DC 40%` rows change nothing.
  - `'the ward winner is the most ward-ballot votes, with share, runner-up and margin'`.
  - `'an exact ward tie has no winner'`.
  - `'the council's largest party is by seats, and majority means more than half'`: 116 of 231 is a majority; 115 of 231 is not.
  - `'without a seat file a council has no seats and is unchecked'`.
  - `'seat check flags merged independents'`: two wards won by `INDEPENDENT` against `independentWardSeats: 1` gives `'mismatch'`.
  - `'a missing header column fails loudly'`.
- [ ] **Step 2: Watch them fail.** Run `node --test server/providers/saElections/results.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Real-sample check.** Stream `NC.csv` through `csvRecords` and `aggregateProvince`. Expected: 233 wards and 26 councils; every ward has a winner or a tie; and the sum of NC registered voters is printed for the ledger.
- [ ] **Step 6: Commit.** Message: "Work out ward and council winners from the IEC results".

### Task 4: MDB boundaries

**Files:**
- Create: `server/providers/saElections/boundaries.js`
- Test: `server/providers/saElections/boundaries.test.mjs`

**Interfaces:**
- Produces:
  - `MDB_LAYERS = { councils: <LM 2026 FeatureServer/0 URL>, wards: <Wards 2026 FeatureServer/0 URL> }`. The URLs are verbatim from the spec.
  - `fetchBoundaries(level: 'councils'|'wards', { fetchImpl, signal }) → Promise<Area[]>`.
    - **Query:** paged with `where=1=1`, `f=geojson`, `outSR=4326`, `maxAllowableOffset=0.001`, `geometryPrecision=5`, `resultRecordCount=2000` and `resultOffset`. At most 5 pages; each page capped at 16 MiB with a 90 s timeout; `redirect: 'error'`; the generic User-Agent.
    - **Fields:** councils use `outFields=CAT_B,MUNICNAME,PROVINCE,CATEGORY`; wards use `WardID,CAT_B,WardNo,MUNICNAME,Province`.
    - **Area shape:** `{ id, name, code, province, category?, wardNo?, municipality?, polygons }`. `polygons` is `number[][][][]` (polygon → rings → `[lon, lat]`); Polygon and MultiPolygon are both accepted, and features with bad geometry are dropped.
    - **Ids and names:** a council's `id` is `CAT_B`; a ward's `id` is `String(WardID)`. A ward's `name` is `Ward ${WardNo}`, and its `municipality` is `MUNICNAME`.
    - **Failures:** it throws `incomplete_boundaries` if the last page still says `exceededTransferLimit`, or if no area is valid.

- [ ] **Step 1: Write the failing tests** using a fake `fetchImpl`.
  - `'pages until the service says it is complete'`: two pages give one combined list.
  - `'maps council and ward attributes to areas'`.
  - `'accepts MultiPolygon and drops bad geometry'`.
  - `'refuses an incomplete set'`.
  - `'asks ArcGIS for simplified WGS84 GeoJSON'`: the requested URL has `maxAllowableOffset=0.001` and `outSR=4326`.
- [ ] **Step 2: Watch them fail.** Run `node --test server/providers/saElections/boundaries.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Fetch simplified 2026 ward and council boundaries".

### Task 5: The `/api/sa-elections` provider

**Files:**
- Create: `server/providers/saElections/index.js`, `server/providers/saElections/iec.js`
- Modify: `server/providers/local.js` (import, then add `saElectionsProxy()` after `droneAirspaceProxy()`), `src/tooling/previewServing.test.mjs` (assert a plugin named `sa-elections`)
- Test: `server/providers/saElections/provider.test.mjs`

**Interfaces:**
- Consumes: `csvRecords`, `aggregateProvince`, `councilOutcome`, `wardOutcome` and `seatCheck` (Task 3); `fetchBoundaries` (Task 4); `readSeatFile` (Task 2).
- Produces:
  - **`iec.js`:**
    - `IEC_PROVINCES = ['EC','FS','GP','KN','NP','MP','NW','NC','WP']`;
    - `provinceCsvUrl(code)` and `seatFileUrl(code, catB)`, using the spec's URL patterns with spaces encoded;
    - `headProvince(code, {fetchImpl, signal}) → Promise<number|null>`, which returns the `Last-Modified` time in ms;
    - `streamProvince(code, {fetchImpl, signal}) → Promise<ProvinceTally>`, which streams the body through `TextDecoderStream` and line splitting into `csvRecords` and `aggregateProvince`; it uses an 80 MiB running cap and a 10-minute timeout, and never writes the body to disk;
    - `fetchSeatFile(code, catB, {fetchImpl, signal}) → Promise<Uint8Array>`, with a 1 MiB cap and a 60 s timeout.
  - **`index.js`:** `saElectionsProxy({ fetchImpl, now = Date.now, cacheDir = path.join(process.cwd(), '.gev-cache', 'sa-elections'), env = process.env, setTimer = setTimeout, fsImpl = fs.promises } = {})` returns the Vite plugin `{ name: 'sa-elections', configureServer, configurePreviewServer }` mounted at `/api/sa-elections`.
  - **Routes:** `GET /councils` and `GET /wards` answer `200 { level, results: 'off'|'loading'|'ok'|'stale'|'failed', resultsAsOf: number|null, boundariesAsOf: number, areas: Array<Area & { result: CouncilResult|WardResult|null }> }`.
    - Other paths answer 404.
    - Non-GET requests answer 405.
    - Rate limiting is `makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 })` and gives 429.
    - Cross-site browsers are refused with `admitSameSiteKeyless`.
    - With no boundaries at all, the route answers 502 `{ error: 'sa_elections_unavailable' }`.
  - **Work starts lazily, on the first request,** never at plugin construction.
  - **Boundaries:** refreshed when older than 7 days. They are kept in `boundaries-<level>.json`, and a failed refresh keeps the last good copy.
  - **Results run only when `env.SA_ELECTIONS_RESULTS === '1'`.**
    - **First run:** status `loading`. The server streams provinces 2 at a time, then fetches each council's seat file 4 at a time (council codes come from the tally; districts are not fetched). It then computes outcomes, runs `seatCheck` per council and sets each ward's `confirmed`.
    - **Cache:** it writes `results.json` as `{ version: 1, provinces: { <code>: { lastModified, councils, wards } } }`. The write goes to a temp file and is then renamed.
    - **Daily:** a `HEAD` on all nine files; any province whose `Last-Modified` changed is redone with its seat files.
    - **One province failing:** it keeps that province's previous entry, and the status becomes `stale`.
    - **No entry at all:** the status becomes `failed`, and a retry follows after 1 hour.

- [ ] **Step 1: Write the failing tests.** Use a fake `fetchImpl` serving synthetic CSVs, workbooks from `buildXls` and boundary pages, a temp `cacheDir`, and a controllable `now`.
  - `'with the switch off it serves boundaries only and never calls the IEC'`: `results: 'off'`, and no URL containing `elections.org.za` was requested.
  - `'nothing is fetched until the first request'`.
  - `'first request answers loading, then ok with council and ward results joined'`.
  - `'a failed province keeps its previous results and marks the answer stale'`: Review Focus 2.
  - `'an unchanged Last-Modified does not download again'`: after a day, only `HEAD`s are made.
  - `'a changed Last-Modified re-reads only that province'`.
  - `'results are replaced by rename, never written in place'`: with a recording `fsImpl`, every write targets a temp name in `cacheDir`, and `results.json` only ever appears through `rename`. This is Review Focus 3.
  - `'a council with a mismatched seat check marks its wards unconfirmed'`.
  - `'refuses unknown paths, other methods and rate-limited clients'`.
- [ ] **Step 2: Watch them fail.** Run `node --test server/providers/saElections/provider.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement, and mount the plugin in `local.js`.**
- [ ] **Step 4: Watch them pass.** Run `node --test server/providers/saElections/*.test.mjs src/tooling/previewServing.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Serve South African election results joined to boundaries".

### Task 6: Client source, records and cards

**Files:**
- Create: `src/layers/saElections/source.js`, `src/layers/saElections/records.js`, `src/layers/saElections/cards.js`
- Test: `src/layers/saElections/source.test.mjs`, `records.test.mjs`, `cards.test.mjs`

**Interfaces:**
- Consumes: the route payload (Task 5) and `partyStyle` (Task 2).
- Produces:
  - `createSaElectionsSource({ fetchImpl }) → { getSnapshot({ signal, level }) }`. It fetches `/api/sa-elections/${level}`, caps the body at 40 MiB with `readResponseJsonCapped`, and throws on a non-OK answer.
  - `normalizeSaElectionsPayload(payload, level) → { status, resultsAsOf, rows: Row[] }`. `Row` is an `Area` plus `stableId` (= `id`) and `result`. Malformed areas are dropped, and an unknown status becomes `'failed'`.
  - `SA_ELECTIONS_OVERLAY_SOURCE = { councils: 'sa-councils-2026', wards: 'sa-wards-2026' }`.
  - `saAreaColor(row, level) → { color: string|null, strength: 'strong'|'faint'|null }`.
    - A council's colour is its largest party's colour: strong with a majority, faint without one. With no seats, the colour is null.
    - A ward's colour is its winner's colour, always strong. A tie or no result gives null.
    - Null means outline only.
  - `saAnchorDegrees(polygons) → {lon, lat}`: reuse `droneAirspaceAnchorDegrees` by importing it from `../droneAirspace/cards.js`.
  - `buildSaCouncilCard(row, status) → overlay entry`. The title is `${name} (${code})`. The details are:
    - `{party} · {seats} of {total} seats`;
    - `Majority` or `No majority`;
    - the top three parties as `{short} {seats}`;
    - `{short} PR vote {pct}`;
    - `Turnout {pct}`.
    - When `status !== 'ok' && status !== 'stale'`, the details are a single line instead: `Results are off`, `Downloading results from the IEC…` or `IEC results unavailable`. With no seats, they are `Seat count unavailable`.
  - `buildSaWardCard(row, status) → overlay entry`. The title is `${name} · ${municipality}`. The details are:
    - `{winner short} {pct}`;
    - `Runner-up {short} {pct}`;
    - `Margin {pts} points`;
    - `Turnout {pct}`;
    - when unconfirmed, also `Unconfirmed: does not match the IEC seat count`;
    - for a tie, only `Tie`.
  - Entry fields otherwise match `buildDroneAirspaceCard`: `id`, `selected: true`, `interactive: false`, `accent`, `priority`, `gapPx`, `verticalOnly`, `placement`. Percentages use `Intl.NumberFormat` with `style: 'percent'` and one fraction digit.

- [ ] **Step 1: Write the failing tests.**
  - `'source asks the level route and refuses a failed answer'`.
  - `'normalizes rows and drops malformed areas'`.
  - `'a council with no majority is faint; with no seats it is outline only'`.
  - `'a tied ward has no fill'`.
  - `'council card lists seats, majority, top three, PR share and turnout'`.
  - `'ward card shows winner, runner-up, margin and turnout, and flags unconfirmed'`.
  - `'cards say why when results are off, loading or failed'`.
- [ ] **Step 2: Watch them fail.** Run `node --test src/layers/saElections/*.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Describe election areas and their cards on the client".

### Task 7: Layer factory and catalog wiring

**Files:**
- Create: `src/layers/saElections/index.js`, `src/app/layers/saElections.js`
- Modify:
  - `src/app/sourceComposition.js`: add the contract `'sa-elections': contract(['sa-councils-2026','sa-wards-2026'], ['getSnapshot'])`.
  - `src/standalone/layerSources.js`: add the default `'sa-elections': createSaElectionsSource()`.
  - `src/app/constructCatalog.js`: construct both layers after drone airspace, and add both to `LOCAL_ONLY_LAYER_METADATA`.
  - `src/ui/layerPanel.js`: add the group `{ label: msg('South Africa'), ids: ['sa-councils-2026','sa-wards-2026'] }` after Infrastructure.
  - `src/ui/layerNames.js`: add `msg('SA councils 2026')` and `msg('SA wards 2026')`.
  - `src/voice/layerManifest.js`: add both ids to `VOICE_OFF_LAYERS` with the reason `'fork-local South African election layer; no room in the prompt budget'`.
  - `src/data/dataCredits.js`: add one `DATA_CREDITS` entry with key `za-elections`. Its html: `South African elections: boundaries simplified from <a …>Municipal Demarcation Board</a> 2026 data (non-commercial use) · results from the <a …>Electoral Commission of South Africa</a>`. The links are `https://spatialhub-mdb-sa.opendata.arcgis.com/` and `https://results.elections.org.za/`.
  - `scripts/package-boundaries.json`: add each new `src/` module to every group that the boundary check names, at least `application-components` and `application-layer-construction`, as drone airspace is listed.
- Test: `src/layers/saElections/layer.test.mjs`, `src/app/constructCatalog.test.mjs`, `src/data/dataCredits.test.mjs`

**Interfaces:**
- Consumes: Task 6 exports.
- Produces: `createSaElectionsLayer({ level: 'councils'|'wards', source, overlayHost, inputFor, picking, maxCameraHeightM = null, repollMs = 30_000 }) → Layer`.
  - **Layer fields:** `id` is `sa-councils-2026` or `sa-wards-2026`; `name` is `'SA councils 2026'` or `'SA wards 2026'`; `icon` is `'🗳️'`; `source` is `'MDB · IEC'`; `updateInterval` is `3_600_000`.
  - **Methods:** `init/enable/disable/update/destroy/getStats/getRowControls`, following `createDroneAirspaceLayer`: fills in `draw.shapes({clampTo:'both'})`, draped outlines in `draw.lines`, pick prefix `sa-${level}:`, and click selection kept out of the pick-ownership registry.
  - **Fill alpha:** 0.5 strong, 0.15 faint.
  - **Outlines:** every area gets an outline. It uses the area colour (or neutral grey `#9aa4ad` when the colour is null) at width 1 px for wards and 2 px for councils.
  - **Re-poll while loading:** when `status === 'loading'`, update schedules one re-poll after `repollMs`. `disable` and `destroy` clear it (Review Focus 4).
  - **Camera gate:** with `maxCameraHeightM` set, the sets show only while the camera is below it. The camera height is read through the same port the app's view-bounded library layers use (find it in `src/library/layers.js`).
  - **`getRowControls()` legend:** up to 11 parties by areas won, then `Other`, each with its count; for councils, a blurb `Faint: no party holds more than half the seats`. When results are not shown, there is one legend row whose blurb is the card's status line.
  - **`getStats()`:** `{ count, lastUpdate, error, stale }`, where `stale` is `status === 'stale'`.

- [ ] **Step 1: Write the failing tests** in `layer.test.mjs`, using `bindFakeDraw` and `fakeInputUnderLabel` as in `src/layers/droneAirspace/ownership.test.mjs`.
  - `'draws a fill and an outline per polygon in party colours'`.
  - `'no-majority councils are faint and seat-less ones are outline only'`.
  - `'results off draws outlines only and says so in the legend'`.
  - `'a click opens that area's card'`.
  - `'the legend has at most 12 rows ending in Other'`.
  - `'while loading it re-polls once, and disabling cancels the re-poll'`, with fake timers: Review Focus 4.
  - `'above maxCameraHeightM the wards hide'`.
  - Also add asserts that `constructCatalog.test.mjs` builds both ids, and that `dataCredits.test.mjs` has a `za-elections` credit naming both publishers.
- [ ] **Step 2: Watch them fail.** Run `node --test src/layers/saElections/layer.test.mjs src/app/constructCatalog.test.mjs src/data/dataCredits.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the layer, wrapper and registrations.**
- [ ] **Step 4: Watch them pass.**
  - Run the Step 2 command, plus `node --test src/voice/layerManifest.test.mjs src/data/layerState.test.mjs`, plus `npm run check:boundaries`. Expected: PASS.
  - The i18n catalog test may fail until Task 10; note it in the ledger.
- [ ] **Step 5: Commit.** Message: "Add the SA councils and wards 2026 layers".

### Task 8: Live data check and ward render measurement (needs Xolisani)

- [ ] **Step 1: Stop and ask Xolisani** to run `! echo 'SA_ELECTIONS_RESULTS=1' >> .env`. Then run `docker compose restart` and wait for `curl -s -o /dev/null -w '%{http_code}' http://localhost:4173/` to return 200.
- [ ] **Step 2: Wait for the first download to finish.** Poll `curl -s localhost:4173/api/sa-elections/councils | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(d['results'],len(d['areas']))"` every few minutes until it prints `ok 213`. Expected: about 245 MB downloaded once. Record the time taken in SAST.
- [ ] **Step 3: Check the totals.**
  - All 213 councils have results, and all 4,485 wards have a winner or a tie.
  - Per-party seat totals are compared with ANC 3,164, DA 1,527, MK 701, EFF 505 and ActionSA 219. Record the differences; district seats may explain them.
  - The count of `majority: false` is compared with the 127 the IEC declared.
  - The count of `seatCheck: 'mismatch'` is recorded. **If more than 5 councils disagree, stop and report to Xolisani** (the spec's "more than a handful").
  - Unmatched party names in the server log are fixed in `normalizePartyName` with a test.
- [ ] **Step 4: Measure in Chrome on localhost:4173.** Turn on SA wards 2026 at a whole-country view, and record the activation time and frame rate (the app's FPS readout, or `performance.now()` around the first `update`).
  - If the frame rate drops below 30 or activation takes over 5 s, set `maxCameraHeightM` on the wards wrapper (start at 1,500 km), add a legend blurb `Zoom in to see wards`, and re-measure.
  - Record the numbers in the ledger.
- [ ] **Step 5: Commit any fixes.** Message: "Tune the ward layer for the real data".

### Task 9: South Africa button

**Files:**
- Modify:
  - `src/ui/stores/omnibar.js`: document the optional `onLayersChange(listener) → unsubscribe`.
  - `src/ui/applicationShell.js`: in the `useOmnibarStore(...).connect({...})` call, add `onLayersChange`. It must work when called before the data manager is bound: the shell keeps the listeners and attaches one forwarder to `dataManager.subscribe` when it binds.
  - `src/ui/views/panels/Omnibar.vue`: the button, after `.omnibar-locate`.
  - `src/ui/styles/omnibar-dock.css`: add `.omnibar-sa` to the voice-mode hidden list beside `.omnibar-locate`.
  - `index.html`: add `how_to_vote` to `icon_names` in order.
- Test: `src/ui/commandDock.test.mjs`, `src/ui/kit/omnibarControls.test.mjs`, `src/materialSymbolsSubset.test.mjs`

**Interfaces:**
- Consumes: the omnibar controls `layers()`, `setLayer(id, enabled)` and `onLayersChange(listener)`; and `frameAt(place, rangeM)` already in `Omnibar.vue`.
- Produces: `<UiButton class="omnibar-sa" :pressed="saOn" pressed-class="active" :disabled="!saAvailable" :label="t('South Africa: 2026 election map')" @click="onSouthAfrica">` with `<UiIcon name="how_to_vote" :size="null" />`, styled like `.omnibar-locate`.
  - `saAvailable` means `controls.layers()` lists `sa-councils-2026`.
  - `saOn` means either SA layer reports `enabled`. It is re-read on every `onLayersChange` call and on mount.
  - `onSouthAfrica()` does nothing while `screenIsOwned()`.
    - **On:** `setLayer` false for both ids. The camera is not moved.
    - **Off:** `setLayer('sa-councils-2026', true)`, then `void frameAt({ latitude: -28.5, longitude: 24.7 }, 2_600_000)`. Tune the range so the whole country fits at the default window size.

- [ ] **Step 1: Write the failing tests.**
  - In `omnibarControls.test.mjs`: `'the South Africa button is a UiButton with the how_to_vote glyph'`, plus the updated button counts, plus `.omnibar-sa` hidden in voice mode.
  - In `commandDock.test.mjs`, through the mounted Omnibar with fake controls and a fake runner:
    - `'South Africa turns the councils layer on and frames the country'`: one `setLayer('sa-councils-2026', true)` and one runner call `fly_to_location` with latitude −28.5.
    - `'pressed again it turns both layers off and leaves the camera'`.
    - `'it shows pressed when the wards layer is turned on elsewhere'`: fire the `onLayersChange` listener.
    - `'it is disabled without the layer or the controls, and clicking does not throw'`: Review Focus 5.
    - `'it does nothing while a cockpit owns the screen'`.
  - In `materialSymbolsSubset.test.mjs`: unchanged. It must pass once `how_to_vote` is in the subset.
- [ ] **Step 2: Watch them fail.** Run `node --import=./build/registerVue.js --test src/ui/commandDock.test.mjs src/ui/kit/omnibarControls.test.mjs src/materialSymbolsSubset.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: "Add a South Africa button that opens the election map".

### Task 10: Translations

**Files:**
- Modify: `src/i18n/locales/{ar,de,es,fr,he,it,ja,pt,ru,sv,uk,zh-CN}.json`, then regenerate zh-Hant.

- [ ] **Step 1: Find the missing strings.** Run `node --test src/i18n/catalog.test.mjs`. Expected: FAIL, listing every new string from Tasks 6, 7 and 9.
- [ ] **Step 2: Translate.** Add the translations with a scratchpad script, as in earlier fork work. Keep placeholders (`{party}`, `{seats}`, `{pct}`, `{total}`) and the env var name unchanged.
- [ ] **Step 3: Regenerate zh-Hant.** Run `npm run i18n -- --zh-hant`, then the Step 1 command. Expected: PASS.
- [ ] **Step 4: Commit.** Message: "Translate the South African election map".

### Task 11: Documentation and full verification

**Files:**
- Create: `docs/SOUTH_AFRICA_ELECTIONS.md`. It covers:
  - what the layers show and the winner rules;
  - the `.env` switch and the restart it needs;
  - sources and URLs;
  - the MDB licence and IEC terms, including that results are for personal display only;
  - the cache location, and the refresh rules (daily HEAD, weekly boundaries);
  - known risks: merged independents, approximate turnout, district councils left out;
  - the Task 8 measurements.
- Modify:
  - `DATA_SOURCES.md`: one row for the two layers, marked fork-local.
  - `.env.example`: a commented `# SA_ELECTIONS_RESULTS=1` with a two-line explanation.
- Test: none new.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Full checks.** Run `npm test > <workspace>/npm-test.log 2>&1; tail -5 <workspace>/npm-test.log`, then `npm run build`, then `npm run check:boundaries`. Expected: all pass. Quote the last line of each.
- [ ] **Step 3: Live check in Chrome on localhost:4173.**
  - Click the South Africa button: the country is framed and councils are coloured.
  - Click a metro, for example Cape Town: the card shows a majority for the largest party. Click Johannesburg: the card shows "No majority".
  - Turn on wards and click a ward: the card shows the winner, runner-up and margin.
  - Click the button again: both layers go off and the camera stays.
  - Switch to voice mode: the button hides.
- [ ] **Step 4: Commit.** Message: "Document the South African election map".
- [ ] **Step 5: Hand over** to superpowers:finishing-a-development-branch. Do not merge or push until Xolisani chooses.
