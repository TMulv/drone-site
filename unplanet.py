# Converts a DJI "little planet" export back into a 2:1 equirectangular 360.
# Usage: python3 unplanet.py planet.jpg out.jpg
# ponytail: horizon radius is auto-detected from the dark ground disk; fails on snowy/bright ground. Pass a radius as 3rd arg to override.
import sys, numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter1d
src = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)
H, W, _ = src.shape
lum = src.mean(axis=2)
m = slice(H//4, 3*H//4), slice(W//4, 3*W//4)
ys, xs = np.nonzero(lum[m] < 70)
cy, cx = ys.mean() + H//4, xs.mean() + W//4
if len(sys.argv) > 3:
    k = float(sys.argv[3])
else:  # horizon = where brightness climbs out of the ground disk
    a = np.linspace(0, 2*np.pi, 720)
    prof = [lum[(cy + r*np.sin(a)).astype(int).clip(0, H-1), (cx + r*np.cos(a)).astype(int).clip(0, W-1)].mean() for r in range(50, min(H, W)//2)]
    k = 50 + int(np.argmax(np.diff(gaussian_filter1d(prof, 3)))) + 10
OW = max(1024, min(int(2*np.pi*k) // 2 * 2, 4096)); OH = OW // 2  # match the horizon's real pixel count, no fake upscaling
lon = (np.arange(OW) + 0.5) / OW * 2*np.pi
lat = np.pi/2 - (np.arange(OH) + 0.5) / OH * np.pi
LON, LAT = np.meshgrid(lon, lat)
r = k * np.tan((LAT + np.pi/2).clip(0, np.pi - 1e-3) / 2)
x, y = cx + r*np.sin(LON), cy - r*np.cos(LON)
out = np.stack([map_coordinates(src[..., c], [y.clip(0, H-1), x.clip(0, W-1)], order=1) for c in range(3)], -1)
# Highest latitude where every longitude has real pixels:
max_r = min(cx, cy, W-1-cx, H-1-cy)
top = np.degrees(2*np.arctan(max_r / k)) - 90
# Above that, fade into a soft sky built from the last real row (blurred sideways), easing to its average at the zenith.
row = int((90 - top) / 180 * OH) + 1
ref = gaussian_filter1d(out[row], OW/30, axis=0, mode='wrap')
latd = np.degrees(LAT)[..., None]
toward_zenith = ((latd - top) / (90 - top)).clip(0, 1)
sky = ref[None] * (1 - toward_zenith) + ref.mean(0) * toward_zenith
t = ((latd - (top - 12)) / 12).clip(0, 1); t = t*t*(3 - 2*t)
out = out * (1 - t) + sky * t
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(sys.argv[2], quality=90)
print(f"horizon radius {k:.0f}px, real sky up to {top:.0f}°, saved {OW}x{OH}")
