# SA governance views: design

Approved by Xolisani on 24 November 2026 (plan mode, after "dive in" to my picks). Batch 2 of the South African layers.

## Approaches

- **Mayors:** (1) a hand-kept, dated table for the 8 metros only (chosen); (2) that plus Treasury's undated officials list for the other 205 councils, rejected because the list still names pre-election mayors (Johannesburg shows Dada Morero); (3) no mayors, rejected because the metros are the part people ask about.
- **Where governance shows:** (A) colour views plus card lines on the existing councils layer, with a separate district-outline layer (chosen); (B) separate audit and intervention layers that redraw every council polygon, rejected because it doubles the polygons and splits one question across three layers; (C) Data Library manifests, rejected because the data must be joined to the polygons by code.
- **District colours:** colouring districts by the district (DC 40%) ballot is rejected for now: the results pipeline skips that ballot, and adding it needs a results-version bump and a re-download of about 245 MB.

## Context

Xolisani said "start" on batch 2, "who runs each council", and "dive in" to my picks. The picks:
- mayors only in a hand-kept, dated table, and only for the 8 metros;
- governance shown as new colour views on the existing councils layer, plus a separate district-outline layer.

This is the fork's local-only election map (`sa-councils-2026`, `sa-wards-2026`), extended. The fork is public: code and the small curated tables are committed, and fetched data is not.

### Facts checked on 24 Nov 2026

**Audit opinions** (Treasury, Municipal Money, keyless).
- `https://municipaldata.treasury.gov.za/api/cubes/audit_opinions/facts?cut=financial_year_end.year:2024&pagesize=500` gives 257 rows (78 KB) in one request: the 213 councils plus the 44 districts. Fields: `demarcation.code`, `opinion.code`, `opinion.label`.
- 2024 (financial year 2023/24) is the latest year:
  - `unqualified` (clean) 41;
  - `unqualified_emphasis_of_matter` 99;
  - `qualified` 90;
  - `disclaimer` 11;
  - `adverse` 6;
  - `outstanding` 10.
- Codes match the MDB `CAT_B` and `DISTRICT` values.
- Terms allow reuse, commercial use included, with the source and date credited.

**Mayors from Treasury are stale.** The `officials` cube has no date and still names pre-election mayors: Johannesburg shows Dada Morero. Not used.

**Section 139 list.** The CoGTA reply to NW4545, "as at August 2026", has an Annexure A table (`https://static.pmg.org.za/RNW4545-260914.docx`, linked from `pmg.org.za/committee-question/40568/`).
- It lists 37 councils: 31 local municipalities, Mangaung, and 5 districts (DC12, DC15, DC36, DC39, DC4).
- I checked every code against the MDB 2026 names, and all 37 match.
- Each row has the name, province, intervention type (verbatim, for example "S139(5)(a) and (c)") and the date instituted.

**Metros on 24 Nov 2026:**

| Metro | State | Detail | Source |
|---|---|---|---|
| CPT | Mayor elected | Geordin Hill-Lewis (DA), re-elected 19 Nov; DA majority, 133 of 235 seats | Daily Maverick, 19 Nov |
| BUF | Mayor elected | Princess Faku (ANC), re-elected 24 Nov, 52–47, with EFF, PA and AIC votes | EWN, 24 Nov |
| JHB | Unresolved | Vote expected Fri 27 Nov | EWN, 24 Nov |
| TSH | Unresolved | First sitting Thu 26 Nov | EWN, 24 Nov |
| EKU | Unresolved | Council sits Wed 25 Nov | EWN, 24 Nov |
| ETH | Unresolved | 24 Nov sitting adjourned without a mayor | Witness, 24 Nov |
| NMA | Unresolved | DA-led six-party deal signed; vote due 24 Nov, result not yet reported | Herald, 24 Nov |
| MAN | Unresolved | Latest source is from 19 Nov | OFM |

**District outlines.** `services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_District_Municipalities_2026/FeatureServer/0` has 52 features: 44 districts (category C) and 8 metros (category A). Fields: `DISTRICT`, `DISTRICT_N`, `CATEGORY`, `PROVINCE`, `Map_Label`.

The MDB local-municipality layer has `DISTRICT` for each council, so district membership needs no geometry. For example, KZN212 is in DC21.

**Code facts (from the code reader):**
- The councils layer colours through `saAreaColor` (`src/layers/saElections/records.js:63`), in three places: the draw (`index.js:290`), the legend (`:383`) and the card accent (`cards.js:52`).
- It has no `setParams`, and `getRowControls()` returns `chips: []`.
- `_rowById` drops polygons, and a redraw happens only when the signature changes (`index.js:277-316`).
- Segmented-switch precedent: `src/layers/firms/queries.js:157-168`, reaching `module.setParams` through `layerPanel.js:599-612` and `lifecycle.js:1867`.
- The election results pipeline skips the district ballot (`results.js:111`). Colouring districts by party would need a results-version bump and a re-download of about 245 MB.

## Design (decisions are my calls)

