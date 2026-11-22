# South African cameras (fork-local)

This fork adds 40 South African cameras to the camera layer: 27 owner-published still images and 13 YouTube live streams. Upstream God’s Eye View has none in Africa. They load from `config/cctv_sources.south-africa.json` through the settings in `compose.override.yaml`. Design and plan: `docs/superpowers/specs/2026-11-22-south-africa-cameras-design.md` and `docs/superpowers/plans/2026-11-22-south-africa-cameras.md`.

Every camera sets `streetViewFallback: false`, so none of them can ever spend the Google key on a Street View fallback frame. Still images go through the per-camera refresh floor at the `frameRefreshMs` shown. YouTube streams never touch the server: their window loads YouTube’s privacy-enhanced player only after Play. Owners are credited in the camera panel and linked in the Data credits popover (`za-cctv` in `src/data/dataCredits.js`).

Positions marked approximate carry an honest `accuracyM`. Coordinates come from the owner where stated, otherwise from airfield records or OpenStreetMap, as noted per camera.

## Still images

| id | Camera | Owner and terms | Position evidence | Refresh |
|---|---|---|---|---|
| `za-ctwc-tablemountain` | Cape Town Webcam: Table Mountain over Milnerton Lagoon | Capetown-webcam.com by Kapstadt.de. Owner invites embedding on condition the sponsored link to www.Kapstadt.de stays with the image | Estimated from the view: the owner says Milnerton Lagoon and the houses of Woodbridge Island are nearest the viewer; exact mount unknown (±800 m) | 7 min |
| `za-rand-henley-west` | Rand Airport: Henley WestCam | HenleyAir.tv (Henley Air). Owner asks that linked feeds acknowledge the source | Rand Airport (FAGM) aerodrome reference point, SA eAIP AD 2.2; camera on Hangar 6 (±1000 m) | 2 min |
| `za-rand-henley-north` | Rand Airport: Henley NorthCam | HenleyAir.tv (Henley Air). Owner asks that linked feeds acknowledge the source | Rand Airport (FAGM) aerodrome reference point, SA eAIP AD 2.2; camera on Hangar 7 (±1000 m) | 2 min |
| `za-hoedspruit-n` | Hoedspruit Civil Airfield: north | Hoedspruit Flying Club. Published by the club; no reuse terms stated | Airfield coordinates stated by the owner (S 24 21.100' E030 56.583') (±1000 m) | 10 min |
| `za-hoedspruit-3` | Hoedspruit Civil Airfield: camera 3 | Hoedspruit Flying Club. Published by the club; no reuse terms stated | Airfield coordinates stated by the owner (S 24 21.100' E030 56.583') (±1000 m) | 10 min |
| `za-hoedspruit-4` | Hoedspruit Civil Airfield: camera 4 | Hoedspruit Flying Club. Published by the club; no reuse terms stated | Airfield coordinates stated by the owner (S 24 21.100' E030 56.583') (±1000 m) | 10 min |
| `za-swellendam-d2` | Swellendam Airfield: camera D2 | Swellengrebel Flying Club. Published by the club; no reuse terms stated | Airfield coordinates stated by the owner to the whole arc-minute (34°03'S, 20°29'E) (±1500 m) | 5 min |
| `za-swellendam-n1` | Swellendam Airfield: camera N1 | Swellengrebel Flying Club. Published by the club; no reuse terms stated | Airfield coordinates stated by the owner to the whole arc-minute (34°03'S, 20°29'E) (±1500 m) | 5 min |
| `za-swellendam-n2` | Swellendam Airfield: camera N2 | Swellengrebel Flying Club. Published by the club; no reuse terms stated | Airfield coordinates stated by the owner to the whole arc-minute (34°03'S, 20°29'E) (±1500 m) | 5 min |
| `za-mosselbay-aero-n` | Mossel Bay Aerodrome: north | Mossel Bay Aero Club. Published by the club; no reuse terms stated | Mossel Bay aerodrome (FAMO) reference point, OurAirports; camera mount on the field unknown (±1000 m) | 2 min |
| `za-mosselbay-aero-w` | Mossel Bay Aerodrome: west | Mossel Bay Aero Club. Published by the club; no reuse terms stated | Mossel Bay aerodrome (FAMO) reference point, OurAirports; camera mount on the field unknown (±1000 m) | 2 min |
| `za-hartrao-26m` | HartRAO 26 m radio telescope | NRF/SARAO — Hartebeesthoek Radio Astronomy Observatory. SARAO terms allow personal, non-commercial display with notices retained | 26 m antenna position (IVS station catalogue, HARTRAO); the camera points at it, mount unknown (±300 m) | 2 min |
| `za-hartrao-15m` | HartRAO 15 m antenna | NRF/SARAO — Hartebeesthoek Radio Astronomy Observatory. SARAO terms allow personal, non-commercial display with notices retained | 15 m antenna position (IVS station catalogue, HART15M); the camera points at it, mount unknown (±300 m) | 2 min |
| `za-hartrao-vgos` | HartRAO VGOS geodesy antenna | NRF/SARAO — Hartebeesthoek Radio Astronomy Observatory. SARAO terms allow personal, non-commercial display with notices retained | VGOS antenna position (IVS station catalogue, HARTVGS); the camera points at it, mount unknown (±300 m) | 2 min |
| `za-hartrao-allsky` | HartRAO all-sky camera | NRF/SARAO — Hartebeesthoek Radio Astronomy Observatory. SARAO terms allow personal, non-commercial display with notices retained | Observatory site position; the camera's place on the site is not stated (±500 m) | 5 min |
| `za-saao-allsky` | SAAO Sutherland seeing-monitor all-sky camera | South African Astronomical Observatory. Published on SAAO's live Sutherland weather page; no reuse terms stated | SAAO Sutherland station position; the seeing monitor's place on the plateau is not stated (±500 m) | 2 min |
| `za-monet-outside` | MONET/South telescope: outside view | MONET (Univ. Göttingen, McDonald Observatory, SAAO). Published on the MONET weather page; no reuse terms stated | MONET/South telescope position stated by the owner (-32°22'44", +20°48'39") (±200 m) | 2 min |
| `za-cathedralpeak-1` | Cathedral Peak Hotel: the peaks | Cathedral Peak Hotel. Published by the hotel as its 24-hour webcam; no reuse terms stated | Hotel coordinates stated by the owner; camera mount on the property unknown (±150 m) | 2 min |
| `za-cathedralpeak-2` | Cathedral Peak Hotel: the valley | Cathedral Peak Hotel. Published by the hotel as its 24-hour webcam; no reuse terms stated | Hotel coordinates stated by the owner; camera mount on the property unknown (±150 m) | 2 min |
| `za-shellybeach` | Shelly Beach launch site (Breakerview) | South Coast Web (margate.co.za). Published by South Coast Web; no reuse terms stated | Estimated: Breakerview is about 40 m from the Sonny Evans Small Craft Harbour and 30 m from the Shelly Centre (owner), placed with OpenStreetMap (±100 m) | 5 min |
| `za-capegliding-1` | Cape Gliding Club, Worcester: towards Robertson (clubhouse) | Cape Gliding Club. Published by the club; no reuse terms stated; robots.txt allows all | Unverified: Worcester airfield (FAWC) position from third-party airfield listings, which disagree by a few hundred metres; the club states none (±500 m) | 5 min |
| `za-capegliding-2` | Cape Gliding Club, Worcester: camera 2 | Cape Gliding Club. Published by the club; no reuse terms stated; robots.txt allows all | Unverified: Worcester airfield (FAWC) position from third-party airfield listings, which disagree by a few hundred metres; the club states none (±500 m) | 5 min |
| `za-capegliding-3` | Cape Gliding Club, Worcester: Slanghoek mountains (runway) | Cape Gliding Club. Published by the club; no reuse terms stated; robots.txt allows all | Unverified: Worcester airfield (FAWC) position from third-party airfield listings, which disagree by a few hundred metres; the club states none (±500 m) | 5 min |
| `za-capegliding-4` | Cape Gliding Club, Worcester: Audensberg (chalets) | Cape Gliding Club. Published by the club; no reuse terms stated; robots.txt allows all | Unverified: Worcester airfield (FAWC) position from third-party airfield listings, which disagree by a few hundred metres; the club states none (±500 m) | 5 min |
| `za-eikendal-1` | Eikendal Wine Estate: main building and vineyards | Capetown-webcam.com by Kapstadt.de. Published openly on capetown-webcam.com (hosted by Kapstadt.de); no reuse terms stated | Eikendal Estate (OpenStreetMap vineyard area); camera at Eikendal Lodge per the publisher, exact mount unknown (±700 m) | 5 min |
| `za-eikendal-2` | Eikendal Wine Estate: over the vineyards | Capetown-webcam.com by Kapstadt.de. Published openly on capetown-webcam.com (hosted by Kapstadt.de); no reuse terms stated | Eikendal Estate (OpenStreetMap vineyard area); exact mount unknown (±700 m) | 5 min |
| `za-somersetwest` | Somerset West: towards Strand and the Helderberg | Capetown-webcam.com by Kapstadt.de. Published openly on capetown-webcam.com (hosted by Kapstadt.de); no reuse terms stated | Approximate: the publisher says a hillside in a residential area in the north of Somerset West, looking south; placed at the town centre (±3000 m) | 5 min |

## YouTube live streams

Checked live and embeddable on 22 Nov 2026 (YouTube oEmbed). A stream’s video ID changes when its owner restarts it: when a window says “Stream is offline”, open the channel’s /streams page, take the new ID, and update `youtubeVideoId`.

| id | Stream | Channel | Position evidence |
|---|---|---|---|
| `za-yt-vanilla-tablemountain` | Table Mountain from the Vanilla rooftop, Cape Town CBD | [Vanilla Internet](https://www.youtube.com/@VanillaISP) | Owner: the roof of its building in the CBD; Vanilla’s published address is 125 Buitengracht Street (OpenStreetMap street position) (±400 m) |
| `za-yt-paarden-island` | Table Mountain, Lion’s Head and the harbour from Paarden Island | [FLOORING.CO.ZA](https://www.youtube.com/@flooringcoza) | Rooftop camera listed as the Paarden Island webcam by capetown-webcam.com; placed at the Paarden Eiland suburb (±1000 m) |
| `za-yt-muizenberg` | Muizenberg surf (Wave Watchers) | [Muizenberg Wave Watchers](https://www.youtube.com/@MuizenbergWaveWatchers) | Muizenberg Beach (OpenStreetMap); the surf camera’s exact spot on the beachfront is not stated (±2000 m) |
| `za-yt-langebaan` | Langebaan Lagoon from Pearly’s Restaurant | [Table Mountain Live Stream](https://www.youtube.com/@TableMountainLiveStream) | Pearly’s Restaurant on the Langebaan beachfront (stream title); placed on Beach Road, Langebaan (±500 m) |
| `za-yt-franschhoek` | Franschhoek valley (Matopie) | [TCS Live](https://www.youtube.com/@TCSLiveOnline) | Stream title names Franschhoek; placed at the town, exact camera site not stated (±3000 m) |
| `za-yt-wilderness` | Wilderness: Map of Africa viewpoint | [TCS Live](https://www.youtube.com/@TCSLiveOnline) | Map of Africa viewpoint (OpenStreetMap), named in the stream title (±300 m) |
| `za-yt-plettenberg` | Plettenberg Bay: The Wedge to Beacon Isle | [TCS Live](https://www.youtube.com/@TCSLiveOnline) | Beacon Isle Drive (OpenStreetMap), named in the stream title (±500 m) |
| `za-yt-knysna-heads` | Knysna: The Heads | [TCS Live](https://www.youtube.com/@TCSLiveOnline) | The Heads, Knysna (OpenStreetMap), named in the stream title (±500 m) |
| `za-yt-jbay-supertubes` | Jeffreys Bay: Supertubes (lower point) | [SA Webcams](https://www.youtube.com/@SAWebcams) | Supertubes, Jeffreys Bay (stream title); placed at the town, about 2 km from the break (±2500 m) |
| `za-yt-nkorho` | Nkorho Bush Lodge waterhole, Sabi Sand | [Africam](https://www.youtube.com/@Africamvideos) | Nkorho Bush Lodge (OpenStreetMap), named in the stream title (±500 m) |
| `za-yt-naledi` | Naledi Lodge Cat Eye camera, Greater Kruger | [Africam](https://www.youtube.com/@Africamvideos) | Naledi Lodge in the Balule Nature Reserve (reserve position, OpenStreetMap); the lodge itself is not mapped (±10000 m) |
| `za-yt-simbavati` | Simbavati Waterside, Klaserie | [Africam](https://www.youtube.com/@Africamvideos) | Klaserie Private Nature Reserve (reserve position, OpenStreetMap), named in the stream title (±10000 m) |
| `za-yt-tembe` | Tembe Elephant Park | [Africam](https://www.youtube.com/@Africamvideos) | Tembe Elephant Park (reserve position, OpenStreetMap) (±8000 m) |

## Not included, and why

- **Windy-sourced cameras** (Morningstar airfield, Langebaan sports centre, Muizenberg beachfront, Gordon's Bay): Windy's API terms.
- **SA Weather Service aviation webcams** (George and other airports): the terms sit behind a subscription login, so they couldn't be checked.
- **SAAO's main live page and SALT:** refuse automated requests, or the images are gone.
- **Sutherland Solaris:** the camera's raw guest interface, not deliberately published.
- **Las Cumbres Observatory, Sutherland:** the licence covers scientific and educational use only; images also redirect off-host.
- **Panomax** (Table Mountain panorama): commercial platform.
- **SANParks:** blocks automated requests; images reportedly need an account.
- **Snow Report SA:** the media guidelines ask for permission first.
- **Avenues Guesthouse, Mossel Bay:** the legal notice forbids reuse without agreement.
- **Knysna panorama (gardenroute-knysna.de):** the owner asks to be contacted before use.
- **Sling Aircraft:** the terms forbid linking.
- **Springs:** obfuscated image URLs.
- **ipcamlive hotel cameras:** ipcamlive's terms on third-party embedding weren't found.
- **YouTube streams with embedding disabled or no stated location:** Clifton 4th Beach, the Table Mountain Live Stream main cam, TCS Cape Town, Vanilla Sea Point, Ulusaba, Roy's Dam.
- **SANRAL i-traffic:** their terms forbid automated use without permission; a separate request is pending.

## Turning them off

Remove the `environment:` lines from `compose.override.yaml` and run `docker compose up -d`. The built-in cameras are unaffected either way.
