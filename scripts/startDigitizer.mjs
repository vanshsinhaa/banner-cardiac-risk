// Standalone digitizer launcher; npm run dev also uses this when the local model service is stopped.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const upstream = path.join(root, 'Open-ECG-Digitizer');
const python = path.join(upstream, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (process.argv.includes('--help')) {
  console.log('Start the local waveform digitizer: npm run digitizer\nFor website-only startup alongside this service, run npm run dev:web.\nOptional uvicorn arguments: npm run digitizer -- --port 8003');
  process.exit(0);
}
if (!existsSync(python)) {
  console.error('The digitizer Python environment is missing. Follow digitizer-service/README.md to create Open-ECG-Digitizer/.venv first.');
  process.exit(1);
}
const cache = process.env.MPLCONFIGDIR || path.join(root, '.local-run', 'matplotlib');
mkdirSync(cache, { recursive: true });
console.log('Loading the waveform digitizer. Keep this terminal open; wait for the uvicorn startup message.');
const child = spawn(python, ['-m', 'uvicorn', 'server:app', '--app-dir', path.join(root, 'digitizer-service'),
  '--host', '127.0.0.1', '--port', '8000', ...process.argv.slice(2)], {
  // Give POSIX children their own signal group; forward Ctrl+C exactly once.
  detached: process.platform !== 'win32',
  cwd: upstream, stdio: 'inherit', env: { ...process.env,
    ECG_RESAMPLE_SIZE: process.env.ECG_RESAMPLE_SIZE || '1200',
    PYTORCH_ENABLE_MPS_FALLBACK: process.env.PYTORCH_ENABLE_MPS_FALLBACK || '1',
    MPLCONFIGDIR: cache,
  },
});
child.on('error', error => { console.error(`Could not start the digitizer: ${error.message}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
