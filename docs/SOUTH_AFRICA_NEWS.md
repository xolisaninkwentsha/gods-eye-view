# South African news layer (fork-local)

This fork adds one layer, **SA news (24h)** (`sa-news`), to the South Africa group. It puts the last 24 hours of South African news on the globe at town level, one dot per story. Upstream God’s Eye View has none of this, and its worldwide News layer is untouched. Design: `docs/superpowers/specs/2026-11-24-sa-news-design.md`.

The layer is for personal display on this PC. Fetched data is kept in server memory only. From the outlets only the title, link and time are kept, for every item of the last 24 h (up to 200 per feed) and not only the placed ones. From GDELT only the event fields needed to place and kind each story are kept: event id, CAMEO root, quad class, mention count, place, latitude, longitude, article link and added time. No headline and no article text. The only data in git is the town list and the alias and deny lists (see “Editing the lists”).

## What the layer shows

- **Four kinds of dot**, each 7 px with a white outline:
  - Protest (GDELT CAMEO root 14), orange `#f2994a`.
  - Violence (roots 18–20), red `#eb5757`.
  - Other event (any other GDELT root), blue-grey `#8fa6bf`.
  - Headline (an outlet RSS item), teal `#2bb3a3`.
- **Layout.** Each place’s stories sit in a sunflower spiral around the town, newest at the centre. Neighbours are about 0.5–0.86 km apart (mean about 0.8 km), so every story is its own dot. Johannesburg’s 54 or so a day fill a disc about 7 km across: one blob at country zoom, separate dots at city zoom.
- **Card.** Headline (cut to 90 characters), place, the outlet or source domain with “3 h ago” (SAST time), the kind, and “Click to open the story ↗”. A mouse click opens the article in a new tab; so do Enter or Space on the focused card.
- **One article, one dot.** When both sources carry the same article it shows once, with the outlet’s headline and GDELT’s place. URLs are compared without scheme, `www`, query, hash or trailing slash.
- **Legend.** The four kinds with counts, and the layer row’s info line says when a source is not whole:
  - “GDELT: N of 24 h loaded” while the 24-hour window is incomplete.
  - “GDELT unavailable” when GDELT has failed.
  - “Headlines: X of 8 outlets unavailable” when feeds fail.

## Sources

- **GDELT 2.0 event exports** (`data.gdeltproject.org/gdeltv2/`), the 15-minute files, read by the server with the helpers already in `server/providers/news/gdeltEvents.js`. All event types are kept, not only violence, but only events coded to South Africa (`SF`) at city level (geo type 3 or 4). Country and province points are dropped, because they would pile up on one spot. A story’s time is GDELT’s DATEADDED.
- **Eight outlet RSS feeds**, read every 15 minutes, items from the last 24 hours: IOL, Daily Maverick, TimesLIVE, Mail & Guardian, GroundUp, eNCA, The Citizen and SAnews. None carries coordinates. A story’s time is the feed’s `pubDate`.
- **GeoNames ZA** (CC BY 4.0), as a committed list of 593 towns with 5,000 or more people (name, latitude, longitude, population). Nothing is downloaded at run time.

## Placing rules

- **GDELT events** are placed where GDELT put them, with one exception. When a story’s place is exactly the name of a listed town, and that town is within 25 km of GDELT’s point, the story takes the town’s position. GDELT and headline stories at one town then share one spiral (GDELT puts Johannesburg and Pretoria 4–6 km from the listed points). The list keeps only the most populous town of a name, so a town of that name further away is another place and keeps GDELT’s point. Events at a name on the shared deny list are dropped.
- **Headlines** are matched on the title only, never the description: whole words, case-sensitive, longest name first, first match in title order. A title with no match is dropped.
  - A name right after a surname particle is skipped, as in “AB de Villiers”. The particles are de, du, le, la, da, van, von, der and den, written in lower case (“de”) or Capitalised (“De”). An all-caps word is never a particle, so “DA Cape Town caucus” still places at Cape Town.
  - A skipped name does not end the scan: “Prince Albert of Monaco visits Durban” places at Durban.
- **Aliases** map other names to a listed town: Joburg and Jozi to Johannesburg, Tshwane to Pretoria, eThekwini to Durban, PE, Port Elizabeth and Nelson Mandela Bay to Gqeberha, Nelspruit to Mbombela, Pietersburg to Polokwane, Mangaung to Bloemfontein, Msunduzi to Pietermaritzburg, Buffalo City to East London.
  - Renamed or respelt towns, under the name GeoNames does not use: Makhanda to Grahamstown, Mahikeng to Mafikeng, Komani to Queenstown, Makhado to Louis Trichardt, Tembisa to Thembisa, Witbank to Emalahleni, Bela-Bela to Bela Bela, eMkhondo to Piet Retief, Uitenhage to Kariega, King William's Town to Qonce, Umtata to Mthatha, Ballito to Ballitoville. A curly apostrophe (’) in a title matches as a straight one.
