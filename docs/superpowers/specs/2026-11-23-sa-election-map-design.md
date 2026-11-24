# South African election map: design

Date: 2026-11-23. Fork-local (xolisaninkwentsha/gods-eye-view), not for upstream.

## Intent

Xolisani wants South Africa's political map on the globe: who won each ward
and each council in the 4 November 2026 local government election (LGE),
with councils where no party has a majority marked, plus a **South Africa
button** that jumps to South Africa and switches this on. This is the first
of the South African data builds ranked in the research report
(`reports/South Africa geo data sources.md`, builds 1 to 3; that report is
local and gitignored). It is for personal use on this PC; the fork is public.

## Goals

- Two layers: **SA councils 2026** (213 polygons: 8 metros and 205 local
  municipalities) and **SA wards 2026** (4,485 polygons).
- Councils are coloured by the party with the most seats, and a council where
  no party holds more than half the seats is visibly different.
- Wards are coloured by the party (or independent) that won the ward ballot.
- A click on a council or ward opens a card with the detail below.
- A South Africa button beside "Go to my location".
- The app's own server fetches the data, keeps a small derived cache on this
  PC, and nothing from the IEC or the MDB ever enters git.

## Non-goals

- District councils (52) and their results; 994 district seats are still being
  filled indirectly.
- Voting districts and voting stations.
- Earlier elections (2021, 2016). The same code could take another IEC event id
  later.
- Who governs (coalitions, mayors): a later hand-kept table (report build 7).
- Hiding the rest of the world or filtering other layers to South Africa.
  Xolisani chose the plain "jump and switch on" button.
- Voice and MCP access, share links, and an upstream pull request.

## Anti-goals (a failure even if it works)

- Any IEC or MDB data in git: no commits, no test fixtures, no snapshots.
- Seats or a majority guessed from vote shares. Seats come from the IEC's seat
  reports or are not shown.
- The app downloading IEC files on a machine where nobody switched it on.
- Pulling the 245 MB of results again on every refresh.
- Turning TLS verification off for any host.

## Constraints

- **MDB licence:** use in "value-added products such as applications" is
  allowed with acknowledgement; no selling or commercial use; modified data
  must not be passed off as the MDB's. The geometry is simplified here, so the
  credit says it is simplified from MDB data.
- **IEC results portal:** robots.txt allows all paths with the content signal
  `search=yes,ai-train=no,use=reference`; its copyright and disclaimer pages
  refuse scripts, so the reuse terms are unread. Personal display only. The
  IEC API (whose terms forbid caching) is not used.
- No API keys. The server stays on localhost.
- Every new UI string goes into all 12 hand-written locales (plus the
  generated zh-Hant); party and place names are data and are not translated.
- The voice prompt is at its budget, so both layers go in `VOICE_OFF_LAYERS`.
- Both layers are **local-only** (`LOCAL_ONLY_LAYER_METADATA`, like
  `local-adsb` and `osm-places`): no permanent share-link token that could
  collide with upstream's ledger. The data exists only on this PC, so a share
  link could not reproduce it elsewhere. Cost: the layers are not restored
  after a reload, and cannot be shared or shown through MCP.

## Data sources (checked 2026-11-23)

**MDB 2026 boundaries** (keyless ArcGIS FeatureServer, `maxRecordCount` 2,000):
- Wards: `https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_Wards_2026/FeatureServer/0`,
  4,485 features; fields include `WardID` (8 digits), `CAT_B`, `WardNo`,
  `MUNICNAME`, `Province`.
- Councils: `https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_L_ocal_Municipalities_2026/FeatureServer/0`,
  213 features (`CATEGORY` A = 8, B = 205); fields include `CAT_B`,
  `MUNICNAME`, `PROVINCE`.
- Size: with `maxAllowableOffset=0.001` (about 100 m) and
  `geometryPrecision=5`, 2,000 wards come to 2.76 MB of GeoJSON, so all wards
  are about 6.2 MB.

**IEC detailed results**, one CSV per province, at
`https://results.elections.org.za/home/LGEPublicReports/1887/Downloadable Party Results/{CODE}.csv`
with CODE in EC, FS, GP, KN, NP, MP, NW, NC, WP (about 245 MB in all; GP and
KN about 49 MB each). Each file sends `Last-Modified`; the dates differ
(WP 7 Nov, EC 11 Nov, GP 20 Nov).
- Columns: `Province, Municipality, Ward, VotingDistrict, VotingStationName,
  RegisteredVoters, BallotType, SpoiltVotes, PartyName, TotalValidVotes,
  DateGenerated`; UTF-8 with a BOM; one row per voting district, ballot and
  party.
- `Municipality` reads `NC061 - RICHTERSVELD`: the code before ` - ` is the
  MDB `CAT_B`. `Ward` reads `Ward 30601001`: the digits are the MDB `WardID`.
