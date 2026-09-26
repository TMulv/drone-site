# Tyler Mulvey · Aerial 360

Your 360s sit on a ring around you. Scroll or drag to turn it, click a card to fly into that sphere, then drag or scroll to look around. Esc or "back to the ring" takes you out. Arrow keys and Enter work too.

No build step: `index.html`, `style.css`, `script.js`, and three.js from a CDN.

## Font

Titles use **Azonix** by Mixo (free for personal use; commercial use needs a license from him). Download it from https://www.dafont.com/azonix.font, unzip, and drop `Azonix.otf` into `fonts/`. Until then the site falls back to Michroma, a similar free Google font.

Everything else (locations, dates, buttons, hints) uses **Lemon Milk** by MARSNEV (donationware — free for personal/non-commercial use, a donation is asked for commercial use, see https://www.marsnev.com). This free version has no lowercase letters, so it always renders as capitals — that's why it still looks right even though the CSS says `text-transform: lowercase`.

## Controls

Top right: **hide text while turning** (the words fade while you scroll or drag, and the setting is remembered) and **full screen** (or press F). iPhone Safari doesn't allow full screen for web pages, so the button hides itself there.

## Preview

```
python3 -m http.server
```

Open http://localhost:8000. Double-clicking `index.html` won't work because browsers block local file loads.

## Add a 360

1. Put the stitched 2:1 panorama in `media/360/`.
2. Put a portrait card image (600x800, a slice of the pano around the horizon) in `media/360/thumbs/`. The card should show the middle of the pano, because that's the direction you land facing when you click in.
3. Add an entry at the top of `panoramas` in `gallery.json`:

```json
{ "file": "media/360/new-shot.jpg", "thumb": "media/360/thumbs/new-shot.jpg",
  "location": "Town, ST", "date": "Oct 1, 2026", "time": "6:12 pm", "alt": "40 m" }
```

4. Run `node validate.js` to catch typos and missing files.

Simplest option: drop the SD card folder into a chat with Claude and ask for the new sets to be stitched and added.

Got a round "little planet" from DJI Fly instead of a flat 2:1 image? `python3 unplanet.py planet.jpg media/360/new-shot.jpg` converts it (needs `pip3 install numpy pillow scipy`).

## Deploy

Drag this folder onto https://app.netlify.com/drop. For a custom domain, buy one (~$10-12/yr) and add it in Netlify's site settings.