- **Deny list**, shared by both sources: the nine provinces and their short forms (so province-only headlines are not placed), and names that headlines use for something else: Springbok, Madlanga, George, Alice, Bethlehem, Virginia, Nigel, Robertson, Victoria and Paris. The phrase “Soweto derby” is denied too. A longer denied span such as “Northern Cape” hides a shorter town inside it.
- **Headline-only deny list** (`SA_HEADLINE_DENY_NAMES`): town names that a headline far more often means as something else. Only headlines consult it, so GDELT keeps placing these towns (its Newcastle is the KwaZulu-Natal town). Like the shared list, a longer denied span hides a shorter town inside it. The groups, with examples (the full list is in `places.js`):
  - foreign places: Newcastle, Wellington, Adelaide, Aberdeen, Bochum, Carolina, Stanford;
  - people and surnames: Le Roux, Prince Albert, Winnie Mandela, Ngcobo, Brits, Wepener;
  - given names: Stella, Leslie, Ashton;
  - brands and companies: Northam, Ceres, Excelsior;
  - ordinary words in Title Case headlines: Retreat, Warden, Wilderness, Darling, Despatch.
- **GDELT titles** are the words of the article’s address; with fewer than 3 words the title is “Story from <domain>”.

## Server: `/api/sa-news`

- Same-origin, no key, rate limited. It returns the stories and a status for GDELT (hours covered, state) and for each outlet.
- The first request waits up to 10 s for the first GDELT and feed reads; later requests answer from memory and never wait.
- The server keeps backfilling GDELT in the background: every 2 s while each round reads something and the 24 h window is not complete, and every 5 minutes otherwise. Feeds refresh every 15 minutes.
- Everything is held in memory only; a server restart starts the backfill again. No disk cache.
- The background reads stop when the server closes, including Vite’s in-process restarts, and the log shows `[sa-news] stopped`.

## Measured yield (24 Nov 2026)

- **Before building, a full 24 h of GDELT:** 1,048 South African city-level events, which group by URL into 197 stories. Johannesburg 54, Pretoria 17, Cape Town 15, Durban 11; 68 distinct points.
- **A replay of the headline matcher over the 8 feeds:** 340 items, 26 placed (7.6%, about 1 in 13). The false hits it found (Springbok, Mpumalanga, the Soweto derby) are now on the deny list.
- **Live check, 22:26 SAST:** the first answer came in 2.6 s, with GDELT at 3 h and all 8 feeds ok. An eye check of the 34 placed headlines found no false places.
- **Live check, 22:38 SAST:** GDELT reached 24 h, complete. 203 stories at 62 places: event 149, violence 30, protest 1, headline 23. No story sat on Kwazulu or Madlanga.

## Terms

- **GDELT:** “unlimited and unrestricted use”, with citation. Credited in the app.
- **GeoNames:** CC BY 4.0, with attribution. Credited in the app.
- **Outlets.** Daily Maverick allows personal use only, and The Citizen bars mirroring. Keeping a headline, a link and a time on this PC and linking out fits both. GroundUp’s terms were also read, and this use (headline, link, time, linking out) fits them. **The terms of IOL, TimesLIVE, Mail & Guardian, eNCA and SAnews were not read.**
- The article text is never stored; the card links to the outlet’s own page.
- The credit is registered as `za-news` in `src/data/dataCredits.js` and shown in the Data credits popover.
- Feeds are read with a size cap, redirects refused and the User-Agent `GodsEyeView (sa-news)`. No key is needed and nothing is added to `.env`.

## Editing the lists

The alias list (`SA_ALIASES`), the shared deny lists (`SA_DENY_NAMES`, `SA_DENY_PHRASES`) and the headline-only deny list (`SA_HEADLINE_DENY_NAMES`) are in `server/providers/saNews/places.js`. The server reads them once when it starts. So after editing:

1. Run `node --test server/providers/saNews/places.test.mjs` and fix what it reports.
2. Then run `docker compose restart`.

To regenerate the town list, run `node scripts/sa-towns.mjs`, then `npx prettier --write server/providers/saNews/sa-towns.json`. It needs the network, downloads GeoNames ZA.zip into memory only, and stops without writing if the town count falls outside 550–650. Then test and restart as above.

## Local-only behaviour

`sa-news` is local-only like the other SA layers: no permanent share-link token, so it is **not restored after a reload, cannot be shared by link, and cannot be shown through MCP**. It is also in `VOICE_OFF_LAYERS`.

## Known limits

- **GDELT titles are the words of the article’s address**, not its real headline.
- **About 1 in 13 outlet headlines is placed** (26 of 340, 7.6%, in the measurement). Most headlines name no town.
- **News24 and SABC are not included.**
- **Province-only headlines are not placed.**
- **The headline deny list is hand-kept** and can never be complete. A town name that a headline uses for a person, a team or a foreign place, and that is not on the list, still places the headline.
- **Title Case headlines can still collide** with town names that are ordinary words, such as “Springs”.
- **George, Bethlehem, Virginia, Nigel, Robertson, Alice and Springbok** are on the shared deny list, so they get no dot from either source.
- **“Story from <domain>” titles are English** in every locale.
- **Large townships not in the GeoNames list** (Khayelitsha, Umlazi, Mamelodi, KwaMashu) are not matched.
- **A story’s time** is GDELT’s DATEADDED or the feed’s `pubDate`, not necessarily when it happened.
- **GDELT starts empty after a restart** and needs time to fill the 24 hours (about 12 minutes in the live check); the legend says how far it has got.
- **Local-only and voice-off**, as above.