- `BallotType` is `Ward`, `PR` or `DC 40%` (the district council ballot).
- Independent ward candidates all appear as `PartyName` `INDEPENDENT`.
- Verified on the Northern Cape file: all 233 wards and all 26 municipality
  codes match the MDB exactly; no (voting district, ballot, party) row
  repeats; 13 wards had an independent on the ward ballot.

**IEC seat calculation**, one old-format Excel (BIFF8 `.xls`, 25 to 50 KB)
per council, at
`https://results.elections.org.za/home/LGEPublicReports/1887/Seat Calculation Detail/{CODE}/{CAT_B}.xls`
(for example `WP/CPT.xls`). Each holds the quota inputs, among them total
seats (B) and independent ward councillors elected (C), and per party a "Total
Party Seats (x)", "Ward Seats (y)" and "PR List Seats (x-y)" table. Party
names may carry a " (PF)" forfeiture marker, which must be stripped before
matching. No spreadsheet reader is installed in the repo.

## Approaches considered

- **A. New elections layers fed by a server join (chosen).** The server
  fetches the boundaries and the IEC files, works out the winners, and serves
  ready-to-draw areas. The globe shows fills in party colours, with a click
  card. It is the most code, but it is the only path with a full card and no
  pins.
- **B. A pre-built map file shown through the local GeoJSON layer.** About a
  third of the code, but that layer puts a 3D pin on every shape (4,485 on
  the wards), and its card shows only a title and two fields.
- Dropped: Data Library manifests (they cannot join two sources) and a KMZ
  dropped onto the globe (it lasts one session, and the button cannot switch
  it on).

## Design

### Server: `/api/sa-elections`

- A provider mounted in `server/providers/local.js`, modelled on
  `server/providers/shipwrecks.js` (stale serving, upstream timeouts,
  `redirect: 'error'`, capped bodies, a per-client rate limit).
- Two read routes, one per layer: `/api/sa-elections/councils` and
  `/api/sa-elections/wards`. Each answers with every area: id, name,
  simplified rings, and that area's results (below), plus `results` status
  (`off`, `loading`, `ok`, `stale`, `failed`) and an as-of time.
