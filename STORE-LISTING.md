# Store listing

Everything to fill in on the Chrome Web Store and Edge Add-ons dashboards for Agent Lens. Run `node tools/check-listing.cjs` after editing this file; it checks the limits and the Riot notice. The images come from `node tools/store-assets.cjs` (see `store-assets/README.md`).

The links below assume a public repo at `github.com/raccooovl/agent-lens` with GitHub Pages turned on for its `docs/` folder. If the repo gets another name, change the links here and in `docs/`.

- Homepage / website: https://raccooovl.github.io/agent-lens/
- Support: https://github.com/raccooovl/agent-lens/issues
- Privacy policy: https://raccooovl.github.io/agent-lens/privacy.html

## Fields

| Field | Chrome Web Store | Edge Add-ons |
|---|---|---|
| Name and short summary | From the package (`extName`, `extDescription` in `tools/messages.cjs`), per language. Not editable in the dashboard. | Same, from the package. |
| Detailed description | Per language, below. | Per language, below (250 to 10,000 characters). |
| Search terms | None. | Per language, below (at most 7 terms, 30 characters each, 21 words in total). |
| Category | Entertainment | Entertainment |
| Icon / logo | `extension/icons/icon-128.png` (from the package) | `store-assets/promo/logo-300x300.png`, the same for every language |
| Screenshots (1280x800) | `store-assets/<language>/1-agents.png` to `5-popup.png`, per language | The same files, per language |
| Small promo tile (440x280) | `store-assets/promo/small-tile-440x280.png` | Same file (optional on Edge) |
| Marquee / large tile (1400x560) | `store-assets/promo/marquee-1400x560.png` | Same file (optional) |
| Homepage, support, privacy | The three links above | The three links above; the website must be your own site, not the store page |

Chrome and Edge can't localize the promo tile and marquee, so they're in English with very little text.

Single purpose: show which VALORANT agent Twitch streamers are playing and filter streams by it.

Permission justifications:
- **storage:** keeps the user's settings, chosen agents and filter.
- **Host access to static-cdn.jtvnw.net/previews-ttv/:** downloads the public preview picture of VALORANT streams shown on Twitch, to recognise the agent on the user's computer.
- **Content script on twitch.tv:** shows the agent on stream cards and the sidebar, and adds the filter to the VALORANT directory.
- **Content security policy `wasm-unsafe-eval`:** runs the extension's own bundled WebAssembly file (`data/kernel.wasm`, source in `tools/kernel.wat`) to compare pictures faster. No remote code.

Data use: Agent Lens collects no user data. Tick no data categories and certify the three statements (no selling, no unrelated use, no creditworthiness).

---

## English (en)

### Detailed description

Agent Lens shows which VALORANT agent every Twitch streamer is playing, right on their stream card. Looking for someone to learn your agent from? Pick that agent, and only the streams playing it stay on the page.

• See the agent on every live stream in the category, plus the round score when it's readable.
• Filter the VALORANT directory by role (Duelists, Initiators, Controllers, Sentinels) or by agent, with a count for each.
• Pick the agents you play: their streams get a star and a one-click filter.
• See what your followed channels are playing, right in the sidebar.
• Open the toolbar button on a channel to see their agent and score.
• No agent in sight? The card says why: agent select, in menus, dead, round over, buy phase, deathmatch or a pro match.
• Hover a card for both teams' agents, the map and the mode.
• Skip small streams if you like, to save data. Works with stretched resolutions and most stream layouts.

How it works: Agent Lens reads the ability icons in each stream's public preview picture, on your own computer. No account, no servers, no tracking, and it never touches the game.

How well it works: on 321 previews checked by hand, it named the right agent about 98% of the time when the streamer was alive and the ability bar was visible, and it never named a wrong agent. When it isn't sure, it says so instead of guessing. Spotted a wrong agent? Report it at github.com/raccooovl/agent-lens/issues.

Agent Lens was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Not affiliated with Twitch.

### Edge search terms

- twitch agent filter
- stream agent finder
- twitch stream filter
- fps stream finder
- twitch directory filter
- streamer agent badge
- round score twitch

