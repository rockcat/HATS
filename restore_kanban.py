#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json

with open('F:/workspace/HATS/projects/hatslaunch/kanban-board.json', 'r', encoding='utf-8') as f:
    raw = f.read()

# Find where first JSON ends
depth = 0
end_pos = None
in_string = False
i = 0
while i < len(raw):
    ch = raw[i]
    if in_string:
        if ch == '\\':
            i += 2
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
                end_pos = i + 1
                break
    i += 1

# Extract and load the first valid JSON
valid_json = raw[:end_pos]
board = json.loads(valid_json)

# Write it back cleanly
with open('F:/workspace/HATS/projects/hatslaunch/kanban-board.json', 'w', encoding='utf-8') as f:
    json.dump(board, f, indent=2, ensure_ascii=False)

print(f'Fixed. Board has {len(board["tickets"])} tickets, nextSeq is {board["nextSeq"]}')
