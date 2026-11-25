# SA news layer: design

Approved by Xolisani on 24 November 2026 (plan mode, after "dive in" to my picks). Batch 3 of the South African layers.

## Approaches

- **Where SA news shows:** (A) a new fork-local layer "SA news (24h)" (chosen); (B) widening the app's worldwide News layer (Conflicts) to all South African event types, rejected because it changes upstream code and the global layer's meaning; (C) a Data Library manifest, rejected because neither source is a placed GeoJSON feed.
- **Town names:** (A) a committed, filtered GeoNames list of 593 towns with a hand-kept alias and deny list (chosen); (B) a runtime GeoNames download with alternate names, rejected because the alternates are mostly foreign spellings and the download adds zip handling, a cache and a failure mode for no gain.
- **Titles for GDELT stories:** address words (chosen); GKG page titles rejected (about 576 MB a day of downloads).
- **Layout:** one dot per story in a sunflower spiral per place (chosen), so every story is one click; merging stories per place rejected because a card can open only one link.

## Context

Xolisani said "start batch 3" (news) and then "dive in" to my picks. So the goal is South African news on the globe, at city level, from two sources:
- **GDELT events:** all event types, not only violence.
- **SA outlet headlines:** placed by matching town names.

The fork is public: code and small curated lists are committed, fetched data is not. Xolisani uses it on localhost only.

### Facts checked on 24 Nov 2026
- **GDELT.** The 18:45 SAST export had 1,077 events, of which 16 were South African (`ActionGeo_CountryCode` = `SF`).
  - 15 of those were at city level (geo type 4); 1 was at country level.
  - Places included Randburg, Sandton, Kempton Park and Stellenbosch.
  - Root codes were mixed (17, 04, 01, 10, 05, 18), so most stories are not violence.
  - Licence: "unlimited and unrestricted use", with citation.
- **The app's GDELT reader** (`server/providers/news/gdeltEvents.js`) exports what we need: `exportsOfDay`, `exportUrl`/`exportAt`, `fetchLatestExport`, `unzipExport`, `articleLink`, `addressWords`, `cleanTitle` and `storyKey`.
  - Its `parseEvents` is hard-wired to violence and drops the country column (53).
  - `fetchTable` is not exported.
  - So the fork writes its own small fetch-and-parse using the exported pieces. No upstream file changes.
  - Upstream constants worth mirroring: `lastupdate.txt` gating (asking early gives a 404 that the CDN keeps for an hour), 4 fetches at once, an 8 MB cap and 30 s timeouts.
- **Outlet RSS.** Eight feeds returned 200:
  - IOL `iol.co.za/rss/`, Daily Maverick `dailymaverick.co.za/dmrss/`, TimesLIVE `timeslive.co.za/arc/outboundfeeds/rss/`, M&G `mg.co.za/rss/` (`/feed/` is 404), GroundUp `groundup.org.za/sitenews/rss/` (the www host redirects), eNCA `enca.com/rss.xml`, The Citizen `citizen.co.za/feed/` (684 KB) and SAnews `sanews.gov.za/rss.xml`.
  - None carries coordinates. News24 returns 403; SABC is not used.
  - Terms: Daily Maverick allows personal use only; The Citizen bars mirroring. Storing headline, link and time on this PC, and linking out, fits both.
  - Most headlines name no town ("ANC's quest for hegemony…"). The measured yield is about 7.6%, under "Measured before deciding" below.
- **GeoNames ZA** (`download.geonames.org/export/dump/ZA.zip`, 2.7 MB, CC BY 4.0) has 13,529 populated places: 595 with 5,000+ people, 250 with 20,000+.
  - Its ambiguous names include George, Alice, Bethlehem, Ermelo, Vryheid and Hammanskraal. Some are fine; George, Alice and Bethlehem are also people or foreign places.
- **App patterns.**
  - An overlay card can open a link: `interactive: true` plus `activate: () => { openExternal(url); return true; }`, as in `src/layers/perimeters/cards.js:157-228` and `index.js:182-189`, with `openExternal` passed from `src/app/layers/perimeters.js:20`.
  - Points need `pos`, `height: 'clampGround'`, `disableDepthTest` and a set-level `horizonCull` (batch 1 lesson).

