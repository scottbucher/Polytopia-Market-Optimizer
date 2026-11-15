# Market Planner for The Battle of Polytopia

Finds where to put your markets, sawmills, windmills, forges and their support buildings for the most stars, and gives you a turn-by-turn build order.

It runs entirely in your browser. Nothing is uploaded.

## What it does

- **Load your game without spoilers.** Open your `.state` save file. The planner keeps only the tiles you have explored, and hides crops until you have Organization and metal until you have Climbing, just like the game does.
- **Or draw your map.** Paint terrain, crops, metal, buildings, cities and territory by hand.
- **Screenshot import (best effort).** Put a screenshot under the map, line up the grid, paint a few tiles of each terrain, and the planner guesses the rest from the screenshot's colours.
- **Pick a goal:**
  - *Most market income*: the highest stars per turn, at the lowest cost for that income.
  - *Reach an income*: get to X★ per turn from markets within N turns, as early as possible.
  - *Save up stars*: have X★ on hand by turn N, investing only where it pays off in time.
  - *Best return by a turn*: the most stars on hand by turn N.
- **Tech-aware costs.** Mark the techs you own. Tech cost is tier × cities + 4 (about a third less with Philosophy), so the plan knows whether buying Construction for windmills is worth it.
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
- Polaris and Cymanti don't build markets, so the planner doesn't apply to them. Elyrion can't clear or burn forest.

Not modelled: city level-ups and their rewards from the population that farms, huts and mines add.

## How the optimizer works

1. **Exact per city.** For every set of techs worth buying, it tries every market tile in each city, every placement of that city's sawmill, windmill and forge around it, and the cheapest support buildings for each income level. Then it combines cities with a knapsack so tech costs are shared.
2. **Across city borders.** It then scores those plans on the real map, where one city's sawmill can feed a neighbouring city's market, and improves the best ones with a local search over one- and two-tile changes.
3. **Build order.** It orders the steps greedily by payback (income gained per star spent, with techs shared across everything they unlock), then simulates turn by turn with your stars and income.

Tests check the optimizer against exhaustive search on small maps.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static site in dist/
```

Pushing to `main` runs the tests and deploys to GitHub Pages (turn Pages on under **Settings → Pages → Source: GitHub Actions**).

To test with your own save, copy it to `test/fixtures/game.state` (`*.state` files are git-ignored).

## Credits

Save file reading is ported from [polytopiamapmodelgo](https://github.com/samuelyuan/polytopiamapmodelgo) by Samuel Yuan (MIT). Fan-made, not affiliated with Midjiwan.
