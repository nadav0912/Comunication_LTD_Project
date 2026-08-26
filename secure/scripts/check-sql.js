'use strict';

// SC14 static check (SPEC.md §16). The secure build must never interpolate into a SQL string — every
// query uses bound parameters. This scans secure/routes/ and fails if any template interpolation
// ("dollar-brace") appears there, mirroring `git grep` but runnable via `npm run check:sql`.

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'routes');
const needle = '$' + '{'; // avoid writing the token literally so this file never flags itself

const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'));
const hits = [];
for (const file of files) {
  const lines = fs.readFileSync(path.join(routesDir, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(needle)) hits.push(`  ${file}:${i + 1}: ${line.trim()}`);
  });
}

if (hits.length) {
  console.error('check:sql FAILED — template interpolation found in secure/routes/ (SC14):');
  hits.forEach((h) => console.error(h));
  process.exitCode = 1;
} else {
  console.log(`check:sql ok — no interpolation in ${files.length} route files (SC14)`);
}
