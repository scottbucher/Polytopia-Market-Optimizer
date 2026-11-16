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

| Platform | Folder |
| --- | --- |
| Windows (Steam) | `%USERPROFILE%\AppData\LocalLow\Midjiwan\Polytopia\<account id>\Data\Singleplayer\` |

Each game is one `<id>.state` file. Copy it somewhere first if you want to keep it, since the game deletes it when the game ends.

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
- A city's income is its level, plus 1 per Workshop and Park, plus 1 for the capital. In a save, a city's `production` is 1 + its Workshops and Parks, and `population` is the progress toward the next level.

Population numbers come from the game's logic data. The level rewards are not in that data: they come from the game itself, checked against a real save (each city's stars and population pips, and the +★ total).

Not modelled:

- City level-ups are only partly modelled. The search picks layouts by market income alone, so it never adds a building just to level a city up; level-ups are counted when the build order is ordered and simulated (steps that level a city up go earlier, and bank goals credit the rewards). Population lost when a building is destroyed isn't counted. Turn the rewards off with "count city upgrade rewards" if you'd rather take the other choices.
- Aquarion's Fertilize (turning wetland into crops).
- The non-market part of your income is a starting estimate when loading a save (each city's level plus its Workshops and Parks, plus 1 for the capital). Check "Income per turn" against the game.
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
