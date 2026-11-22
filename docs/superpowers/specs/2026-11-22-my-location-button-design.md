# "Go to my location" button: design (short)

Date: 2026-11-22 · Fork: `xolisaninkwentsha/gods-eye-view` · Approved by Xolisani ("ok go ahead")

## Intent

One click flies the globe to where Xolisani is right now, his live location
rather than a saved home spot. It's for personal use on his own PC.

## Approach

Use the browser's Geolocation API, and fly there through the search bar's
existing coordinate route (`goTo` → `location.search("lat, lon")`). That route
answers coordinates locally (`src/search/coordinateGeocoder.js`: "without
asking anyone"), so the position never reaches the app's server or a place-name
service. Only Chrome's own location service, Google's, sees anything, in order
to work the position out.

Rejected:

- **An IP lookup web service:** less accurate, and it sends his address to a
  third party.
- **A saved home spot:** not "current".

## Design

- **Button:** a `UiButton` in the search bar next to the microphone, with the
  `my_location` Material icon (already in `index.html`'s `icon_names`) and the
  label "Go to my location".
- **Click:** `navigator.geolocation.getCurrentPosition` with
  `enableHighAccuracy: true`, a 30 s timeout (a cold first fix can take longer than 10 s, seen live) and `maximumAge` of 60 s. Chrome
  asks permission the first time.
- **Success:** the same flight as typing the coordinates. It frames about
  ±1.5 km and shows the usual searched-location pin.
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
    to 5–250 km) and say "Rough location (±{km} km). Right-click the button
    to save your exact spot."
- **A click with a precise fix** (Wi-Fi or GPS devices): fly to it as before.
  Travel away from home with such a device and the live fix wins.
- **New text:** "Saved the centre of this view as your spot", "Rough location
  (±{km} km). Right-click the button to save your exact spot.", and "Your spot
  could not be saved". Translated in every shipped locale.
- **Not built:** a way to delete the saved spot (right-click again replaces
  it), and any server-side storage.
