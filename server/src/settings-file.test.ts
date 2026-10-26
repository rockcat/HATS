import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { applicable, loadSettingsFile, lockedKeys, settingsFile } from './settings-file.js';
import { withEffective } from './api/env-manager.js';

const saved = async (text: string) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hats-settings-'));
  const file = path.join(dir, 'settings.env');
  await writeFile(file, text);
  return file;
};

describe('where settings are kept', () => {
  it('is .env unless the container names a file in the data directory', () => {
    expect(settingsFile({})).toBe('./.env');
    expect(settingsFile({ HATS_SETTINGS_FILE: '/app/runtime_data/config/settings.env' }))
      .toBe('/app/runtime_data/config/settings.env');
  });
});

describe('loading them at startup', () => {
  it('applies what was saved, over what the container started with', async () => {
    const env: Record<string, string | undefined> = {
      HATS_SETTINGS_FILE: await saved('ANTHROPIC_MODEL=claude-haiku-4-5\nOLLAMA_MODEL=llama3.2\n'),
      ANTHROPIC_MODEL: 'from-dotenv',
    };
    expect(loadSettingsFile(env).sort()).toEqual(['ANTHROPIC_MODEL', 'OLLAMA_MODEL']);
    expect(env['ANTHROPIC_MODEL']).toBe('claude-haiku-4-5');
  });

  it('never lets a saved value replace a locked one', async () => {
    // Compose points Ollama at the host; a localhost saved in the panel must not undo it.
    const env: Record<string, string | undefined> = {
      HATS_SETTINGS_FILE: await saved('OLLAMA_BASE_URL=http://localhost:11434/v1\n'),
      HATS_ENV_LOCKED: 'OLLAMA_BASE_URL, SPEECH_SERVICE_URL',
      OLLAMA_BASE_URL: 'http://host.docker.internal:11434/v1',
    };
    expect(loadSettingsFile(env)).toEqual([]);
    expect(env['OLLAMA_BASE_URL']).toBe('http://host.docker.internal:11434/v1');
  });

  it('does nothing without a named file — .env is already loaded by --env-file', () => {
    const env: Record<string, string | undefined> = { A: '1' };
    expect(loadSettingsFile(env)).toEqual([]);
    expect(env).toEqual({ A: '1' });
  });

  it('starts fine when the file does not exist yet', () => {
    expect(loadSettingsFile({ HATS_SETTINGS_FILE: path.join(tmpdir(), 'no-such-settings.env') })).toEqual([]);
  });
});

describe('the locked list', () => {
  it('ignores blanks and spacing', () => {
    expect([...lockedKeys({ HATS_ENV_LOCKED: ' A, ,B ' })]).toEqual(['A', 'B']);
    expect(applicable({ A: '1', C: '3' }, new Set(['A']))).toEqual({ C: '3' });
  });
});

describe('what the Settings panel is shown', () => {
  it('is the file, plus the running value of anything it does not mention', () => {
    const shown = withEffective(
      [{ key: 'ANTHROPIC_MODEL', value: 'saved', isSecret: false }],
      ['ANTHROPIC_MODEL', 'ANTHROPIC_API_KEY', 'NOT_SET'],
      { ANTHROPIC_MODEL: 'running', ANTHROPIC_API_KEY: 'sk-x' },
    );
    expect(shown).toEqual([
      { key: 'ANTHROPIC_MODEL', value: 'saved', isSecret: false },
      { key: 'ANTHROPIC_API_KEY', value: 'sk-x', isSecret: true },
    ]);
  });
});
