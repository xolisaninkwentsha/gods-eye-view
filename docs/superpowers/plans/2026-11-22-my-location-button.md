# "Go to my location" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search-bar button that flies the globe to the viewer's current browser location.

**Architecture:** A small `src/ui/myLocation.js` asks the browser for one position and turns failures into the search bar's existing error line. The Omnibar adds one button that calls it and flies through its existing coordinate route (`goTo`), which answers coordinates locally.

**Tech Stack:** Vue 3 SFC (Omnibar.vue), `node:test`, the app's i18n catalogs.

**Spec:** `docs/superpowers/specs/2026-11-22-my-location-button-design.md`

## Global Constraints

- **Branch** `my-location` is cut from `main` after the South African cameras branch is merged. Commits are local; Xolisani pushes.
- **Geolocation options:** `{ enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }`.
- **The position** is never stored, logged or sent anywhere except through `goTo({ latitude, longitude })`.
- **New UI text, exactly:** `'Go to my location'`, `'Location access was not allowed'`.
- **Reused text:** `'Browser location is unavailable'` and `'Location not found'`.
- **The icon** is `UiIcon name="my_location" :size="null"`, with no `index.html` change.
- **Run tests with** `node --import=./build/registerVue.js --test …`. Checks before done: `npm test`, `npm run build`, `npm run test:track -- --url http://localhost:4173`, compared with the camera-branch baseline.

## Review Focus

1. **Permission denied, now or remembered from before.** Expect "Location access was not allowed" and no flight. Test in Task 1.
2. **No answer within 30 s,** for example no Wi-Fi and slow network location. Expect "Location not found" and the button usable again. Test in Task 1.
3. **A double-click or impatient re-click.** Expect one request in flight and no second flight. Test in Task 1 (`goToMyLocation` ignores calls while busy).
4. **A browser without geolocation,** or an insecure context if the app is ever opened over a LAN IP. Expect "Browser location is unavailable". Test in Task 1.
5. **A fix arriving after the user typed a new search.** Expect the newer search to win. Covered by the search runner's own generation logic, since `goTo` goes through it; noted for the reviewer.

---

### Task 1: Location helper

**Files:**
- Create: `src/ui/myLocation.js`
- Test: `src/ui/myLocation.test.mjs`

**Interfaces:**
- Produces: `locateOnce({ geolocation = globalThis.navigator?.geolocation } = {}) → Promise<{ ok: true, latitude: number, longitude: number } | { ok: false, reason: 'unavailable'|'denied'|'notFound' }>`.
- Produces: `locateFailureText(reason) → string`. This maps `unavailable` → `t('Browser location is unavailable')`, `denied` → `t('Location access was not allowed')`, and anything else → `t('Location not found')`.
- Produces: `createMyLocationAction({ locate = locateOnce, goTo, showError, setBusy }) → { run(): Promise<boolean>, busy(): boolean }`. A second `run()` while one is pending returns `false` without calling `locate`.

- [ ] **Step 1: Write the failing tests,** with a fake `geolocation` whose `getCurrentPosition(success, failure, options)` records `options`:
  - `'a fix resolves to its latitude and longitude'`: `{coords:{latitude:-33.92,longitude:18.42,accuracy:1500}}` gives `{ok:true, latitude:-33.92, longitude:18.42}`.
  - `'it asks once, allowing a cold first fix 30 s, for a fix no older than a minute'`: options deep-equal `{ enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }`.
  - `'no geolocation is unavailable; code 1 is denied; codes 2 and 3 are not found'`.
  - `'each failure reads as the search bar message'`: English strings as in Global Constraints.
  - `'the action flies to the fix through goTo and shows no error'`: `goTo` is called once with `{latitude:-33.92, longitude:18.42}`.
  - `'the action shows the failure text and does not fly'`.
  - `'a second click while locating is ignored'`: `locate` is called once, and the second `run()` resolves `false`.
