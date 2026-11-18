import {
  Deck,
  LinearInterpolator,
  OrthographicController,
  OrthographicView,
  type OrthographicViewState,
} from '@deck.gl/core';
import { LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import {
  CollisionFilterExtension,
  DataFilterExtension,
  type CollisionFilterExtensionProps,
  type DataFilterExtensionProps,
} from '@deck.gl/extensions';
import { dotScale, labelMatches, MAP_SIZE, sparseScale, type TopicLabel } from './map';
import type { MapTheme } from './theme';

/**
 * The map itself, in WebGL (deck.gl): acceptodds' `MapCanvas`, without React. Draws what it is given and reports
 * hovers and clicks; it fetches nothing and knows nothing about papers. `update` takes any of its inputs and redraws.
 */

export type LabelMode = 'auto' | 'region' | 'cluster' | 'off';

export interface CanvasInput {
  /** Interleaved x, y in `[0, MAP_SIZE]`. */
  positions: Float32Array;
  /** RGBA per point. */
  colours: Uint8Array;
  /** 1 per point drawn, 0 per point hidden (neither drawn nor pickable); `null` draws every point. */
  shown: Float32Array | null;
  regions: TopicLabel[];
  clusters: TopicLabel[];
  labelMode: LabelMode;
  selected: number | null;
  /** Lines go from the selected point to these. */
  neighbours: number[];
  /** A search's words (`labelTerms`): topic labels holding one are lit. */
  highlight: readonly string[];
  theme: MapTheme;
}

export interface CanvasOptions {
  /** A dot's radius in pixels at the opening view: small for the whole map, bigger for a piece of it. */
  dotRadius?: number;
  /** The other papers' opacity while one is selected. */
  dimmed?: number;
  /** In a frame on a page that scrolls: the wheel scrolls the page, and zooms only with ⌘ or Ctrl. */
  embedded?: boolean;
  onHover: (hover: { index: number; x: number; y: number } | null) => void;
  onSelect: (index: number | null) => void;
  /** A paper clicked with ⌘ or Ctrl held, as a link would open in a new tab; without it, such a click selects. */
  onOpen?: (index: number) => void;
}

/** Below this zoom (past the opening view) `auto` labels regions, above it clusters. */
const CLUSTER_LABELS_FROM = 1;
/**
 * The labels' SDF atlas. deck's `outlineWidth` is a fraction of the glyph's distance field (0–1), and the halo can
 * reach no further than `buffer`: the field is wide enough here (`radius`) for the halo below.
 */
const LABEL_FONT = { sdf: true, fontSize: 96, buffer: 32, radius: 48, smoothing: 0.2 };
/** The halo round a label, so it reads over dense dots (about 2.5px at label sizes). */
const LABEL_HALO = 0.45;
/** Label sizes in pixels: a region's a size larger than a cluster's. */
const REGION_LABEL_PX = 15;
const CLUSTER_LABEL_PX = 14;
/** A label the search names: this much bigger, and a ~4px halo. */
const LIT_LABEL_EXTRA_PX = 2;
const LIT_LABEL_HALO = 0.7;
const SERIF = 'Georgia, "Times New Roman", serif';
/** How far the view may drift from where it opened before "Reset view" shows: a fraction of a pixel. */
const HOME_TOLERANCE = 0.5;
/** Dots on the whole map are this much smaller in a narrow frame, where the papers sit closer together. */
const NARROW_DOTS = 0.6;
const FILTER = new DataFilterExtension({ filterSize: 1 });
const COLLISIONS = new CollisionFilterExtension();

/**
 * deck's controller, except that a drag always pans. Its own turns a drag with ⌘, Ctrl, Alt or Shift held into a
 * rotation, which a flat view cannot do, and a touch pinch ends at the fingers (its inertia froze repeated pinches).
 */
export class PanController extends OrthographicController {
  isFunctionKeyPressed(event: Parameters<OrthographicController['isFunctionKeyPressed']>[0]): boolean {
    return event.type === 'panstart' ? false : super.isFunctionKeyPressed(event);
  }

  protected _onPinchEnd(event: Parameters<OrthographicController['_onPinchEnd']>[0]): boolean {
    if (event.pointerType !== 'touch') return super._onPinchEnd(event);
    const inertia = this.inertia;
    this.inertia = 0;
    try {
      return super._onPinchEnd(event);
    } finally {
      this.inertia = inertia;
    }
  }
}

/** Embedded in a page that scrolls, on a touch screen one finger scrolls the page and two pan and zoom. */
export class EmbeddedController extends PanController {
  protected _onPanStart(event: Parameters<PanController['_onPanStart']>[0]): boolean {
    return event.pointerType === 'touch' ? false : super._onPanStart(event);
  }
}

type Rgba = [number, number, number, number];

export class MapCanvas {
  private deck: Deck<OrthographicView>;
  private input: CanvasInput | null = null;
  private opening = 0;
  private zoom = 0;
  private closeUp = false;
  private readonly narrow: boolean;
  private readonly resetButton: HTMLButtonElement;
  private readonly box: HTMLDivElement;
  private cleanup: (() => void)[] = [];
  /** Stable while the points, colours and filter are: a new data object makes deck rebuild its attributes. */
  private paperData: { key: unknown[]; data: object } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly options: CanvasOptions,
  ) {
    this.narrow = matchMedia('(max-width: 720px)').matches;
    this.box = document.createElement('div');
    this.box.className = 'canvas';
    this.resetButton = document.createElement('button');
    this.resetButton.type = 'button';
    this.resetButton.className = 'float reset';
    this.resetButton.textContent = 'Reset view';
    this.resetButton.hidden = true;
    this.resetButton.addEventListener('click', () => this.reset());
    parent.append(this.box, this.resetButton);

    const box = this.box;
    this.opening = Math.log2((Math.min(box.clientWidth || 300, box.clientHeight || 300) / MAP_SIZE) * 0.95);
    this.zoom = this.opening;
    const embedded = options.embedded ?? false;
    this.deck = new Deck<OrthographicView>({
      parent: box,
      views: new OrthographicView({ flipY: false }),
      initialViewState: homeView(this.opening),
      useDevicePixels: matchMedia('(pointer: coarse)').matches ? Math.min(devicePixelRatio, 2) : true,
      controller: { type: embedded ? EmbeddedController : PanController, doubleClickZoom: true, inertia: true },
      touchAction: embedded ? 'pan-x pan-y' : 'none',
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      onViewStateChange: ({ viewState }) => {
        const view = viewState as OrthographicViewState;
        const zoom = view.zoom as number;
        const closeUp = zoom - this.opening >= CLUSTER_LABELS_FROM;
        const changed = zoom !== this.zoom || closeUp !== this.closeUp;
        this.zoom = zoom;
        this.closeUp = closeUp;
        this.resetButton.hidden = !awayFromHome(view, this.opening, box);
        if (changed) this.render();
      },
      onClick: (info) => {
        if (!info.picked) this.options.onSelect(null);
      },
    });

    // Embedded, the wheel scrolls the page and zooms only with ⌘ or Ctrl held (a trackpad pinch arrives as
    // Ctrl + wheel), as an embedded Google map does: a plain wheel is stopped before deck's listener, not prevented.
    if (embedded) {
      const onWheel = (e: WheelEvent) => {
        if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
      };
      box.addEventListener('wheel', onWheel, { capture: true });
      this.cleanup.push(() => box.removeEventListener('wheel', onWheel, { capture: true }));
    }
  }

  update(next: Partial<CanvasInput>) {
    this.input = { ...(this.input as CanvasInput), ...next };
    this.render();
  }

  /** Fly to a point, closer in. */
  focus(index: number) {
    const at = this.input?.positions;
    if (!at) return;
    this.deck.setProps({
      initialViewState: {
        target: [at[2 * index], at[2 * index + 1], 0],
        zoom: Math.max(this.zoom, this.opening + 3),
        minZoom: this.opening - 1,
        maxZoom: this.opening + 9,
        transitionDuration: reducedMotion() ? 0 : 600,
        transitionInterpolator: new LinearInterpolator(['target', 'zoom']),
      },
    });
  }

  reset() {
    this.deck.setProps({
      initialViewState: {
        ...homeView(this.opening),
        transitionDuration: reducedMotion() ? 0 : 400,
        transitionInterpolator: new LinearInterpolator(['target', 'zoom']),
      },
    });
  }

  destroy() {
    this.cleanup.forEach((f) => f());
    this.deck.finalize();
    this.box.remove();
    this.resetButton.remove();
  }

  private render() {
    const input = this.input;
    if (!input?.positions || !input.colours || !input.theme) return;
    const { positions, colours, shown, selected, neighbours, theme, labelMode, regions, clusters } = input;
    const { dotRadius = 1.6, dimmed: dimmedOpacity = 0.2, embedded = false } = this.options;
    const n = positions.length / 2;
    const ink: Rgba = [...theme.ink, 255];
    const halo: Rgba = [...theme.bg, 255];
    const accent = theme.accent;

    if (!this.paperData || this.paperData.key.some((k, i) => k !== [positions, colours, shown][i])) {
      this.paperData = {
        key: [positions, colours, shown],
        data: {
          length: n,
          attributes: {
            getPosition: { value: positions, size: 2 },
            getFillColor: { value: colours, size: 4 },
            getFilterValue: { value: shown ?? new Float32Array(n).fill(1), size: 1 },
          },
        },
      };
    }
    let shownCount = n;
    if (shown) {
      shownCount = 0;
      for (let i = 0; i < n; i++) shownCount += shown[i];
    }

    const level = labelMode === 'auto' ? (this.closeUp ? 'cluster' : 'region') : labelMode;
    const topics = level === 'region' ? regions : level === 'cluster' ? clusters : [];
    // The labels the search names, regions and clusters alike, shown at every zoom whatever the level.
    const lit =
      input.highlight.length === 0 || labelMode === 'off'
        ? []
        : [...regions, ...clusters].filter((t) => labelMatches(t.text, input.highlight));
    const litSet = new Set(lit);
    const regionSet = new Set(regions);
    // The level's other labels; in a narrow frame three quarters of them, favouring the largest topics.
    let labels = topics.filter((t) => !litSet.has(t));
    if (this.narrow)
      labels = [...labels].sort((a, b) => b.size - a.size || a.number - b.number).slice(0, Math.round(labels.length * 0.75));
    // The lit labels collide with the rest (invisible, at the top priority) so they clear a space for themselves;
    // they are drawn in a layer of their own, which no collision hides.
    const colliding = [...lit, ...labels];
    const biggest = Math.max(1, ...colliding.map((t) => t.size));

    const radius = this.narrow && !embedded ? dotRadius * NARROW_DOTS : dotRadius;
    // Zoom and sparseness both grow the dots; together never past 8x, or zoomed-in sparse dots swamp the map.
    const scale = Math.min(8, dotScale(this.zoom, this.opening) * sparseScale(shownCount, n));
    const at = (i: number): [number, number] => [positions[2 * i], positions[2 * i + 1]];
    const selection = selected === null ? [] : [...neighbours, selected];
    const click = (index: number, e: unknown) => {
      if (this.options.onOpen && e instanceof MouseEvent && (e.metaKey || e.ctrlKey)) this.options.onOpen(index);
      else this.options.onSelect(index);
    };
    const labelSize = (d: TopicLabel) => (regionSet.has(d) ? REGION_LABEL_PX : CLUSTER_LABEL_PX);

    const layers = [
      new ScatterplotLayer<unknown, DataFilterExtensionProps>({
        id: 'papers',
        data: this.paperData.data as never,
        // Always on the layer, so turning the filter on and off never rebuilds it.
        extensions: [FILTER],
        filterEnabled: shown !== null,
        filterRange: [0.5, 1],
        radiusUnits: 'pixels',
        getRadius: radius,
        radiusScale: scale,
        radiusMinPixels: 1,
        opacity: selected !== null ? dimmedOpacity : 1,
        pickable: true,
        onHover: ({ index, x, y }) => this.options.onHover(index >= 0 ? { index, x, y } : null),
        onClick: ({ index }, event) => click(index, event.srcEvent),
      }),
      selected !== null &&
        new LineLayer<number>({
          id: 'neighbour-lines',
          data: neighbours,
          getSourcePosition: () => at(selected),
          getTargetPosition: (j) => at(j),
          getColor: [...accent, 140],
          getWidth: 1.2,
          updateTriggers: { getSourcePosition: [positions, selected], getTargetPosition: positions },
        }),
      selected !== null &&
        new ScatterplotLayer<number>({
          id: 'selection',
          data: selection,
          getPosition: (j) => at(j),
          getFillColor: (j) =>
            j === selected ? [...accent, 255] : [colours[4 * j], colours[4 * j + 1], colours[4 * j + 2], 255],
          getLineColor: theme.dark ? [20, 20, 20, 255] : [255, 255, 255, 255],
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          radiusUnits: 'pixels',
          getRadius: (j) => (j === selected ? 5 : 3.5),
          radiusScale: Math.sqrt(scale),
          pickable: true,
          onHover: ({ object, x, y }) => this.options.onHover(object !== undefined ? { index: object, x, y } : null),
          onClick: ({ object }, event) =>
            object === undefined ? this.options.onSelect(null) : click(object, event.srcEvent),
          updateTriggers: {
            getPosition: positions,
            getFillColor: [selected, colours, accent],
            getRadius: selected,
            getLineColor: theme.dark,
          },
        }),
      colliding.length > 0 &&
        new TextLayer<TopicLabel, CollisionFilterExtensionProps<TopicLabel>>({
          id: `labels-${level}`,
          data: colliding,
          getPosition: (d) => [d.x, d.y],
          getText: (d) => d.text,
          // A lit label's invisible copy at its drawn size, so it clears all the room it takes.
          getSize: (d) => labelSize(d) + (litSet.has(d) ? LIT_LABEL_EXTRA_PX : 0),
          getColor: (d) => (litSet.has(d) ? [0, 0, 0, 0] : ink),
          fontFamily: SERIF,
          fontWeight: 'bold',
          characterSet: 'auto',
          // A halo in the page's colour, not a box: dots stay visible round the letters.
          fontSettings: LABEL_FONT,
          outlineWidth: LABEL_HALO,
          outlineColor: halo,
          extensions: [COLLISIONS],
          // deck takes -1000..1000: a label the search names wins every collision, then the bigger topic.
          getCollisionPriority: (d) => (litSet.has(d) ? 500 : -500) + (499 * d.size) / biggest,
          updateTriggers: {
            getColor: [lit, ink.join()],
            getSize: [regions, lit],
            getCollisionPriority: [lit, biggest],
          },
        }),
      lit.length > 0 &&
        new TextLayer<TopicLabel>({
          id: 'labels-lit',
          data: lit,
          getPosition: (d) => [d.x, d.y],
          getText: (d) => d.text,
          getSize: (d) => labelSize(d) + LIT_LABEL_EXTRA_PX,
          getColor: [...theme.lit, 255],
          fontFamily: SERIF,
          fontWeight: 'bold',
          characterSet: 'auto',
          fontSettings: LABEL_FONT,
          outlineWidth: LIT_LABEL_HALO,
          outlineColor: halo,
          updateTriggers: { getSize: regions },
        }),
    ];
    this.deck.setProps({ layers });
  }
}

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Where the map opens: the whole of it, centred. */
function homeView(opening: number): OrthographicViewState {
  return { target: [MAP_SIZE / 2, MAP_SIZE / 2, 0], zoom: opening, minZoom: opening - 1, maxZoom: opening + 9 };
}

/** Whether the view has been panned or zoomed off where it opened, by more than a fraction of a pixel. */
function awayFromHome(view: OrthographicViewState, opening: number, el: HTMLElement): boolean {
  const zoom = view.zoom as number;
  const [x, y] = view.target as number[];
  const pixels = 2 ** zoom * Math.hypot(x - MAP_SIZE / 2, y - MAP_SIZE / 2);
  const grown = Math.abs(2 ** (zoom - opening) - 1) * Math.min(el.clientWidth, el.clientHeight);
  return pixels > HOME_TOLERANCE || grown > HOME_TOLERANCE;
}
