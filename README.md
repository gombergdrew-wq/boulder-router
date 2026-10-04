# Boulder Approach Router

Static web app (no backend) that plans low-elevation-change hiking approaches between two points through a set of boulders, never crossing terrain steeper than a limit you set, and scores uploaded KML/KMZ/GPX routes against the optimized alternative.

## How it works
- **Terrain:** elevation tiles from AWS Terrain Tiles (Terrarium PNG, public, CORS-enabled) are stitched into a grid (~4–15 m cells, picked from the area size).
- **Cliff avoidance:** slope is computed on a ~15 m baseline. Cells above *Max slope* are blocked, then grown by the *Safety margin*. Routes can't cross blocked cells or take any single step above the limit.
- **Optimization:** 16-direction least-cost search (Dijkstra/A*) in a Web Worker. Cost = distance × steepness penalty + *Elevation-change penalty* × (climb + descent). Boulder visiting order is solved exactly (≤ 9 boulders) or by nearest-neighbour + 2-opt.
- **Scoring a KML:** the line is resampled on the same grid and measured with the same cost model, then compared against the optimizer run between the line's endpoints (and any Point placemarks as boulder stops).

## Run locally
```
python3 -m http.server 8765
```
then open http://localhost:8765 (the worker needs http, not file://).

## Deploy to GitHub Pages
Push this folder to a repo, then Settings → Pages → Deploy from branch → `main` / root.

## Limits
Elevation data can't see small cliffs, ledges, or boulder-field scrambles. This is a planning aid, so scout the approach.

**Search area:** worldwide, but the grid is capped at 1500×1500 cells. Within ~5 km (at 40° latitude) cells are ~3.7 m; to ~11 km ~7 m; to ~22 km ~15 m (padding included, so about 13 km between the farthest points). Beyond that it's rejected. Data quality varies: US lidar/10 m DEM is best, much of the world is 30 m.
