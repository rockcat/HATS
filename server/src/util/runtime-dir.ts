import path from 'path';

const base = process.env['RUNTIME_DIR']
  ? path.resolve(process.env['RUNTIME_DIR'])
  : path.join(process.cwd(), 'runtime_data');

export function runtimeDir(...segments: string[]): string {
  return path.join(base, ...segments);
}
