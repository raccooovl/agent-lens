# Agent Lens

See which VALORANT agent every Twitch streamer is playing, right on their stream card, and filter the VALORANT directory by agent or role.

## What it does

- **Agent on every VALORANT stream card**, with the round score when it can read it (for example "Jett · 7–5"). Scores at 12 are highlighted: match point or overtime.
- **Filter the VALORANT directory** by role (Duelists, Initiators, Controllers, Sentinels) or by agent. Each agent chip shows how many streams on the page are playing that agent. Pick several to combine them. The filter is remembered. While filtering, Twitch stops loading more streams once the rest are under your minimum viewers (sorted by viewers) or after 300, so the page stays quick; **Load more** in the bar loads another 150.
- **My agents:** pick the agents you play in the toolbar popup. Their streams get a ★ and a one-click filter.
- **Sidebar:** followed channels playing VALORANT get a small agent picture on their avatar.
- **Why there's no agent:** when the stream shows no ability bar, the card says why when it can: **Agent select**, **In menus**, **Dead**, **Round over**, **Buy phase**, **Deathmatch**, or **Pro match** for official broadcasts (VCT and other Riot events, and watch parties showing them).
- **Team comps:** the badge's tooltip lists both teams' agents, read from the portraits at the top of the game display.
- **Streams in the same match:** streamers playing together, or against each other, are linked: a link icon on their badges, who's on which side in the tooltip, and a **Same match** chip on the directory that shows just those streams.
- **Map and mode:** read at agent select (map name and Competitive, Unrated or Swiftplay) and from a deathmatch clock, kept for that match, shown in the tooltip and as filter chips on the directory.
- **This tab:** on a channel page, the toolbar popup says what that streamer is playing and the score.

Works on the VALORANT directory, your Following page, Browse and anywhere else Twitch shows live VALORANT stream cards.

## How it works

Twitch publishes a preview picture of every live stream, refreshed about every five minutes, with a separately taken picture for each image size. For VALORANT streams on your screen, Agent Lens downloads that picture and compares the four ability icons at the bottom of the game's display with each agent's icons. This happens on your own computer, in about a twentieth of a second per stream: it reads a 1280×720 picture first (full HD only when needed), takes a quick look at half detail before the full check of the likeliest agents, does the icon comparisons in a small WebAssembly kernel four at a time, and only reads the parts of the picture that matter (the ability bar, the score, the team portraits, a few screen corners). Streams on screen are read first, nearest first; work for a tab you closed or left is dropped.

A stream whose agent isn't known yet gets a quick look first: a 640×360 picture (about 45 KB). Menus, official broadcasts and pictures with no game in them stop there; only a stream in a match gets the bigger pictures. A stream that stays out of a match (menus, another game, just chatting) is looked at again after 1, 2, 4, 8 and then every 15 minutes, with a quick look each time, instead of every minute. On the Twitch page itself, Agent Lens ignores text changes and chat, spaces its passes over the page by how long the last one took, and never makes the browser recalculate the page's layout from inside a pass, so switching categories and going back stays smooth on big directories. It handles stretched resolutions (4:3, 5:4 and 16:10 played on a 16:9 stream) and streams where the game picture is shrunk to make room for overlays.

When a streamer is dead and watching a teammate, the game shows the teammate's abilities. Agent Lens spots this from the teammate's picture bottom-left and keeps the streamer's own agent (marked with an eye), or shows **Spectating** if it hasn't seen their own agent yet. The agent shown is the one seen most often in the current match, so one odd preview can't change it.

When a stream is between rounds or behind an overlay, the card keeps the agent seen earlier in the match (shown dimmed, with how long ago in the tooltip) for up to 45 minutes. Once the streamer is back in the menus or at agent select, that match is over and the old agent is dropped.

A bar seen while the streamer is dead (the combat report is open) or under a round result banner (won, lost, clutch, flawless...) can be a watched teammate's, so it never sets the agent on its own: it confirms the agent already seen, shows as watching a teammate if it's a different one, or shows as **Jett?** (dimmed) until a clearer preview, or a second such preview minutes later, settles it. In the buy phase everyone is alive, so the bar there counts fully.

The screens are recognised by their shapes, not their text, so they work in any game language: the menu bar icons, the agent select role buttons, the round banner's big centred letters, the red strip with the killer's name in the combat report, the ten player cards with coloured health bars of an official broadcast, and a match clock of two minutes or more (rounds never last that long) for deathmatch. The map and mode at agent select are read as words: the map names seen so far (Abyss, Bind, Corrode, Fracture, Icebox, Lotus, Summit, Sunset, and Bind and Corrode in traditional Chinese) and the modes in English, French, Spanish/Portuguese and Chinese.