### Measured before deciding (24 Nov, about 19:00 SAST)

**A full 24 h of GDELT** (all 96 exports read): 1,048 South African city-level events, which come to **197 stories a day** when grouped by URL.
- Places: Johannesburg 54, Pretoria 17, Cape Town 15, Durban 11; 68 distinct points in all.
- Kinds: other 182, violence 14, protest 1.
- 170 of 197 URLs give 3 or more title words from their address.
- GDELT also mislabels some places:
  - "Kwazulu" (9) is the province coded as a city;
  - "Madlanga" (4) is the Madlanga Commission, a person's name read as a town.
- Domains overlap with the feeds: citizen.co.za 23, timeslive 16, sanews 12, mg.co.za 11.

**A replay of the matcher over all 8 feeds now:** 340 items, all with `<pubDate>` and an http(s) `<link>`. Only **26 placed (7.6%)**, with these false hits:
- "Springbok" ×2: the rugby team, not the Northern Cape town;
- "Mpumalanga" ×2: the province, but GeoNames has a KwaZulu-Natal town of that name;
- "Soweto derby": the football match.

Good hits included Riebeek West, Polokwane, Gqeberha, Soshanguve, Sandton, Mdantsane, Germiston, Soweto (flood) and Pretoria.

**GeoNames.**
- With 5,000+ people there are 593 primary names. Nelspruit and Port Elizabeth are not primary; the primaries are Mbombela and Gqeberha.
- The 817 Latin alternate names are mostly foreign spellings ("Blumfontejn", "Behnoni"), so they are not used.
- ZA.zip has 2 entries (readme.txt and ZA.txt, 12 MB unpacked).

## Design (my calls)

0. **Changes from the measurements:**
   - **Commit the town list.** The filtered GeoNames list (593 towns of 5,000+ people: name, lat, lon, population) is committed as about 25 KB of JSON, with CC BY 4.0 credit. A one-off script, `scripts/sa-towns.mjs`, regenerates it. This removes the runtime download, the zip handling, the disk cache and the gazetteer status.
   - **No alternate names.** Only a committed alias table: Joburg and Jozi → Johannesburg, Tshwane → Pretoria, eThekwini → Durban, PE / Port Elizabeth / Nelson Mandela Bay → Gqeberha, Nelspruit → Mbombela, Pietersburg → Polokwane, Mangaung → Bloemfontein, Msunduzi → Pietermaritzburg, Buffalo City → East London.
   - **Deny list, committed and shared by both sources:**
     - all 9 province names and their short forms (Gauteng, KwaZulu-Natal/KZN/Kwazulu, Mpumalanga, Limpopo, Free State, North West, Northern/Eastern/Western Cape);
     - names that headlines use for something else: Springbok, Madlanga, George, Alice, Bethlehem, Virginia, Nigel, Robertson, Victoria, Paris;
     - "Soweto derby" (phrase-level).
   - **GDELT events** whose place matches the deny list are dropped, which removes the Kwazulu and Madlanga pile-ups.
   - **Layout:** each place's stories sit in a deterministic sunflower spiral around the point, newest at the centre, about 700 m apart. Johannesburg's 54 a day fill about a 5 km disc: a single blob at country zoom, separate clickable dots at city zoom.
   - **The same article from both sources is one dot.** URLs are normalised (https, no www, no query or hash, no trailing slash). Such a dot uses the outlet's headline and GDELT's place.
   - **Titles:** GDELT stories use their address words; with fewer than 3 words, "Story from <domain>".
   - **Story place** is chosen with the exported `choosePlaces` rather than by row order.
   - **Time:** GDELT uses DATEADDED (column 59) for both the 24-hour window and "x h ago". Headlines use `pubDate`, falling back to when the item was first seen.
   - **Links:** only http(s) URLs are accepted, checked on the server and again in the client normaliser, with a test for a `javascript:` link.
   - **Backfill:**
     - The first request waits up to 10 s for the first batch.
     - The server then keeps fetching in the background, up to 12 exports at a time, 4 at once, every 2 s until the 24 hours are covered, and every 5 minutes after that.
     - `status.gdelt` reports the hours covered. While that is under 24, the legend shows "GDELT: last N h so far".
     - The route always answers from what it holds and never waits on the feeds.


