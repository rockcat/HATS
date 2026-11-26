import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { buildIndex, folderContents, countIn, crumbs, existingFolder, kindOf, ROOT, TICKET_WORK } from './file-explorer-logic.js';

const file = (relativePath: string, size = 10) =>
  ({ name: relativePath.split('/').pop(), relativePath, size, modified: '2026-11-25T10:00:00Z', isDir: false });
const dir = (relativePath: string) => ({ name: relativePath.split('/').pop(), relativePath, size: 0, modified: '', isDir: true });

const listing = {
  sources: [file('sources/sales.csv'), dir('sources/brief'), file('sources/brief/notes 10.md'), file('sources/brief/notes 2.md')],
  outputs: [file('outputs/report.md')],
  tickets: [{ id: 'TKT-002', files: [file('TKT-002/draft.md')] }, { id: 'TKT-003', files: [] }],
};

describe('project files as folders', () => {
  const index = buildIndex(listing);
  const names = (path: string) => folderContents(index, path).map((e: { label: string }) => e.label);

  it('starts with Sources, Outputs and Ticket work', () => {
    expect(names(ROOT)).toEqual(['Sources', 'Outputs', 'Ticket work']);
  });

  it('leaves out Ticket work when no ticket has files', () => {
    expect(folderContents(buildIndex({ ...listing, tickets: [] }), ROOT).map((e: { label: string }) => e.label))
      .toEqual(['Sources', 'Outputs']);
  });

  it('lists folders first, then files, in natural order', () => {
    expect(names('sources')).toEqual(['brief', 'sales.csv']);
    expect(names('sources/brief')).toEqual(['notes 2.md', 'notes 10.md']);
  });

  it("gathers each ticket's folder under Ticket work", () => {
    expect(names(TICKET_WORK)).toEqual(['TKT-002']);
    expect(names('TKT-002')).toEqual(['draft.md']);
  });

  it('counts what a folder holds', () => {
    expect(countIn(index, 'sources')).toBe(2);
    expect(countIn(index, ROOT)).toBe(3);
  });

  it('makes breadcrumbs from the top', () => {
    expect(crumbs(index, 'sources/brief').map((c: { label: string }) => c.label)).toEqual(['Project', 'Sources', 'brief']);
    expect(crumbs(index, 'TKT-002').map((c: { path: string }) => c.path)).toEqual([ROOT, TICKET_WORK, 'TKT-002']);
    expect(crumbs(index, 'nowhere').map((c: { label: string }) => c.label)).toEqual(['Project']);
  });

  it('falls back to the nearest folder that still exists', () => {
    const fewer = buildIndex({ sources: [file('sources/sales.csv')] });
    expect(existingFolder(fewer, 'sources/brief')).toBe('sources');
    expect(existingFolder(fewer, 'TKT-002')).toBe(ROOT);
    expect(existingFolder(fewer, 'outputs')).toBe('outputs');
  });

  it('copes with a file listed without its folder', () => {
    const loose = buildIndex({ outputs: [file('outputs/charts/q3.png')] });
    expect(folderContents(loose, 'outputs').map((e: { name: string }) => e.name)).toEqual(['charts']);
    expect(crumbs(loose, 'outputs/charts').map((c: { label: string }) => c.label)).toEqual(['Project', 'Outputs', 'charts']);
  });

  it('says what sort of thing each entry is', () => {
    expect(kindOf({ name: 'sales.csv', isDir: false })).toBe('CSV');
    expect(kindOf({ name: 'brief', isDir: true })).toBe('Folder');
    expect(kindOf({ name: 'data.parquet', isDir: false })).toBe('PARQUET file');
    expect(kindOf({ name: 'Makefile', isDir: false })).toBe('File');
  });
});
