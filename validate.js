// Run: node validate.js
// Catches the #1 way this site breaks: a typo in gallery.json (trailing comma, missing quote, missing file).
const fs = require('fs');

let data;
try {
  data = JSON.parse(fs.readFileSync('gallery.json', 'utf8'));
} catch (e) {
  console.error('gallery.json is not valid JSON:', e.message);
  process.exit(1);
}

let errors = 0;
(data.panoramas || []).forEach((p, i) => {
  for (const key of ['location', 'file']) if (!p[key]) { console.error(`panoramas[${i}] is missing "${key}"`); errors++; }
  for (const key of ['file', 'thumb']) if (p[key] && !fs.existsSync(p[key])) { console.error(`panoramas[${i}] ${key} not found: ${p[key]}`); errors++; }
});

if (errors) { console.error(`${errors} problem(s). Fix gallery.json before deploying.`); process.exit(1); }
console.log(`gallery.json looks good (${data.panoramas.length} panoramas).`);
