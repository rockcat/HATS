import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { missingScript } from './mcp-client.js';

const script = path.resolve('/root/.gemini/extensions/google-workspace/dist/index.js');
const nowhere = () => false;
const everywhere = () => true;

describe('spotting a server script that is not installed here', () => {
  it('names an absolute script path that does not exist', () => {
    expect(missingScript([script], nowhere)).toBe(script);
  });

  it('passes a script that is there', () => {
    expect(missingScript([script], everywhere)).toBeNull();
  });

  it('ignores npx package names and flags, which are not files', () => {
    expect(missingScript(['-y', '@modelcontextprotocol/server-memory'], nowhere)).toBeNull();
  });

  it('ignores a relative path, which depends on where the child starts', () => {
    expect(missingScript(['dist/index.js'], nowhere)).toBeNull();
  });

  it('ignores an absolute path that is data, not a script', () => {
    expect(missingScript([path.resolve('/projects/paige/kanban-board.json')], nowhere)).toBeNull();
  });
});