- **Switch:** IEC fetching runs only when `SA_ELECTIONS_RESULTS=1`. Unset,
  the routes serve boundaries only, with `results: 'off'`.
  - **Where it is set (Xolisani's choice):** in `.env`, which is gitignored.
    He adds the line himself (`echo 'SA_ELECTIONS_RESULTS=1' >> .env`), so
    nobody reads or writes his keys file for him. The app copies `.env` once
    at start, so the container is restarted afterwards.
  - **Documentation:** `.env.example` documents it, commented out.
  - **Never in `compose.override.yaml`:** that file is committed and public
    in the fork, so a switch there would turn on IEC downloads for anyone who
    clones it.
- **Boundaries:** paged ArcGIS queries (`f=geojson`, `outSR=4326`,
  `maxAllowableOffset=0.001`, `geometryPrecision=5`), refreshed weekly; a
  failed refresh keeps the last good copy.
- **Results:** each province CSV is **stream-parsed straight from the
  response and never written to disk**. Per ward, the server keeps
  ward-ballot votes per party. Per council, it keeps PR-ballot votes per
  party. Registered voters are counted once per voting district. Spoilt votes
  are counted once per voting district and ballot. Rows with ballot `DC 40%`
  are ignored.
- **Seats:** each council's `.xls` is read by a small BIFF8 reader written
  for these files (the compound-file container, shared strings, and number
  cells). From it the server takes total seats and, per party, total, ward
  and PR seats.
- **Cache:** derived results and simplified boundaries are kept in
  `.gev-cache/sa-elections/`. That folder is already gitignored and
  bind-mounted, so it survives `docker compose down -v`. The cache records
  each province file's `Last-Modified`. Once a day the server sends `HEAD`
  requests for the nine files and re-reads only the provinces whose file
  changed, plus their councils' seat files.
- **First run:** the full download takes minutes. The routes answer at once
  with boundaries and `results: 'loading'`.
- **Politeness:** at most 2 CSV downloads and 4 seat files at a time, under a
  generic User-Agent naming the app, with no personal details.

### Winner rules

- **Ward winner:** the party with the most ward-ballot votes summed across the
  ward's voting districts. `INDEPENDENT` is shown as "Independent". An exact
  tie shows as a tie.
- **Council:** the party with the most total seats from the seat file; a tie
  in seats goes to the higher PR vote. "Majority" means that party's seats
  exceed half the council's total seats; otherwise the card says "No
  majority".
- **Vote share:** PR ballot for a council, ward ballot for a ward.
- **Turnout:** for each ward and council, the larger of the ward-ballot and
  PR-ballot votes cast (valid plus spoilt), divided by registered voters. The
  IEC's own figure also counts special votes, so this one is close but not
  identical; the documentation says so.
- **Known risk:** every independent shares the name `INDEPENDENT`, so a ward
  with several independents may have their votes merged.
- **Seat check (builder's call, made in design review):** the server checks
  each council's computed ward winners against its seat file. It counts ward
  wins per party and compares them with that party's "Ward Seats (y)"; it
  compares independent wins with C.
  - Where a council's counts disagree, its wards still draw in the
    vote-based winner's colour, because the most ward-ballot votes is the
    legal rule.
  - Their cards add one line saying the result is unconfirmed because it
    does not match the IEC's seat count.
  - No legend row is added.
  - The real-data check reports how many councils disagree. If more than a
    handful do, Xolisani hears about it before anything ships.

### Client: two layers

- One factory in `src/layers/saElections/` (source, records, cards, index)
  makes both layers, `sa-councils-2026` and `sa-wards-2026`. It is modelled on
  `src/layers/droneAirspace/`: ground-clamped fills in one draw set, draped
  outlines in another, its own click card through the overlay host, and a
  legend in the layer panel.
- **Colours:** a fixed party colour table for the main parties (ANC, DA, MK,
  EFF, IFP, ActionSA, PA, FF Plus and others), plus Independent and Other. The
  legend has at most 12 rows. ANC and MK, whose own colours are both green,
  must be clearly different on the map.
- **Councils with no majority** keep their largest party's colour at a
  visibly fainter fill, and the legend explains what faint means.
- **Council card:** name and code, the largest party with seats out of the
  total, "Majority" or "No majority", the top three parties by seats, that
  party's PR vote share, and turnout.
- **Ward card:** ward number and municipality, the winner and their vote
  share, the runner-up and their share, the margin, and turnout.
- An area that has a result is drawn and carded whatever the status.
- Areas without a result draw as outlines only, and their card says why.
- While the status is `loading`, the legend keeps the party key plus a
  "Downloading…" note, and the client asks again every 30 seconds, also after
  a failed request.
- This rule was amended after the final review: it used to draw outlines only
  whenever results were `off`, `loading` or `failed`, and it now keeps one
  failing or still-downloading province from hiding the others.
- **Panel:** a new "South Africa" group in `PANEL_GROUPS` holds both layers.
- **Refresh:** the client polls hourly; the server answers from its cache.
- **Render cost:** 4,485 ground fills have never been drawn in this app, so
  the first plan task is a spike that draws all wards and measures activation
  time and frame rate on this PC. If that is too slow, wards draw only below a
  set camera height, or are simplified further.

### South Africa button

- It sits beside "Go to my location" in the search bar and hides with it in
  voice mode.
- **Off:** pressing it frames the whole country (around 29°S 24.7°E) through
  the same `fly_to_location` path the location button uses, and turns on SA
  councils 2026.
- **On:** it shows as pressed while either SA layer is on. Pressing it then
  turns both SA layers off and leaves the camera where it is.
- It follows the location button's guards: it does nothing while a cockpit or
  scene owns the screen.

### Registrations

- `server/providers/local.js`
- The source contract in `src/app/sourceComposition.js` and the default
  source in `src/standalone/layerSources.js`
- `src/app/constructCatalog.js` and `LOCAL_ONLY_LAYER_METADATA`
- `src/ui/layerPanel.js` (the new group)
- `src/data/dataCredits.js`: the MDB credit ("simplified from Municipal
  Demarcation Board data") and the IEC credit
- `VOICE_OFF_LAYERS`, with a reason for each layer
- The locale catalogs
- A `DATA_SOURCES.md` row
- A new `docs/SOUTH_AFRICA_ELECTIONS.md` covering the switch, the sources,
  the terms and the known risks
- `.env.example`, with the switch commented out. Nothing goes in
  `compose.override.yaml`.

## Testing

- **Unit tests on synthetic data only:** CSV aggregation, the BIFF8 reader
  (the test builds a tiny workbook in code), the seat and majority rules, the
  route payloads and statuses, the layer's draw, card and legend (following
  the drone-airspace tests), the button in `src/ui/commandDock.test.mjs`, and
  the i18n catalog test.
- **Real-data check (nothing committed):**
  - all 4,485 wards and 213 councils have results;
  - per-party seat totals are close to the IEC declaration (ANC 3,164, DA
    1,527, MK 701, EFF 505, ActionSA 219), knowing that those figures may
    count district seats;
  - the number of councils with no majority is compared with the 127 the
    IEC declared.
- **Checks:** `npm test`, `npm run build`, and a live check in Chrome on
  localhost:4173.

## Left to the builder

Exact colours and opacities, payload field names, the module split inside the
provider, the card layout within the existing card component, the test helper
that builds the workbook, and the camera range used to frame the country.
