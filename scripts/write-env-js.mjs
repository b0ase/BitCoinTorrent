// Writes <dir>/env.js from the environment at build time. The file is gitignored:
// never commit it. Usage: node scripts/write-env-js.mjs <dir>
import { writeFileSync } from 'node:fs';
const dir = process.argv[2] || 'public';
const key = process.env.SUPABASE_ANON_KEY_PUBLIC || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
if (!key) {
  const msg = 'write-env-js: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set';
  if (process.env.VERCEL || process.env.CI_REQUIRE_ENV) { console.error(msg); process.exit(1); }
  console.warn(msg + ' (pages will not reach Supabase)');
}
writeFileSync(`${dir}/env.js`, `window.SUPABASE_ANON_KEY=${JSON.stringify(key)};\n`);
console.log(`write-env-js: wrote ${dir}/env.js`);
