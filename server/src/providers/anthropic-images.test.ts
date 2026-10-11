import { describe, it, expect } from 'vitest';
import { toAnthropicMessages } from './anthropic.js';
import type { Message } from './types.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

const photoResult = (images?: Message['images']): Message[] => [
  { role: 'user', content: 'What am I holding?' },
  {
    role: 'assistant', content: '',
    toolCalls: [{ id: 'tc1', name: 'device__take_photo', arguments: {} }],
  },
  {
    role: 'tool', content: 'Here is the picture.\n\nKept at outputs/device/a.jpg.',
    toolCallId: 'tc1', toolName: 'device__take_photo',
    ...(images ? { images } : {}),
  },
];

/** The tool_result block, wherever it ended up. */
const toolResult = (mapped: ReturnType<typeof toAnthropicMessages>) => {
  for (const message of mapped) {
    if (!Array.isArray(message.content)) continue;
    const found = message.content.find((b) => (b as { type: string }).type === 'tool_result');
    if (found) return found as { content: unknown };
  }
  throw new Error('no tool_result in the mapped messages');
};

describe('showing the model a photo a device took', () => {
  it('sends the image as a block it can actually see', () => {
    const mapped = toAnthropicMessages(photoResult([{ mediaType: 'image/jpeg', base64: JPEG }]));
    const blocks = toolResult(mapped).content as Array<Record<string, unknown>>;

    const image = blocks.find((b) => b['type'] === 'image');
    expect(image).toBeDefined();
    expect(image?.['source']).toEqual({ type: 'base64', media_type: 'image/jpeg', data: JPEG });
  });

  it('puts the text first, because it says where the picture was kept', () => {
    const mapped = toAnthropicMessages(photoResult([{ mediaType: 'image/jpeg', base64: JPEG }]));
    const blocks = toolResult(mapped).content as Array<Record<string, unknown>>;

    expect(blocks[0]?.['type']).toBe('text');
    expect(blocks[0]?.['text']).toContain('outputs/device/a.jpg');
  });

  it('sends several pictures when several were taken', () => {
    const mapped = toAnthropicMessages(photoResult([
      { mediaType: 'image/jpeg', base64: JPEG },
      { mediaType: 'image/png', base64: JPEG },
    ]));
    const blocks = toolResult(mapped).content as Array<Record<string, unknown>>;

    expect(blocks.filter((b) => b['type'] === 'image')).toHaveLength(2);
  });

  it('leaves an ordinary tool result as a plain string', () => {
    // Every other tool in the system goes through this path; wrapping them all
    // in blocks would be a change nobody asked for.
    const mapped = toAnthropicMessages(photoResult(undefined));
    expect(toolResult(mapped).content).toBe('Here is the picture.\n\nKept at outputs/device/a.jpg.');
  });

  it('treats an empty image list as no images', () => {
    const mapped = toAnthropicMessages(photoResult([]));
    expect(typeof toolResult(mapped).content).toBe('string');
  });

  it('still batches consecutive tool results into one user message', () => {
    // Anthropic requires one user message with N tool_result blocks following
    // an assistant message with N tool_use blocks.
    const mapped = toAnthropicMessages([
      { role: 'user', content: 'go' },
      {
        role: 'assistant', content: '',
        toolCalls: [
          { id: 'a', name: 'device__take_photo', arguments: {} },
          { id: 'b', name: 'device__get_device_time', arguments: {} },
        ],
      },
      { role: 'tool', content: 'photo', toolCallId: 'a', images: [{ mediaType: 'image/jpeg', base64: JPEG }] },
      { role: 'tool', content: 'half three', toolCallId: 'b' },
    ]);

    const batched = mapped.filter((m) => Array.isArray(m.content)
      && (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'));
    expect(batched).toHaveLength(1);
    expect((batched[0]!.content as Array<{ type: string }>).filter((b) => b.type === 'tool_result')).toHaveLength(2);
  });
});
