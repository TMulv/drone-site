// Run: node validate.js
// Catches the #1 way this site breaks — a typo in gallery.json (trailing comma, missing quote, missing file).
// No deps, no framework: it's the one check this project needs.
const fs = require('fs');

let data;
try {
  data = JSON.parse(fs.readFileSync('gallery.json', 'utf8'));
} catch (e) {
  console.error('gallery.json is not valid JSON:', e.message);
  process.exit(1);
}

let errors = 0;
function check(list, name, requiredField) {
  (list || []).forEach((item, i) => {
    if (!item[requiredField]) {
      console.error(`${name}[${i}] is missing "${requiredField}":`, item);
      errors++;
      return;
    }
    if (requiredField !== 'youtubeId' && !fs.existsSync(item[requiredField])) {
      console.error(`${name}[${i}] points to a file that doesn't exist: ${item[requiredField]}`);
      errors++;
    }
  });
}

check(data.photos, 'photos', 'file');
check((data.panoramas || []).filter(p => !p.skypixel), 'panoramas', 'file');
(data.panoramas || []).filter(p => p.skypixel).forEach((p, i) => {
  if (!/^https:\/\/www\.skypixel\.com\//.test(p.skypixel)) { console.error(`skypixel entry ${i} isn't a skypixel.com link:`, p.skypixel); errors++; }
  if (p.thumb && !fs.existsSync(p.thumb)) { console.error(`skypixel entry ${i} thumb not found: ${p.thumb}`); errors++; }
});
check(data.videos360, 'videos360', 'youtubeId');

if (errors === 0) {
  console.log('gallery.json looks good.');
} else {
  console.error(`${errors} problem(s) found. Fix gallery.json before deploying.`);
  process.exit(1);
}
