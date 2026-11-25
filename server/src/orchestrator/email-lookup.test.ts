import { describe, it, expect } from 'vitest';
import { describeApprovedEmails } from './email-lookup.js';
import type { EmailAllowlistEntry } from '../api/email-allowlist-store.js';

const entry = (email: string, status: EmailAllowlistEntry['status'], requestedBy = 'Wren', reason?: string): EmailAllowlistEntry =>
  ({ email, status, requestedBy, reason, requestedAt: '2026-11-25T10:00:00Z' });

const entries = [
  entry('ana@acme.com', 'approved', 'Poppy', 'Acme pricing contact'),
  entry('bob@acme.com', 'pending'),
  entry('eve@spam.example', 'rejected'),
  entry('team@hats.dev', 'approved', 'Wren'),
];

describe('list_approved_emails', () => {
  it('lists every approved address, whoever asked for it, and nothing else', () => {
    const text = describeApprovedEmails(entries);
    expect(text).toContain('ana@acme.com (asked for by Poppy: Acme pricing contact)');
    expect(text).toContain('team@hats.dev (asked for by Wren)');
    expect(text).not.toContain('bob@acme.com');
    expect(text).not.toContain('eve@spam.example');
  });

  it('finds addresses by part of the address or the reason, ignoring case', () => {
    expect(describeApprovedEmails(entries, '@ACME.com')).toMatch(/matching "@ACME.com"[\s\S]*ana@acme.com/);
    expect(describeApprovedEmails(entries, 'pricing')).toContain('ana@acme.com');
    expect(describeApprovedEmails(entries, 'pricing')).not.toContain('team@hats.dev');
  });

  it('says when an address is still waiting, or was refused, so it is not asked for twice', () => {
    expect(describeApprovedEmails(entries, 'bob@acme.com')).toMatch(/bob@acme.com is waiting/);
    expect(describeApprovedEmails(entries, 'eve@spam.example')).toMatch(/was refused/);
  });

  it('says how to ask when nothing is approved', () => {
    expect(describeApprovedEmails([])).toMatch(/No email addresses are approved yet.*request_email_approval/);
    expect(describeApprovedEmails(entries, 'nobody@x.com')).toMatch(/request_email_approval/);
  });
});
