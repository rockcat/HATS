// ── Commands typed into a chat ───────────────────────────────────────────────
//
// The Chat section used to have a separate command box. Its commands now work
// in the message box instead; everything else typed there is a message to the
// agent. No imports and no DOM, so it is directly testable.
//
//   task Name: description         give an agent a task
//   task Name [folder]: description   …in a named project folder
//   reply Name: message             answer an agent's question
//   resume                          restart unfinished tasks and tickets

const COMMAND = /^(?:(?:task|reply)\s+[^:\s][^:]*:\s*\S[\s\S]*|resume)$/;

/** The line to run as a command, or null when `text` is a message. */
export function chatCommand(text) {
  const line = (text ?? '').trim();
  return COMMAND.test(line) ? line : null;
}
