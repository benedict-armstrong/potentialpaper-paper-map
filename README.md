# Paper map

A [PotentialPaper](https://github.com/PotentialHedge/potentialpaper) plugin: every paper on a map, near the papers
most like it. acceptodds' paper map, drawn from a **signal set** instead of acceptodds' own database, so any set with
the same signals can be mapped.

- **A page of its own**, "Paper map" (`/x/benedict-armstrong/paper-map/map`): the whole window under the site's bar (`"layout": "full"`), every paper in the set, in WebGL
  (deck.gl). Coloured by region or cluster, with a legend (point at a grouping to light its papers); region names
  when zoomed out and cluster names when zoomed in (or always one, or none). Hover a dot for its title and cluster;
  click to select it, which draws lines to its 10 nearest papers by the set's embedding and lists them; click again,
  or ⌘/Ctrl-click, to open the paper. The search box finds titles (words match at the start of a word, `"a phrase"`,
  `-not`): what it finds stays lit, the rest fades, and topic labels it names turn blue. With **redraw** (on by
  default) the rest is hidden and the matches are laid out again among themselves, in a worker (up to 10,000).
  `/map/<paper>` (`/map/openreview%3Aabc`) opens on that paper, selected.
- **A tab on a venue, topic or organisation**: the same map, of that page's papers only ("No papers on this map
  here." when it has none). On a venue it shows only when the venue has submissions.
- **On a paper** (the aside): its minimap, as acceptodds draws it "as on the map". The paper among the 100 papers
  nearest it on the map, framed round it and coloured by cluster, with lines to its 10 nearest papers by embedding
  (the view widens to take them in). Hover names a paper, a click opens it, and "Open the full map" opens the page
  on it. On a paper with no submissions it doesn't show; on one the set doesn't cover it says "This paper isn't on
  the map."

The controls (colour, labels, redraw, shown or hidden) are remembered in the plugin's own `localStorage`.

## The signal set

| Signal        | Kind                      | Used for                                    |
| ------------- | ------------------------- | ------------------------------------------- |
| `map.xy`      | vector, 2 dims            | each paper's place (any units; required)    |
| `map.region`  | label, with titles        | coarse groupings: colour, legend, labels    |
| `map.cluster` | label, with titles        | fine groupings: colour, legend, labels      |
| `embedding`   | vector (cosine)           | nearest papers (`pp.signals.nearest`)       |

The default set is `benedict-armstrong/acceptodds-map` (acceptodds' ICLR 2027 map). A set missing `map.region` or
`map.cluster` still draws, uncoloured; one without `embedding` draws no lines. A label key that is a whole number is
coloured as acceptodds colours that grouping, so the same map looks the same in both.

## Settings

| Setting | Values                    | Default                              |
| ------- | ------------------------- | ------------------------------------ |
| `set`   | a signal set's id         | `benedict-armstrong/acceptodds-map`  |

In `settings.json` it is `benedict-armstrong/paper-map.set`.

## Permissions and data

None: signals are public. The map reads `pp.signals.set` (small: the set's generation and when it changed) and
`pp.signals.columns` for `map.xy`, `map.region` and `map.cluster` with titles, for the whole set or one scope; a
selection or a minimap asks `pp.signals.nearest`. Links to papers go through `pp.ui.openUrl`. No network access of
its own.

The columns are the expensive part (a few MB at 40k papers). Each is kept in the plugin's own IndexedDB, stamped
with the set's generation and last change, so it is fetched again only when the set changes; the map page and the
minimaps share one copy.

## Develop

    npm install
    npm run dev          # rebuilds dist/ on change, serves the repo with CORS on http://localhost:5175/
    npm test             # the map maths, the data, the layout, and each surface in a DOM against a fake host
    npm run typecheck

Then, on your local PotentialPaper (`npm run dev` there), open `/settings/plugins` and load `http://localhost:5175/`
under "Load from localhost".

`dist/` is committed: PotentialPaper serves a plugin's files from the repo at a pinned commit and never builds.
CI fails if `dist/` doesn't match a fresh build, so run `npm run build` and commit `dist/` with your change
(`npm run check` does all of it).

## Release

Bump `version` in `potentialpaper-plugin.json` and `package.json`, build, commit, and tag `v<version>`. Readers who
installed it see "Update" on `/settings/plugins`. The repo carries the `potentialpaper-plugin` topic, so it is listed
under Discover.

## Not ported from acceptodds

- **The minimap's redraw** from the vectors (UMAP over the piece): it needs every drawn paper's embedding, and the
  host has no way to read a signal for a list of papers short of the whole column (64 dims × 40k papers).
- **The server's search**: authors, abstracts and filters (`author:`, `keyword:`). This one searches titles.
- **The selection in the address bar**: a plugin page can't change its own URL, so a selection isn't kept there.
- Odds colouring, prices and "yours" (starred, held): those are acceptodds' markets.

MIT licence.
