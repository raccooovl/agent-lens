# Agent Lens privacy

Agent Lens sends no data to its developer or to any server. It has no analytics, tracking, advertising or remote code.

**What it reads.** On `https://www.twitch.tv/` pages, it reads which live VALORANT streams are shown (channel name and category) and, in the sidebar, which followed channels are playing VALORANT.

**What it downloads.** For those streams, it downloads the public preview picture Twitch publishes for every live stream, from Twitch's image server (`static-cdn.jtvnw.net/previews-ttv/`). These requests carry no cookies and no referrer. The picture is analysed on your computer to find the agent and round score, then discarded.

**What it stores.** In `chrome.storage.local`: your settings, the agents you picked and your directory filter. In `chrome.storage.session`, cleared when the browser closes: the agent and score found for each stream, with the time it was read. It never stores your browsing history, follows, chat, account details or the pictures themselves.

**Permissions.** Storage; access to Twitch's preview pictures; and a content script on `https://www.twitch.tv/*`. No extension file is exposed to web pages.

Uninstalling Agent Lens removes everything it stored.
