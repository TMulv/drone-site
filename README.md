# Your drone site

No build step. No npm. No framework. Open `index.html` in a browser and it's your site.

## Preview it locally

Double-clicking `index.html` won't load the gallery (browsers block local file reads by default).
Instead, from this folder run:

```
python3 -m http.server
```

Then open http://localhost:8000

## Add content

Edit `gallery.json`. Three lists: `photos`, `panoramas`, `videos360`. Copy an existing entry, change the values. That's it — no code touched.

- Regular photo → drop the file in `media/photos/`, add an entry with its path as `file`
- 360 photo (DJI Sphere panorama, stitched, 2:1 ratio) → drop it in `media/360/`, add an entry with its path as `file`
- DJI Fly gave you a round "little planet" instead of a flat 2:1 strip? Convert it (one-time setup: `pip3 install numpy pillow scipy`):
  ```
  python3 unplanet.py ~/Desktop/planet.jpg media/360/my-shot.jpg
  ```
  The sky straight overhead isn't in a little planet, so the script fades it into soft overcast. For a full-quality sphere, stitch the 26 raw shots from the SD card's PANORAMA folder with Hugin (free) instead.
- 360 photo already on SkyPixel → skip the file, add an entry with `"skypixel": "<the SkyPixel link>"`. Optional `"thumb": "media/360/some-screenshot.jpg"` for a real preview image instead of the 360° tile. Opens your SkyPixel post in a new tab (SkyPixel blocks embedding, so it can't play inside your site). For the drag-around-on-your-site experience, add the actual file instead (line above).
- 360 video → upload to YouTube, grab the ID from the URL (`youtube.com/watch?v=THIS_PART`), add it as `youtubeId`

Before you deploy, sanity-check your edits:

```
node validate.js
```

Catches typos and missing files before they break the live site.

## Deploy (free, ~2 minutes, no git required)

1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page
3. You get a live URL immediately

Want a custom domain instead of the random Netlify one? Buy a domain (~$10-12/yr, Cloudflare Registrar or Namecheap), then in Netlify's site settings add it as a custom domain and follow their DNS steps. Same drag-and-drop deploy flow works for every future update — just drag the folder again.

## When this setup stops being enough

- More than ~50-100 photos and load feels sluggish → move `gallery.json` entries into paginated pages, or add a build step. Not needed yet.
- Want version history / multiple people editing → add git + GitHub, connect Cloudflare Pages or Netlify to the repo instead of drag-drop. Not needed yet.
- Want thumbnails auto-generated instead of full-size images in the grid → add an image pipeline. Not needed yet — `loading="lazy"` on the grid images covers the perf problem until the library gets big.
