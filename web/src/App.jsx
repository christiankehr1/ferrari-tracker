import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  Scatter,
  ZAxis,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { T } from "./theme.js";
import { MODELS, COLOR } from "./models.js";
import ModelsPage from "./ModelsPage.jsx";
import MapPage from "./MapPage.jsx";
import BiWordmark from "./BiWordmark.jsx";

// Data is published next to the site by the GitHub Action.
// Cache-bust so a fresh crawl shows up without a hard refresh.
const DATA_URL = "./data/dashboard.json";

// B.I. Collection, the official Ferrari dealer in Zürich. Matched on the seller
// id the API returns, not the name — dealers rename themselves ("… 50 Jahre"),
// and the id is what autoscout24.ch/de/s/seller-60699 is keyed on.
const BI_COLLECTION_ID = 60699;

/** Shield badge for a B.I. Collection car. Deliberately not the prancing horse —
 *  that mark is Ferrari's trademark — just a giallo shield with a tricolore cap.
 *  Yellow, not rosso: the row's left accent bar is already red, and at 12px a red
 *  shield reads as part of it. */
const BiBadge = () => (
  <svg
    viewBox="0 0 12 14"
    width={12}
    height={14}
    role="img"
    aria-label="Listed by B.I. Collection"
    style={{ marginLeft: 6, verticalAlign: "-2px", flexShrink: 0 }}
  >
    <title>Listed by B.I. Collection — Ferrari Zürich</title>
    <path d="M6 .5 11.5 2v6.2c0 2.6-2.4 4.4-5.5 5.3C2.9 12.6.5 10.8.5 8.2V2Z" fill={T.giallo} />
    <path d="M1.6 1.75 6 .55l4.4 1.2v1.1H1.6Z" fill={T.drop} />
    <path d="M4.5 1 6 .55 7.5 1v1.85h-3Z" fill="#E8E4DA" />
    <path d="M7.5 1 10.4 1.75v1.1H7.5Z" fill={T.rosso} />
  </svg>
);

const chf = (n) => (n == null ? "—" : "CHF " + n.toLocaleString("de-CH"));
const kchf = (n) => (n == null ? "—" : (n / 1000).toFixed(0) + "k");
const day = (ts) => ts.slice(0, 10);

// The price-vs-? scatter can plot against either of a listing's two "how much
// life has this car had" numbers. Same shape either way — a listing field, an
// axis tick formatter, and how the tooltip should read it back.
const X_METRICS = [
  {
    key: "days",
    label: "DAYS ON MARKET",
    field: "days_on_market",
    binSize: 120,
    tickFormat: (v) => `${v}d`,
    tooltipFormat: (v) => `${v}d listed`,
  },
  {
    key: "mileage",
    label: "MILEAGE",
    field: "current_mileage",
    binSize: 10000,
    tickFormat: (v) => `${Math.round(v / 1000)}k`,
    tooltipFormat: (v) => `${v.toLocaleString("de-CH")} km`,
  },
];
// Delisting is detected at crawl time (hourly), so the minute is meaningful —
// show it, unlike the listing date which is only ever a calendar day.
const stamp = (ts) => ts.slice(0, 16).replace("T", " ") + " UTC";

// The four KPI tiles double as the table's filter — clicking one shows only the
// cars it counts. Three are subsets of what's on the market, "delisted" is the
// cars that have left, so the selections are mutually exclusive. One predicate
// drives both the visible rows and the per-model tab counts.
const matchesFilter = (l, filter) => {
  switch (filter) {
    case "fresh":
      return l.status === "active" && l.days_on_market <= 7;
    case "cuts":
      return l.status === "active" && l.current_price < l.first_price;
    case "delisted":
      return l.status === "delisted";
    default: // "active" — everything on the market
      return l.status === "active";
  }
};

