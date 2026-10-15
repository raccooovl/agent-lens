# Changes

## 0.3.4

- **Going back to a filtered directory is fast again.** With a filter on, most cards are hidden, so the list stays short and Twitch's "load more" spot at its end stays in view: Twitch kept loading page after page (up to five per scroll) of streams that were then hidden. In one evening that left 1,400 cards on the page, and Twitch rebuilds every one of them when you go back to it, which froze the page for seconds. Now, while a filter is on, loading pauses when more can't help: when the directory is sorted by viewers and the last card is already under your minimum viewers, or after 300 streams. The bar says so, and **Load more** loads another 150.

## 0.3.3

- **No more flicker while filtering.** With a filter on, most cards are hidden, so the list gets short and Twitch keeps loading more cards at the bottom. Those showed for a moment before being hidden. Now, while a filter is on, a card only shows once it's known to match.

## 0.3.2

- The minimum-viewers setting is now also in the VALORANT directory bar ("Min. viewers", top right), next to where its effect shows. It stays in sync with the popup; the bar doesn't redraw while the list is open.

## 0.3.1

- **Minimum viewers.** A new setting in the popup (All streams, 10+, 25+, 50+, 100+, 250+): smaller streams aren't downloaded or read at all, and the directory bar says how many were skipped.
- **Smoother Twitch pages, especially going back and switching categories.** On a 150-card directory the page script's longest pass went from about 110–290 ms to about 25 ms. It no longer reacts to text changes (viewer counts, chat), reads all card styles before changing anything, takes card positions from the browser's visibility events instead of measuring the page, works out same-match groups only when results change, and spaces its passes by how long the last one took.
- **Quick check.** Streams whose agent isn't known get a 640×360 picture first (about 45 KB). Menus, broadcasts and non-game pictures stop there; streams in a match get the usual pictures; agent select goes straight to full HD for the map and mode. About 30% less data for a first look at a directory.
- **Back-off for idle streams.** Streams out of a match are looked at after 1, 2, 4, 8 and then every 15 minutes, with a quick look each time, instead of two big pictures every minute.

## 0.3.0

- **Team comps.** Both teams' agents are read from the portraits at the top of the game display and listed in the badge's tooltip.
- **Streams in the same match are linked.** Streamers in one match, as teammates or opponents, get a link icon and are named in each other's tooltip, and the VALORANT directory gets a **Same match** chip that shows just those streams. Linking needs matching team comps on both sides and agreeing scores; on eight live captures every link it made was right.
- **Map and mode.** Read at agent select (the map's name and Competitive, Unrated or Swiftplay, in several languages), kept for the match, shown in the tooltip and as filter chips. A deathmatch clock marks Deathmatch and Team Deathmatch, and Deathmatch cards get a pill.
- **Pro matches.** Official broadcasts (VCT and other Riot events, and watch parties showing them) get a **Pro match** pill instead of the observed player's agent.
- **Faster.** 1280×720 pictures first (half the data), full HD only for a missing score or an unclear picture. The icon comparisons run in a small WebAssembly kernel, four at a time (about four times faster, same results on all 321 test previews), work buffers are reused, and the screen checks stop at the first clear answer. Streams on screen are read first, nearest first, a stream known to play one of your agents before the rest, and queued work for a closed tab or a page you left is dropped. A first look at a stream now takes about 55 ms instead of 115 ms, while also reading the teams and mode.

## 0.2.0

- **Cards say why there's no agent.** When a preview shows no ability bar, the card names the screen when it recognises it: **Agent select**, **In menus**, **Dead**, **Round over** or **Buy phase**, with the score when readable. Recognised by shape, so any game language works.
- **Death and round-end screens can't put the wrong agent on a card.** The bar seen while the combat report is open or under a round result can be a watched teammate's. It now only confirms the agent already seen, shows as watching a teammate, or shows as a dimmed **Jett?** until a clearer preview settles it. Buy-phase previews still count fully.
- **A finished match is let go.** Back in the menus or at agent select, the previous match's agent is dropped instead of lingering for 45 minutes.
- **About 2.5 times faster, and much lighter on screens without a bar.** A quick look at half detail picks the likely agents and layouts before the full check (same results on all 321 test previews), and only the parts of the picture that are used are copied out of the image. Menus and other screens without a bar went from about half a second to about a tenth.
- A failed preview can no longer stall the ones queued after it.

## 0.1.2

- **Streams caught while the streamer is dead or between rounds now get their agent much sooner.** Twitch keeps a separate preview picture for each image size, each taken at a different moment. When one shows no ability bar (dead, round over, a menu), Agent Lens now looks at another size's picture straight away, and checks again a minute later instead of five. It only downloads pictures it hasn't read yet.
- Round scores and the agent are combined over these pictures in the order they were taken.

## 0.1.1

- **Spectating no longer shows the wrong agent.** After dying, a player watches a teammate, and the game then shows the teammate's abilities. Agent Lens now recognises the teammate's picture that appears bottom-left while spectating. It keeps the streamer's own agent (with an eye icon and "watching a teammate" in the tooltip), or shows **Spectating** if their own agent hasn't been seen yet. The score is still shown.
- The agent shown is now the one seen most often in the current match, since nobody can switch agents mid-match. A single unusual preview can't change it; a new match (the round count going down) starts over.

## 0.1.0

First version.

- Agent badge on live VALORANT stream cards, with the round score when readable (match point and overtime highlighted).
- Role and agent filter on the VALORANT directory, with counts, combined selections and a remembered filter.
- My agents: pick your agents in the popup for a ★ on their streams and a one-click filter.
- Agent pictures on sidebar channels playing VALORANT.
- Toolbar popup: what the stream in the current tab is playing, your agents and display settings.
- Recognises stretched 4:3, 5:4 and 16:10 resolutions and shrunk game pictures. Keeps the agent through menus and between rounds for up to 45 minutes.
- English, Dutch, German, Spanish and Brazilian Portuguese.
