// ── list_approved_emails: who this team may email ────────────────────────────
//
// check_email_permissions tells an agent what became of its own requests. An
// agent about to send also needs the other half: every address a human has
// approved, whoever asked for it, so it knows it may send without asking.

import type { EmailAllowlistEntry } from '../api/email-allowlist-store.js';

const matches = (e: EmailAllowlistEntry, search: string) =>
  e.email.includes(search) || (e.reason ?? '').toLowerCase().includes(search);

function line(e: EmailAllowlistEntry): string {
  const why = e.reason ? `: ${e.reason}` : '';
  return `- ${e.email} (asked for by ${e.requestedBy}${why})`;
}

/** The approved addresses, optionally only those matching `search`, as an agent reads them. */
export function describeApprovedEmails(entries: EmailAllowlistEntry[], search?: string): string {
  const wanted = search?.trim().toLowerCase() ?? '';
  const approved = entries.filter((e) => e.status === 'approved' && (!wanted || matches(e, wanted)));

  if (approved.length > 0) {
    const heading = wanted
      ? `Approved addresses matching "${search!.trim()}", which you may send to:`
      : 'Approved addresses, which you may send to:';
    return [heading, ...approved.map(line)].join('\n');
  }

  if (!wanted) {
    return 'No email addresses are approved yet. Ask for one with request_email_approval, then wait for a human to approve it.';
  }
  // Not approved: say what is known about it, so the agent does not ask twice.
  const other = entries.find((e) => e.status !== 'approved' && matches(e, wanted));
  if (other?.status === 'pending') return `No approved address matches "${search!.trim()}". ${other.email} is waiting for a human to approve it.`;
  if (other?.status === 'rejected') return `No approved address matches "${search!.trim()}". ${other.email} was refused: do not contact it.`;
  return `No approved address matches "${search!.trim()}". To send to one, ask with request_email_approval first.`;
}