function Delta({ from, to }) {
  if (from == null || to == null || to === from)
    return <span style={{ color: T.faint, fontFamily: T.mono, fontSize: 12 }}>—</span>;
  const d = to - from;
  const down = d < 0;
  return (
    <span
      style={{
        color: down ? T.drop : T.rosso,
        fontFamily: T.mono,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {down ? "▼" : "▲"} {Math.abs(d / 1000).toFixed(1)}k
    </span>
  );
}

/**
 * Average asking price per model per day.
 * History rows only exist when a price changed, so each car's price has to be
 * carried forward across the days in between — otherwise the average would
 * swing based on which cars happened to move that day.
 */
function buildStats(listings) {
  const days = [...new Set(listings.flatMap((l) => l.history.map((h) => day(h.ts))))].sort();
  if (!days.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  if (days[days.length - 1] !== today) days.push(today);

  return days.map((d) => {
    const acc = Object.fromEntries(MODELS.map((m) => [m.key, []]));
    for (const l of listings) {
      const start = day(l.first_seen);
      const end = l.delisted_at ? day(l.delisted_at) : today;
      if (d < start || d > end) continue;
      let price = null;
      for (const h of l.history) {
        if (day(h.ts) <= d) price = h.price;
        else break;
      }
      if (price != null) acc[l.model_key]?.push(price);
    }
    const avg = (a) =>
      a.length >= 3 ? Math.round(a.reduce((x, y) => x + y, 0) / a.length / 1000) : undefined;
    // Same 3-car threshold as the average, so the band never appears on a day
    // too thin for the line above it to be drawn.
    const range = (a) => (a.length >= 3 ? [Math.round(Math.min(...a) / 1000), Math.round(Math.max(...a) / 1000)] : undefined);
    return {
      date: d,
      ...Object.fromEntries(MODELS.map((m) => [m.key, avg(acc[m.key])])),
      ...Object.fromEntries(MODELS.map((m) => [`${m.key}Range`, range(acc[m.key])])),
      // Unthresholded on purpose: the tooltip needs the real denominator, and
      // a day with too few cars to average never reaches it anyway.
      ...Object.fromEntries(MODELS.map((m) => [`${m.key}N`, acc[m.key].length])),
    };
  });
}

/**
 * Every individual listing's carried-forward price per day, per model — the
 * raw cloud of points the average line is smoothing over. Same carry-forward
 * rule as buildStats, but nothing is averaged or thresholded, so a model with
 * only one or two cars still shows its dots even though it can't plot a line.
 */
function buildScatterByModel(listings, days, series) {
  const today = new Date().toISOString().slice(0, 10);
  const map = Object.fromEntries(series.map((m) => [m.key, []]));
  for (const l of listings) {
    if (!map[l.model_key]) continue;
    const start = day(l.first_seen);
    const end = l.delisted_at ? day(l.delisted_at) : today;
    let price = null;
    let hi = 0;
    for (const d of days) {
      if (d < start || d > end) continue;
      while (hi < l.history.length && day(l.history[hi].ts) <= d) {
        price = l.history[hi].price;
        hi++;
      }
      if (price != null) map[l.model_key].push({ date: d, price: Math.round(price / 1000) });
    }
  }
  return map;
}

// A day averaging four cars and a day averaging forty look identical on the
// line, and the line moves when the pool changes as much as when a price does
// — an expensive car delisting drags the average down with nobody moving an
// ask. So the average never appears alone: the count it came from and the
// spread it flattened travel with it.
const THIN_DAY = 4;

// Default tooltip content lists every series at the hovered x, which for the
// scatter cloud means one line per car on the market that day, plus the
// min/max band. Filter it down to just the average line(s) — the dots and the
// band are for visual density, not lookup.
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const lines = payload.filter((p) => p.dataKey !== "price" && !String(p.dataKey).endsWith("Range"));
  if (!lines.length) return null;
  return (
    <div
      style={{
        background: T.panelUp,
        border: `1px solid ${T.line}`,
        borderRadius: 4,
        padding: "6px 10px",
        fontFamily: T.mono,
        fontSize: 12,
      }}
    >
      <div style={{ color: T.dim, marginBottom: 4 }}>{label}</div>
      {lines.map((p) => {
        const row = p.payload ?? {};
        const n = row[`${p.dataKey}N`];
        const band = row[`${p.dataKey}Range`];
        // A day scraping the 3-car floor gets dimmed whole rather than
        // annotated: a thin average should look thin at a glance, not read the
        // same as a well-supported one and leave the caveat to be computed.
        const thin = n != null && n <= THIN_DAY;
        return (
          <div key={p.dataKey} style={{ opacity: thin ? 0.55 : 1, whiteSpace: "nowrap" }}>
            <span style={{ color: p.color }}>
              {p.value}k · {String(p.name ?? p.dataKey).toUpperCase()}
            </span>
            <span style={{ color: T.faint }}>
              {n != null && ` · n=${n}`}
              {band && ` · ${band[0]}\u2013${band[1]}k`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// One car per hovered point, so unlike ChartTooltip there's no series list to
// filter — just name the car and give both axes their units back. The x value
// reads differently depending on which metric is active, hence the passed-in
// metric rather than a fixed "Nd listed" string. The median line shares the
// same x/y space but carries no single car to describe, so it's excluded by
// dataKey rather than shown as a phantom listing.
function ScatterTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null;
  const p = payload.find((entry) => entry.dataKey === "price")?.payload;
  if (!p) return null;
  return (
    <div
      style={{
        background: T.panelUp,
        border: `1px solid ${T.line}`,
        borderRadius: 4,
        padding: "6px 10px",
        fontFamily: T.mono,
        fontSize: 12,
      }}
    >
      <div style={{ color: T.text, marginBottom: 2 }}>{p.model_label}</div>
      <div style={{ color: T.dim }}>
        {p.price}k CHF · {metric.tooltipFormat(p.x)}
      </div>
    </div>
  );
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * Time-on-market aggregates over the delisted archive — the payoff of keeping
 * departed cars forever. Median days from listing (AutoScout's own creation
 * date, carried on days_on_market) to the crawl that confirmed them gone, per
 * model. Thin now, but every car that leaves the market lands here for good, so
 * the medians only sharpen over months and years.
 */
function exitStats(listings) {
  const gone = listings.filter((l) => l.status === "delisted");
  const byModel = MODELS.map((m) => {
    const days = gone.filter((l) => l.model_key === m.key).map((l) => l.days_on_market);
    return {
      key: m.key,
      label: m.label,
      color: m.color,
      exits: days.length,
      median: median(days),
      min: days.length ? Math.min(...days) : null,
      max: days.length ? Math.max(...days) : null,
    };
  }).filter((r) => r.exits > 0);
  return { total: gone.length, median: median(gone.map((l) => l.days_on_market)), byModel };
}

// The timing tower's columns are fixed px — they add up to more than a phone is
// wide, which let the whole page slide sideways. Below this width the row drops
// POS (the order is already the ranking) and tightens the numeric columns.
const NARROW = "(max-width: 560px)";

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    // Read mq.matches rather than trust the event: resize also re-syncs after a
    // mount that measured a zero-width window, which "change" never reports
    // because the query's own value never flipped.
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  return narrow;
}

const NAV = [
  { id: "dashboard", href: "#/", label: "DASHBOARD" },
  { id: "map", href: "#/map", label: "HEATMAP" },
  { id: "models", href: "#/models", label: "MODEL DIRECTORY" },
];

// Hash routing, not a router: GitHub Pages serves one static index.html, so a
// real path would 404 on refresh. The hash keeps every page linkable.
const viewFromHash = () => {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h === "models" || h === "map" ? h : "dashboard";
};

function Shell({ data, view, children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        color: T.text,
        fontFamily: T.body,
        padding: "0 0 64px",
      }}
    >
      <header
        style={{
          padding: "20px 24px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: T.rosso, fontFamily: T.display, fontSize: 15 }}>■</span>
            <BiWordmark height={17} color={T.text} />
          </div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 11,
              color: T.dim,
              marginTop: 6,
              letterSpacing: "0.1em",
            }}
          >
            {MODELS.map((m) => m.label).join(" · ")} — AUTOSCOUT24.CH · SVIZZERA
          </div>
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.faint }}>
          {data ? (
            <>
              LAST CRAWL {data.crawled_at.slice(0, 16).replace("T", " ")} UTC ·{" "}
              <span style={{ color: T.drop }}>●</span> LIVE
            </>
          ) : (
            "CONNECTING…"
          )}
        </div>
      </header>
      <nav
        style={{
          display: "flex",
          gap: 4,
          padding: "14px 24px 0",
          borderBottom: `1px solid ${T.line}`,
        }}
      >
        {NAV.map((n) => {
          const on = view === n.id;
          return (
            <a
              key={n.id}
              href={n.href}
              aria-current={on ? "page" : undefined}
              style={{
                padding: "8px 12px",
                fontFamily: T.mono,
                fontSize: 11,
                letterSpacing: "0.12em",
                color: on ? T.text : T.dim,
                textDecoration: "none",
                borderBottom: `2px solid ${on ? T.rosso : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {n.label}
            </a>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [model, setModel] = useState("all");
  const [filter, setFilter] = useState("active");
  const [xMetric, setXMetric] = useState("days");
  const [open, setOpen] = useState(null);
  const [view, setView] = useState(viewFromHash);
  const narrow = useNarrow();

  // minmax(0, 1fr) rather than 1fr: a bare 1fr floors at the car name's
  // min-content width, so the row would still push past the viewport.
  const grid = {
    display: "grid",
    gridTemplateColumns: narrow
      ? "minmax(0, 1fr) 58px 62px 52px 44px"
      : "36px minmax(0, 1fr) 84px 96px 66px 56px",
    gap: narrow ? 6 : 8,
  };

  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    fetch(`${DATA_URL}?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const listings = data?.listings ?? [];
  const stats = useMemo(() => buildStats(listings), [listings]);

  const rows = useMemo(
    () =>
      listings
        .filter((l) => (model === "all" || l.model_key === model) && matchesFilter(l, filter))
        .sort((a, b) => (a.current_price ?? 1e12) - (b.current_price ?? 1e12)),
    [listings, model, filter]
  );

  // Counts follow the active tile, so the tabs describe what clicking them shows.
  const counts = useMemo(() => {
    const inScope = listings.filter((l) => matchesFilter(l, filter));
    return {
      all: inScope.length,
      ...Object.fromEntries(
        MODELS.map((m) => [m.key, inScope.filter((l) => l.model_key === m.key).length])
      ),
    };
  }, [listings, filter]);

  // The whole dashboard reads as one selection: picking a model narrows the KPIs
  // and the chart, not just the table below them.
  const selected = useMemo(
    () => (model === "all" ? null : MODELS.find((m) => m.key === model)),
    [model]
  );

  const kpis = useMemo(() => {
    const scope = selected ? listings.filter((l) => l.model_key === selected.key) : listings;
    const active = scope.filter((l) => l.status === "active");
    const cuts = active.filter((l) => l.current_price < l.first_price);
    const sold = scope.filter((l) => l.status === "delisted");
    const fresh = active.filter((l) => l.days_on_market <= 7);
    return [
      {
        filter: "active",
        label: "ON MARKET",
        value: active.length,
        // Per-model counts live on the filter tabs — five of them don't fit here.
        sub: selected ? `${selected.label} only` : `across ${MODELS.length} models`,
      },
      { filter: "fresh", label: "LISTED < 7D", value: fresh.length, sub: "new to the market", color: T.giallo },
      { filter: "cuts", label: "PRICE CUTS", value: cuts.length, sub: "since tracking began", color: T.drop },
      {
        filter: "delisted",
        label: "DELISTED",
        value: sold.length,
        sub: sold.length ? `median ${median(sold.map((l) => l.days_on_market))}d listed` : "none yet",
        color: T.rosso,
      },
    ];
  }, [listings, selected]);

  // Scoped to the selected model like the KPIs, so the archive panel reads as
  // part of the same selection as everything above it.
  const exits = useMemo(
    () => exitStats(selected ? listings.filter((l) => l.model_key === selected.key) : listings),
    [listings, selected]
  );

  const series = useMemo(() => (selected ? [selected] : MODELS), [selected]);

  const scatterByModel = useMemo(
    () => buildScatterByModel(listings, stats.map((s) => s.date), series),
    [listings, stats, series]
  );

  const xMetricDef = useMemo(() => X_METRICS.find((m) => m.key === xMetric), [xMetric]);

  // Current price against either how long a car has sat or how far it's been
  // driven, grouped per model like the chart above. Delisted cars are
  // excluded — days_on_market and current_mileage both freeze at exit, but
  // current_price is only ever the price it left at, not what it sold for.
  const priceVsDays = useMemo(() => {
    const map = Object.fromEntries(series.map((m) => [m.key, []]));
    for (const l of listings) {
      if (!map[l.model_key] || l.status !== "active") continue;
      const x = l[xMetricDef.field];
      if (l.current_price == null || x == null) continue;
      map[l.model_key].push({
        id: l.id,
        model_label: (selected ?? MODELS.find((m) => m.key === l.model_key))?.label,
        x,
        price: Math.round(l.current_price / 1000),
      });
    }
    return map;
  }, [listings, series, selected, xMetricDef]);

  const hasPriceVsDays = useMemo(
    () => series.some((m) => priceVsDays[m.key]?.length),
    [series, priceVsDays]
  );

  // The scatter is too noisy to read a trend off directly, so bucket the x
  // axis into fixed-width bins and plot the median price per bin — same
  // 3-car floor as the other charts, so a lonely outlier can't fake a trend.
  const medianByX = useMemo(() => {
    const { binSize } = xMetricDef;
    const map = {};
    for (const m of series) {
      const bins = {};
      for (const p of priceVsDays[m.key] ?? []) {
        const start = Math.floor(p.x / binSize) * binSize;
        (bins[start] ??= []).push(p.price);
      }
      map[m.key] = Object.entries(bins)
        .filter(([, prices]) => prices.length >= 3)
        .map(([start, prices]) => ({ x: Number(start) + binSize / 2, medianPrice: median(prices) }))
        .sort((a, b) => a.x - b.x);
    }
    return map;
  }, [priceVsDays, series, xMetricDef]);

  // An average needs three cars on a day to be plotted, so a thinly-listed model
  // can have a column of nothing but gaps — draw the empty state rather than an
  // axis with no line under it.
  const hasTrend = useMemo(
    () => stats.length >= 2 && stats.some((s) => series.some((m) => s[m.key] != null)),
    [stats, series]
  );

  const Tab = ({ val, cur, set, children }) => (
    <button
      onClick={() => set(val)}
      style={{
        background: cur === val ? T.panelUp : "transparent",
        color: cur === val ? T.text : T.dim,
        border: `1px solid ${cur === val ? T.line : "transparent"}`,
        borderRadius: 4,
        padding: "6px 14px",
        cursor: "pointer",
        fontFamily: T.mono,
        fontSize: 12,
        letterSpacing: "0.08em",
      }}
    >
      {children}
    </button>
  );

  if (view === "models")
    return (
      <Shell data={data} view={view}>
        <ModelsPage />
      </Shell>
    );

  if (view === "map")
    return (
      <Shell data={data} view={view}>
        <MapPage data={data} error={error} />
      </Shell>
    );

  if (error)
    return (
      <Shell data={data} view={view}>
        <div
          style={{
            padding: 48,
            fontFamily: T.mono,
            fontSize: 13,
            color: T.dim,
            lineHeight: 1.8,
          }}
        >
          <div style={{ color: T.rosso, marginBottom: 8 }}>Can't load crawl data ({error}).</div>
          The site is up but data/dashboard.json didn't load. Check that the latest
          "Crawl and publish" run finished green in the repo's Actions tab.
        </div>
      </Shell>
    );

  if (!data)
    return (
      <Shell data={data} view={view}>
        <div style={{ padding: 48, fontFamily: T.mono, fontSize: 13, color: T.faint }}>
          Loading listings…
        </div>
      </Shell>
    );

  return (
    <Shell data={data} view={view}>
      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 1,
          background: T.line,
          borderBottom: `1px solid ${T.line}`,
        }}
      >
        {kpis.map((k) => {
          const on = filter === k.filter;
          const accent = k.color ?? T.text;
          return (
            <button
              key={k.label}
              onClick={() => setFilter(k.filter)}
              aria-pressed={on}
              style={{
                background: on ? T.panelUp : T.panel,
                // A colour cap on the selected tile so the active view is legible
                // even when its number is the muted white of ON MARKET.
                borderTop: `2px solid ${on ? accent : "transparent"}`,
                textAlign: "left",
                padding: "16px 24px",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
              }}
            >
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 10,
                  color: on ? T.text : T.dim,
                  letterSpacing: "0.14em",
                }}
              >
                {k.label}
              </div>
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 30,
                  fontWeight: 600,
                  color: k.color ?? T.text,
                  lineHeight: 1.3,
                }}
              >
                {k.value}
              </div>
              <div style={{ fontSize: 11, color: T.faint }}>{k.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Aggregate chart */}
      <section style={{ padding: "28px 24px 8px" }}>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            color: T.dim,
            letterSpacing: "0.14em",
            marginBottom: 12,
          }}
        >
          AVERAGE ASKING PRICE · kCHF
          {selected && (
            <>
              {" · "}
              <span style={{ color: selected.color }}>{selected.label}</span>
            </>
          )}
        </div>
        {!hasTrend ? (
          <div
            style={{
              height: 240,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px dashed ${T.line}`,
              borderRadius: 4,
              fontFamily: T.mono,
              fontSize: 12,
              color: T.faint,
              textAlign: "center",
              padding: 24,
            }}
          >
            {stats.length < 2 ? (
              <>
                The trend line starts once prices move.
                <br />
                First crawl is the baseline — check back tomorrow.
              </>
            ) : (
              <>
                Not enough {selected?.label} listings for a daily average.
                <br />
                A day needs three cars on the market to be plotted.
              </>
            )}
          </div>
        ) : (
          <>
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <ComposedChart data={stats} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                  <XAxis
                    dataKey="date"
                    allowDuplicatedCategory={false}
                    tick={{ fill: T.faint, fontSize: 10, fontFamily: T.mono }}
                    tickFormatter={(d) => d.slice(5)}
                    minTickGap={40}
                    axisLine={{ stroke: T.line }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: T.faint, fontSize: 10, fontFamily: T.mono }}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <ZAxis range={[18, 18]} />
                  <Tooltip content={<ChartTooltip />} />
                  {series.map((m) => (
                    <Area
                      key={`${m.key}-band`}
                      type="monotone"
                      dataKey={`${m.key}Range`}
                      stroke="none"
                      fill={m.color}
                      fillOpacity={series.length > 1 ? 0.06 : 0.1}
                      isAnimationActive={false}
                      connectNulls
                      activeDot={false}
                      legendType="none"
                    />
                  ))}
                  {series.map((m) => (
                    <Scatter
                      key={`${m.key}-dots`}
                      data={scatterByModel[m.key]}
                      dataKey="price"
                      name={m.label}
                      fill={m.color}
                      fillOpacity={series.length > 1 ? 0.22 : 0.35}
                      stroke="none"
                      isAnimationActive={false}
                    />
                  ))}
                  {series.map((m) => (
                    <Line
                      key={m.key}
                      type="monotone"
                      dataKey={m.key}
                      stroke={m.color}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                display: "flex",
                gap: 20,
                fontFamily: T.mono,
                fontSize: 11,
                color: T.dim,
                marginTop: 4,
              }}
            >
              {series.map((m) => (
                <span key={m.key}>
                  <span style={{ color: m.color }}>■</span> {m.label}
                </span>
              ))}
              <span style={{ color: T.faint }}>
                · line = daily average · band = daily min–max · dots = individual listings
              </span>
            </div>
          </>
        )}
      </section>

      {/* Price vs. days on market / mileage */}
      <section style={{ padding: "8px 24px 8px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.dim, letterSpacing: "0.14em" }}>
            PRICE VS. {xMetricDef.label} · kCHF
            {selected && (
              <>
                {" · "}
                <span style={{ color: selected.color }}>{selected.label}</span>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {X_METRICS.map((m) => (
              <Tab key={m.key} val={m.key} cur={xMetric} set={setXMetric}>
                {m.label}
              </Tab>
            ))}
          </div>
        </div>
        {!hasPriceVsDays ? (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px dashed ${T.line}`,
              borderRadius: 4,
              fontFamily: T.mono,
              fontSize: 12,
              color: T.faint,
              textAlign: "center",
              padding: 24,
            }}
          >
            No active {selected ? selected.label : ""} listings to plot right now.
          </div>
        ) : (
          <>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <ComposedChart margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                  <CartesianGrid stroke={T.line} strokeDasharray="2 6" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={xMetricDef.label}
                    tickFormatter={xMetricDef.tickFormat}
                    tick={{ fill: T.faint, fontSize: 10, fontFamily: T.mono }}
                    axisLine={{ stroke: T.line }}
                    tickLine={false}
                    domain={[0, "auto"]}
                  />
                  <YAxis
                    type="number"
                    dataKey="price"
                    name="Asking price"
                    tick={{ fill: T.faint, fontSize: 10, fontFamily: T.mono }}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<ScatterTooltip metric={xMetricDef} />} cursor={{ stroke: T.line }} />
                  {series.map((m) => (
                    <Scatter
                      key={`${m.key}-dots`}
                      data={priceVsDays[m.key]}
                      fill={m.color}
                      fillOpacity={series.length > 1 ? 0.45 : 0.65}
                      stroke="none"
                      isAnimationActive={false}
                    />
                  ))}
                  {series.map((m) => (
                    <Line
                      key={`${m.key}-median`}
                      data={medianByX[m.key]}
                      dataKey="medianPrice"
                      stroke={m.color}
                      strokeWidth={2}
                      dot={{ r: 3, fill: m.color, stroke: "none" }}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                display: "flex",
                gap: 20,
                fontFamily: T.mono,
                fontSize: 11,
                color: T.dim,
                marginTop: 4,
              }}
            >
              {series.map((m) => (
                <span key={m.key}>
                  <span style={{ color: m.color }}>■</span> {m.label}
                </span>
              ))}
              <span style={{ color: T.faint }}>
                · line = median per bin · each dot = one active listing
              </span>
            </div>
          </>
        )}
      </section>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, padding: "20px 24px 12px", flexWrap: "wrap" }}>
        <Tab val="all" cur={model} set={setModel}>
          ALL <span style={{ color: T.faint }}>{counts.all}</span>
        </Tab>
        {MODELS.map((m) => (
          <Tab key={m.key} val={m.key} cur={model} set={setModel}>
            <span style={{ color: m.color }}>■</span> {m.label}{" "}
            <span style={{ color: T.faint }}>{counts[m.key]}</span>
          </Tab>
        ))}
      </div>

      {/* Time-on-market archive — only in the delisted view, where it's the point */}
      {filter === "delisted" && exits.total > 0 && (
        <section style={{ padding: narrow ? "0 12px 12px" : "0 24px 12px" }}>
          <div
            style={{
              background: T.panel,
              border: `1px solid ${T.line}`,
              borderRadius: 4,
              padding: narrow ? "14px 14px" : "16px 20px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.dim,
                  letterSpacing: "0.14em",
                }}
              >
                TIME ON MARKET · DELISTED ARCHIVE
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.faint }}>
                {exits.total} exit{exits.total === 1 ? "" : "s"} tracked · median{" "}
                <span style={{ color: T.rosso, fontWeight: 600 }}>{exits.median}d</span> listed
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 56px 72px 88px",
                gap: 6,
                fontFamily: T.mono,
                fontSize: 10,
                color: T.faint,
                letterSpacing: "0.1em",
                padding: "0 2px 6px",
              }}
            >
              <span>MODEL</span>
              <span style={{ textAlign: "right" }}>EXITS</span>
              <span style={{ textAlign: "right" }}>MEDIAN</span>
              <span style={{ textAlign: "right" }}>RANGE</span>
            </div>
            {exits.byModel.map((r) => (
              <div
                key={r.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 56px 72px 88px",
                  gap: 6,
                  alignItems: "center",
                  padding: "7px 2px",
                  borderTop: `1px solid ${T.bg}`,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500 }}>
                  <span style={{ color: r.color, marginRight: 8 }}>■</span>
                  {r.label}
                </span>
                <span
                  style={{ fontFamily: T.mono, fontSize: 12, color: T.dim, textAlign: "right" }}
                >
                  {r.exits}
                </span>
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 13,
                    fontWeight: 600,
                    textAlign: "right",
                  }}
                >
                  {r.median}d
                </span>
                <span
                  style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, textAlign: "right" }}
                >
                  {r.min === r.max ? `${r.min}d` : `${r.min}–${r.max}d`}
                </span>
              </div>
            ))}
            <div
              style={{
                fontFamily: T.mono,
                fontSize: 10,
                color: T.faint,
                marginTop: 12,
                lineHeight: 1.6,
              }}
            >
              Days from the listing's AutoScout creation date to the crawl that confirmed it gone.
              A disappearance is all the API gives us, so this counts sold and pulled listings alike.
            </div>
          </div>
        </section>
      )}

      {/* Timing tower */}
      <section style={{ padding: narrow ? "0 12px" : "0 24px" }}>
        <div
          style={{
            ...grid,
            padding: "8px 12px",
            fontFamily: T.mono,
            fontSize: 10,
            color: T.faint,
            letterSpacing: "0.12em",
          }}
        >
          {!narrow && <span>POS</span>}
          <span>CAR</span>
          <span style={{ textAlign: "right" }}>KM</span>
          <span style={{ textAlign: "right" }}>ASK</span>
          <span style={{ textAlign: "right" }}>Δ</span>
          <span style={{ textAlign: "right" }}>DAYS</span>
        </div>

        {rows.map((l, i) => (
          <div key={l.id}>
            <div
              onClick={() => setOpen(open === l.id ? null : l.id)}
              style={{
                ...grid,
                alignItems: "center",
                padding: "10px 12px",
                cursor: "pointer",
                background: open === l.id ? T.panelUp : T.panel,
                borderLeft: `3px solid ${COLOR[l.model_key] ?? T.faint}`,
                borderBottom: `1px solid ${T.bg}`,
              }}
            >
              {!narrow && (
                <span style={{ fontFamily: T.mono, fontSize: 12, color: T.faint }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
              )}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {l.version}
                {l.seller_id === BI_COLLECTION_ID && <BiBadge />}
                <span style={{ color: T.faint, fontSize: 11, marginLeft: 8 }}>
                  {l.year} · {l.seller_city} · {l.seller_type === "private" ? "PRIV" : "PRO"}
                </span>
              </span>
              <span
                style={{ fontFamily: T.mono, fontSize: 12, color: T.dim, textAlign: "right" }}
              >
                {l.current_mileage?.toLocaleString("de-CH") ?? "—"}
              </span>
              <span
                style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}
              >
                {kchf(l.current_price)}
              </span>
              <span style={{ textAlign: "right" }}>
                <Delta from={l.first_price} to={l.current_price} />
              </span>
              <span
                style={{ fontFamily: T.mono, fontSize: 12, color: T.dim, textAlign: "right" }}
              >
                {l.days_on_market}d
              </span>
            </div>

            {open === l.id && (
              <div
                style={{
                  background: T.panelUp,
                  padding: "16px 20px",
                  borderLeft: `3px solid ${T.line}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: T.mono,
                    fontSize: 11,
                    color: T.dim,
                    marginBottom: 10,
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  <span>
                    #{l.id} · {l.hp ? l.hp + " PS · " : ""}
                    {l.transmission ?? "—"} · listed {day(l.as24_created ?? l.first_seen)}
                    {l.status === "delisted" && l.delisted_at && (
                      <span style={{ color: T.rosso }}>
                        {" · "}left the market {stamp(l.delisted_at)}
                      </span>
                    )}
                  </span>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: T.giallo, textDecoration: "none" }}
                  >
                    {chf(l.current_price)} — open on AutoScout ↗
                  </a>
                </div>
                {l.history.length < 2 ? (
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, padding: "8px 0" }}>
                    No price change since tracking started.
                  </div>
                ) : (
                  <div style={{ height: 110 }}>
                    <ResponsiveContainer>
                      <LineChart data={l.history} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                        <XAxis dataKey="ts" hide />
                        <YAxis
                          tick={{ fill: T.faint, fontSize: 9, fontFamily: T.mono }}
                          tickFormatter={kchf}
                          axisLine={false}
                          tickLine={false}
                          domain={["auto", "auto"]}
                          width={54}
                        />
                        <Tooltip
                          contentStyle={{
                            background: T.panel,
                            border: `1px solid ${T.line}`,
                            borderRadius: 4,
                            fontFamily: T.mono,
                            fontSize: 11,
                          }}
                          labelFormatter={day}
                          formatter={(v) => [chf(v), "ask"]}
                        />
                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke={l.current_price < l.first_price ? T.drop : T.dim}
                          dot={false}
                          strokeWidth={1.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {rows.length === 0 && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: T.faint,
              fontFamily: T.mono,
              fontSize: 12,
            }}
          >
            {filter === "delisted"
              ? "No cars have left the market yet. Delistings appear once a tracked car disappears from two crawls in a row."
              : "No cars match this filter."}
          </div>
        )}
      </section>
    </Shell>
  );
}
