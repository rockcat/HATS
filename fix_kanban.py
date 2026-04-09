import json

with open('F:/workspace/HATS/projects/hatslaunch/kanban-board.json', 'r', encoding='utf-8') as f:
    raw = f.read()

# Walk character by character to find end of first valid JSON object
depth = 0
end_pos = None
in_string = False
i = 0
while i < len(raw):
    ch = raw[i]
    if in_string:
        if ch == '\\':
            i += 2  # skip escaped char
            continue
        if ch == '"':
            in_string = False
    else:
        if ch == '"':
            in_string = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end_pos = i
                break
    i += 1

print('First JSON ends at position:', end_pos)
first_json = json.loads(raw[:end_pos+1])
print('First JSON nextSeq:', first_json['nextSeq'])
print('First JSON ticket count:', len(first_json['tickets']))

# Parse the second fragment — it ends with `"nextSeq": 21\n}`
# Wrap the ticket portion in a minimal JSON structure
remainder = raw[end_pos+1:].strip()
print('Remainder length:', len(remainder))
print('Remainder preview:', repr(remainder[:120]))

# The remainder looks like: `"id": "TKT-020", ... }, }, "nextSeq": 21 }`
# Wrap it to make it parseable
wrapped = '{"tickets": {"TKT-020": {' + remainder.split('"nextSeq"')[0].rstrip().rstrip('}').rstrip().rstrip('}').rstrip(',').rstrip() + '}}, "nextSeq": 21}'
try:
    second_json = json.loads(wrapped)
    print('TKT-020 parsed OK:', second_json['tickets']['TKT-020']['title'][:60])
    # Merge
    merged = first_json.copy()
    merged['tickets'].update(second_json['tickets'])
    merged['nextSeq'] = second_json['nextSeq']
    print('Merged ticket count:', len(merged['tickets']))
    print('Merged nextSeq:', merged['nextSeq'])

    with open('F:/workspace/HATS/projects/hatslaunch/kanban-board.json', 'w', encoding='utf-8') as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
    print('Written successfully.')
except Exception as e:
    print('Parse error:', e)
    print('Wrapped attempt:', repr(wrapped[:300]))
