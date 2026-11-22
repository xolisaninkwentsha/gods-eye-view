# South African cameras: design

Date: 2026-11-22 · Fork: `xolisaninkwentsha/gods-eye-view` · Status: draft for approval

## Intent

The app's camera layer has 7,350 cameras and none in Africa (nearest to Cape
Town: Castelldefels, 8,482 km). Xolisani, in Cape Town, wants South African
cameras on the globe **for personal enjoyment** ("I just think it's really
cool"). It is also a fallback in case SANRAL refuses access to its i-traffic
cameras. Nothing is done with the imagery beyond looking at it. The app runs
only on his PC (Docker, published on 127.0.0.1:4173), in his personal fork,
which pulls updates from upstream `bilawalsidhu/gods-eye-view`.

## Goals

1. Add every verified, owner-published **still-image** South African webcam
   (about 25, listed below) as cameras on the globe, credited to their owners.
2. Add **YouTube live webcams** in South Africa (about 15) as camera points that
   play inside the app when clicked.
3. Keep the global camera catalog working exactly as before.

## Non-goals

- Traffic coverage. None of these cameras faces a road; they are scenic,
  airfield, observatory and weather views. SANRAL remains a separate request.
- Sending anything upstream. This lives in the personal fork, though the code
  should follow upstream conventions so pulls stay easy.
- Cameras whose terms or behaviour rule them out (see Excluded).

## Anti-goals (a failure even if it "works")

- **Spending Google money.** When a camera has no fetchable image, the frame
  endpoint falls back to Google Street View Static on the user's
  `GOOGLE_MAPS_SERVER_API_KEY` (`server/providers/cctv.js`, `streetViewFallback`).
  No camera added here may trigger that fallback.
- Getting around a site's block: disguised User-Agents, scraping pages that
  refuse automated clients, or decoding obfuscated URLs. The app fetches with
  its own `gods-eye-view-cctv-proxy/1.0` identity, and a camera that refuses
  that identity is dropped.
- Storing frames on disk, or fetching more often than the owner updates.
- Switching off the built-in camera packs (a file pack does that unless
  `CCTV_FORCE_AUSTIN=1`, `server/providers/cctv/catalog.js:333`).
- Loosening URL validation, redirect rules or the CSP beyond what's stated here.

## Constraints

- **Repo rules:** `docs/CCTV_INTEGRATION.md` (server-registered URLs only, pinned
  hosts, no browser-supplied URLs, bounded fetches, in-memory caching) and
  `SECURITY.md`. CSP `frame-src` already allows `https://www.youtube-nocookie.com`
  (`build/vite.js:83`).
- **Checks:** `npm test`, `npm run build`, and `npm run test:track` with the dev
  server up (`CONTRIBUTING.md`). Node 24 (host 24.22.3 via nvm, image 24.22.2).
- **Runtime:** Docker, via `compose.yaml` plus the fork's `compose.override.yaml`.
  The repo is bind-mounted at `/app`. Configuration goes in the override's
  `environment:`, never in `.env`, which holds keys and is never read.
- **Refresh:** the client clamps an explicit `frameRefreshMs` to 1–20 min
  (`src/data/cctvLod.js:521`) and only fetches cameras in view.

## Approaches considered

1. **New "YouTube" camera type in the camera layer (chosen).** YouTube cameras
   live in the same camera-list file. They render as normal camera points; a
   click opens a floating panel with a Play button that loads the app's existing
   privacy-enhanced YouTube player (`src/data/youtubeLivePlayer.js`). The frame
   endpoint returns a placeholder for them, never Street View. Trade-off: the most
   code, in camera-layer files that upstream also edits.
2. **Route camera selection into the existing Live section.** Cameras would
   announce selection like flights do, and streams would attach to `cctv:<id>`
   in `src/data/liveStreams.js`. Less new UI, but the video plays in a different
   panel from the camera. Announcing camera selection also affects every
   consumer of `gev:awareness-subject-selected` (tracked readout, context
   store). Rejected.
3. **Link-out only.** This borrows Québec's link-only `sourceKind`: a mislabelled
   hack that still risks Street View charges and sends the user out of the app.
   Rejected.

Xolisani picked approach 1.

## Design

### A. Camera list (no code)

A new file, `config/cctv_sources.south-africa.json`: an array of source records
in the format `normalizeSourceItem` already accepts
(`server/providers/cctv/normalize.js:632`):

- `id`: stable, prefixed `za-`.
- `name`, `city`, `cityId`: `cityId` is `za-<region>`.
- `provider`: the owner.
- `credit`: the owner's required wording where one exists.
- `license`: a short terms note.
- `lat`, `lon`.
- `accuracyM` and `positionSource`: be honest about approximate positions.
- `headingDeg` with `headingConfidence: "low"`: only where the view direction
  is known.
- `feedType`.
- `snapshotUrl` and `url`: the same image URL.
- `sourceUrl`: the owner's page, which the panel links to.
- `frameRefreshMs`.
- `streetViewFallback: false`: see C.

### B. Configuration (no code)

Add to `compose.override.yaml` under `services.gods-eye-view.environment`:

- `CCTV_SOURCES_FILE=config/cctv_sources.south-africa.json`
- `CCTV_FORCE_AUSTIN=1`: keeps every live pack loading alongside the file.
- `NODE_EXTRA_CA_CERTS=/app/config/certs/sectigo-public-server-auth-ca-ov-r36.pem`.
  SAAO's `suthweather.saao.ac.za` omits its intermediate certificate. Add
  that public intermediate (from `http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt`,
  converted to PEM) rather than ever disabling verification.

- `CCTV_MAX_SOURCES=7450`. The default cap, `DEFAULT_CCTV_MAX_SOURCES = 7350`
  (`server/providers/cctv/constants.js:17`), is already full. The sources file
  joins the shared pool as one more pack, so without a higher cap about 60
  existing cameras would be pushed out (Goal 3). The ceiling is 8,000. Verify
  by comparing `/api/cctv/sources` `trimmedPacks` for the built-in packs before
  and after.

These variables reach `process.env` unchanged, because dotenv values apply
only to unset variables (`server/standalone/vite.config.js:20-22`).

**Host pinning (builder's call, accepted):** the sources file is upstream's
supported route for operator-supplied cameras. It keeps redirects on the same
host (`server/providers/cctv/media.js:526-555`) but doesn't pin paths. A
dedicated pinned pack module isn't worth it for a personal list.

### C. Server changes

1. **Feed type `youtube`.** `normalizeFeedType` already passes unknown values
   through. Add a validated `youtubeVideoId` field
   (`/^[A-Za-z0-9_-]{11}$/`; anything else drops the camera with one warning).
   Expose it on `/api/cctv/sources` only for `feedType === 'youtube'`. A
   `youtube` camera has no `url`/`snapshotUrl`, and the server never fetches
   YouTube.
2. **Frame endpoint.** Sources with `streetViewFallback: false` go through
   `fetchThrottledFrame`. That gives them a server-side refresh floor at
   `frameRefreshMs`, an in-memory cache, and one shared request per camera, as
   `docs/CCTV_INTEGRATION.md:113-117` requires. This matters because several
   client paths ask for frames independently, and `getFrame` ticks every 10 s.
   Sources-file cameras without the flag behave as upstream.
   For `feedType === 'youtube'`, and for any source with
   `streetViewFallback: false` whose upstream fetch fails, serve the existing
   synthetic SVG card. The label for YouTube cameras is "LIVE ON YOUTUBE —
   PRESS PLAY"; otherwise use the existing offline wording. Never call
   `streetViewFallback`. Set `X-CCTV-Source: synthetic` and record health
   accordingly.
3. **Cape Gliding Club resolver.** These four cameras have no fixed image URL.
   Add `sourceKind: "capegliding-latest"`. At frame time, the server makes two
   requests:
   - It GETs `https://www.capegliding.co.za/wp-admin/admin-ajax.php?action=get_latest_camera_image&camera=cameraN`,
     with `N` taken from the record and in 1–4, a short deadline, and a small
     body cap.
   - It parses `data.url` and accepts it only if it is pinned under
     `https://www.capegliding.co.za/wp-content/uploads/camera-cache/cameraN/`
     (via `pinnedCameraUrl`). It then fetches that image through the normal
     bounded image path.

   It reuses the per-camera refresh floor (`fetchThrottledFrame`) so the
   frequency never exceeds `frameRefreshMs`.
4. **Pass-through.** `streetViewFallback` and `youtubeVideoId` survive
   `normalizeSourceItem` and the `/api/cctv/sources` projection.

### D. Client changes

1. **Model.** Treat `feedType === 'youtube'` as a browser-overlay camera
   (`isBrowserOverlayCamera` in `src/layers/cctv/model.js`) and as live-capable
   for icons and LOD. They stay out of still-card fill and 3D projection: YouTube
   pixels can't be read.
2. **Overlay.** Add `src/ui/youtubeCctvOverlay.js` plus a small Vue panel,
   modelled on `src/ui/quebecCctvOverlay.js`. It is a floating panel anchored at
   the selected YouTube camera. It shows:
   - the camera name, owner credit, and a link to `sourceUrl`;
   - a **Play** button;
   - the note "Video plays from YouTube, which sees your IP address."

   Play calls `createYouTubeLivePlayer({ host, videoId })` and maps its states
   to text: loading, playing, "offline" (stream not live), and "unavailable"
   (embedding refused). Nothing loads before Play. Deselecting or closing calls
   `destroy()`. Wire it wherever the Québec overlay is created and selected.

### E. Camera inventory

#### Still images: ready (data only, once C2's opt-out exists)

Every URL below returned HTTP 200 `image/jpeg` today, 22 Nov 2026,
12:57–13:13 SAST. Re-test each with the app's User-Agent before adding it, and
drop any that refuse it.

| id | Camera | Image URL | Position (evidence) | Refresh | Credit / page |
|---|---|---|---|---|---|
| za-ctwc-tablemountain | Cape Town Webcam: Table Mountain over Milnerton Lagoon | https://www.kapstadt.de/webcam.jpg | **Approximate**: Milnerton, east side of the lagoon, facing about 200° (owner says Milnerton Lagoon and Woodbridge Island are nearest the viewer). Exact mount unknown | 420000 | Must show "Cape Town Webcam is sponsored by www.Kapstadt.de", linked to https://www.kapstadt.de (owner's embed condition). Page https://www.capetown-webcam.com/information |
| za-rand-henley-west | Rand Airport: Henley WestCam | https://helidev.tech/cam_west.jpg | -26.241978, 28.151356 (eAIP ARP; camera on Hangar 6) | 120000 | "HenleyAir.tv — Henley Air, Rand Airport" (owner asks for acknowledgement). https://henleyair.tv/ |
| za-rand-henley-north | Rand Airport: Henley NorthCam | https://helidev.tech/cam_north.jpg | as above (Hangar 7) | 120000 | as above |
| za-hoedspruit-n | Hoedspruit Civil Airfield: north | https://livecam.hoedspruitcivil.co.za/faht2002.jpg | -24.351667, 30.943050 (owner) | 600000 | Hoedspruit Flying Club. https://www.hoedspruitcivil.co.za/webcams |
| za-hoedspruit-3 | Hoedspruit Civil Airfield: cam 3 | https://livecam.hoedspruitcivil.co.za/faht221.jpg | as above | 600000 | as above |
| za-hoedspruit-4 | Hoedspruit Civil Airfield: cam 4 | https://livecam.hoedspruitcivil.co.za/faht222.jpg | as above | 600000 | as above |
| za-swellendam-d2 | Swellendam Airfield: D2 | http://www.fasx.co.za/fasx.co.za/cam-ftp/camD2.jpg | -34.05, 20.483333 (owner, about ±1 km) | 300000 | Swellengrebel Flying Club. http://www.fasx.co.za/index.php/en/pilot-resources-en/club-weather-en |
| za-swellendam-n1 | Swellendam Airfield: N1 | …/cam-ftp/camN1.jpg | as above | 300000 | as above |
| za-swellendam-n2 | Swellendam Airfield: N2 | …/cam-ftp/camN2.jpg | as above | 300000 | as above |
| za-mosselbay-aero-n | Mossel Bay Aerodrome: north | https://mosselbayaero.com/airfieldcameras/north.jpg | -34.158746, 22.055676 (airfield ARP, OurAirports; eAIP gives the runway 28 threshold, -34.156944, 22.061389) | 120000 | Mossel Bay Aero Club. https://mosselbayaero.com/ |
| za-mosselbay-aero-w | Mossel Bay Aerodrome: west | https://mosselbayaero.com/airfieldcameras/west.jpg | as above | 120000 | as above |
| za-hartrao-26m | HartRAO 26 m radio telescope | http://www.hartrao.ac.za/hh26m_live.jpg | -25.88975, 27.68540 (IVS antenna position; camera points at it) | 120000 | NRF/SARAO, Hartebeesthoek Radio Astronomy Observatory. Terms allow personal non-commercial display. http://www.hartrao.ac.za/hh26m_liveview.php |
| za-hartrao-15m | HartRAO 15 m antenna | http://www.hartrao.ac.za/ht15m_live.jpg | -25.88973, 27.68427 (IVS) | 120000 | as above |
| za-hartrao-vgos | HartRAO VGOS antenna | http://www.hartrao.ac.za/xxvgs_live.jpg | -25.88770, 27.68604 (IVS) | 120000 | as above |
| za-hartrao-allsky | HartRAO all-sky camera | http://www.hartrao.ac.za/allskycam/HRAO/ImageLastFTP_AllSKY.jpg | -25.89037, 27.68558 (site, about ±500 m) | 300000 (≈1 MB image) | as above |
| za-saao-allsky | SAAO Sutherland seeing-monitor all-sky | https://suthweather.saao.ac.za/AllSkyCurrentImageMarked.JPG | -32.3783, 20.8105 (site, about ±500 m) | 120000 | South African Astronomical Observatory. https://suthweather.saao.ac.za/ (needs the B cert) |
| za-monet-outside | MONET/South telescope: outside | https://monet.saao.ac.za/webcams/outside | -32.3789, 20.8108 (owner, Univ. Göttingen) | 120000 | MONET (Univ. Göttingen, McDonald Obs., SAAO). https://monet.saao.ac.za/ |
| za-cathedralpeak-1 | Cathedral Peak Hotel: peaks | https://webcam.cathedralpeak.co.za/current.jpg | -28.94756, 29.20655 (owner) | 120000 | Cathedral Peak Hotel. https://www.cathedralpeak.co.za/webcams/ |
| za-cathedralpeak-2 | Cathedral Peak Hotel: valley | https://webcam.cathedralpeak.co.za/current_3.jpg | as above | 120000 | as above |
| za-shellybeach | Shelly Beach launch site (Breakerview) | https://margate.co.za/wp-content/uploads/cam/shelly.jpg | -30.809, 30.411 (estimate, about ±100 m) | 300000 | South Coast Web (margate.co.za). https://margate.co.za/beaches-lagoons/shelly-beach-web-cam/ |

#### Still images: builder must finish checks first

- **Knysna panorama:** `https://www.gardenroute-knysna.de/webcam/webcam/webcampic.jpg`
  (owner page https://www.gardenroute-knysna.de/webcam.html). It works with the
  app's User-Agent, but the terms aren't checked and the position is unknown.
  Include it only if the terms are clean and a position can be stated honestly.
- **Eikendal Wine Estate ×2 and Somerset West residential:** live copies at
  `https://www.kapstadt.de/webcams/eikendal-wine-estate-webcam-{1,2}.jpg` and
  `…/somerset-west-residential.jpg`. capetown-webcam.com says the Eikendal
  cameras are *"provided by www.eikendal.com"*. Include them with the credit
  "Eikendal (www.eikendal.com), via Capetown-webcam.com by Kapstadt.de", at an
  approximate position. Somerset West's position is very vague (northern
  hillside, looking south): include it only with `accuracyM` of 2000 or more.

#### Still images: need the C3 resolver

| id | Camera | Position | Refresh |
|---|---|---|---|
| za-capegliding-1..4 | Cape Gliding Club, Worcester: Robertson, cam2, Slanghoek, Audensberg | **Unverified**: about -33.663, 19.415 (third-party, disagreement of a few hundred metres) | 300000 (0.3–0.5 MB images) |

Credit: Cape Gliding Club, https://www.capegliding.co.za/webcams/ (no terms
stated; robots allows all).

#### YouTube live webcams

The builder resolves the current video ID for each, because a stream's ID
changes when it restarts. Check that each is embeddable (oEmbed returns 200)
and currently live. Positions come from the owner's description or the view,
so most are approximate: set `accuracyM` to match. Drop any with no locational
evidence.

| Camera | Source | Location clue |
|---|---|---|
| Table Mountain & Bloubergstrand Beach (24/7) | video `Yql-FpQkDr8`, channel @TableMountainLiveStream | Bloubergstrand |
| Table Mountain from Tygerberg | @TableMountainLiveStream | Tygerberg Hill |
| Kalk Bay (Brass Bell) | @TableMountainLiveStream | Brass Bell, Kalk Bay |
| Pearly's, Langebaan | @TableMountainLiveStream | Pearly's restaurant, Langebaan beach |
| Vanilla Table Mountain | @VanillaISP (e.g. `97lRTzdjMP8`) | Vanilla sites, City Bowl |
| Vanilla Three Anchor Bay | @VanillaISP | Three Anchor Bay |
| Paarden Island rooftop (Table Mountain, Lion's Head, Signal Hill) | @flooringcoza | Paarden Island |
| Clifton 4th Beach | @SAWebcams (e.g. `IGu55JrxyHU`) | Clifton 4th Beach |
| Jeffreys Bay Supertubes | @SAWebcams | Supertubes, J-Bay |
| Woodbridge Island | video `z1PJqpgZccg` | Woodbridge Island, Milnerton |
| Strand beach | video `Ex1LNvbzwS0` | Strand beachfront |
| Muizenberg Wave Watchers | @MuizenbergWaveWatchers | Muizenberg (Surfer's Corner) |
| Franschhoek Valley | @TCSLiveOnline | Franschhoek |
| Knysna Heads | @TCSLiveOnline | Knysna Heads |
| Africam wildlife cams (e.g. Tembe, Olifants River, Naledi, Nkorho) | Africam YouTube channel | lodge/waterhole named per stream |

### F. Excluded, and why

- **Windy-sourced cameras** (Morningstar, Langebaan sports centre, Muizenberg
  beachfront, Gordon's Bay): Windy's API terms.
- **SAWS George Airport and other SAWS aviation webcams:** the terms sit behind a
  subscription login, so they can't be checked.
- **SAAO's main live page and SALT:** 403 or 404.
- **Sutherland Solaris:** the camera's raw guest interface, not deliberately
  published.
- **Las Cumbres Observatory, Sutherland:** the licence covers scientific or
  educational use only, and images redirect off-host to S3.
- **Panomax** (Table Mountain panorama): commercial platform.
- **SANParks:** 403, and an account is reportedly required.
- **Snow Report SA cameras:** the media guidelines ask for permission first.
- **Avenues Guesthouse, Mossel Bay:** the legal notice forbids reuse in
  electronic publications without agreement.
- **Sling Aircraft:** the terms forbid linking.
- **Springs:** obfuscated image URLs.
- **Stale images:** Zandspruit, Witbank, Dullstroom, Randpark and others.
- **ipcamlive hotel cameras** (The Bay Hotel, Harbour House, Pezula, South
  Beach, Point Watersports, others): ipcamlive's terms on third-party embedding
  aren't found, and they would need a CSP change. The YouTube overlay is built
  so that this could be added later.

### G. Testing and verification

Add unit tests alongside the existing CCTV tests in `src/data/`, run by
`npm test`:

- `youtubeVideoId` validation (good, bad and missing).
- A `youtube` camera's frame request returns the synthetic SVG and never calls
  the Street View fetch (assert that the fetch spy is uncalled).
- `streetViewFallback: false` with a failing upstream returns the synthetic SVG
  and doesn't call Street View.
- The Cape Gliding resolver:
  - happy path;
  - malformed JSON;
  - off-host or out-of-directory `data.url`;
  - a camera number outside 1–4;
  - oversized and timed-out responses;
  - the refresh floor is honoured.
- The YouTube overlay:
  - nothing loads before Play;
  - Play creates the player with the right ID;
  - deselect or close destroys it;
  - "unavailable" and "offline" states render their text.

Then run `npm run build`, and run `npm run test:track` against the running
container.

Live verification in Docker (`docker compose up -d` after the change):

- `/api/cctv/sources` lists every `za-` camera, and the total still includes
  the built-in packs.
- `/api/cctv/frame/<id>` for each still camera returns `image/*` with
  `X-CCTV-Source` showing the upstream source, not synthetic or Street View.
- For each YouTube camera, it returns the synthetic SVG.
- A browser check (screenshot) shows a South African camera point, its panel,
  and a YouTube stream playing after Play.

### G2. Calls made after the builder check

- **Still cameras get the server-side refresh floor** (C2), keyed on
  `streetViewFallback: false`, not on every sources-file camera.
- **`CCTV_MAX_SOURCES=7450`** keeps every existing camera (B).
- **The sources file stands in for a pinned pack** (B).
- **`get_cctv_snapshot` is unchanged.** That MCP tool can pass a `za-` frame to
  Xolisani's own assistant when he asks. That is still personal viewing, the
  same as for every other camera.
- **Credits (Xolisani's choice: "Credits list"):** each camera's `credit` shows
  as plain text under its image in the camera panel, which is existing
  behaviour. One new `DATA_CREDITS` entry, `za-cctv`, in `src/data/dataCredits.js`
  gives every South African owner a clickable link in the Data credits popover.
  That entry includes the exact "Cape Town Webcam is sponsored by
  www.Kapstadt.de" link to https://www.kapstadt.de and an acknowledgement of
  HenleyAir.tv.
- **The YouTube window floats but isn't anchored to the map.** The Québec
  overlay's marker and horizon logic exist for its map still, which YouTube
  can't provide.

### H. Left to the builder

- File and function names, and the exact Vue panel layout. Match the Québec
  overlay's look.
- Placeholder SVG wording within the spirit of C2.
- Whether the Cape Gliding resolver lives in `server/providers/cctv/` as its
  own module (preferred) or in `sources.js`.
- How to resolve current YouTube video IDs (browser or oEmbed). No YouTube Data
  API key is available.
- Commit structure. Commits go to the fork's `main` only when Xolisani asks
  (his standing rule).