---

## Nederlands (nl)

### Detailed description

Agent Lens laat zien welke VALORANT-agent elke Twitch-streamer speelt, direct op de streamkaart. Zoek je iemand om je agent van te leren? Kies die agent en je ziet alleen nog streams met die agent.

• Zie de agent op elke livestream in de categorie, plus de rondestand als die leesbaar is.
• Filter de VALORANT-categorie op rol (Duelists, Initiators, Controllers, Sentinels) of op agent, met een telling per agent.
• Kies de agents die jij speelt: hun streams krijgen een ster en een eigen filter.
• Zie in de zijbalk wat de kanalen die je volgt spelen.
• Klik op een kanaal op de knop in de werkbalk om de agent en stand te zien.
• Geen agent te zien? De kaart zegt waarom: agentkeuze, in menu's, dood, ronde voorbij, koopfase, deathmatch of een profwedstrijd.
• Wijs een kaart aan voor de agents van beide teams, de map en de modus.
• Sla kleine streams over als je wilt, om data te sparen. Werkt met uitgerekte resoluties en de meeste stream-indelingen.

Hoe het werkt: Agent Lens leest de vaardigheidsiconen in de openbare preview van elke stream, op je eigen computer. Geen account, geen servers, geen tracking, en het spel zelf blijft onaangeroerd.

Hoe goed het werkt: op 321 met de hand gecontroleerde previews noemde het in ongeveer 98% van de gevallen de juiste agent als de streamer leefde en de vaardighedenbalk zichtbaar was, en nooit een verkeerde agent. Twijfelt het, dan zegt het dat in plaats van te gokken. Een verkeerde agent gezien? Meld het op github.com/raccooovl/agent-lens/issues.

Agent Lens was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Niet gelieerd aan Twitch.

### Edge search terms

- twitch agent filter
- streams filteren op agent
- twitch categorie filter
- fps streams vinden
- streamer agent zien
- rondestand twitch
- twitch extensie fps

---

## Deutsch (de)

### Detailed description

Agent Lens zeigt direkt auf der Stream-Karte, welchen VALORANT-Agenten jeder Twitch-Streamer spielt. Du suchst jemanden, von dem du deinen Agenten lernen kannst? Wähle ihn aus, und es bleiben nur Streams mit diesem Agenten stehen.

• Sieh den Agenten auf jedem Livestream der Kategorie, dazu den Rundenstand, wenn er lesbar ist.
• Filtere die VALORANT-Kategorie nach Rolle (Duellanten, Initiatoren, Controller, Wächter) oder nach Agent, jeweils mit Anzahl.
• Wähle die Agenten, die du spielst: Ihre Streams bekommen einen Stern und einen eigenen Filter.
• Sieh in der Seitenleiste, was deine gefolgten Kanäle spielen.
• Öffne auf einem Kanal die Schaltfläche in der Symbolleiste, um Agent und Stand zu sehen.
• Kein Agent zu sehen? Die Karte sagt, warum: Agentenwahl, im Menü, tot, Runde vorbei, Kaufphase, Deathmatch oder ein Profi-Match.
• Fahr mit der Maus über eine Karte, um die Agenten beider Teams, die Map und den Modus zu sehen.
• Überspring kleine Streams, wenn du willst, um Daten zu sparen. Funktioniert mit gestreckten Auflösungen und den meisten Stream-Layouts.

So funktioniert es: Agent Lens liest die Fähigkeitssymbole im öffentlichen Vorschaubild jedes Streams, auf deinem eigenen PC. Kein Konto, keine Server, kein Tracking, und das Spiel selbst bleibt unberührt.

Wie gut es funktioniert: Bei 321 von Hand geprüften Vorschaubildern nannte es in etwa 98 % der Fälle den richtigen Agenten, wenn der Streamer am Leben und die Fähigkeitenleiste sichtbar war, und nie einen falschen. Ist es sich nicht sicher, sagt es das, statt zu raten. Einen falschen Agenten entdeckt? Melde ihn auf github.com/raccooovl/agent-lens/issues.

Agent Lens was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Keine Verbindung zu Twitch.

