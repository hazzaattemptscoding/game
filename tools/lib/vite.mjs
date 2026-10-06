// Start and stop a Vite dev server for a browser test. `npx vite` runs Vite as a child of npx, so killing the npx process
// left Vite running on its port, and the next test that asked for that port (from any checkout) quietly got the old server
// and tested its code. Here the server runs in its own process group and stop() ends the whole group, and a port that is
// already taken is an error, not something to test against.
import { spawn } from 'node:child_process';
import net from 'node:net';

const taken = port => new Promise(resolve => {
  const s = net.connect(+port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

export async function startVite(port, wait = 3500) {
  if (await taken(port)) throw new Error(`port ${port} is already in use (a server left running?). Stop it first: a test on it would load whatever that server serves.`);
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ } };
  process.on('exit', stop);
  await new Promise(r => setTimeout(r, wait));
  return { proc, stop };
}
