#!/usr/bin/env python3
"""Inline shared/nb-party.js into a game's index.html (or refresh an existing copy).
Usage: python3 tools/inject-nb-party.py path/to/index.html [...]"""
import pathlib, re, sys
here = pathlib.Path(__file__).resolve().parent.parent
mod = (here / 'shared' / 'nb-party.js').read_text()
block = '<script id="nb-party">\n' + mod.rstrip() + '\n</script>\n'
for p in sys.argv[1:]:
    f = pathlib.Path(p); s = f.read_text()
    if '<script id="nb-party">' in s:
        s = re.sub(r'<script id="nb-party">.*?</script>\n', lambda m: block, s, count=1, flags=re.S)
    else:
        i = s.index('</head>'); s = s[:i] + block + s[i:]
    f.write_text(s); print('injected', p)
