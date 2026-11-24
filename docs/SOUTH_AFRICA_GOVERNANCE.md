# South African governance views (fork-local)

This fork adds views of who runs each South African council, on top of the election map. The **SA councils 2026** layer gets a colour switch (Party, Audit, Section 139), its cards get governance lines, and a new layer, **SA districts 2026**, outlines the 52 district-level areas. Upstream God’s Eye View has none of this. Design: `docs/superpowers/specs/2026-11-24-sa-governance-design.md`. The councils layer itself is described in `docs/SOUTH_AFRICA_ELECTIONS.md`.

The layers are for personal display on this PC. No Treasury or MDB payload is stored in git: the server fetches it and keeps a derived cache that is gitignored. The only data in git is two small curated tables (see “Updating the curated tables”).

## What the views show

### Councils: the colour switch (`sa-councils-2026`)

- **Party** is the existing view: the party with the most seats.
- **Audit** colours each council by its Auditor-General opinion in National Treasury’s Municipal Money data, for the latest financial year that has results (see “Audit year rule”). Bands: Clean audit (green), Unqualified with findings (light green), Qualified (yellow), Adverse (orange), Disclaimer (red), Outstanding (purple), No audit data (grey).
- **Section 139** colours red the local councils and metros on CoGTA’s section 139 intervention list (32 on the Aug 2026 list). The legend gives the list’s month, how many councils it lists and how many of them are districts (shown on the districts layer), all read from the table, and says that “not listed does not mean no intervention”.
- Party colours draw first. Governance data is applied when it arrives and never blocks the layer. While it is loading or missing, the legend says so (“Loading audit results…”, “Audit results unavailable”, “Intervention list unavailable”), so councils are never painted grey without saying why. Switching views needs no new fetch, and the Party view keeps working when governance data is unavailable.

### Council cards

Besides the election lines, a council card gains (every line is cut to 90 characters, ending in `…`):

- `District: <name> (<code>)`, except for metros, which have no district.
- The audit line: financial year and opinion, named as in the legend (for example `Audit 2023/24: Clean audit`; an opinion outside the six bands keeps Treasury’s own label), or `Audit: unavailable` if the governance fetch never succeeded.
- When listed: `Section 139 since <since> (CoGTA list, <list month>)` and `Type: <verbatim type>`.
- For the 8 metros: `Mayor: <name> (<party>), elected <date>`, or `Mayor: not yet elected (as of <date>)`, followed by a short note.

Dates are South African; a date-only value such as `2026-11-19` shows as `19 Nov 2026` whatever the machine’s time zone.

### SA districts 2026 (`sa-districts-2026`)

- 52 outlines from the Municipal Demarcation Board: 44 district municipalities and 8 metros, drawn as 3 px lines draped on the ground.
- A district on the section 139 list is outlined red; the others are light grey. Mangaung, a metro, counts too.
- The fills are not clickable, so the councils underneath stay clickable. Click an **outline** for the card: name and code, province, “District municipality” or “Metro (also a council)”, “Councils: …” (fitted to 90 characters, ending “… (+n)” when there are more), the audit line and the section 139 lines.
- Districts get no party colours. The IEC election pipeline skips the district ballot, and adding it would need a re-download of about 245 MB.
- The layer sits in the “South Africa” group after the other SA layers.

### Audit year rule

The audit year is the latest Municipal Money year with at least 200 rows whose opinion is not “outstanding”. A new year that is mostly “outstanding” therefore does not take over: the map stays on the last real year. At the time of writing that is 2023/24; the label is derived from the year, so it moves by itself when a new year qualifies.

## Sources

- **Audit opinions:** National Treasury Municipal Money, `https://municipaldata.treasury.gov.za/api/cubes/audit_opinions/…` (keyless). One aggregate request finds the year, then one request fetches that year’s facts (about 257 rows: the 213 councils and the 44 districts). Codes match the MDB `CAT_B` and `DISTRICT` values.
- **Section 139 list:** CoGTA’s reply to parliamentary question NW4545, Annexure A (“as at August 2026”), published by the Parliamentary Monitoring Group on 14 Sep 2026: `https://pmg.org.za/committee-question/40568/`. It is kept in git as `server/providers/saGovernance/interventions-2026-08.json`, verbatim: 37 rows (31 local municipalities, Mangaung, and 5 districts).
- **Metro mayors:** a hand-kept table, `server/providers/saGovernance/metros.json`, 8 rows, each dated and with its own source link (news reports). Treasury’s own officials list is not used: it carries no date and still names pre-election mayors.
- **District outlines and membership:** the MDB `MDB_District_Municipalities_2026` FeatureServer (52 features) on the same `services7.arcgis.com/oeoyTUJC8HEeYsRB` host as the election boundaries, fetched with the same simplification as the council boundaries. Each local council’s district comes from the `DISTRICT` field of the council boundaries, so membership needs no geometry.

## Terms

- **Treasury Municipal Money:** the terms allow reuse, commercial use included, with the source and date credited.
- **CoGTA list:** a published parliamentary reply, credited to CoGTA via PMG; its “as at” month is shown with the list, in the legend and on the cards.
- **MDB licence:** the same as for the election boundaries (see `docs/SOUTH_AFRICA_ELECTIONS.md`): value-added use with acknowledgement, no commercial use, geometry simplified here.
- **Metro table:** public facts from news reports, each row dated and linked.
- The credit is registered as `za-governance` in `src/data/dataCredits.js` and shown in the Data credits popover.
- Fetches use fixed hosts only, TLS on, redirects refused, size caps and timeouts. The Treasury audit fetches send the User-Agent `GodsEyeView (sa-governance)`; the MDB district outline and membership fetches reuse the election provider’s boundary fetcher and send `GodsEyeView (sa-elections)`. No key is needed and nothing is added to `.env`.

