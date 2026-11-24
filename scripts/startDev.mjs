// Start the configured local digitizer before serving the development website.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env');
const root = fileURLToPath(new URL('../', import.meta.url));
loadEnvConfig(root, true);
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function launch(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32', env: process.env });
  children.add(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { children.delete(child); if (!stopping) stop(code ?? 1); });
  return child;
}
async function health(url) {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1500) });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.status === 'ready') return true;
    throw new Error('The configured digitizer port is responding, but not as a ready digitizer. Check ECG_DIGITIZER_URL.');
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'TimeoutError') return false;
    throw error;
  }
}
try {
  process.env.ECG_DIGITIZER_URL ||= 'http://127.0.0.1:8000';
  const url = new URL(process.env.ECG_DIGITIZER_URL);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (local) {
    if (await health(url.href)) console.log('Using the already-running local digitizer.');
    else {
      if (url.pathname !== '/' || url.search || url.username || url.password) throw new Error('Automatic local startup requires a plain digitizer URL, such as http://127.0.0.1:8000.');
      console.log('Starting the local digitizer; the website will start when the model is ready…');
      launch([path.join(root, 'scripts/startDigitizer.mjs'), '--host', url.hostname === '[::1]' ? '::1' : url.hostname, '--port', url.port || '80']);
      const deadline = Date.now() + 120_000;
      let ready = false;
      while (!stopping && Date.now() < deadline) {
        if (await health(url.href)) { ready = true; break; }
        await delay(500);
      }
      if (!ready && !stopping) throw new Error('The digitizer did not become ready within 2 minutes. Check its startup output above.');
    }
  } else console.log('Using the configured external digitizer; no local model process will be started.');
  if (!stopping) launch([require.resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(2)]);
} catch (error) { console.error(error.message); stop(1); }
