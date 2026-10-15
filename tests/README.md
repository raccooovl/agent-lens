# Tests

```sh
npm install --no-save playwright jpeg-js
node --test tests/unit.test.cjs   # detector, screens, teams, same-match, map/mode, region reading, kernel, service worker, texts, manifest
node tests/e2e.js                 # 52 browser checks on captured Twitch markup with known previews (no network)
node tests/live.js                # live twitch.tv (signed out); then python3 tests/review-sheet.py to check decisions by eye
```

On the hand-labelled set (`VAL=/path/to/set`): `eval-own-agent.js` (agent accuracy, `WIDTHS=1920,1280`), `eval-score.js` (round scores), `eval-spectate.js`, and `eval-screens.js` (menus, agent select, death and round-end screens, uncertain bars).

Browser tests open a visible Chromium window (set `CHROMIUM_PATH` to choose one). Tools: `npm install --no-save playwright jpeg-js wabt` covers tests and builders (`tools/build-kernel.cjs`, `tools/build-words.cjs`). `e2e.js` runs a copy of the extension that fetches previews from a local test server, because the service worker's requests can't be intercepted.

`fixtures/previews/` holds 30 live previews checked by hand: 14 agents (including two stretched 4:3 HUDs), four spectating, three non-gameplay screens, agent select (Bind, Competitive), a FLAWLESS round result, a French DÉFAITE with the combat report open, a duo in the same match (panzermausitv and zoovieh), two opponents (subroza and zekken), an official broadcast and a deathmatch. `fixtures/valorant-directory.html` is the VALORANT directory as captured from twitch.tv on 14 October 2026, without scripts or images.

`probe-scan.js` measures the page script on a 150-card directory (`--no-extension` for the baseline, `--profile` for a CPU profile); `probe-nav.js` measures going to another category and back on live twitch.tv; `probe-back.js` opens a stream from the filtered directory and goes Back (frozen time, long tasks, first card on screen; `--profile`). `probe-scan.js --copies=20 --filter=clove --away=3000` simulates Back on a 600-card filtered directory.

The stream previews in `fixtures/previews/` and the captured Twitch pages (`fixtures/valorant-directory.html`, `fixtures/nav.html`) aren't in the public repository, because they show real streamers, their names and their stream titles. The browser tests, most detector tests and `tools/store-assets.cjs` need them, so run those from the developer's local copy.