0. **Checked further.** All 257 audit codes match the 213 MDB 2026 council codes plus the 44 district codes, with no misses either way. A "no audit data" path stays anyway.
1. **Governance views live on the councils layer.** A segmented switch in its row has three choices:
   - **Party:** today's view.
   - **Audit 2023/24:** clean (green), unqualified with findings (light green), qualified (yellow), adverse (orange), disclaimer (red), outstanding (purple), no data (grey).
   - **Interventions:** councils on the section 139 list filled red, others faint.
   - The legend follows the chosen view, and so does the card accent.
   - Wards are unchanged.
   - The audit-year label is derived from the year chosen, never hard-coded: year 2024 reads "2023/24".
   - While audits are loading or unavailable, the audit view's legend says so ("Loading audit results…" or "Audit results unavailable"), rather than showing 213 silent grey councils. Cards say "Audit: unavailable".
   - The interventions legend note reads: "37 councils on CoGTA's list as at Aug 2026; 5 of them are districts, shown on the districts layer. Not listed ≠ no intervention."
2. **Every council card gains governance lines, whatever the view.** Card lines don't wrap, so each is cut to 90 characters:
   - "District: Ugu (DC21)".
   - "Audit 2023/24: Qualified".
   - For councils on the list, two lines:
     - "Section 139 since June 2022 (CoGTA list, Aug 2026)";
     - "Type: S139(5)(a) and (c)", which is the verbatim type.
   - For metros, either "Mayor: Geordin Hill-Lewis (DA), elected 19 Nov 2026" or "Mayor: not yet elected (as of 24 Nov 2026)", plus the short note, for example "Vote expected 27 Nov".
3. **A new layer, "SA districts 2026" (`sa-districts-2026`).**
   - It draws the 52 district outlines as draped lines, 3 px wide and pickable.
   - The 5 districts on the section 139 list get a red outline; the rest are light grey.
   - The near-clear fill is `pickable: false`. The districts tile the whole country, so a pickable fill would steal every click from the councils layer, whose cards carry the governance lines. You open a district card by clicking its outline, and the legend note says so.
   - The council cards' "District:" line covers the common question either way.
   - Card: the full name and code, the province, "District municipality" or "Metro (also a council)", "Councils: Ray Nkonyeni, Umdoni, … (+2)" cut to 90 characters, the district's own audit result, and its section 139 lines if listed.
   - No party colouring: the district ballot is skipped, and adding it would cost a 245 MB re-download. That is noted as a later option.
4. **A new server route, `/api/sa-governance`.**
   - It serves the audits for the latest year with 200 or more rows that are not "outstanding". Every year has exactly 257 rows, so counting all rows would jump to a new year made mostly of outstanding audits. They are fetched from Municipal Money, cached in memory and in `.gev-cache/sa-governance/audits.json`, refreshed daily, and served stale for up to 30 days.
   - It also serves the two committed tables.
   - It serves `districtOf` too: each council's code mapped to its district code and name, from the attribute-only membership fetch. That fetch is cached weekly with the districts, and it is what the council card's "District:" line uses.
   - `/api/sa-governance/districts` serves the 52 simplified district polygons with their member councils. These are cached in `.gev-cache/sa-governance/districts.json` and refreshed weekly, like the election boundaries.
   - Neither route changes the election provider's caches or results.
5. **The curated tables are committed JSON** in `server/providers/saGovernance/`:
   - `interventions-2026-08.json`: 37 rows with code, name, province, type and `since`, plus `asOf`, `source` and `sourceUrl`.
     - `since` is the document's text, kept verbatim for display ("2019", "June 2018", "8 Dec 2021").
     - Tests check it is not empty; they don't parse it.
   - `metros.json`: 8 rows, each with `status` (`elected` or `unresolved`).
     - Elected rows add the mayor, the mayor's party, the coalition parties and an ISO `electedOn` date.
     - Every row has a short note, an ISO `asOf` date and a `sourceUrl`.
     - No seat counts: the card already shows the IEC's.
     - Nelson Mandela Bay is re-checked when Task 1 is dispatched, because its vote was due 24 Nov.
   - They are public facts with sources, and they are checked by tests: known codes, required fields, valid dates.
   - Updating either is a one-file edit. The doc explains how, and the JHB, TSH, EKU, ETH, NMA and MAN rows will need an update within days.
6. **Labels are honest.**
   - "Interventions" says "as at Aug 2026", and "not listed" never says "no intervention".
   - Audits say "2023/24".
   - The metro rows carry their own as-of dates.
7. **Same pattern as before.** Local-only, voice-off, the South Africa panel group, same-origin keyless routes with capped reads, `redirect: 'error'` and the User-Agent `GodsEyeView (sa-governance)`. Nothing goes in `.env` or `compose.override.yaml`. The South Africa button stays as it is.

## Non-goals

- Party colours for districts (district ballot), mayors outside the metros, Treasury finance data, the AGSA 2024-25 report (not yet in Municipal Money), and anything for the wards layer.

## Anti-goals

- A label that claims more than the source: "not listed" never means "no intervention"; a metro row never shows a mayor without a dated source.
- A silent failure that looks like data: unavailable audits must say so, not paint every council grey.
- Fetched data committed to git; changes to the election provider's caches or results.