1. **New fork-local layer "SA news (24h)" (`sa-news`)** in the South Africa group. Local-only, voice-off. The app's worldwide News layer is untouched.
2. **One dot per story, never merged.**
   - Stories at the same town sit in the sunflower spiral from item 0, newest at the centre, about 700 m apart, so each is clickable.
   - Colour by kind:
     - **Protest:** GDELT CAMEO root 14, orange `#f2994a`.
     - **Violence:** roots 18–20, red `#eb5757`.
     - **Other event:** any other GDELT root, blue-grey `#8fa6bf`.
     - **Headline:** an outlet RSS item, teal `#2bb3a3`.
   - Dots are 7 px with a white outline.
3. **Card:** headline (cut to 90), then place, then outlet or source domain plus "3 h ago" (SAST time), then kind, then "Click to open the story ↗".
   - The card is interactive, and clicking it opens the article in a new tab.
   - All lines are capped at 90 characters.
4. **Titles.**
   - GDELT stories have no headline, so they use their address words (`addressWords` + `cleanTitle`), the same fallback the News layer uses.
   - GKG page titles are a non-goal: about 6 MB per quarter hour, roughly 576 MB a day.
5. **Placing rules.**
   - **GDELT:** keep only events with `SF` and geo type 3 or 4 (city), and drop any whose place is on the deny list. Country (1) and province (2 and 5) points are dropped too, because they would pile up on centroids. A story's place is chosen with the exported `choosePlaces`.
   - **Headlines:** match the title only (not the description), as whole words, case-sensitive, longest match first, first match in title order. A title with no match is dropped.
   - **Town list, aliases and deny list:** as in item 0 (the committed list of 593 towns, the alias table, and the deny list that covers province names). Province-only mentions are not placed.
6. **Server: `server/providers/saNews/`.**
   - **`gdelt.js`:** parse, then a 24-hour window of exports gated by `lastupdate.txt`, with at most 4 fetches at once and up to 12 per refresh. Kept in memory.
   - **`rss.js`:** the 8 feeds every 15 minutes, items from the last 24 hours. Feeds are read through `readResponseTextCapped` with a 2 MiB cap, `redirect: 'error'` and the User-Agent `GodsEyeView (sa-news)`.
   - **`places.js`:** the committed `sa-towns.json`, aliases and deny list, plus `matchPlace(title)` and `deniedPlace(name)`.
   - **`index.js`:** route `/api/sa-news`, returning `{fetchedAt, stories: [{id, kind, title, url, source, publishedAt, place, lat, lon}], status: {gdelt: {hoursCovered, state}, rss: {outlet: ok|failed}}}`.
     - Same-site gate, rate limit, coalesced refresh, logs by code or name only.
     - Nothing is committed except the alias and deny lists.
7. **Legend.**
   - The four kinds with counts.
   - Blurb: "GDELT events placed at city level and SA outlet headlines matched to town names. Click a card to open the story."
   - Status lines when a source is down ("GDELT unavailable", "Headlines: 2 of 8 outlets unavailable"), never a silent empty map.
8. **Credits `za-news`:** "GDELT Project", GeoNames (CC BY 4.0), and "headlines link to IOL, Daily Maverick, TimesLIVE, Mail & Guardian, GroundUp, eNCA, The Citizen, SAnews".

## Non-goals

- GKG titles or GKG locations; News24 and SABC; the article text (linked, never stored); changes to the worldwide News layer.

## Anti-goals

- Stories piled on a country, province or mislabelled point (the Kwazulu and Madlanga cases).
- A headline placed on the wrong town by a name that means something else (Springbok, Mpumalanga, Soweto derby).
- Any outlet text beyond headline, link and time kept anywhere; anything fetched committed.
- A silent empty or partial map: missing sources and partial GDELT coverage are stated in the legend.
