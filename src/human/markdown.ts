import { marked } from 'marked';
// @ts-ignore — no type declarations for marked-terminal
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal());

export function renderMarkdown(text: string): string {
  return (marked(text) as string).trimEnd();
}
