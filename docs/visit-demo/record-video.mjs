// Two recordings, one per team, made into one video: one above the other
// (which embeds in a page better) or side by side, with the long waits cut
// out (see record-cuts.mjs). Needs ffmpeg on the PATH, or FFMPEG set to it.

import { spawn } from 'node:child_process';

const FPS = 25;

/** An ffmpeg select expression keeping these stretches, shifted by `offset` ms. */
function selectExpr(keep, offset) {
  return keep
    .map((k) => `between(t,${Math.max(0, (k.start - offset) / 1000).toFixed(3)},${Math.max(0, (k.end - offset) / 1000).toFixed(3)})`)
    .join('+');
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}. Install ffmpeg, or set FFMPEG to it.`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}):\n${err}`))));
  });
}

/**
 * @param {{ first: { path: string, offset: number }, second: { path: string, offset: number },
 *           keep: { start: number, end: number }[], out: string, layout?: 'stacked' | 'side' }} job
 *   first goes on top (or left). offset: ms from the start of the run to the start of that recording.
 */
export async function combine({ first, second, keep, out, layout = 'stacked' }) {
  const fit = layout === 'stacked' ? 'scale=1280:-2' : 'scale=-2:720';
  const part = (input, { offset }) =>
    `[${input}:v]fps=${FPS},select='${selectExpr(keep, offset)}',setpts=N/${FPS}/TB,${fit}[v${input}]`;
  const stack = layout === 'stacked' ? 'vstack' : 'hstack';
  const filter = `${part(0, first)};${part(1, second)};[v0][v1]${stack}=inputs=2:shortest=1[out]`;
  await run(process.env.FFMPEG || 'ffmpeg', [
    '-y', '-i', first.path, '-i', second.path,
    '-filter_complex', filter, '-map', '[out]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', out,
  ]);
}
