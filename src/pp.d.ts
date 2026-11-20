/**
 * Types for the PotentialPaper plugin SDK, API version 1 (https://ppusercontent.com/sdk/v1/pp.js). Copy this file
 * next to your code, or reference it: `/// <reference path="pp.d.ts" />`. The SDK installs `window.pp`.
 */

declare namespace PP {
  type PageKind = 'paper' | 'venue' | 'topic' | 'org' | 'user';

  type Permission = 'page.read' | 'scope.read' | 'reviews.read' | 'identity';
  type Outcome = 'accepted' | 'rejected' | 'withdrawn' | 'pending';

  type ErrorCode = 'MethodNotFound' | 'PermissionDenied' | 'InvalidParams' | 'Unavailable' | 'Internal';

  /** A failed call: `code` to branch on, `message` for people. */
  interface PluginError extends Error {
    name: 'PluginError';
    code: ErrorCode;
  }

  /** A page as plugins see it. */
  interface PageSummary {
    kind: PageKind;
    /** Its public identifier: `venue:iclr/2027`, `arxiv:1706.03762`, `topic:linear-attention`. */
    identifier: string;
    /** Its path on the site. */
    address: string;
    url: string;
    name: string;
  }

  interface Theme {
    mode: 'light' | 'dark';
    /**
     * The page's design tokens (`ink`, `bg`, `muted`, `rule`, `accent`, `font-serif`, …). The SDK also sets each on
     * your document's `:root` as `--pp-<name>`, and `color-scheme`, on load and whenever they change.
     */
    tokens: Record<string, string>;
  }

  interface Size {
    width: number;
    height: number;
  }

  interface Context {
    plugin: { id: string; name: string; version: string; sha: string | null; dev: boolean };
    /** The panel this frame draws, or the plugin page it is. */
    surface:
    | {
        type: 'panel';
        panel: string;
        /** The slot's full name: `paper.community`. */
        slot: string;
        /** Where it sits: `main`, `aside`, `tab`, `body`, `submission`, `community` or `author`. */
        place: string;
        /** Its size in CSS pixels, kept current (`ui.onResize`). */
        size: Size;
        /** In the `paper.submission` slot: the submission it is drawn under, by its venue (`openreview:ICLR.cc/2027/Conference`). */
        submission?: { venue: { id: string; name: string } };
        /** In the `paper.author` slot: what the paper's authors set for it in `author/plugins.json`. */
        config?: Record<string, unknown>;
      }
    | { type: 'page'; page: string; path: string[]; size: Size };
    /** The page the panel is on; `null` on the plugin's own page. */
    page: PageSummary | null;
    /** The pages above it: a paper's venues, topics and orgs; a topic's broader topics; an org's parents. */
    scopes: PageSummary[];
    viewer: { signedIn: boolean; isOwner: boolean };
    theme: Theme;
    /** Your plugin's settings, by name, as they resolve for this reader. */
    settings: Record<string, unknown>;
    /** The site's origin. */
    site: string;
    /** The methods this host answers. */
    methods: string[];
  }

  interface Section {
    /** `author`, `community`, `organizers`, `members` or `about`. */
    part: string;
    path: string;
    title: string;
    markdown: string;
  }

  interface Link {
    label: string;
    origin: 'owners' | 'community';
    /** The target's identifier. */
    to: string | null;
    name: string | null;
    note: string | null;
    fromAnchor: string | null;
    toAnchor: string | null;
    evidence: string | null;
  }

  interface PageFiles {
    page: PageSummary;
    /** Its kind file as it parses (`venue.json`, `topic.json`, …); a paper's metadata. */
    kindFile: Record<string, unknown> | null;
    sections: Section[];
    links: Link[];
    commit: string | null;
  }

  interface Members {
    total: number;
    papers: (PageSummary & { year: number | null; via: string[] })[];
    /** Pass as `offset` for the next page; `null` at the end. */
    nextOffset: number | null;
  }

  interface Note {
    externalId: string;
    replyTo: string | null;
    kind: 'review' | 'meta_review' | 'decision' | 'comment' | 'withdrawal' | 'other';
    invitation: string;
    signature: string;
    content: Record<string, string | number | boolean | string[]>;
    license: string;
    url: string | null;
    createdAt: string;
  }

  interface Submission {
    venue: { id: string; name: string; url: string | null; forms: Record<string, unknown> };
    externalId: string;
    number: number | null;
    status: 'under_review' | 'accepted' | 'rejected' | 'withdrawn' | 'desk_rejected' | null;
    decision: string | null;
    url: string | null;
    fetchedAt: string;
    notes: Note[];
  }

  /** Fixed-width bins: `counts[i]` holds the means in `[lo + i·width, lo + (i+1)·width)`, the last closed at `hi`. */
  interface Bins {
    lo: number;
    hi: number;
    width: number;
    counts: number[];
  }

