// Writes <dir>/env.js at build time with the MAIN stack (api.b0ase.com)
// public anon key from MAIN_SUPABASE_ANON_KEY. The output is gitignored:
// never commit it, never hardcode keys. Usage: node scripts/write-env-js.mjs <dir>
import { writeFileSync } from 'node:fs';
const dir = process.argv[2] || 'public';
const key = process.env.MAIN_SUPABASE_ANON_KEY || '';
if (!key) console.warn('write-env-js: MAIN_SUPABASE_ANON_KEY is not set; static pages will not reach api.b0ase.com');
writeFileSync(`${dir}/env.js`, `window.SUPABASE_ANON_KEY=${JSON.stringify(key)};\n`);
console.log(`write-env-js: wrote ${dir}/env.js`);
