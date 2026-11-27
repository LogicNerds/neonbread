# Neon Bread Studios — Arcade

The site behind **www.neonbreadent.com**: a neon 80s arcade floor with Chonx '26, Chonx: Cheeky Ops, Yeet The Baby, Grandma Theft Automatic, Body The Karen, Ped X-ing, and Chonx Five O.

## Layout
- `index.html`: the arcade. One self-contained page, with the cabinet art drawn in code.
- `chonx26/`, `cheekyops/`, `yeet/`, `gta/`, `karen/`, `pedxing/`, `fiveo/`: the games. **This repo is the source of truth.** Edit them here directly.
- `shared/nb-scores.js`: global leaderboards (name entry, posting, boards). Every game and the arcade inline a copy of it. After editing it, run `python3 tools/inject-nb-scores.py <each game's index.html>` on each game folder here.
- `shared/nb-party.js`: online party mode (rooms, lobby, live sync) for Yeet The Baby, Body The Karen, Ped X-ing and Bruh.... Each of those games inlines a copy. After editing it, run `python3 tools/inject-nb-party.py yeet/index.html karen/index.html pedxing/index.html boredgames/bruh/index.html`.
- `firebase/`: Firestore rules and indexes (leaderboards) and Realtime Database rules (`database.rules.json`, online party rooms) for the `neon-bread-arcade` project. Deploy with `firebase deploy --only firestore` and `firebase deploy --only database` from that folder.
- `tools/mock-rtdb.py`: a local stand-in for the Realtime Database, for testing online play: run it, then open games with `?nbdb=http://localhost:9000` in two separate browser profiles (one hosts, one joins).
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