Two streams are linked as the same match when their team comps share at least three agents on each side (same sides, or swapped for opponents), their scores agree (the later picture may be a round or two on), and no team seen in full on both differs. Without both scores, the comps must be almost identical. On 1,009 live previews in eight captures this linked six pairs, all checked by eye: four duos and two pairs of opponents.

On the VALORANT directory every loaded card is read, so the filter knows about all of them. On other pages only cards on screen are read. Results are kept until you close the browser.

## Accuracy

Tested on 321 previews of 109 live streams, checked by hand:

- In 181 previews where the streamer is alive and the ability bar is visible, their agent was named correctly in 98%, and never wrongly.
- 33 previews showed a dead streamer watching a teammate (about one in six in-match previews). 29 were recognised as spectating, and none is taken as the streamer's own agent any more: the one that slipped through before is now only a "maybe", as it shows the combat report.
- 22 of the 181 own-agent previews were taken on a death screen or under a round result. They show as **Agent?** until confirmed; the other 156 count straight away.
- On 107 previews with no ability bar (menus, agent select, Deathmatch, other games, overlays), no agent was named. 47 of them get a pill saying why (25 menus, 7 agent select, 12 dead, 2 round over, 1 buy phase).
- On 406 more previews taken later and not used for tuning, every menu (32) and agent select (8) pill was right, and no screen was flagged on any of the 268 previews with an agent.
- Round scores are read on about three in four previews where they're visible, and none was read wrongly.
- Team portraits: the streamer's own agent was found on their team in 139 of 177 previews, about seven of the ten portraits are read per picture, and the picks checked by eye were right. A team never gets the same agent twice (a repeat drops both readings).
- Official broadcasts: 21 of 2,616 previews were recognised as one; all were Riot's broadcasts or a watch party showing one.
- Map and mode: tested leave-one-out on 22 agent select screens: 34 right, none wrong, 4 not read.

When a picture shows no ability bar (the streamer is dead, the round just ended, a menu), Agent Lens reads the picture of another image size, which was taken at a different moment, and looks again a minute later. Streams without a visible ability bar in any picture get the screen pill if one was recognised, otherwise nothing, until a later preview shows the bar.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder, the one that contains `manifest.json`.
4. Open or refresh Twitch and go to the VALORANT category.

## Settings

In the toolbar popup:

- **Agent on stream cards**, **Round score** and **Agents in the sidebar** turn those parts on or off.
- **Sharper previews** (on by default) adds a full-HD picture (about 250 KB) when the 1280×720 one (about 130 KB) didn't show a score or a clear agent. Turn it off to use 1280×720 and 1152×648 pictures only.
- **Read streams with at least…** (All streams, 10+, 25+, 50+, 100+ or 250+ viewers; also **Min. viewers** in the directory bar): smaller streams get no badge and aren't downloaded at all. Handy on a big directory or a slow connection; the bar says how many were skipped.

## Privacy and permissions

- **Storage:** your settings, agents and filter, in this browser.
- **Access to `static-cdn.jtvnw.net/previews-ttv/`:** downloads the public preview pictures of VALORANT streams you can see. Requests carry no cookies and no referrer.
- **Twitch pages:** adds the badges, sidebar pictures and filter to `https://www.twitch.tv/`.
- **`wasm-unsafe-eval`** in the content security policy: lets the extension run its own bundled WebAssembly file (`data/kernel.wasm`, built from `tools/kernel.wat`). No code is loaded from anywhere else.

Nothing is sent anywhere else: no analytics, accounts or servers. No extension file is exposed to web pages. See `PRIVACY.md`.

## New agents

When Riot releases an agent, its icons need to be added before Agent Lens can recognise it. Run `python3 tools/build-agent-data.py` from the source folder and reload the extension. New maps or translations at agent select are added by saving an example box in `tools/state-refs/select-boxes/` (with its label in `labels.json`) and running `node tools/build-words.cjs`.

## Languages

English, Dutch, German, Spanish and Brazilian Portuguese, following your browser's language. Agent names stay as in the game.

---

Agent Lens isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Agent Lens is not affiliated with Twitch. The Inter typeface is used under the SIL Open Font License (`fonts/Inter-OFL.txt`).
