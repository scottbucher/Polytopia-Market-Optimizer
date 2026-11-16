# Market Planner for The Battle of Polytopia

Finds where to put your markets, sawmills, windmills, forges and their support buildings for the most stars, and gives you a turn-by-turn build order.

It runs entirely in your browser. Nothing is uploaded.

## What it does

- **Load your game without spoilers.** Open your `.state` save file. The planner keeps only the tiles you have explored, and hides crops until you have Organization (or Farming, for Zebasi) and metal until you have Climbing, just like the game does. Water crops are only shown to Aquarion.
- **Enemy units.** A unit of another player standing on one of your tiles stops you building, destroying or changing the terrain there, so the plan leaves that tile alone (its building still earns). Cloaks and other hidden units are never shown. Load your save again once they move.
- **Or draw your map.** Paint terrain, crops, metal, buildings, cities, territory and enemy units by hand.
- **Screenshot import (best effort).** Put a screenshot under the map, line up the grid, paint a few tiles of each terrain, and the planner guesses the rest from the screenshot's colours.
- **Pick a goal:**
  - *Most market income*: the highest stars per turn, at the lowest cost for that income.
  - *Reach an income*: get to X★ per turn from markets by turn N, as early as possible.
  - *Save up stars*: have X★ on hand on turn N, investing only where it pays off in time.
  - *Best return by a turn*: the most stars on hand on turn N.

  Deadlines are game turns: the turn number comes from your save (or **Turn now**), so loading a newer save of the same game keeps the deadline. Stars on turn N are counted after that turn's income and before you spend: the game pays income at the start of your turn, so a save made mid-turn already includes this turn's. Your goal and the numbers you typed are remembered across reloads.
- **City upgrades.** The plan follows each city's population: when its farms, huts, mines and producers fill a city, the city levels up right then and the build order says which reward to take (always the economic one). The +5★ from Resources and the stars per turn from levels, Workshops and Parks count toward *Save up stars* and *Best return*. City levels come from your save; for a hand-drawn map, set them under **Cities**.
- **Tech-aware costs.** Mark the techs you own. Tech cost is tier × cities + 4 (about a third less with Philosophy), so the plan knows whether buying Construction for windmills is worth it, and buys Philosophy first when the discount pays for it.
- **Build order.** Every plan comes with a TODO list: what to research and build, on which turn, with the stars you'll have and the market income after each step. Steps are numbered on the map.

## Where is my save file?

Browsers can't open a folder by its path, so **Load game save** shows the folder for your computer with a **Copy path** button. Paste it into the file dialog.

