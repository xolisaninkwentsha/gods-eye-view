# South African Cameras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put about 25 owner-published South African still webcams and about 15 South African YouTube live webcams on the globe, with no Google Street View spend.

**Architecture:** Still cameras come from a fork-local camera-list file that the existing catalog already loads. A per-source `streetViewFallback: false` flag routes those cameras through the existing per-camera refresh floor and never through Street View. A new `youtube` feed type carries a validated video ID to the browser. There it is treated like Québec's browser-only cameras: no frame, no 3D projection. A small floating window plays the stream with the app's existing `createYouTubeLivePlayer` only after Play. Cape Gliding Club's four cameras use a pinned two-step lookup through the same refresh floor.

**Tech Stack:** Node 24 (ES modules), Vite middleware (`server/providers/cctv.js`), Vue 3 render functions, `node:test` with happy-dom (`src/testSupport/registerDom.mjs`), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-22-south-africa-cameras-design.md`

## Global Constraints

- **No camera added here may reach `streetViewFallback`** in `server/providers/cctv.js`.
- **Fetch only as `gods-eye-view-cctv-proxy/1.0`,** the existing default in `cctvUpstreamUserAgent`. Drop a camera that refuses that identity; never add a per-host User-Agent for these hosts.
- **Settings go only in `compose.override.yaml` `environment:`.** `.env` is never read or written.
- **YouTube video ID grammar:** `/^[A-Za-z0-9_-]{11}$/`.
- **New UI text reuses existing catalog messages only:** `'Play'`, `'Open on YouTube'`, `'Stream is offline'`, `'This stream cannot play here'`, `'Try again'`, `'Video plays from YouTube, which sees your IP address.'`, `'Close camera preview'`, `'LIVE'`. Any other `t()` string fails `src/i18n/catalog.test.mjs` until every locale has it.
- **Placeholder text for YouTube frames:** `LIVE ON YOUTUBE — PRESS PLAY` (server SVG, not translated, like the existing statuses).
- **Camera IDs** are prefixed `za-`; `cityId` is `za-<region>`.
- **Refresh:** the client clamps `frameRefreshMs` to 60000–1200000. Use the per-camera values in the spec's inventory tables.
- **Kapstadt main cam** must show the credit "Cape Town Webcam is sponsored by www.Kapstadt.de", with `sourceUrl` `https://www.kapstadt.de`.
- **Commits:** local commits on the fork's `main` only. No push until Xolisani asks.
- **Checks before claiming done:** `npm test`, `npm run build`, and `npm run test:track -- --url http://localhost:4173` with the container up. Quote the last line of each.

## Review Focus

1. **An SA still camera goes offline or times out.** Expect the synthetic "unavailable" card and zero Street View calls. Test in Task 1.
2. **The YouTube stream isn't live, or its owner disables embedding.** Expect "Stream is offline" or "This stream cannot play here", with an "Open on YouTube" link. Test in Task 4.
3. **The user picks another camera, auto-hop moves on, or the layer is turned off while a stream plays.** Expect the player destroyed and the audio stopped. Test in Task 4.
4. **Cape Gliding's lookup returns a URL for another host, another camera folder, or junk.** Expect it rejected, a placeholder served, and no fetch of that URL. Test in Task 5.
5. **A hand-edited camera list has a bad YouTube ID or a missing coordinate.** Expect that one entry dropped with a warning and the rest loading. Test in Task 3.

---

### Task 1: Street View opt-out and server-side refresh floor

**Files:**
- Modify: `server/providers/cctv/normalize.js` (`normalizeSourceItem`, around line 632)
- Modify: `server/providers/cctv.js`: `fetchThrottledFrame` (around line 126), the frame upstream selection (around line 684), and the Street View call (around line 769)
- Test: `src/data/cctvStreetViewOptOut.test.mjs` (new). Copy the env, fetch-stub and server harness from `src/data/cctvStreetViewDisconnect.test.mjs`.

**Interfaces:**
- Produces: the normalized source field `streetViewFallback: false | undefined`, where only a literal `false` in the raw record yields `false`.
- Produces: `fetchThrottledFrame(source, cameraId, frameUrl)` accepts `frameUrl: string | (() => Promise<string|null>)`. A function is awaited only when a fetch is actually due.

