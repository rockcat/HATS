/**
 * Which addresses this machine can be reached on.
 *
 * A pairing QR encodes exactly one URL, and a machine with more than one
 * network adapter has more than one right answer: a laptop on both wired and
 * wireless is reachable at two addresses, and which one works depends entirely
 * on the network the phone happens to be on. Offering all of them and letting
 * somebody pick beats guessing.
 */

import { networkInterfaces } from 'os';

export interface LanAddress {
  address: string;
  /** The adapter's name, which is what makes one address recognisable from another. */
  label: string;
  /**
   * False for addresses a phone almost certainly cannot reach — virtual
   * adapters for WSL, Hyper-V and the like. Still offered, because the guess
   * is a heuristic and being wrong should not hide a working address.
   */
  likelyReachable: boolean;
}

/** Adapter names that belong to virtualisation rather than a real network. */
const VIRTUAL = /vethernet|hyper-v|virtualbox|vmware|loopback|docker|wsl/i;

/**
 * Every IPv4 address this machine holds, most likely useful first.
 *
 * Link-local (169.254.x) is dropped: it means the adapter never got a lease,
 * so nothing is reachable there.
 */
export function lanAddresses(): LanAddress[] {
  const found: LanAddress[] = [];

  for (const [label, addresses] of Object.entries(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      found.push({ address: entry.address, label, likelyReachable: !VIRTUAL.test(label) });
    }
  }

  return found.sort((a, b) =>
    Number(b.likelyReachable) - Number(a.likelyReachable) || a.label.localeCompare(b.label));
}

/** The host:port a request arrived on, which is the address that demonstrably works. */
export function hostOf(headerHost: string | undefined, fallbackPort: number): string {
  return headerHost ?? `localhost:${fallbackPort}`;
}

/** True when an address only works on this machine — useless in a QR code. */
export function isLoopback(host: string): boolean {
  let name = host.trim().toLowerCase();
  // An IPv6 host is bracketed in a URL: `[::1]:3001`. Splitting on the colon
  // would leave `[`, which matches nothing.
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(name);
  name = bracketed ? bracketed[1]! : (name.split(':')[0] ?? '');
  return name === 'localhost' || name === '::1' || name.startsWith('127.');
}