  /** A score field at one venue of a scope, with counts. */
  interface ScoreSummary {
    /**
     * `<source>:<venue id>`: `openreview:ICLR.cc/2027/Conference`. A 6 at one venue is no 6 at another. `page` is the
     * venue's own page, whose statistics of it are the whole venue's (a topic's or an org's are only its papers');
     * `null` for a venue with no page.
     */
    venue: { id: string; name: string; page: PageSummary | null };
    /** The field's key in the venue's review forms (`rating`), and its label. */
    field: string;
    label: string;
    /** Submissions with a mean for it. */
    count: number;
    /** The range the venue's form states, when it does. */
    min: number | null;
    max: number | null;
    byStatus: Record<Outcome, number>;
    decisionsOut: boolean;
    /** Withheld by the site until the venue's decisions are out: no values, empty bins. */
    hidden: boolean;
    computedAt: string;
  }

  interface ScoreList {
    page: PageSummary;
    hideUntil: 'never' | 'decisions';
    /** Venues with the most submissions first; each venue's fields in its forms' order (the overall rating first). */
    scores: ScoreSummary[];
  }

  interface ScoreField extends ScoreSummary {
    page: PageSummary;
    /** Each submission's mean over its reviews, ascending. */
    values: number[];
    bins: Bins;
    /** The same by outcome. */
    split: Record<Outcome, { count: number; values: number[]; bins: Bins }>;
    /**
     * With `{ marks: true }`: the scope's own submissions in this field, whose they are and their means, ascending, to
     * mark on the venue's distribution. `null` when the scope has more than 1,000 here; empty when withheld.
     */
    marks?: ScoreMark[] | null;
  }

  /** One of a scope's submissions on a field: the paper and its mean. */
  interface ScoreMark {
    /** The paper's identifier and path; `null` for a paper with no identifier yet. */
    identifier: string | null;
    address: string | null;
    title: string;
    mean: number;
    outcome: Outcome;
  }

  interface SignalSet {
    id: string;
    name: string;
    description: string | null;
    source: string;
    commit: string;
    publisher: string;
    generation: number;
    staged: number | null;
    changedAt: string;
    signals: { name: string; kind: 'vector' | 'number' | 'label'; spec: Record<string, unknown>; count: number }[];
  }

  interface SignalColumns {
    set: { id: string; name: string; generation: number };
    /** Each paper's identifier, as its publisher gave it. */
    papers: string[];
    /** With `titles: true`. */
    titles?: string[];
    signals: Record<
      string,
      | { kind: 'vector'; dims: number; /** Flat: `dims` numbers a paper, `null` where it has none. */ values: (number | null)[] }
      | { kind: 'number'; values: (number | null)[] }
      | { kind: 'label'; keys: string[]; titles: (string | null)[]; /** Indexes into `keys`. */ values: (number | null)[] }
    >;
  }

  /** A paper of a scope, as `scope.papers` gives it. */
  interface BulkPaper {
    identifier: string | null;
    address: string | null;
    title: string;
    year: number | null;
    /** Every submission of the paper, not only the scope's (with `fields` naming `submissions`, `scores` or `status`). */
    submissions?: {
      venue: { id: string; name: string };
      externalId: string;
      number: number | null;
      url: string | null;
      /** With `status`. */
      status?: Submission['status'];
      decision?: string | null;
      /** With `scores`: each review's score fields, by key. CC BY: keep `license` and `url` with them. */
      reviews?: { id: string; signature: string; scores: Record<string, number>; url: string | null; license: string }[];
    }[];
  }

  /**
   * A token naming the reader to your own backend (`identity`). Your backend verifies it (ES256) against `jwksUrl`,
   * with `iss` = `issuer` (the site's origin) and `aud` = `audience` (your plugin's id), and checks `exp`.
   */
  interface IdentityToken {
    /** The JWT. Claims: `iss`, `aud`, `sub`, `handle`, `plugin`, `iat`, `nbf`, `exp`, `jti` (and `dev: true` from localhost). */
    token: string;
    /** When it stops verifying (five minutes after it was made). */
    expiresAt: string;
    /** Your plugin's id; `dev:<id>` when it is loaded from localhost. */
    audience: string;
    issuer: string;
    /** The reader's `sub` for your plugin: stable across handle changes, and different for every plugin. */
    subject: string;
    /** The reader's handle, as the site shows it. */
    handle: string;
    /** `<site>/.well-known/jwks.json`. */
    jwksUrl: string;
  }

