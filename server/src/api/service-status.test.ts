import { describe, it, expect } from 'vitest';
import { probeServices, serviceTargets, type ServiceTarget } from './service-status.js';

const urls = {
  agentLibraryUrl:  'http://library:3010',
  projectServerUrl: 'http://projects:3020',
  speechServiceUrl: 'http://speech:3050',
};
const speechUp = async () => true;

describe('which services to show', () => {
  it('always lists the three HATS services', () => {
    const ids = serviceTargets(urls, speechUp, {}).map((t) => t.id);
    expect(ids).toEqual(['agent-library', 'project-server', 'speech']);
  });

  it('adds a local model server only when it is configured', () => {
    const ids = serviceTargets(urls, speechUp, { OLLAMA_BASE_URL: 'http://host:11434/v1' }).map((t) => t.id);
    expect(ids).toContain('ollama');
    expect(ids).not.toContain('lmstudio');
  });

  it('labels a model server without the "(local)" suffix', () => {
    const lm = serviceTargets(urls, speechUp, { LM_STUDIO_BASE_URL: 'http://x:1234/v1' })
      .find((t) => t.id === 'lmstudio');
    expect(lm?.label).toBe('LM Studio');
    expect(lm?.url).toBe('http://x:1234/v1');
  });

  it('keeps a standalone service in the list, with no URL', () => {
    const lib = serviceTargets({ ...urls, agentLibraryUrl: null }, speechUp, {})
      .find((t) => t.id === 'agent-library');
    expect(lib?.url).toBeNull();
  });
});

describe('probing them', () => {
  const target = (url: string | null, probe: ServiceTarget['probe']): ServiceTarget =>
    ({ id: 'x', label: 'X', url, probe });

  it('reports what the probe says', async () => {
    const [up, down] = await probeServices([
      target('http://a', async () => true),
      target('http://b', async () => false),
    ]);
    expect(up).toMatchObject({ enabled: true, connected: true });
    expect(down).toMatchObject({ enabled: true, connected: false });
  });

  it('does not probe a service that is switched off', async () => {
    let probed = false;
    const [off] = await probeServices([target(null, async () => { probed = true; return true; })]);
    expect(off).toMatchObject({ enabled: false, connected: false });
    expect(probed).toBe(false);
  });

  it('treats a probe that throws as down, not as a failed request', async () => {
    const [s] = await probeServices([target('http://a', async () => { throw new Error('ECONNREFUSED'); })]);
    expect(s?.connected).toBe(false);
  });
});
