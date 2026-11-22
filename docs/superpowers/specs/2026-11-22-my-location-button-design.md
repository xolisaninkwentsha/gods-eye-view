# "Go to my location" button: design (short)

Date: 2026-11-22 · Fork: `xolisaninkwentsha/gods-eye-view` · Approved by Xolisani ("ok go ahead")

## Intent

One click flies the globe to where Xolisani is right now, his live location
rather than a saved home spot. It's for personal use on his own PC.

## Approach

Use the browser's Geolocation API, and fly there through the search bar's
existing coordinate route, `goTo`. In the running app that is the action
runner's `fly_to_location` with the coordinates (`flyToLandmark`, about 250 m
range, no searched-location pin). Only without a runner does it fall back to
`location.search("lat, lon")`, which answers coordinates locally
(`src/search/coordinateGeocoder.js`: "without asking anyone"). Either way the
position is never sent to the app's server or a place-name service as a
position. Chrome's own location service, Google's, sees enough to work the
position out, and the map tiles the flight then loads tell the tile providers
which area is on screen, as any flight does.

Rejected:

- **An IP lookup web service:** less accurate, and it sends his address to a
  third party.
- **A saved home spot:** not "current".

## Design

- **Button:** a `UiButton` in the search bar next to the microphone, with the
  `my_location` Material icon (already in `index.html`'s `icon_names`) and the
  label "Go to my location".
- **Click:** `navigator.geolocation.getCurrentPosition` with
  `enableHighAccuracy: true`, a 30 s timeout and `maximumAge` of 60 s. The
  first live click said "Location not found" with a 10 s timeout; a slow cold
  first fix is the suspected cause, not a proven one. Chrome asks permission
  the first time, and only on a secure page (localhost counts): elsewhere the
  button says "Browser location is unavailable" without asking.
- **Success:** the same flight as typing the coordinates through the runner
  (see Approach), with no pin. The Addendum below replaces this framing.
- **Failure, in the search bar's error line:**
  - no geolocation → "Browser location is unavailable" (existing text);
  - permission denied → "Location access was not allowed" (new);
  - timeout (30 s) or position unavailable → "Location not found" (existing).
- **New text:** "Go to my location" and "Location access was not allowed", in
  all shipped locales. `src/i18n/catalog.test.mjs` requires it.
- **Not built:** follow-me tracking, an accuracy ring, storing the position.
- **Known limit:** on a cabled desktop, Chrome's fix may be kilometres off.

## Addendum: saved spot and honest fallback (2026-11-22)

**Why:** the live check landed about 25 km from central Cape Town. This PC has
no Wi-Fi or GPS (only `eno1`), so Chrome's fix is its estimate from the internet
connection, at ±26 km, and no code can make it more precise. Xolisani chose
"Saved spot + honest fallback".

- **Save:** right-click the button to save the ground under the middle of the
  screen as "my spot". The bridge's live pick is `pickWorld(viewer, 0.5, 0.5)`,
  the same point the Context panel uses. It's stored only in this browser
  (`localStorage` key `gev:my-location-spot:v1`, `{lat, lon}`), and a short
  confirmation shows in the search bar line.
- **A click with a rough fix** (accuracy worse than 2 km):
  - if a saved spot lies within the fix's error range (distance ≤ accuracy +
    5 km), fly exactly to the saved spot;
  - otherwise frame the whole uncertainty area (range 2.5 × accuracy, clamped
    to 5–250 km) and say "Rough location (±{km} km). Centre the map on your
    spot, then right-click the button to save it." The view is then centred
    on the rough fix, so the notice asks for the map to be moved first:
    saving straight away would store the rough fix as an exact spot.
- **A click with a precise fix** (Wi-Fi or GPS devices, accuracy 2 km or
  better): fly to it, framed by its accuracy too (range 2.5 × accuracy, clamped
  to 500 m–5 km), so a ±1 km fix is not shown as one confident street. Travel
  away from home with such a device and the live fix wins.
- **Framing** goes through the runner's `fly_to_location` with `rangeM`
  (`src/voice/actionSchemas.js`); without a runner it falls back to `goTo`.
- **Stale answers:** a fix that arrives after a newer search, chip or typed
  edit is dropped: it neither flies nor shows a message.
- **Messages** (failures, the rough-fix notice, the save confirmation) show in
  the search bar's line even while the GEV chat is open, since the button is
  pressed outside the field. They go with the next edit.
- **New text:** "Saved the centre of this view as your spot", "Rough location
  (±{km} km). Centre the map on your spot, then right-click the button to save
  it.", and "Your spot could not be saved". Translated in every shipped locale.
- **Not built:** a way to delete the saved spot (right-click again replaces
  it), and any server-side storage.
