# South African election map (fork-local)

This fork adds two layers for the 4 November 2026 local government election: **SA councils 2026** (213 polygons: 8 metros and 205 local municipalities) and **SA wards 2026** (4,485 polygons). Upstream God’s Eye View has neither. A **South Africa** button beside “Go to my location” in the search bar frames the country and switches on the councils layer. Design: `docs/superpowers/specs/2026-11-23-sa-election-map-design.md`.

The layers are for personal display on this PC. No IEC or MDB data is stored in git: the server fetches it and keeps a derived cache that is gitignored.

## What the layers show

- **Councils** are filled in the colour of the party with the most seats. A council where no party holds more than half the seats keeps that party’s colour at a visibly fainter fill; the legend says what faint means.
- **Wards** are filled in the colour of the party (or independent) that won the ward ballot.
- A click opens a card. The council card shows the largest party with its seats out of the total, “Majority” or “No majority”, the top three parties by seats, the largest party’s PR vote share and turnout. The ward card shows the ward number and municipality, the winner and share, the runner-up and share, the margin and turnout.
- Every area that has a result is filled and carded, whatever the status, so during a download the provinces already read appear as they land. An area without a result draws as an outline only, and its card says why: results are off, still downloading, or unavailable, or, once results are in, that there is none for that area.
- The layers sit in a “South Africa” group in the layer panel.

### Winner rules

- **Ward winner:** the party with the most ward-ballot votes summed across the ward’s voting districts. All independent candidates arrive under one name and show as “Independent”. An exact tie shows as a tie, drawn as an outline.
- **Council winner:** the party with the most total seats in the IEC’s seat report; a tie in seats goes to the higher PR vote. “Majority” means that party’s seats exceed half the council’s total seats. Seats are never worked out from vote shares: a council with no seat report draws as an outline.
- **Vote share:** the PR ballot for a council, the ward ballot for a ward.
- **Turnout (approximate):** the larger of the ward-ballot and PR-ballot votes cast (valid plus spoilt), divided by registered voters. The IEC’s own figure also counts special votes, so this one is close but not identical.
- **Seat check:** the server counts each council’s ward wins per party and compares them with the “Ward Seats” in its seat report, and independent wins with the independent councillors elected. Where they disagree, the wards still draw in the vote-based winner’s colour (most ward votes is the rule), and their cards add a line saying the result is unconfirmed because it does not match the IEC’s seat count.

## Turning IEC results on

IEC fetching runs only when `SA_ELECTIONS_RESULTS=1`. Without it the routes serve boundaries only, with results status `off`.

1. Add the line yourself: `echo 'SA_ELECTIONS_RESULTS=1' >> .env`. `.env` is gitignored and nothing else should read or write it for you.
2. The app copies `.env` once at start, so run `docker compose restart` afterwards.

`.env.example` documents the switch, commented out. **Never put it in `compose.override.yaml`**: that file is committed and public in the fork, so a switch there would turn on IEC downloads for anyone who clones it.

## Sources

**MDB 2026 boundaries** (keyless ArcGIS FeatureServer, `maxRecordCount` 2,000), fetched with `maxAllowableOffset=0.001` (about 100 m) and `geometryPrecision=5`:

- Wards (4,485 features; fields `WardID`, `CAT_B`, `WardNo`, `MUNICNAME`, `Province`): `https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_Wards_2026/FeatureServer/0`
- Councils (213 features; fields `CAT_B`, `MUNICNAME`, `PROVINCE`, `CATEGORY`): `https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_L_ocal_Municipalities_2026/FeatureServer/0`

**IEC detailed results**, one CSV per province, about 245 MB in all:
`https://results.elections.org.za/home/LGEPublicReports/1887/Downloadable Party Results/{CODE}.csv`, CODE in EC, FS, GP, KN, NP, MP, NW, NC, WP. Each file is stream-parsed straight from the response and never written to disk. Columns used: `Municipality` (the code before `-` is the MDB `CAT_B`), `Ward` (the digits are the MDB `WardID`), `VotingDistrict`, `RegisteredVoters`, `BallotType` (`Ward`, `PR`, or `DC 40%`, which is ignored), `SpoiltVotes`, `PartyName`, `TotalValidVotes`.

**IEC seat calculation**, one old-format Excel (BIFF8 `.xls`) per council:
`https://results.elections.org.za/home/LGEPublicReports/1887/Seat Calculation Detail/{CODE}/{CAT_B}.xls`. A small reader written for these files takes total seats and, per party, total, ward and PR seats. A “ (PF)” forfeiture marker on a party name is stripped before matching.

## Terms

- **MDB licence:** use in value-added products such as applications is allowed with acknowledgement; no selling or commercial use; modified data must not be passed off as the MDB’s. The geometry is simplified here, so the credit reads “simplified from Municipal Demarcation Board data”. It is registered as `za-elections` in `src/data/dataCredits.js` and shown in the Data credits popover.
- **IEC results portal:** robots.txt allows all paths with the content signal `search=yes,ai-train=no,use=reference`. Its copyright and disclaimer pages refuse scripts, so the **reuse terms are unread**: treat the results as personal display only, on this PC. The IEC API (whose terms forbid caching) is not used. The server sends a generic User-Agent naming the app, with no personal details, and at most 2 CSV downloads and 4 seat files at a time. TLS verification is never turned off.