## Server routes, cache and refresh

- `/api/sa-governance` returns the audits, the two curated tables and `districtOf` (each council’s district code and name). Same-origin, no key.
- `/api/sa-governance/districts` returns the 52 simplified district polygons with their member councils.
- **Audits:** cached in memory and in `.gev-cache/sa-governance/audits.json`, refreshed daily. A failed refresh keeps serving the last copy for up to 30 days, and the fetch is re-checked once a minute after a failure.
- **Districts:** cached in `.gev-cache/sa-governance/districts.json`, refreshed weekly, served stale for up to 90 days. Once something is held, the main route never waits for a districts refresh.
- Disk caches are validated before use: a corrupt or hand-edited file is ignored and fetched again.
- `.gev-cache/` is gitignored and bind-mounted into the container. Nothing fetched is committed.
- The election provider’s caches, results and routes are unchanged, and `/api/sa-elections/districts` is still 404.

## Updating the curated tables

Both tables are read once when the server starts, and checked then. A table that fails its checks stops the server from starting, with an error starting `invalid_governance_table:` that names the row and field. So after editing either file:

1. Run `node --test server/providers/saGovernance/tables.test.mjs` and fix what it reports. It runs the same checks the server does.
2. Then run `docker compose restart`.

The legend and card text follow the data by themselves: the list’s month, how many councils it lists and how many of them are districts, and each metro row’s mayor, dates and note. A data update needs no code or translation change.

### Metro mayors (`server/providers/saGovernance/metros.json`)

An object with a `rows` array, one row per metro. Codes are `CPT`, `BUF`, `JHB`, `TSH`, `EKU`, `ETH`, `NMA` and `MAN`. Fields:

- `code`: the metro’s code, unique.
- `status`: `"elected"` or `"unresolved"`.
- `note`: a short text, required on every row (for an elected row, for example “DA holds a majority of seats”; for an unresolved row, what is known, for example “Mayoral vote expected Fri 27 Nov”).
- `asOf`: the date the row was last checked, ISO `YYYY-MM-DD`. Required on every row.
- `sourceUrl`: an `https:` link to the report the row rests on. Required on every row.
- Elected rows also need `mayor`, `party`, `coalition` (a non-empty list of party names) and `electedOn` (ISO date).
- An unresolved row must **not** carry `mayor`; the server refuses to start if it does.

To record a result, edit `metros.json` only: change `status` to `"elected"`, add `mayor`, `party`, `coalition` and `electedOn`, and update `note`, `asOf` and `sourceUrl`. To re-check a row that is still unresolved, update `asOf`, `note` and `sourceUrl`. Codes must not repeat. Then test and restart as above.

**As of 24 Nov 2026, six rows are unresolved and will need updating within days:** Johannesburg (vote expected Fri 27 Nov), Tshwane, Ekurhuleni, eThekwini, Nelson Mandela Bay and Mangaung. Cape Town (Geordin Hill-Lewis, DA, elected 19 Nov) and Buffalo City (Princess Faku, ANC, elected 24 Nov) are done.

### Section 139 list (`server/providers/saGovernance/interventions-2026-08.json`)

An object with `asOf` (ISO month, `YYYY-MM`), `source` (text), `sourceUrl` (`https:`) and a `rows` array. Each row has `code`, `name`, `province`, `type` and `since`, all non-empty text. The `code` must be an MDB code (a local municipality such as `EC139`, a metro such as `MAN`, or a district such as `DC12`) and must not repeat. Copy `type` and `since` verbatim from the source: the cards show them as written.

When CoGTA publishes a newer list:

1. Add a new file named for its month, for example `server/providers/saGovernance/interventions-2027-02.json`, in the format above, with the new `asOf`, `source`, `sourceUrl` and rows. The old file can then be deleted: nothing else reads it.
2. In `server/providers/saGovernance/tables.js`, change the file name in the `load('interventions-2026-08.json')` call to the new file.
3. In `server/providers/saGovernance/tables.test.mjs`, update `EXPECTED_CODES` to the new list’s codes, in the file’s order, and the checks next to it that pin this list: its `asOf` month, its row count and its district (`DC…`) codes.
4. In `DATA_SOURCES.md`, update the CoGTA section 139 row: its count, its “as at” date and the file name. The figures this doc quotes for the list (in “What the views show”, Sources and Known limits) change the same way.
5. Test and restart as above.

The legend’s month, count and districts, and the cards’ “(CoGTA list, …)” month, then follow from the new file’s `asOf` and rows.

## Local-only behaviour

`sa-districts-2026` is local-only like the other SA layers: no permanent share-link token, so it is **not restored after a reload, cannot be shared by link, and cannot be shown through MCP**. It is also in `VOICE_OFF_LAYERS`. The councils layer keeps its own id and behaviour. The colour switch is local to the page.

## Known limits

- **Audits are 2023/24.** The Auditor-General’s 2024-25 results are not in Municipal Money yet.
- **The intervention list is as at Aug 2026.** A council not on it may still be under intervention, and the list changes without notice.
- **Five of the 37 listed councils are districts** (DC12, DC15, DC36, DC39, DC4). They show on the districts layer, not on the councils layer, so the councils layer colours 32.
- **Mayors only for metros.** The other 205 local councils and 44 districts show no mayor: Treasury’s officials list is undated and still pre-election, and no reliable source covers them.
- **No party colours for districts.**
- **District outlines are fiddly to click at country zoom.** Zoom in and click the line itself.
- **Local-only and voice-off**, as above.
- Names from the sources (councils, mayors, parties, intervention types) are data and are not translated; every other new string is in all locales.