| Platform | Folder |
| --- | --- |
| Windows (Steam) | `%USERPROFILE%\AppData\LocalLow\Midjiwan\Polytopia\<account id>\Data\Singleplayer\` |
| Mac (Steam) | `~/Library/Application Support/<Polytopia folder>/<account id>/Data/Singleplayer/` |
| Linux (Steam) | `~/.config/unity3d/Midjiwan/Polytopia/<account id>/Data/Singleplayer/` |
| Linux (Steam with Proton) | `~/.local/share/Steam/steamapps/compatdata/874390/pfx/drive_c/users/steamuser/AppData/LocalLow/Midjiwan/Polytopia/<account id>/Data/Singleplayer/` |
| Phone or tablet | Can't be reached: the app keeps its saves where browsers (and you) can't get at them. |

- **Windows:** paste `%USERPROFILE%\AppData\LocalLow\Midjiwan\Polytopia` into the address bar of the file dialog; the `%USERPROFILE%` part fills itself in.
- **Mac:** the Library folder is hidden. In the file dialog press <kbd>⇧⌘G</kbd> (Go to folder) and paste `~/Library/Application Support`. The game's folder there is named after Midjiwan or Polytopia (Unity names it after the app's bundle id; we haven't been able to check the exact name). If you can't find it, `find ~/Library -name '*.state' -path '*Singleplayer*'` in Terminal lists the saves.
- **Linux:** the folders are hidden. In the file dialog press <kbd>Ctrl</kbd>+<kbd>L</kbd> and paste the path. If your Steam library is somewhere else, `compatdata` is in that library's `steamapps` folder.

Each game is one `<game id>.state` file. Copy it somewhere first if you want to keep it, since the game deletes it when the game ends.

### Keeping in sync

After you load a save, a bar above the map shows when it was read, with a **Refresh** button that reads it again. A refresh of the same game takes stars, techs, the map and cities from the save but keeps what the save doesn't know: your goal, city names you typed, what the plan may do, rules and costs, and your correction to "Income per turn". Changes you painted on the map are replaced by the save's. If a plan is showing, it is marked out of date; press **Solve again** when you want a new one.

- **Chrome and Edge on Windows** can keep hold of the save: choose the **Singleplayer folder** (or the `Polytopia` folder above it) and the planner follows the game you're playing, including new games. It never reads the Multiplayer folder (load a multiplayer save as one file). **Keep up to date** reads the save by itself whenever the game writes it (it checks every few seconds while the tab is showing). After you reload the page, one click on **Reconnect** picks it up again.
- **Firefox and Safari**, and Chrome on Mac or Linux: **Refresh** opens the file dialog again (it opens in the same folder). Auto-update isn't possible there: Firefox and Safari can't read a file again after it changes, and Chrome doesn't let pages read app data folders on Mac (`~/Library`) or Linux (`~/.config`, `~/.local/share`).

## Rules used

Defaults come from the game's own logic data, and you can change all of them in **Rules and costs**:

- A market earns 1★ per level of each adjacent sawmill, windmill or forge, up to 8.
- A sawmill / windmill / forge gets one level per adjacent lumber hut / farm / mine.
- Each city can have one market, sawmill, windmill and forge.
- Market, sawmill, windmill, forge, farm and mine cost 5★. A lumber hut costs 3★.
- Clearing a forest gives 1★ back (Forestry). Burning a forest costs 3★ and leaves a field with crops (Construction). Growing a forest costs 5★ (Spiritualism).
- You can't build, destroy, or clear, burn or grow forest on a tile with an enemy unit on it. The planner treats every other player's visible unit this way, allies included.
- Polaris and Cymanti don't build markets, so the planner doesn't apply to them. Elyrion can't clear or burn forest.

City growth:

| | Population |
| --- | --- |
| Farm, mine, aquafarm | +2 |
| Lumber hut | +1 |
| Sawmill, windmill | +1 per level |
| Forge | +2 per level |
| Market | none |

- A city at level L levels up when its population reaches L + 1; extra population carries over. Each level adds 1★ per turn by itself.
- The economic reward at each level: level 2 Workshop (+1★ per turn, instead of an Explorer), level 3 Resources (+5★ at once, instead of a City wall), level 4 Population growth (+3 population, which can level the city again, instead of Border growth), level 5 and up Park (+1★ per turn, instead of a super unit).
- A city's income is its level, plus 1 per Workshop and Park, plus 1 for the capital. In a save, a city's `population` is the progress toward the next level and `production` is 1 + its Workshops and Parks.
- Destroying a building takes its population away again (a hut next to a sawmill also takes the sawmill's level). A city never loses a level: its population goes below zero (red pips in the game), and each point below zero costs 1★ per turn of that city's income, down to nothing. The planner counts this in the build order and in "Income per turn" from a save.

Population numbers come from the game's logic data. The level rewards are not in that data: they come from the game itself, checked against a real save (each city's stars and population pips, and the +★ total). The rules for destroying come from the [wiki](https://polytopia.fandom.com/wiki/Population) and haven't been checked against a save yet.

Not modelled:

- City level-ups are only partly modelled. The search picks layouts by market income alone, so it never adds a building just to level a city up; level-ups are counted when the build order is ordered and simulated (steps that level a city up go earlier, and bank goals credit the rewards). Turn the rewards off with "count city upgrade rewards" if you'd rather take the other choices.
- Aquarion's Fertilize (turning wetland into crops).
- The non-market part of your income is a starting estimate when loading a save (each city's level plus its Workshops and Parks, plus 1 for the capital, less any population below zero). A city with an enemy unit in it is counted in full, though it may make nothing while it is occupied. Check "Income per turn" against the game.
- Temples, ports and other buildings are never torn down to make room.

## How the optimizer works

1. **Exact per city.** For every set of techs worth buying, it tries every market tile in each city, every placement of that city's sawmill, windmill and forge around it, and the cheapest support buildings for each income level. Then it combines cities with a knapsack so tech costs are shared.
2. **Across city borders.** It then scores those plans on the real map, where one city's sawmill can feed a neighbouring city's market, and improves the best ones with a local search: one- and two-tile changes, market + producer + support placed together across a border, and switching a group of producers to another kind. Every layout found is pruned of buildings that add nothing, and the best ones are peeled down one building at a time to fill in the cheaper income levels.
3. **Build order.** It orders the steps greedily by payback (income gained per star spent, with techs shared across everything they unlock, and a city level-up's reward counted in), respecting what the game requires (techs first, terrain actions before building, a sawmill next to a lumber hut, the old market torn down before the new one), then simulates turn by turn with your stars, income and city growth.

A small empire takes a second or two and a mid-sized one a few seconds. Very large ones (10 or more cities that share borders) can take half a minute or more.

Tests check the optimizer against exhaustive search on small maps. On single cities it is exact; across city borders the local search can, rarely, miss a layout that needs several buildings moved at once (the tests allow 2 misses in 18 random two-city maps).

Game rules live in one table in `src/data/rules.ts` (buildings, terrain actions, techs, tribes), so a balance patch is usually a one-line change there or in **Rules and costs**.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static site in dist/
```

Pushing to `master` runs the tests and deploys to GitHub Pages (turn Pages on under **Settings → Pages → Source: GitHub Actions**).

To test with your own save, copy it to `test/fixtures/game.state` (`*.state` files are git-ignored).

## Credits

Save file reading is ported from [polytopiamapmodelgo](https://github.com/samuelyuan/polytopiamapmodelgo) by Samuel Yuan (MIT). Fan-made, not affiliated with Midjiwan.