## Cache and refresh

The derived results and the simplified boundaries live in `.gev-cache/sa-elections/`, which is gitignored and bind-mounted into the container, so it survives `docker compose down -v`. Refresh is request-driven: nothing runs until a layer asks.

- **Writes:** each cache file is written to a temp file and renamed into place, so a crash leaves the previous file whole. Temp files that a killed process left behind are deleted on the first request after a restart.
- **Boundaries:** refreshed weekly. A failed refresh keeps the last good copy.
- **Results:** each province file is checked with a `HEAD` request (`Last-Modified`) at most once a day, and one hour after a failed check. Only provinces whose file changed are read again, along with their councils’ seat files.
- **Seat files:** one that failed is retried the next day.
- **Gaps:** provinces missing from the cache are filled on the next request.
- **First run:** the full download takes minutes. The routes answer at once with boundaries and status `loading`.
- **Statuses:**
  - `off`: the switch is not set, so no area has a result.
  - `loading`: a download is running, either the first run or a run filling provinces missing from the cache. Areas already downloaded are drawn; the rest wait as outlines, and the legend says the download is running.
  - `ok`: all nine provinces are in and the last check succeeded.
  - `stale`: some provinces are missing, or the last refresh failed, so the cached results are served as they are.
  - `failed`: a run failed with no results at all.
- **Polling:** the client polls hourly and the server answers from its cache. While the status is `loading` the client asks again every 30 seconds, also after a failed request, until the download ends.

## Local-only behaviour

Both layers are local-only, like `local-adsb` and `osm-places`: they get no permanent share-link token, so they are **not restored after a reload, cannot be shared by link, and cannot be shown through MCP**. They are also in `VOICE_OFF_LAYERS` (the voice prompt is at its budget), and the South Africa button hides in voice mode. Party and place names are data and are not translated; every other new string is in all locales.

## Known limits

- **Merged independents:** every independent ward candidate appears under the name `INDEPENDENT`, so a ward with several independents may have their votes merged and the winner’s share overstated. The seat check marks wards in councils where the counts disagree.
- **Approximate turnout:** see the turnout rule above.
- **Left out:** district councils (52), voting districts and stations, earlier elections (2021, 2016) and who governs (coalitions, mayors).
- **A persistently failing province** delays the other provinces’ daily checks, because the checks run as one pass.

## Measured performance

**Rendering** (Chrome on this Ubuntu PC, 24 November 2026, whole-country view at 3,669 km, frame rate counted while the camera turns):

- No election layers on: 59.7 fps.
- Wards on: 52.6 to 59.7 fps; the slowest single frame took 46 to 278 ms.
- Wards on over Johannesburg at 150 km: 59.2 fps.
- Switching wards on just after a page reload: the data is ready in 0.85 s, the colours are on screen in 3.0 to 4.7 s (two runs), and the ward outlines finish in about 5.5 to 6 s.
- Outcome: the plan’s limit was under 30 fps or over 5 s to show, so the wards layer has no camera-height limit.

**First download:** with the switch on, the first run (nine province CSVs, about 245 MB, plus 213 seat files) finished in under a minute.

**Data check** (24 November 2026):

- All 213 councils and all 4,485 wards have results. 4,481 wards have a winner; 4 are tied.
- Seat check: 209 councils match their IEC seat file. The 4 that do not are exactly the councils with a tied ward: Mnquma (EC122), Maluti a Phofung (FS194), Ba-Phalaborwa (LIM334) and Steve Tshwete (MP313). The check compares the ward winners counted from the votes with each party’s ward seats in the seat file. A tied ward has no winner from the votes (the IEC settles it outside the count), so its council cannot match; the check treats this as a mismatch by design.
- Every council balances: its party seats plus its independent ward winners equal its total seats.
- 8,805 seats in all. Largest parties: ANC 3,293, DA 1,722, MK 801, EFF 595, IFP 488, ActionSA 319.
- 74 councils have a majority and 139 have none.

**Seat-file layouts the reader handles** (found in the real files):

- A party name ending in ` *` marks the party that caused an excess seat. The marker is stripped before names are matched.
- Parties that won wards but have no PR list come after the `Independents` row, as `NAME **`, with their count in the “Ward Seats” column and the total column empty. King Sabata Dalindyebo (EC157) is the case: the UDM’s 13 seats are all ward seats. Its server log line “seat-file parties with no PR votes: UNITED DEMOCRATIC MOVEMENT” is expected, because the UDM had no PR list there.

**Not reconciled:** figures from the IEC’s declaration speech, as quoted second-hand in the research notes, are lower for every large party (ANC 3,164, DA 1,527, MK 701, EFF 505, ActionSA 219), and the IEC’s count of councils with no majority (127) differs from the app’s 139; the IEC’s own 127 plus 72 does not add up to 213. The app’s numbers come straight from the 213 seat files, and every council balances, so the gap most likely lies in what the speech counted. It was not checked against a primary IEC source.
