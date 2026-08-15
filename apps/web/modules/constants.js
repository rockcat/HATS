// ── Constants ─────────────────────────────────────────────────────────────────

export const HAT = {
  none:   { bar: '#30363d', label: '#6e7681', bg: 'rgba(48,54,61,0.20)'    },
  white:  { bar: '#e6edf3', label: '#0d1117', bg: 'rgba(230,237,243,0.40)' },
  red:    { bar: '#f85149', label: '#f85149', bg: 'rgba(248,81,73,0.12)'   },
  black:  { bar: '#8b949e', label: '#8b949e', bg: 'rgba(139,148,158,0.12)' },
  yellow: { bar: '#e3b341', label: '#e3b341', bg: 'rgba(227,179,65,0.12)'  },
  green:  { bar: '#3fb950', label: '#3fb950', bg: 'rgba(63,185,80,0.12)'   },
  blue:   { bar: '#58a6ff', label: '#58a6ff', bg: 'rgba(88,166,255,0.12)'  },
};

export const HAT_OPTIONS = [
  { value: 'none',   label: 'No Hat'             },
  { value: 'white',  label: 'White — Facts'      },
  { value: 'red',    label: 'Red — Emotion'      },
  { value: 'black',  label: 'Black — Caution'    },
  { value: 'yellow', label: 'Yellow — Optimism'  },
  { value: 'green',  label: 'Green — Creativity' },
  { value: 'blue',   label: 'Blue — Process'     },
];

export const HAT_DESC = {
  none:   'No Hat',
  white:  'Facts',
  yellow: 'Optimism',
  black:  'Caution',
  red:    'Emotion',
  green:  'Creativity',
  blue:   'Process',
};

export const STATE_LABEL = {
  idle:             'Idle',
  working:          'Working',
  waiting_for_help: 'Waiting for help',
  in_discussion:    'In discussion',
};
