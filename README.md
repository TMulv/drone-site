# Tyler Mulvey · Aerial 360

A list of your 360s on the left, thumbnail and details for whichever one you're pointed at on the right. Search narrows the list by town, state, year, or season. Click (or tap) any entry and it morphs full screen into that panorama — drag or scroll to look around, Esc or "back to the list" to leave.

No build step: `index.html`, `style.css`, `script.js`, and three.js from a CDN.

## Font

Titles use **Azonix** by Mixo (free for personal use; commercial use needs a license from him). Download it from https://www.dafont.com/azonix.font, unzip, and drop `Azonix.otf` into `fonts/`. Until then the site falls back to Michroma, a similar free Google font.

Everything else (locations, dates, buttons, hints) uses **Lemon Milk** by MARSNEV (donationware — free for personal/non-commercial use, a donation is asked for commercial use, see https://www.marsnev.com). This free version has no lowercase letters, so it always renders as capitals — that's why it still looks right even though the CSS says `text-transform: lowercase`.

## Search

The search box (top right while browsing) matches whatever's typed against each entry's town, state — full name or abbreviation — year, or season, all pulled from `location` and `date` in `gallery.json`. No extra fields needed. Non-matches drop out of the list; the detail pane jumps to the first match, or explains when there isn't one.

## Controls

Inside a panorama: **zoom** with the scroll wheel, a trackpad or touchscreen pinch, the + / − buttons, or the + / − keys (0 resets, double-click toggles a close-up). Dragging slows down as you zoom in so the view stays under your finger. Also **hide text while turning** (the words fade while you drag or scroll to look around, and the setting is remembered) and **full screen** (or press F), top right. iPhone Safari doesn't allow full screen for web pages, so that button hides itself there. Esc or the "back to the list" button (top left) takes you out.

## Preview

```
python3 -m http.server
```

Open http://localhost:8000. Double-clicking `index.html` won't work because browsers block local file loads.

## Add a 360

1. Put the stitched 2:1 panorama in `media/360/`.
2. Put a portrait card image (600x800, a slice of the pano around the horizon) in `media/360/thumbs/`. It's what shows in the list and detail pane, and it should show the middle of the pano, because that's the direction you land facing when you step inside.
3. Add an entry at the top of `panoramas` in `gallery.json`:

```json
{ "file": "media/360/new-shot.jpg", "thumb": "media/360/thumbs/new-shot.jpg",
  "location": "Town, ST", "date": "Oct 1, 2026", "time": "6:12 pm", "alt": "40 m" }
```

4. Run `node validate.js` to catch typos and missing files.

Simplest option: drop the SD card folder into a chat with Claude and ask for the new sets to be stitched and added.

Got a round "little planet" from DJI Fly instead of a flat 2:1 image? `python3 unplanet.py planet.jpg media/360/new-shot.jpg` converts it (needs `pip3 install numpy pillow scipy`).

## Deploy

Live at mulvey.world via GitHub Pages (`CNAME` points it there). Push to `main` and Pages redeploys automatically; DNS is set up at Namecheap.
