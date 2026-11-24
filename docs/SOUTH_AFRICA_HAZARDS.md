# South African live hazards (fork-local)

This fork adds two layers that show current hazards over South Africa: **SA weather warnings** (the South African Weather Service's impact-based warnings) and **SA earthquakes (30 days)** (tremors in and around the country over the last month). Upstream God’s Eye View has neither. Both sit in the **South Africa** group in the layer panel, after the election layers. Design: `docs/superpowers/specs/2026-11-24-sa-live-hazards-design.md`.

The layers are for personal display on this PC. They are not an official warning service: for decisions, check weathersa.co.za. No SAWS or EMSC data is stored in git, and nothing is written to disk.

## What the layers show

### SA weather warnings (`sa-weather-warnings`)

- One drawn area per municipality polygon in a warning. Colour is the impact band, and the level number is the likelihood: levels 1 to 4 are yellow, 5 to 8 are orange and 9 to 10 are red.
- The card lists every warning in force for that area, worst first, for example “Yellow · Level 4 · Severe Thunderstorms”. Under each heading: the validity range in SAST, “Issued …” (also SAST), the first impact line and the first instruction sentence, each cut to 90 characters (the full text is on weathersa.co.za), and “Source: South African Weather Service”.
- Expired warnings drop out. The client re-checks on every update, so a warning that expires while the page is open disappears, and a selected area left with no warning loses its card.

### SA earthquakes (30 days) (`sa-earthquakes`)

- Dots are coloured by age: last 24 hours red, 1 to 7 days ago orange, 7 to 30 days ago yellow. Size follows magnitude. Dots are clamped to the ground.
- The card shows, for example, “M2.9 · Minor”, the region, the time in SAST, “Network: SASN” and “Source: EMSC-CSEM SeismicPortal”.
- The existing global **Earthquakes (24h)** layer is unchanged.

## The update rule for warnings

SAWS publishes many CAP files, and a new file does not say plainly which older warnings it overrides. The layer decides as follows:

- Files from one office and one hazard form an **issue**. A gap of more than 60 minutes between files starts a new issue. Files within one issue never replace each other.
- An earlier warning stops showing for an area only when a **later issue** has a warning for the **same area**, with an **overlapping time window**, that is itself still shown (not expired and not itself replaced).
- A **Cancel** never shows. A Cancel in the **same issue** as its warning replaces nothing; only a Cancel in a **later issue** replaces, whatever its own expiry and even if it is itself superseded.
- Expired warnings drop.

**Known cost:** SAWS may drop a warning without re-issuing it. On 24 November 2026 the KZN issue of 23 November had Level 2 for 38 areas, while the 24 November issue had only Level 4 for 10. The layer then keeps showing the older warning, labelled with its issue time, until it expires.

**Limit:** a SAWS Cancel that carries no polygon replaces nothing, because the parser drops any info block with no area.

## Sources

**SAWS CAP feed:**

- RSS: `https://caps.weathersa.co.za/Home/RssFeed`. Feed links are never followed.
- CAP files: `https://www.weathersa.co.za/Documents/Warnings/<name>`, rebuilt from a name that matches `^([A-Z]{2,3})_CAP_([A-Za-z]+)_(\d{8})_(\d{6})\.xml$`. At most 60 listed files from the last 4 days are considered; files already cached are not fetched again.
- XML is read with hand-written regex; there is no new dependency.

**EMSC FDSN event service:** `https://www.seismicportal.eu/fdsnws/event/1/query`, box latitude −35 to −22, longitude 16 to 33, the last 30 days, at most 500 events. A `204 No Content` answer means no events and is an empty layer, not an error.

Both fetches refuse redirects, keep TLS verification on, read through capped readers, and send a generic User-Agent (`GodsEyeView (sa-weather)` or `GodsEyeView (sa-quakes)`) with no personal details.

## Terms

- **SAWS:** the RSS channel says “Public Domain”, but each CAP file says `scope: Restricted`. The two disagree, so the fork uses the feed only on the owner’s localhost and commits no SAWS data. The SAWS website’s internal APIs (`/api/WarningAlerts`, `/api/StormTrack`) are not used: their terms forbid reuse. The credit is registered as `za-saws` in `src/data/dataCredits.js`.
- **EMSC:** licence CC BY 4.0, credit “EMSC-CSEM SeismicPortal” (registered as `za-emsc`). Bulk mirroring needs EMSC’s written permission; the fork caches only the one 10-minute query in memory.

## Cache and refresh

Both routes (`/api/sa-weather-warnings`, `/api/sa-earthquakes`) read upstream at most every 10 minutes and answer from memory in between. The client updates every 10 minutes too.

- **Weather:** parsed CAP files are kept in memory (up to 128). A file the feed lists but that answers 404 or 500 is skipped, not cached as a failure, and fetched again at the next refresh. If a refresh fails, the last snapshot is served, marked stale, for up to 24 hours, with expiry re-applied at serve time.
- **Earthquakes:** if a refresh fails, the last result is served stale for up to 24 hours, with the 30-day window re-applied at serve time.
- **Nothing is cached to disk.** There is no `.gev-cache` use and no keys.

## Local-only behaviour

Both layers are local-only, like the election layers: they get no permanent share-link token, so they are **not restored after a reload, cannot be shared by link, and cannot be shown through MCP**. They are also in `VOICE_OFF_LAYERS`. Place and warning text are data and are not translated; every other new string is in all locales. Neither layer registers in the pick-ownership registry.

## Known limits

- **Warnings are not decisions.** Check weathersa.co.za. Long impact and instruction text is cut on the card.
- **Dropped warnings** show until they expire (see the KZN case above).
- **Mine tremors** are included but cannot be labelled: EMSC marks every event `ke`.
- **Depth** is a 10 km placeholder in the feed, so it is not shown.
- **The box is not the border.** It includes Lesotho and eSwatini and parts of Botswana, Namibia, Zimbabwe and Mozambique.
- **Left out:** the SAWS storm-track and forecast products, and earthquakes older than 30 days.