- [ ] **Step 1: Write the failing tests** in `cctvStreetViewOptOut.test.mjs`. Each test sets `CCTV_SOURCES_JSON`, `CCTV_SOURCES_FILE=absent-source-file.json`, `CCTV_FORCE_AUSTIN=0` and `GOOGLE_MAPS_SERVER_API_KEY=fixture-key`, and counts `https://maps.googleapis.com/` calls.
  - `'an opted-out camera whose upstream fails gets the synthetic card, never Street View'`: upstream answers 503. Expect `GET /frame/za-fixture` to return 200, `content-type` `image/svg+xml`, `x-cctv-source` `synthetic`, and `streetViewCalls === 0`.
  - `'an opted-out camera is fetched at most once per frameRefreshMs'`: `frameRefreshMs: 600000`, upstream returns `image/jpeg`. Two GETs → `upstreamCalls === 1`, both 200 `image/jpeg`.
  - `'a camera without the flag still falls back to Street View'`: the same 503 upstream with no flag gives `streetViewCalls === 1`. This guards upstream behaviour.
- [ ] **Step 2:** Run `node --test src/data/cctvStreetViewOptOut.test.mjs`. Expected: the first two FAIL, the third PASSES.
- [ ] **Step 3: Implement.**
  - Pass `streetViewFallback` through in `normalizeSourceItem`.
  - In the frame handler, before the generic `fetchCctvImageFromUpstream` branch, route `source?.streetViewFallback === false` to `fetchThrottledFrame(source, cameraId, upstreamCandidate)`.
  - In `fetchThrottledFrame`, resolve a function-valued `frameUrl` (`await frameUrl()`) right before `fetchCctvImageFromUpstream`. A `null` result counts as a failed fetch, with the same backoff.
  - At the Street View call, skip `streetViewFallback` when `source?.streetViewFallback === false`.
- [ ] **Step 4:** Run `node --test src/data/cctvStreetViewOptOut.test.mjs src/data/cctvStreetViewDisconnect.test.mjs src/data/cctvProxy.test.mjs`. Expected: all PASS.
- [ ] **Step 5:** Commit: `git add server/providers/cctv/normalize.js server/providers/cctv.js src/data/cctvStreetViewOptOut.test.mjs && git commit -m "Let a camera opt out of the Street View fallback"`

### Task 2: South African still cameras (data and settings)

**Files:**
- Create: `config/cctv_sources.south-africa.json`
- Create: `config/certs/sectigo-public-server-auth-ca-ov-r36.pem`
- Modify: `compose.override.yaml` (add `environment:`)

**Interfaces:**
- Consumes: `streetViewFallback` from Task 1.
- Produces: the catalog file Tasks 3, 5 and 6 append to. Records use only fields `normalizeSourceItem` keeps, plus Task 1, 3 and 5 fields.

- [ ] **Step 0: Record the baseline.** Run `curl -s http://localhost:4173/api/cctv/sources` and save `sources.length` and `trimmedPacks` to `…/scratchpad/cctv-baseline.json`.
- [ ] **Step 1: Re-test every image URL** from the spec's "Still images: ready" table. Use `curl -sS -m 25 -A 'gods-eye-view-cctv-proxy/1.0' -o /dev/null -w '%{http_code} %{content_type}\n' <url>`. Keep only `200 image/*`. For `suthweather.saao.ac.za`, test after Step 3.
- [ ] **Step 2: Write `config/cctv_sources.south-africa.json`:** one record per kept camera, using the spec's id, name, position, refresh and credit values.
  - Every record has: `feedType: "image"`, `url` and `snapshotUrl` set to the image, `sourceUrl` set to the owner page, `provider`, `credit`, `license`, `accuracyM`, `positionSource`, and `streetViewFallback: false`.
  - Set `headingDeg` (with `headingConfidence: "low"`) only where the spec or the owner names the view direction.
- [ ] **Step 3: Add the SAAO certificate.**
  - Fetch the cert: `curl -sS -o /tmp/claude-1000/-home-xolisani-nkwentsha-Desktop-gods-eye-view/6cf5119e-95b4-44c3-ab4a-75d945004b92/scratchpad/sectigo.crt http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt`
  - Convert it: `openssl x509 -inform DER -in …/sectigo.crt -out config/certs/sectigo-public-server-auth-ca-ov-r36.pem`
  - Check its subject: `openssl x509 -in config/certs/sectigo-public-server-auth-ca-ov-r36.pem -noout -subject` should print the Sectigo Public Server Authentication CA OV R36 subject.
  - Run `NODE_EXTRA_CA_CERTS=config/certs/… node -e "fetch('https://suthweather.saao.ac.za/AllSkyCurrentImageMarked.JPG',{headers:{'user-agent':'gods-eye-view-cctv-proxy/1.0'}}).then(r=>console.log(r.status,r.headers.get('content-type')))"`. Expected: `200 image/jpeg`.
