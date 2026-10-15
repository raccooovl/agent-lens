# Agent Lens

A Chrome and Edge extension (Manifest V3) that shows which VALORANT agent each Twitch streamer is playing, and filters the VALORANT directory by agent or role. Detection runs locally on Twitch's public preview pictures.

- `extension/`: the extension. Load it unpacked, or zip its contents (without `VERIFICATION.md`) for the stores. See `extension/README.md`.
- `tools/messages.cjs` and `tools/build-locales.cjs`: all texts in five languages; run `node tools/build-locales.cjs` after editing.
- `tools/build-agent-data.py`: refreshes agent icons and pictures when Riot adds an agent.
- `tests/`: logic tests and browser tests, see `tests/README.md`.
- `STORE-LISTING.md`: everything to fill in on the Chrome and Edge dashboards, in five languages. `node tools/check-listing.cjs` checks it.
- `store-assets/`: store screenshots and promo images, made by `node tools/store-assets.cjs` (see `store-assets/README.md`).
- `docs/`: the website (GitHub Pages from this folder): home page, FAQ and privacy policy. `PRIVACY.md`: privacy policy.
- `.github/ISSUE_TEMPLATE/wrong-agent.yml`: the "Wrong agent" report form linked from the listing and the site.
- `launch-log.csv`: where Agent Lens was shared, with a tagged store link per channel.

The code is MIT licensed. The agent pictures and ability icons in `extension/img` and `extension/data` belong to Riot Games and are used under its fan-content policy, not under the MIT licence. Not affiliated with Twitch.

Agent Lens was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.
