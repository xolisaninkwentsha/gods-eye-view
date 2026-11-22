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