  interface SDK {
    readonly apiVersion: 1;
    /** Resolves with the context once the page has answered; every call waits for it. */
    readonly ready: Promise<Context>;
    /** The context, once ready; `null` before. */
    readonly context: Context | null;
    /** Whether the host answers a method. */
    supports(method: string): boolean;
    /** Any method by name, for one newer than these types. */
    call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    /** `settings.change`, `theme.change`, `context.change`, `surface.resize`. Returns a function that stops listening. */
    on(event: string, listener: (params: unknown) => void): () => void;
    getContext(): Promise<Context>;
    settings: {
      /** Your plugin's settings, by name. */
      get(): Promise<Record<string, unknown>>;
      /** Set one of your own settings in the reader's settings.json. */
      set(name: string, value: unknown): Promise<void>;
      onChange(listener: (settings: Record<string, unknown>) => void): () => void;
    };
    /** Small state per reader, kept with their account (64 KB per plugin). For caches, use your own IndexedDB. */
    storage: {
      get(): Promise<Record<string, unknown>>;
      get<T = unknown>(key: string): Promise<T | null>;
      /** `null` removes the key. */
      set(key: string, value: unknown): Promise<void>;
    };
    page: {
      /** Needs `page.read`. The current page when no identifier is given. */
      read(identifier?: string): Promise<PageFiles>;
      /** Needs `scope.read`: a venue's, topic's or org's papers, rolled up from the pages under it. */
      members(
        identifier?: string,
        options?: { offset?: number; limit?: number; rollUp?: boolean },
      ): Promise<Members>;
      /** Any page's summary, its scopes, and whether it has submissions and scores. */
      resolve(identifier: string): Promise<
        PageSummary & { scopes: PageSummary[]; facts: { hasScores: boolean; hasSubmissions: boolean } }
      >;
    };
    scope: {
      /**
       * Needs `scope.read`: a venue's, topic's or org's score statistics, the current page by default. Without `venue`
       * and `field`, the list of venues and fields; with both, that field's sorted means, bins and split by outcome.
       * `{ marks: true }` adds the scope's own submissions by name (`marks`). For a whole venue's numbers on a topic's or
       * an org's page, ask the venue's own page: `scores(summary.venue.page.identifier, venue, field)`.
       */
      scores(identifier?: string): Promise<ScoreList>;
      scores(identifier: string | undefined, venue: string): Promise<ScoreList>;
      scores(
        identifier: string | undefined,
        venue: string,
        field: string,
        options?: { marks?: boolean },
      ): Promise<ScoreField>;
      /**
       * Needs `scope.read`: every paper of a scope, rolled up, fetched in chunks. Resolves with them all, or with `[]`
       * when `onChunk` takes each chunk as it comes. `fields` defaults to all three.
       */
      papers(
        identifier?: string,
        options?: {
          fields?: ('submissions' | 'scores' | 'status')[];
          chunkSize?: number;
          onChunk?: (rows: BulkPaper[]) => void;
        },
      ): Promise<BulkPaper[]>;
    };
    /** Signals (`handoffs/signals.md`): values apps compute about papers, in sets. Public: no permission needed. */
    signals: {
      /** A set: its signals, their kinds and how many papers each covers. */
      set(set: string): Promise<SignalSet>;
      /**
       * Some of a set's signals (all by default) for every paper that has one, by column. `scope` keeps one venue's,
       * topic's or org's papers. Index `i` of every column is `papers[i]`.
       */
      columns(
        set: string,
        options?: { signals?: string[]; scope?: string; titles?: boolean },
      ): Promise<SignalColumns>;
      /** The `k` (20) papers nearest a paper (the current one by default) by a vector signal, best first. */
      nearest(
        set: string,
        signal: string,
        paper?: string,
        options?: { k?: number; with?: string[] },
      ): Promise<{
        set: string;
        signal: string;
        paper: string | null;
        /** With `with`: the paper's values of those signals (a label's key), `null` where it has none. */
        values?: Record<string, unknown>;
        neighbours: { paper: string; title: string; score: number; values?: Record<string, unknown> }[];
        /** With `with`: the titles of the label values among them, by signal and key. */
        labels?: Record<string, Record<string, string>>;
      }>;
      /** A paper's values (the current one by default), by set. */
      forPaper(
        paper?: string,
        set?: string,
      ): Promise<{ sets: { id: string; name: string; values: Record<string, { kind: string; value: unknown; title?: string | null }> }[] }>;
    };
    reviews: {
      /** Needs `reviews.read`: a paper's submissions, notes and venue forms. The current paper by default. */
      forPaper(identifier?: string): Promise<{ submissions: Submission[] }>;
    };
    identity: {
      /**
       * Needs `identity`: a token naming the reader, for your backend (one of your `network` origins). Fails with
       * `Unavailable` when the reader is signed out. The host keeps a token while it has more than a minute left.
       */
      token(): Promise<IdentityToken>;
      /** `fetch` with `Authorization: Bearer <token>` added. */
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
    ui: {
      /** Size the frame yourself; this turns off the automatic sizing to your body's height. */
      setHeight(height: number): Promise<void>;
      autoHeight(on?: boolean): void;
      /** Open an http(s) address in a new tab. */
      openUrl(url: string): Promise<void>;
      /**
       * On your own page, set the rest of its address after the page's id (`surface.path`) without a reload, so the
       * reader can share what they are looking at. Fails in a panel.
       */
      setPath(path: string[]): Promise<void>;
      /** When the frame's size changes (the column, the window, or its own height); `context.surface.size` is kept current. */
      onResize(listener: (size: Size) => void): () => void;
    };
    theme: { onChange(listener: (theme: Theme) => void): () => void };
    /** Handle a command your manifest declares; the reader runs it from your panel's menu. */
    commands: { register(id: string, handler: (args: unknown) => unknown): () => void };
  }
}

interface Window {
  pp: PP.SDK;
}

declare const pp: PP.SDK;
