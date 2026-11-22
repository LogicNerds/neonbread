#!/usr/bin/env python3
"""Copy the latest build of each game from its own repo into this site.
Downloads index.html plus every local file it references (audio, images).
Run by .github/workflows/sync-games.yml every hour; safe to run by hand too."""
import pathlib, re, sys, urllib.request, urllib.parse

GAMES = {  # site folder: repo
    'chonx26': 'chonx2025',
    'yeet': 'YeetTheBaby',
    'gta': 'grandma-theft-automatic',
}
RAW = 'https://raw.githubusercontent.com/LogicNerds/{repo}/main/{path}'
REF = re.compile(r"""["'`]((?!https?:|data:|//|#)[\w\-./ ]+?\.(?:mp3|m4a|ogg|wav|png|jpg|jpeg|gif|webp|json|css|js))["'`]""")
root = pathlib.Path(__file__).resolve().parent.parent

def get(repo, path):
    url = RAW.format(repo=repo, path=urllib.parse.quote(path))
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

failed = False
for folder, repo in GAMES.items():
    try:
        html = get(repo, 'index.html')
    except Exception as e:
        print(f'!! {repo}: could not fetch index.html ({e}); leaving {folder}/ as is'); failed = True; continue
    files = {'index.html': html}
    for ref in sorted(set(REF.findall(html.decode('utf-8', 'replace')))):
        ref = ref.lstrip('./')
        try:
            files[ref] = get(repo, ref)
        except Exception as e:
            print(f'   {repo}: skipped {ref} ({e})')
    for rel, data in files.items():
        out = root / folder / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        if not out.exists() or out.read_bytes() != data:
            out.write_bytes(data); print(f'updated {folder}/{rel}')
sys.exit(1 if failed else 0)
