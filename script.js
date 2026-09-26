// Tabs — plain show/hide, no router needed for 4 sections.
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

const lightbox = document.getElementById('lightbox');
const lightboxBody = document.getElementById('lightbox-body');
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });

let psvInstance = null;
function closeLightbox() {
  lightbox.classList.add('hidden');
  if (psvInstance) { psvInstance.destroy(); psvInstance = null; } // destroy before clearing, or it tries to remove nodes that are already gone
  lightboxBody.innerHTML = '';
}

function openPhoto(url) {
  lightboxBody.innerHTML = `<img src="${url}" alt="">`;
  lightbox.classList.remove('hidden');
}

// Loaded on demand: a CDN hiccup only breaks self-hosted panos, not the whole gallery.
async function openPanorama(url) {
  lightboxBody.innerHTML = '';
  lightbox.classList.remove('hidden');
  const { Viewer } = await import('@photo-sphere-viewer/core');
  psvInstance = new Viewer({
    container: lightboxBody,
    panorama: url,
    navbar: ['zoom', 'fullscreen'],
  });
}

function openVideo360(youtubeId) {
  lightboxBody.innerHTML = `<iframe src="https://www.youtube.com/embed/${youtubeId}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  lightbox.classList.remove('hidden');
}

// ponytail: gallery.json is hand-edited, so a malformed entry shouldn't take down the whole grid — skip and log instead of throwing.
function card(imgSrc, title, place, date, onClick) {
  const el = document.createElement('div');
  el.className = 'card';
  const media = imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="${title || ''}">` : `<div class="tile">360&deg;</div>`;
  el.innerHTML = `${media}<div class="caption">${title || ''}${place ? ' — ' + place : ''}${date ? ' — ' + date : ''}</div>`;
  el.addEventListener('click', onClick);
  return el;
}

fetch('gallery.json')
  .then(r => r.json())
  .then(data => {
    const photosGrid = document.getElementById('photos-grid');
    (data.photos || []).forEach(p => {
      if (!p.file) return console.warn('skipped photo entry missing "file"', p);
      photosGrid.append(card(p.file, p.title, p.location, p.date, () => openPhoto(p.file)));
    });

    const panoGrid = document.getElementById('panoramas-grid');
    (data.panoramas || []).forEach(p => {
      if (p.skypixel) return panoGrid.append(card(p.thumb, p.title, p.location, p.date, () => window.open(p.skypixel, '_blank', 'noopener')));
      if (!p.file) return console.warn('skipped panorama entry missing "file" or "skypixel"', p);
      panoGrid.append(card(p.file, p.title, p.location, p.date, () => openPanorama(p.file)));
    });

    const videoGrid = document.getElementById('videos360-grid');
    (data.videos360 || []).forEach(v => {
      if (!v.youtubeId) return console.warn('skipped video entry missing "youtubeId"', v);
      const thumb = `https://img.youtube.com/vi/${v.youtubeId}/hqdefault.jpg`;
      videoGrid.append(card(thumb, v.title, v.location, v.date, () => openVideo360(v.youtubeId)));
    });

    document.querySelectorAll('.grid').forEach(g => {
      if (!g.children.length) g.innerHTML = '<p class="empty">Nothing here yet. Add entries to gallery.json.</p>';
    });
  })
  .catch(err => {
    console.error('Could not load gallery.json — if you opened index.html directly, run a local server instead (see README).', err);
  });
