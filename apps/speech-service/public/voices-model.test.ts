import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module without types
import { describeInstalled, filterAvailable, formatSize, languagesOf, preferredLanguage } from './voices-model.js';

const voice = (name: string, over: Record<string, unknown> = {}) => {
  const [code] = name.split('-');
  return {
    name, languageCode: code, language: code!.startsWith('en') ? 'English' : 'French',
    country: code!.endsWith('GB') ? 'Great Britain' : code!.endsWith('US') ? 'United States' : 'France',
    quality: name.split('-').at(-1), speakers: 1, sizeBytes: 63_000_000, installed: false, ...over,
  };
};

const catalogue = [
  voice('en_GB-alba-medium'),
  voice('en_GB-semaine-medium', { installed: true, speakers: 4 }),
  voice('en_US-amy-low'),
  voice('fr_FR-siwis-medium'),
];

describe('filterAvailable', () => {
  it('leaves out what is installed', () => {
    expect(filterAvailable(catalogue).map((v: { name: string }) => v.name))
      .toEqual(['en_GB-alba-medium', 'en_US-amy-low', 'fr_FR-siwis-medium']);
  });

  it('filters by language and quality', () => {
    expect(filterAvailable(catalogue, { language: 'en_GB' }).map((v: { name: string }) => v.name)).toEqual(['en_GB-alba-medium']);
    expect(filterAvailable(catalogue, { quality: 'low' }).map((v: { name: string }) => v.name)).toEqual(['en_US-amy-low']);
  });

  it('searches names, languages and countries', () => {
    expect(filterAvailable(catalogue, { query: 'france' }).map((v: { name: string }) => v.name)).toEqual(['fr_FR-siwis-medium']);
    expect(filterAvailable(catalogue, { query: 'AMY' }).map((v: { name: string }) => v.name)).toEqual(['en_US-amy-low']);
  });
});

describe('describeInstalled', () => {
  it('describes installed voices from the catalogue, with what is running', () => {
    const rows = describeInstalled([{ name: 'en_GB-semaine-medium', speakers: [{}, {}, {}, {}] }], catalogue);
    expect(rows).toEqual([expect.objectContaining({ name: 'en_GB-semaine-medium', language: 'English', speakerCount: 4, running: true })]);
  });

  it('offers a multi-speaker voice its speakers, starting on its default', () => {
    const speakers = [{ name: '01', id: 3 }, { name: '02', id: 9 }];
    const [row] = describeInstalled([{ name: 'en_GB-semaine-medium', speakerId: 9, speakers }], catalogue);
    expect(row).toEqual(expect.objectContaining({ speakerNames: ['01', '02'], defaultSpeaker: '02', speakerCount: 2 }));
  });

  it('offers no speakers for a single-speaker voice', () => {
    const [row] = describeInstalled([{ name: 'en_GB-semaine-medium', speakerId: null, speakers: [] }], catalogue);
    expect(row).toEqual(expect.objectContaining({ speakerNames: [], defaultSpeaker: '' }));
  });

  it('lists a voice the catalogue does not know, by name', () => {
    const rows = describeInstalled([{ name: 'my-own-voice', speakers: [] }], catalogue);
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['en_GB-semaine-medium', 'my-own-voice']);
  });

  it('shows an installed voice that is not running', () => {
    expect(describeInstalled([], catalogue)).toEqual([expect.objectContaining({ name: 'en_GB-semaine-medium', running: false })]);
  });
});

describe('languagesOf and preferredLanguage', () => {
  const languages = languagesOf(catalogue);

  it('lists each language once, by label', () => {
    expect(languages.map((l: { code: string }) => l.code)).toEqual(['en_GB', 'en_US', 'fr_FR']);
  });

  it('starts on the browser language, or one sharing its family, or none', () => {
    expect(preferredLanguage(languages, 'en-GB')).toBe('en_GB');
    expect(preferredLanguage(languages, 'en-AU')).toBe('en_GB');
    expect(preferredLanguage(languages, 'de-DE')).toBe('');
  });
});

describe('formatSize', () => {
  it('shows megabytes for models and kilobytes for small files', () => {
    expect(formatSize(63_201_000)).toBe('63 MB');
    expect(formatSize(5_076)).toBe('5 KB');
    expect(formatSize(0)).toBe('');
  });
});
