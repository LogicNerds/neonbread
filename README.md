# Neon Bread Studios — Arcade

The site behind **www.neonbreadent.com**: a neon 80s arcade floor with Chonx '26, Yeet The Baby, Grandma Theft Automatic, and Body The Karen (coming soon).

## Layout
- `index.html`: the arcade. One self-contained page, with the cabinet art drawn in code.
- `chonx/`, `yeet/`, `gta/`: copies of each game. **Don't edit these here.** Change the game in its own repo and the hourly sync copies it over.
- `shared/nb-scores.js`: global leaderboards (name entry, posting, boards). Every game and the arcade inline a copy of it. After editing it, run `python3 tools/inject-nb-scores.py <each game's index.html>` in each game repo.
- `firebase/`: Firestore rules and indexes for the `neon-bread-arcade` project. Deploy with `firebase deploy --only firestore` from that folder.
- `.github/workflows/sync-games.yml`: runs every hour, or by hand from the Actions tab. It runs `tools/sync-games.py`, which pulls each game's `index.html` and the audio/images it references.

## Game repos
| Folder | Repo |
|---|---|
| `chonx/` | LogicNerds/chonx2025 |
| `yeet/` | LogicNerds/YeetTheBaby |
| `gta/` | LogicNerds/grandma-theft-automatic |

Neon Bread Studios © 2026
