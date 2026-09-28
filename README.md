# Tyler Mulvey · Aerial 360

The selected 360 drifts faintly behind the page. A sortable list of your 360s on the left (by date, city, state, or season; click the active sort again to flip it). Pick one and the right side shows its photo, details, and a map of where it was shot. Click the photo and it grows full screen into the panorama: drag to look around, scroll or pinch to zoom, Esc or "back to the list" to leave. On phones there's no right side, so tapping a row steps straight in.

No build step: `index.html`, `style.css`, `script.js`, and three.js from a CDN.

## Font

Titles use **Azonix** by Mixo (free for personal use; commercial use needs a license from him). Download it from https://www.dafont.com/azonix.font, unzip, and drop `Azonix.otf` into `fonts/`. Until then the site falls back to Michroma, a similar free Google font.

Everything else (locations, dates, buttons, hints) uses **Lemon Milk** by MARSNEV (donationware — free for personal/non-commercial use, a donation is asked for commercial use, see https://www.marsnev.com). This free version has no lowercase letters, so it always renders as capitals — that's why it still looks right even though the CSS says `text-transform: lowercase`.

## Search

The search box (top right while browsing) matches whatever's typed against each entry's town, state — full name or abbreviation — year, or season, all pulled from `location` and `date` in `gallery.json`. No extra fields needed. Non-matches drop out of the list; the detail pane jumps to the first match, or explains when there isn't one.

## Seasons

Seasons go by calendar month: Mar to May is spring, Jun to Aug summer, Sep to Nov fall, Dec to Feb winter (so a Sep 5 flight counts as fall).

- **show** row under sort: one chip per season you've actually shot, plus **all**, each with a count. Tap one to show just that season; tap it again (or **all**) to go back. It works together with search, and the counts follow whatever's typed. The row hides itself if every 360 is from the same season.
- **season** sort: groups the list under "fall 2026", "summer 2026", and so on. Winter spans new year, so Dec 2026 through Feb 2027 is "winter 2026/27".

## Where things live

```
~/Documents/Drone/
  drone-site/   this website (the git repo)
  DCIM/         raw photos copied off the SD card
```

## Weather, light, flight, place

The panel beside each photo is filled in by `enrich.js`, which writes it into `gallery.json`. From inside `drone-site`:

```
node enrich.js
```

It reads raw photos from `~/Documents/Drone/DCIM`, or straight off the SD card if it's plugged in. Somewhere else? `node enrich.js "/path/to/DCIM"`.

- **weather**: historical conditions for that town and hour, from Open-Meteo (free, no key)
- **light**: golden hour, minutes to sunset, where the sun sat, calculated from date, time, and place
- **flight**: frames, how long the sphere took, height above sea level, shutter, ISO, gimbal range, read from the raw DJI photos (matched to each 360 by start time, preferring full 26-frame spheres)
- **place**: county (looked up once per new town) and town elevation

Safe to re-run any time. It never copies the drone's GPS into the site. A group with nothing to show just doesn't appear.

## Saving space

The raw photos are only needed twice: to stitch a 360, and for `enrich.js` to read its flight info. After that, everything the site needs is in `media/360/` and `gallery.json`.

At the end of every run, `enrich.js` lists the `DCIM` folders that are **already on the site** (with how much space they take) and the ones that **aren't** (new sets still to stitch, or extras like wide and 180 shots). The first list is safe to delete or move to Google Drive / an external drive. Re-running the script later keeps the flight info it already saved.

Keep a set if you think you'll ever want to re-stitch it at better quality. Once it's deleted, the stitched JPG on the site is the best copy left.

## Map

Leaflet (loaded from cdnjs) with CARTO's light basemap, tinted warm in `style.css`. CARTO needs a free API key (carto.com/basemaps/apikey); it's `CARTO_KEY` near the map code in `script.js`. Keys are visible in the page by nature, so restrict yours to mulvey.world in the CARTO dashboard. Pins sit on town centers from `towns` in `gallery.json`. Clicking a pin selects that town's first 360 in the list; searching hides pins with no matches.

## Controls

Inside a panorama: **zoom** with the scroll wheel, a trackpad or touchscreen pinch, the + / − buttons, or the + / − keys (0 resets, double-click toggles a close-up). Dragging slows down as you zoom in so the view stays under your finger. **Auto spin** (top right) turns the view on its own; drag anytime to take over. The words (name, compass, caption) start hidden every time you step in so it's just the view; tap the panorama, press T, or hit **show text** (top right) to bring them back. Also **full screen** (or press F), top right; on phones it's a corners icon. iPhone Safari doesn't allow full screen for web pages, so that button hides itself there. Esc or the "back to the list" button (top left) takes you out.

## Preview

```
python3 -m http.server
```

Open http://localhost:8000. Double-clicking `index.html` won't work because browsers block local file loads.

## Add a 360

1. Copy the new `PANORAMA` folders from the SD card into `~/Documents/Drone/DCIM/PANORAMA/` (or leave the card plugged in).
2. Stitch them: easiest is to hand the folders to Claude and ask for the new sets to be stitched and added. By hand, the stitched 2:1 panorama goes in `media/360/`, and a 600x800 portrait card cut from the middle of the pano (the direction you land facing) goes in `media/360/thumbs/`.
3. Add an entry at the top of `panoramas` in `gallery.json`:

```json
{ "file": "media/360/new-shot.jpg", "thumb": "media/360/thumbs/new-shot.jpg",
  "location": "Town, ST", "date": "Oct 1, 2026", "time": "6:12 pm", "alt": "40 m" }
```

4. New town? Add it to `towns` at the top of `gallery.json` with the town center's coordinates (right-click the town on Google Maps to copy them). That places the map pin. Only town centers go here, never the drone's GPS:

```json
"Town, ST": { "ll": [41.0098, -74.1729] }
```

5. From inside `drone-site`, fill in the details, check for typos, and publish:

```
node enrich.js
node validate.js
git add -A && git commit -m "add new 360s" && git push
```

6. Clear out the raw folders `enrich.js` listed as already on the site (see Saving space).

### Taking one off for good

Delete its entry from `gallery.json` and its two files in `media/360/`, then add it to `skip.json` (same `location`, `date`, `time`). That keeps it from coming back: `validate.js` fails if a skipped 360 shows up in `gallery.json` again, and `enrich.js` lists its raw set as removed instead of "new sets to stitch". Anyone (or any Claude) syncing new photos should check `skip.json` first.

Got a round "little planet" from DJI Fly instead of a flat 2:1 image? `python3 unplanet.py planet.jpg media/360/new-shot.jpg` converts it (needs `pip3 install numpy pillow scipy`).

## Deploy

Live at mulvey.world via GitHub Pages (`CNAME` points it there). Push to `main` and Pages redeploys automatically; DNS is set up at Namecheap.
