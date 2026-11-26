import { describe, it, expect } from 'vitest';
import { projectRelative, requestFiles } from './request-files.js';

describe('the files a request is about', () => {
  it('takes the files the agent names', () => {
    expect(requestFiles(['outputs/plan.md', './sources/brief.pdf'], 'Please approve.'))
      .toEqual(['outputs/plan.md', 'sources/brief.pdf']);
  });

  it('finds paths written into the message', () => {
    const message = 'I have drafted `outputs/launch/press-release.md` and TKT-012/notes.txt. Approve?';
    expect(requestFiles(undefined, message)).toEqual(['outputs/launch/press-release.md', 'TKT-012/notes.txt']);
  });

  it('lists a file once, named or mentioned', () => {
    expect(requestFiles(['outputs/plan.md'], 'See outputs/plan.md.')).toEqual(['outputs/plan.md']);
  });

  it('ignores what is not a path inside the project', () => {
    expect(requestFiles(['../secrets.env', 'C:/Users/x.md', 42], 'no files here')).toEqual([]);
  });

  it('normalises how a path is written', () => {
    expect(projectRelative('outputs\\report.md')).toBe('outputs/report.md');
    expect(projectRelative('/outputs/report.md')).toBe('outputs/report.md');
    expect(projectRelative('outputs/a/../../x')).toBeNull();
  });
});
