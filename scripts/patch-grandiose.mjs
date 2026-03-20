/**
 * Patches grandiose C++ sources to fix const char* compiler errors on MSVC
 * and rebuilds the native addon. Runs automatically via postinstall.
 *
 * Root cause: grandiose passes string literals to functions declared as
 * char* instead of const char*. Modern MSVC rejects this (/Zc:strictStrings).
 * The fix is purely a const-correctness annotation — no behaviour changes.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const grandioseDir = join(root, 'node_modules', 'grandiose');
const nativeAddon = join(grandioseDir, 'build', 'Release', 'grandiose.node');

if (!existsSync(grandioseDir)) {
  console.log('[patch-grandiose] grandiose not installed, skipping.');
  process.exit(0);
}

const patches = [
  {
    file: join(grandioseDir, 'src', 'grandiose_util.h'),
    from: 'int32_t rejectStatus(napi_env env, carrier* c, char* file, int32_t line);',
    to:   'int32_t rejectStatus(napi_env env, carrier* c, const char* file, int32_t line);',
  },
  {
    file: join(grandioseDir, 'src', 'grandiose_util.cc'),
    from: 'int32_t rejectStatus(napi_env env, carrier* c, char* file, int32_t line) {',
    to:   'int32_t rejectStatus(napi_env env, carrier* c, const char* file, int32_t line) {',
  },
  {
    file: join(grandioseDir, 'src', 'grandiose_receive.cc'),
    from: '    char* resourceName, napi_async_execute_callback execute,',
    to:   '    const char* resourceName, napi_async_execute_callback execute,',
  },
];

let patchCount = 0;
for (const { file, from, to } of patches) {
  if (!existsSync(file)) {
    console.warn(`[patch-grandiose] File not found: ${file}`);
    continue;
  }
  const content = readFileSync(file, 'utf-8');
  if (content.includes(from)) {
    writeFileSync(file, content.replace(from, to), 'utf-8');
    console.log(`[patch-grandiose] Patched: ${file}`);
    patchCount++;
  }
}

if (patchCount === 0) {
  console.log('[patch-grandiose] All patches already applied.');
  process.exit(0);
}

console.log(`[patch-grandiose] Applied ${patchCount} patch(es). Rebuilding native addon...`);
try {
  execSync('node-gyp rebuild', { cwd: grandioseDir, stdio: 'inherit' });
  console.log('[patch-grandiose] grandiose rebuilt successfully.');
} catch (err) {
  console.error('[patch-grandiose] Rebuild failed:', err.message);
  console.error('[patch-grandiose] NDI output will be unavailable.');
  process.exit(0); // non-fatal — SRT output still works
}
