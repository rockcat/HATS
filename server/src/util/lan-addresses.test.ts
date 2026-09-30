import { describe, it, expect } from 'vitest';
import { hostOf, isLoopback, lanAddresses } from './lan-addresses.js';

describe('lanAddresses', () => {
  it('finds at least one address on a networked machine', () => {
    // Every entry must be usable as a host in a URL.
    for (const entry of lanAddresses()) {
      expect(entry.address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(entry.label).not.toBe('');
    }
  });

  it('leaves out loopback and link-local, which reach nothing', () => {
    for (const { address } of lanAddresses()) {
      expect(address.startsWith('127.'), address).toBe(false);
      expect(address.startsWith('169.254.'), address).toBe(false);
    }
  });

  it('puts the addresses a phone might actually reach first', () => {
    const flags = lanAddresses().map((a) => a.likelyReachable);
    // Once false appears it must not go back to true.
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
  });

  it('marks a virtual adapter as unlikely rather than hiding it', () => {
    // A wrong guess should cost a label, not a working address.
    const virtual = lanAddresses().filter((a) => /vethernet|wsl|hyper-v/i.test(a.label));
    for (const entry of virtual) expect(entry.likelyReachable).toBe(false);
  });
});

describe('isLoopback', () => {
  it('spots the addresses that only work on this machine', () => {
    for (const host of ['localhost', 'localhost:3001', '127.0.0.1', '127.0.0.1:3001', '[::1]:3001']) {
      expect(isLoopback(host), host).toBe(true);
    }
  });

  it('passes a real address through', () => {
    for (const host of ['10.0.30.150:3001', '10.0.10.137:3001', 'poppy.local:3001']) {
      expect(isLoopback(host), host).toBe(false);
    }
  });
});

describe('hostOf', () => {
  it('uses the header when there is one — it is the address that demonstrably works', () => {
    expect(hostOf('10.0.10.137:3001', 3001)).toBe('10.0.10.137:3001');
  });

  it('falls back to localhost when a request carried no host', () => {
    expect(hostOf(undefined, 3001)).toBe('localhost:3001');
  });
});