### Edge search terms

- twitch agent filter
- streams nach agent filtern
- twitch kategorie filter
- fps streams finden
- streamer agent anzeigen
- rundenstand twitch
- twitch erweiterung fps

---

## Español (es)

### Detailed description

Agent Lens muestra qué agente de VALORANT juega cada streamer de Twitch, directamente en su tarjeta. ¿Buscas a alguien de quien aprender tu agente? Elígelo y solo quedarán los streams que lo están jugando.

• Mira el agente en cada stream en directo de la categoría, y el marcador de rondas cuando se puede leer.
• Filtra la categoría VALORANT por rol (Duelistas, Iniciadores, Controladores, Centinelas) o por agente, con el número de cada uno.
• Elige los agentes que juegas: sus streams tendrán una estrella y su propio filtro.
• Mira en la barra lateral a qué juegan los canales que sigues.
• Abre el botón de la barra de herramientas en un canal para ver su agente y marcador.
• ¿No se ve ningún agente? La tarjeta dice por qué: selección de agente, en menús, muerto, ronda terminada, fase de compra, combate a muerte o un partido profesional.
• Pasa el ratón por una tarjeta para ver los agentes de ambos equipos, el mapa y el modo.
• Omite los streams pequeños si quieres, para ahorrar datos. Funciona con resoluciones estiradas y la mayoría de diseños de stream.

Cómo funciona: Agent Lens lee los iconos de habilidades en la vista previa pública de cada stream, en tu propio ordenador. Sin cuenta, sin servidores, sin rastreo, y nunca toca el juego.

Precisión: en 321 vistas previas revisadas a mano, acertó el agente en torno al 98 % de las veces cuando el streamer estaba vivo y se veía la barra de habilidades, y nunca dio un agente equivocado. Cuando no está seguro, lo dice en vez de adivinar. ¿Has visto un agente equivocado? Avisa en github.com/raccooovl/agent-lens/issues.

Agent Lens was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. No está afiliado a Twitch.

### Edge search terms

- filtro agentes twitch
- streams por agente
- filtro categoría twitch
- buscar streams fps
- agente del streamer
- marcador de rondas
- extensión twitch fps

---

## Português (Brasil) (pt_BR)

### Detailed description

O Agent Lens mostra qual agente de VALORANT cada streamer da Twitch está jogando, direto no card da live. Procurando alguém para aprender o seu agente? Escolha o agente e só ficam as lives em que ele está sendo jogado.

• Veja o agente em cada live da categoria, e o placar de rodadas quando dá para ler.
• Filtre a categoria VALORANT por função (Duelistas, Iniciadores, Controladores, Sentinelas) ou por agente, com a contagem de cada um.
• Escolha os agentes que você joga: as lives deles ganham uma estrela e um filtro próprio.
• Veja na barra lateral o que os canais que você segue estão jogando.
• Abra o botão da barra de ferramentas num canal para ver o agente e o placar.
• Nenhum agente à vista? O card diz por quê: seleção de agente, nos menus, morto, rodada encerrada, fase de compra, mata-mata ou uma partida profissional.
• Passe o mouse num card para ver os agentes dos dois times, o mapa e o modo.
• Pule as lives pequenas se quiser, para economizar dados. Funciona com resoluções esticadas e a maioria dos layouts de live.

Como funciona: o Agent Lens lê os ícones de habilidades na prévia pública de cada live, no seu próprio PC. Sem conta, sem servidores, sem rastreamento, e nunca mexe no jogo.

Precisão: em 321 prévias conferidas à mão, ele acertou o agente em cerca de 98% das vezes quando o streamer estava vivo e a barra de habilidades estava visível, e nunca indicou um agente errado. Quando não tem certeza, ele avisa em vez de chutar. Viu um agente errado? Avise em github.com/raccooovl/agent-lens/issues.

Agent Lens was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Sem afiliação com a Twitch.

### Edge search terms

- filtro agentes twitch
- lives por agente
- filtro categoria twitch
- buscar lives fps
- agente do streamer
- placar de rodadas
- extensão twitch fps