- [ ] **Step 4: Add the settings** to `compose.override.yaml` under `services.gods-eye-view.environment`:
  - `CCTV_SOURCES_FILE=config/cctv_sources.south-africa.json`
  - `CCTV_FORCE_AUSTIN=1`
  - `CCTV_MAX_SOURCES=7450`
  - `NODE_EXTRA_CA_CERTS=/app/config/certs/sectigo-public-server-auth-ca-ov-r36.pem`

  Keep the existing `restart: unless-stopped`.
- [ ] **Step 5: Restart and verify.**
  - Run `docker compose up -d --build --wait`. Expected: `Healthy`.
  - Fetch `curl -s http://localhost:4173/api/cctv/sources`. Count `sources` whose `id` starts with `za-`: it should equal the file's record count. The total should equal the baseline plus the `za-` count. The built-in packs' `trimmedPacks` entries should match the baseline, so no existing camera is pushed out.
  - For each `za-` id, `curl -s -o /dev/null -D - http://localhost:4173/api/cctv/frame/<id>` should show `x-cctv-source: upstream-image`.
- [ ] **Step 5b: Add the credits.** Add a `za-cctv` entry to `DATA_CREDITS` in `src/data/dataCredits.js`, after `a22-cctv`. Open it with `'Webcams (South Africa): '`, then give one `<a href="…" target="_blank" rel="noopener">` per owner in the file, separated by ` · `. It must contain `Cape Town Webcam is sponsored by <a href="https://www.kapstadt.de" target="_blank" rel="noopener">www.Kapstadt.de</a>` and `<a href="https://henleyair.tv/" target="_blank" rel="noopener">HenleyAir.tv</a>`. Add a test to `src/data/dataCredits.test.mjs`: `'the South African camera credit carries the Kapstadt.de sponsor link and every owner'`. It should assert both strings above, plus one `href` for each distinct `sourceUrl` origin in `config/cctv_sources.south-africa.json`; read the file in the test. Run `node --test src/data/dataCredits.test.mjs`. Expected: PASS.
- [ ] **Step 6:** Commit: `git add config/cctv_sources.south-africa.json config/certs compose.override.yaml src/data/dataCredits.js src/data/dataCredits.test.mjs && git commit -m "Add South African still webcams"`

### Task 3: Server support for YouTube cameras

**Files:**
- Modify: `server/providers/cctv/normalize.js`: add `normalizeYoutubeVideoId`, and pass `youtubeVideoId` through `normalizeSourceItem`
- Modify: `server/providers/cctv/catalog.js`: the `normalizePack` filter (around line 353)
- Modify: `server/providers/cctv.js`: the `/sources` projection (around line 300) and the frame handler
- Test: `src/data/cctvYoutubeSource.test.mjs` (new; same harness as Task 1)

**Interfaces:**
- Produces: `export function normalizeYoutubeVideoId(value: unknown): string`, which returns the value when it matches the grammar and `''` otherwise.
- Produces: `/api/cctv/sources` rows carry `youtubeVideoId: string`, non-empty only when `feedType === 'youtube'`.

- [ ] **Step 1: Write the failing tests.**
  - `'normalizeYoutubeVideoId keeps only an 11-character ID'`:
    - `normalizeYoutubeVideoId('Yql-FpQkDr8') === 'Yql-FpQkDr8'`
    - `normalizeYoutubeVideoId('Yql-FpQkDr8x') === ''`
    - `normalizeYoutubeVideoId('https://youtu.be/Yql-FpQkDr8') === ''`
    - `normalizeYoutubeVideoId(undefined) === ''`
  - `'a YouTube camera reaches /sources with its video ID and a still camera does not carry one'`.
  - `'a YouTube record with a bad ID is dropped and its neighbours still load'`: the bad record is absent, the valid still is present, and `console.warn` was called once.
  - `'a YouTube camera frame is the LIVE ON YOUTUBE card with no upstream or Street View fetch'`: `image/svg+xml`, `x-cctv-source: synthetic`, the body contains `LIVE ON YOUTUBE`, and the fetch stub has 0 calls.
