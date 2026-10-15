# Store images

Made by `node tools/store-assets.cjs` (needs `npm install --no-save playwright`; set `CHROMIUM_PATH` to pick a Chromium). It takes about three minutes and rewrites everything here, plus the English copies in `docs/img/`.

- `<language>/1-agents.png` … `5-popup.png`: five 1280x800 screenshots per language (en, nl, de, es, pt_BR), with a caption in that language. Upload each language's set to that language in the Chrome and Edge dashboards.
- `promo/small-tile-440x280.png`: Chrome's small promo tile (Edge: small promotional tile).
- `promo/marquee-1400x560.png`: Chrome's marquee (Edge: large promotional tile).
- `promo/logo-300x300.png`: Edge's store logo.

How the screenshots are made: the real extension runs on a local stage page that looks like Twitch's VALORANT directory, with made-up channel names, titles and avatars. The stream pictures are hand-checked previews from `tests/fixtures/previews`, picked because none shows a real face (no camera, or a drawn or VTuber avatar). Every badge, pill, filter and popup in the pictures is the extension's own output on those previews. Nothing is loaded from twitch.tv.

The captions and promo images avoid Riot names and logos (Riot's fan-content policy, section 5). The badges show Riot's agent pictures because that's what the extension shows.
