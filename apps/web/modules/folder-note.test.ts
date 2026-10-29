import { describe, it, expect } from 'vitest';
import { folderNoteText } from './files.js';

describe('the note shown when the folder cannot be opened', () => {
  it('points into the data folder when that is all the runner knows', () => {
    expect(folderNoteText({ path: 'projects/evan', inDataFolder: true })).toBe('In your HATS data folder, at projects/evan');
  });

  it('says why when opening failed', () => {
    expect(folderNoteText({ path: '/p', error: 'xdg-open: spawn xdg-open ENOENT' })).toContain('xdg-open');
  });
});