- [ ] **Step 2:** Run `node --test src/data/cctvYoutubeSource.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `normalizeYoutubeVideoId` and the pass-through.
  - In `normalizePack`, drop `feedType === 'youtube'` items with an empty `youtubeVideoId`, warning once per id.
  - Add the projection field.
  - In the frame handler, answer `feedType === 'youtube'` before any upstream work with the synthetic SVG (status `LIVE ON YOUTUBE — PRESS PLAY`), and return.
- [ ] **Step 4:** Run `node --test src/data/cctvYoutubeSource.test.mjs src/data/cctvMediaFeedType.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -am "Carry YouTube live cameras through the camera catalog"` (add the new test file first).

### Task 4: YouTube cameras in the browser

**Files:**
- Modify: `src/layers/cctv/catalog.js`: the camera object (around line 215) gains `youtubeVideoId`
- Modify: `src/layers/cctv/model.js`: add `isYoutubeCamera`; extend `isBrowserOverlayCamera` and `isVideoFeedCamera`; export it next to `isBrowserOverlayCamera` (around line 545)
- Create: `src/ui/youtubeCctvOverlay.js`
- Create: `src/ui/views/panels/YoutubeCctvOverlay.vue`
- Modify: `src/ui/cctvControls.js`: create next to `_quebecCctvOverlay` (line 49), dispose next to it (line 168)
- Modify: `src/ui/cctvPresentation.js` (around line 181): feed it the active camera; hide `_cctvFrameWrap` for YouTube cameras too
- Test: `src/ui/youtubeCctvOverlay.test.mjs` (new; happy-dom, as in `src/ui/quebecCctvOverlay.test.mjs`); extend the existing CCTV model tests for `isYoutubeCamera`

**Interfaces:**
- Consumes: `youtubeVideoId` on `/api/cctv/sources` rows (Task 3), and `createYouTubeLivePlayer({ host, videoId, onChange }) → { destroy() }` from `src/data/youtubeLivePlayer.js`.
- Produces: `model.isYoutubeCamera(camera): boolean`, true when `normalizeFeedType(camera.feedType) === 'youtube'` and the ID matches the grammar.
- Produces: `createYoutubeCctvOverlay({ documentRef = document, createPlayer = createYouTubeLivePlayer } = {}) → { setCamera(camera|null, { reselected }), dispose() } | null`.

- [ ] **Step 1: Write the failing tests** in `youtubeCctvOverlay.test.mjs`, with a fake `createPlayer` recording calls:
  - `'selecting a YouTube camera shows its name, credit and Play without loading YouTube'`: zero `createPlayer` calls.
  - `'Play creates the player with the camera video ID'`: one call, `videoId === 'Yql-FpQkDr8'`.
  - `'choosing another camera, null, or dispose destroys the player'`: `destroy` is called once for each case.
  - `'offline and unavailable states show the existing messages and an Open on YouTube link'`: when the fake calls `onChange({state:'offline'})` the text is `Stream is offline`; for `'unavailable'` it is `This stream cannot play here`. The link points to `https://www.youtube.com/watch?v=<id>`.
  - Model test: `isYoutubeCamera({feedType:'youtube', youtubeVideoId:'Yql-FpQkDr8'}) === true`, false for a bad ID or another feed type, and `isBrowserOverlayCamera` is true for the valid one.
- [ ] **Step 2:** Run `node --test src/ui/youtubeCctvOverlay.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The window is a fixed-position floating panel, **not anchored to the map**. The Québec overlay's map marker and horizon logic serve its map still, which YouTube can't provide.
  - It contains: a header with the camera name and a close button (`t('Close camera preview')`); a player host; a Play button (`t('Play')`); the note `t('Video plays from YouTube, which sees your IP address.')`; and the credit with a link to `sourceUrl`. The `t('Open on YouTube')` link shows when offline or unavailable, and `t('Try again')` re-runs Play.
  - Match the Québec panel's classes and look.
- [ ] **Step 4:** Run `node --test src/ui/youtubeCctvOverlay.test.mjs src/ui/quebecCctvOverlay.test.mjs src/i18n/catalog.test.mjs`. Expected: PASS. The catalog test proves no new strings were added.
- [ ] **Step 5:** Commit: `git add … && git commit -m "Play YouTube live cameras from the camera layer"`

### Task 5: Cape Gliding Club latest-image lookup

**Files:**
- Create: `server/providers/cctv/capeGliding.js`
- Modify: `server/providers/cctv.js`: the frame upstream selection (next to the Task 1 branch)
- Modify: `config/cctv_sources.south-africa.json`: append `za-capegliding-1`…`4`
- Test: `src/data/cctvCapeGliding.test.mjs` (new)

**Interfaces:**
- Produces: `export const CAPE_GLIDING_SOURCE_KIND = 'capegliding-latest'`.
- Produces: `export async function resolveCapeGlidingFrameUrl(lookupUrl: string, { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 16384 } = {}): Promise<string|null>`.
  - `lookupUrl` must be exactly `https://www.capegliding.co.za/wp-admin/admin-ajax.php?action=get_latest_camera_image&camera=camera<N>`, with N in 1–4.
  - The result must pass `pinnedCameraUrl(url, 'https://www.capegliding.co.za/wp-content/uploads/camera-cache/camera<N>/')` for the same N.
  - Anything else returns `null` without a second fetch.
