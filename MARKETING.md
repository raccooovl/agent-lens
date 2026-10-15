# Agent Lens: launch and marketing plan

Written 15 October 2026. Every channel here is where VALORANT players and viewers already are, costs nothing, and fits one person. Dates marked *unconfirmed* come from leaks or estimates; check them before acting. Log every post in `launch-log.csv` and use its tagged links, so the Chrome Web Store dashboard shows which channel brought visits.

## Before posting anywhere

1. **Get the listing live.** Every channel below needs a working install link. Submit 0.3.4 to the Chrome Web Store and Edge Add-ons now, using `STORE-LISTING.md` and `store-assets/`. Edge review can take up to 7 business days.
2. **Decide what to do about "Same match".** Riot started penalising stream-sniping tools in [patch 13.05](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-13-05) (September 2026), and stream sniping is one of the things VALORANT players hate most. "Same match" links streams in one lobby, opponents included, and the team comps and map filter make it easy to find a specific match. Options: rename it to something like "Other POVs of this match" and show teammates only by default, or leave it. Either way, never lead a post, clip or screenshot with it. The store texts and images already leave it out.
3. **Be ready for the next agent.** When Riot reveals an agent, run `tools/build-agent-data.py`, test, and submit the update the same day. Check what Agent Lens shows for an agent it doesn't know yet: it must not name a wrong one, since "never names a wrong agent" is in the listing.

## Channels, best first

1. **New-agent release day on r/VALORANT** (about 2.7M members). On release day everyone wants to watch the new agent being played, and Twitch can't filter by agent. Post a 10–15 second clip of the directory filtered to the new agent, with a title about that need ("Twitch can't filter by agent, so I made a free extension that can"). Ask the mods by modmail first, say you made it, post once. A reveal is rumoured for the Champions finals weekend, 16–18 October (*unconfirmed*). Last time, Miks went live two days after the reveal. Act on Riot's official release, not the rumour.
2. **Brazilian VALORANT Discords, in Portuguese.** Few tools are localised, and Agent Lens already is. [VDC Community](https://discord.com/servers/vdc-communityvalorant-927348475086127164) has about 67,700 members and [Comunidade Valorant BR](https://discord.com/servers/comunidade-valorant-br-708719358704222298) about 18,300 (Discord's listings, October 2026). Ask staff where tools may be shared, have a native speaker check the text, and use the screenshots in `store-assets/pt_BR/`.
3. **"Who should I watch for [agent]?" threads.** This is the exact question Agent Lens answers, and it recurs on r/VALORANT and [vlr.gg](https://www.vlr.gg/167002/good-streamers-to-watch-to-learn-each-agent). Set free [F5Bot](https://f5bot.com) alerts for phrases like "streamers to watch for", "who to watch", "best [agent] player to watch". Answer fresh threads with real names first, then one line about the filter, and say you made it. On vlr.gg, start at most one discussion thread framed as a free fan tool asking for feedback; vlr's [rules](https://vlr.gg/s/rules) ban for-profit advertising.
4. **Mid-size streamers and VALORANT clip or guide channels.** They scan many streams, and the badges, match-point highlight and pro-match pill save them time. Once the listing is live, send 2–3 short notes a week to the business email on their About page: what it does, free, no data collected, feature requests welcome. One message each, no follow-up chasing, never Twitch whispers.
5. **A weekly "what Twitch streamers are playing" chart: on hold.** Twitch's [Developer Services Agreement](https://legal.twitch.com/en/legal/developer-agreement/) (section VI.C) says insights derived from Twitch data "may not be ... shared with ... third parties for any purpose without Twitch's prior written permission", and Schedule 1 lists "Marketing" and trend "Research" as uses that need a separate agreement. Publishing the chart therefore needs Twitch's written permission first; ask on the [Twitch developer forum](https://discuss.dev.twitch.com/) or at legal@twitch.tv. Collecting previews from twitch.tv itself instead is ruled out by Twitch's terms against automated access.

## What runs by itself

- **Alerts:** F5Bot emails for the "who to watch" phrases. Free; replies stay manual.
- **Weekly chart (on hold):** a GitHub Action that samples the VALORANT directory through Twitch's API, runs the detector, and posts a chart to Bluesky and the website. Only if Twitch gives written permission (see channel 5).
- **Weekly to-do:** a Claude scheduled task on a cheap model (Haiku) that gathers the week's alerts and store numbers and drafts replies for you to send.
- **Measurement:** the tagged links in `launch-log.csv`. Each month, keep the two channels with the most visits per hour spent and drop the rest.

Posting on Reddit, Discord, vlr.gg and email stays manual. Automated posting there gets accounts banned.

## Checked and dropped

- **Agent-main subreddits:** no sign that they're active in 2026.
- **A Twitch panel extension:** Twitch staff have said Extensions can't use WebAssembly (2020, repeated in 2022), and a rejected submission permanently revokes the Client ID.
- **A "!agent" chat command or bot:** needs a server and reaches only viewers already watching that stream.
- **VCT match threads, a Game Changers tie-in, patch-day posts, press tips:** too little reach, or likely removed as promotion.
- **Ruled out earlier:** Twitch Snooze cross-promotion, browser-extension and builder communities, general tech press.

## Rules that apply everywhere

- No "VALORANT", "Riot" or agent names in account names, domains, hashtags or Edge search terms (Riot's fan-content policy, section 5).
- Riot's notice wherever Agent Lens is shared. The listing, website and README already have it, and `node tools/check-listing.cjs` checks it.
- Stay free: no donations, ads or paid promotion.
- Never offer anything in exchange for a rating or review.
