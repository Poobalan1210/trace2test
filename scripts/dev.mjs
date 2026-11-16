// npm run dev: the local stack (real handlers, in-memory stores) and the
// dashboard's dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  ['stack', 'npx', ['tsx', 'scripts/local-stack.ts'], {}],
  ['web', 'npx', ['vite', '--port', '5173', '--strictPort'], { cwd: 'web' }],
].map(([name, cmd, args, opts]) => {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = name === 'stack' ? '\x1b[33m[stack]\x1b[0m ' : '\x1b[36m[web]\x1b[0m   ';
  const pipe = (stream, out) => stream.on('data', (d) => out.write(String(d).replace(/^(?=.)/gm, tag)));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${tag}exited (${code}); stopping`);
    for (const other of procs) other.kill();
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => {
  for (const p of procs) p.kill();
  process.exit(0);
});
