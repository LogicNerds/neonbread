# Neon Bread Studios — Arcade

The site behind **www.neonbreadent.com**: a neon 80s arcade floor with Chonx '26, Yeet The Baby, Grandma Theft Automatic, and Body The Karen.

## Layout
- `index.html`: the arcade. One self-contained page, with the cabinet art drawn in code.
- `chonx26/`, `yeet/`, `gta/`, `karen/`: the games. **This repo is the source of truth.** Edit them here directly.
- `shared/nb-scores.js`: global leaderboards (name entry, posting, boards). Every game and the arcade inline a copy of it. After editing it, run `python3 tools/inject-nb-scores.py <each game's index.html>` on each game folder here.
- `firebase/`: Firestore rules and indexes for the `neon-bread-arcade` project. Deploy with `firebase deploy --only firestore` from that folder.
- `tools/sync-games.py`: **retired, don't run it.** It used to copy each game from its own repo every hour; that sync was turned off on Nov 21 2026 and running it now would overwrite the games here with older copies.

## Old game repos (no longer updated)
The games started in their own repos. Since the sync was turned off, they're frozen and their GitHub Pages copies don't get changes.

| Folder | Old repo |
|---|---|
| `chonx26/` | LogicNerds/chonx2025 |
| `yeet/` | LogicNerds/YeetTheBaby |
| `gta/` | LogicNerds/grandma-theft-automatic |
| `karen/` | LogicNerds/BodyKaren (holds the same Nov 21 v1 build) |

Neon Bread Studios © 2026