- [ ] **Step 2:** Run `node --import=./build/registerVue.js --test src/ui/myLocation.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/ui/myLocation.js`. Wrap `getCurrentPosition` in a Promise. Map `PositionError.code` 1 → `denied`, anything else → `notFound`, and a missing API → `unavailable`. Set `setBusy(true/false)` around the work.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/ui/myLocation.js src/ui/myLocation.test.mjs && git commit -m "Add a one-shot browser location helper for the search bar"`

### Task 2: Button, styles and translations

**Files:**
- Modify: `src/ui/views/panels/Omnibar.vue`: add a `UiButton class="omnibar-locate"` before the mic (`:label="t('Go to my location')"`, `:disabled="locating"`, `@click="onLocate"`) containing `<UiIcon name="my_location" :size="null" />`. Add `onLocate` using `createMyLocationAction({ goTo, showError: (text) => { error.value = text; }, setBusy: (v) => { locating.value = v; } })`.
- Modify: the stylesheet rule for `.omnibar-mic`, to give `.omnibar-locate` the same look.
- Modify: `src/ui/kit/omnibarControls.test.mjs`: UiButton count 2 → 3, UiIcon count 3 → 4. These are intended structural pins.
- Modify: every `src/i18n/locales/*.json` except `zh-Hant.json` (that one is generated with `npm run i18n -- --zh-hant`): add both new messages. Match each locale's existing wording for "location" in `'Browser location is unavailable'`.

- [ ] **Step 1:** Update `omnibarControls.test.mjs` counts and add `'the locate button is a UiButton with the my_location glyph'` (the template contains `class="omnibar-locate"` and `name="my_location"`). Run it. Expected: FAIL.
- [ ] **Step 2:** Implement the Omnibar change and styles. Run `node --import=./build/registerVue.js --test src/ui/kit/omnibarControls.test.mjs`. Expected: PASS.
- [ ] **Step 3:** Run `node scripts/i18n.mjs`. Expected: both new strings reported missing. Add the translations, run `npm run i18n -- --zh-hant`, then `node --import=./build/registerVue.js --test src/i18n/catalog.test.mjs`. Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -am "Add a Go to my location button to the search bar"` (add new files first).

### Task 3: Live check and full checks

- [ ] **Step 1:** `docker compose up -d --wait` on the branch. In Chrome at `http://localhost:4173`, click the button. Xolisani allows the permission prompt; a browser permission bubble is his to answer. Expect a flight to his area and the searched-location pin. Take a screenshot.
- [ ] **Step 2:** Run `npm test`, `npm run build`, `npm run test:track -- --url http://localhost:4173`. Expected: unit and build pass; test:track shows no new failures against the baseline.
- [ ] **Step 3:** Final whole-branch review by a fresh reviewer, then finishing-a-development-branch.

### Task 4: Saved spot and honest fallback (addendum)

**Files:**
- Modify: `src/ui/myLocation.js`
  - `locateOnce` also returns `accuracyM`.
  - Add `loadSavedSpot({ storage })`, `saveSpot(point, { storage })` and
    `chooseDestination(fix, savedSpot) → { kind: 'saved'|'rough'|'precise', latitude, longitude, rangeM?, accuracyM }`.
  - `createMyLocationAction` gains `frame(place, rangeM)` and `showNotice(text)`, and uses `chooseDestination`.
- Modify: `src/ui/entityContextBridge.js`: add `centre()`, the live
  `pickWorld(viewer, 0.5, 0.5)`, falling back to the pose.
- Modify: `src/ui/stores/entityCard.js`: add `viewCentreNow()`, which calls
  `shell.value?.centre?.()`.
- Modify: `src/ui/views/panels/Omnibar.vue`:
  - `@contextmenu.prevent` saves the spot;
  - `frame` uses `runner('fly_to_location', { latitude, longitude, rangeM })`
    when available, else `goTo`;
  - notices go in the existing error line.
- Modify: 12 locale files plus generated zh-Hant (3 new strings).
- Test: `src/ui/myLocation.test.mjs`, and a store test for `viewCentreNow`.

**Constants:**
- `ROUGH_FIX_M = 2000`
- `SAVED_SPOT_SLACK_M = 5000`
- framing range `clamp(2.5 × accuracyM, 5000, 250000)`
- storage key `gev:my-location-spot:v1`

- [ ] **Step 1: Write the failing tests:**
  - `chooseDestination`:
    - a precise fix flies to the fix;
    - a rough fix with a saved spot inside its range uses the saved spot;
    - a rough fix with a saved spot far away frames the fix at the clamped range;
    - a rough fix with no saved spot is framed.
  - The range clamps at 5 km and at 250 km.
  - `saveSpot`/`loadSavedSpot` round-trip; a throwing or corrupt storage gives null.
  - The action:
    - with a saved spot, flies there with no notice;
    - with a rough fix and no spot, calls `frame` and shows the rough notice
      with ±{km} filled;
    - a precise fix calls `goTo`.
  - The store: `viewCentreNow()` returns the connected shell's `centre()`, or
    null when there's none.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Add the strings and translations, and run
      `npm run i18n -- --zh-hant`.
- [ ] **Step 4:** Run `node --import=./build/registerVue.js --test src/ui/myLocation.test.mjs src/ui/kit/omnibarControls.test.mjs src/i18n/catalog.test.mjs <store test>`.
      Expected: PASS.
- [ ] **Step 5:** Live check in Chrome:
  - right-click saves the current view's centre;
  - a click then lands on the saved spot;
  - with the spot cleared (devtools storage), a click frames the ±26 km area
    with the rough notice.
- [ ] **Step 6:** Commit, then rerun the full checks and the final review over the whole branch.
