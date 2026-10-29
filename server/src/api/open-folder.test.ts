import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { folderOpener, hostPath, inContainer } from './open-folder.js';

const data = path.resolve('/app/runtime_data');
const project = path.join(data, 'projects', 'evan');

describe('opening a folder', () => {
  it("uses each platform's file manager", () => {
    expect(folderOpener('/p', 'win32')[0]).toBe('explorer.exe');
    expect(folderOpener('/p', 'darwin')[0]).toBe('open');
    expect(folderOpener('/p', 'linux')[0]).toBe('xdg-open');
  });

  it('knows a container when it is in one', () => {
    expect(inContainer((p) => p === '/.dockerenv')).toBe(true);
    expect(inContainer(() => false)).toBe(false);
  });
});

describe('saying where a folder is, from a container', () => {
  it('gives the host path when compose says where the data comes from', () => {
    expect(hostPath(project, data, 'F:\\hats-data\\')).toEqual({ path: 'F:\\hats-data/projects/evan' });
  });

  it('gives the path within the data folder when it does not', () => {
    expect(hostPath(project, data, undefined)).toEqual({ path: 'projects/evan', inDataFolder: true });
  });

  it("gives the runner's own path for a folder outside the data folder", () => {
    const elsewhere = path.resolve('/srv/other');
    expect(hostPath(elsewhere, data, 'F:/hats-data')).toEqual({ path: elsewhere });
  });
});