- Consumes: function-valued `frameUrl` in `fetchThrottledFrame` (Task 1).
- Records: `sourceKind: "capegliding-latest"`, `url` set to the lookup URL, no `snapshotUrl`, `streetViewFallback: false`, `frameRefreshMs: 300000`.

- [ ] **Step 1: Write the failing tests:**
  - `'resolves the JSON data.url for the same camera folder'`
  - `'rejects a lookup URL for another host, path, action or camera 5'`: returns null, 0 fetches
  - `'rejects data.url on another host or another camera folder'`
  - `'malformed JSON, non-200 and oversized bodies resolve to null'`
  - `'the frame route makes at most one lookup per frameRefreshMs and never calls Street View'`: two frame GETs give 1 lookup, 1 image fetch and 0 googleapis calls
- [ ] **Step 2:** Run `node --test src/data/cctvCapeGliding.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the module. In the frame handler, route `source?.sourceKind === CAPE_GLIDING_SOURCE_KIND` to `fetchThrottledFrame(source, cameraId, () => resolveCapeGlidingFrameUrl(source.url))`. Append the four records, with the spec's unverified-position note in `positionSource` and `accuracyM: 500`.
- [ ] **Step 4:** Run `node --test src/data/cctvCapeGliding.test.mjs src/data/cctvStreetViewOptOut.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add … && git commit -m "Add Cape Gliding Club cameras via their latest-image lookup"`

### Task 6: YouTube inventory, the remaining stills, and full verification

**Files:**
- Modify: `config/cctv_sources.south-africa.json`
- Create: `docs/SOUTH_AFRICA_CAMERAS.md`: a fork-local list of every camera with its owner, terms note and position evidence, plus the Excluded list from the spec. It's kept out of `DATA_SOURCES.md` so pulls from upstream don't conflict.

**Interfaces:**
- Consumes: Task 3 record shape (`feedType: "youtube"`, `youtubeVideoId`, no `url`/`snapshotUrl`, `streetViewFallback: false`).

- [ ] **Step 1: Resolve each YouTube camera in the spec's table** to its current live video ID. Use the channel's `/streams` page in the browser, or oEmbed for a known ID. Keep it only if `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=<id>` returns 200 and the stream is live now. Record it with an honest `accuracyM`/`positionSource`, and the channel as `sourceUrl`.
- [ ] **Step 2: Finish the conditional stills.**
  - **Knysna panorama:** read `https://www.gardenroute-knysna.de/` imprint and terms. Add it only if there's no reuse prohibition and a position can be stated.
  - **Eikendal ×2 and Somerset West:** add them with the spec's credit and `accuracyM` (Somerset West `accuracyM >= 2000`).
- [ ] **Step 3: Restart and verify live.**
  - Run `docker compose up -d --wait`.
  - `/api/cctv/sources` includes every `za-` id.
  - Each still frame returns `upstream-image`; each YouTube frame returns `synthetic` with `LIVE ON YOUTUBE`.
  - In Chrome at `http://localhost:4173`, turn on CCTV, fly to Cape Town, and select a YouTube camera. Press Play and confirm the stream plays. Select a still camera and confirm its image. Save screenshots.
- [ ] **Step 3b: Finish the credits.** Extend the `za-cctv` credit with the owners added in Tasks 5 and 6 (Cape Gliding Club, each YouTube channel, and any added stills). Re-run `node --test src/data/dataCredits.test.mjs`. Expected: PASS, since the test reads the file.
- [ ] **Step 4: Full checks.** Run `npm test`, `npm run build`, then `npm run test:track -- --url http://localhost:4173`. All three must pass. Quote the last line of each.
- [ ] **Step 5:** Commit: `git add config/cctv_sources.south-africa.json docs/SOUTH_AFRICA_CAMERAS.md src/data/dataCredits.js && git commit -m "Add South African YouTube webcams and camera notes"`
