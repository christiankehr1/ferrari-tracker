import { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { T } from "./theme.js";
import ModelsPage from "./ModelsPage.jsx";
import BiWordmark from "./BiWordmark.jsx";

// Data is published next to the site by the GitHub Action.
// Cache-bust so a fresh crawl shows up without a hard refresh.
const DATA_URL = "./data/dashboard.json";

// Fixed order — a series keeps its colour no matter which filter is on, and the
// hues are checked for colourblind separation as a sequence, so don't reshuffle
// them. Green is reserved for price drops and never used for a model.
const MODELS = [
  { key: "f430", label: "F430", color: T.giallo },
  { key: "sf90", label: "SF90", color: T.rosso },
  { key: "812", label: "812", color: T.blu },
  { key: "488", label: "488", color: T.rosa },
  { key: "f360", label: "F360", color: T.acqua },
];
const COLOR = Object.fromEntries(MODELS.map((m) => [m.key, m.color]));

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
    return { date: d, ...Object.fromEntries(MODELS.map((m) => [m.key, avg(acc[m.key])])) };
  });
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
  { id: "models", href: "#/models", label: "MODEL DIRECTORY" },
];

// Hash routing, not a router: GitHub Pages serves one static index.html, so a
// real path would 404 on refresh. The hash keeps both pages linkable.
const viewFromHash = () => (window.location.hash.replace(/^#\/?/, "") === "models" ? "models" : "dashboard");

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
  const [status, setStatus] = useState("active");
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
        .filter((l) => (model === "all" || l.model_key === model) && l.status === status)
        .sort((a, b) => (a.current_price ?? 1e12) - (b.current_price ?? 1e12)),
    [listings, model, status]
  );

  // Counts follow the status filter, so the tabs describe what clicking them shows.
  const counts = useMemo(() => {
    const inStatus = listings.filter((l) => l.status === status);
    return {
      all: inStatus.length,
      ...Object.fromEntries(
        MODELS.map((m) => [m.key, inStatus.filter((l) => l.model_key === m.key).length])
      ),
    };
  }, [listings, status]);

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
    const med = (a) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };
    return [
      {
        label: "ON MARKET",
        value: active.length,
        // Per-model counts live on the filter tabs — five of them don't fit here.
        sub: selected ? `${selected.label} only` : `across ${MODELS.length} models`,
      },
      { label: "LISTED < 7D", value: fresh.length, sub: "new to the market", color: T.giallo },
      { label: "PRICE CUTS", value: cuts.length, sub: "since tracking began", color: T.drop },
      {
        label: "DELISTED",
        value: sold.length,
        sub: sold.length ? `median ${med(sold.map((l) => l.days_on_market))}d listed` : "none yet",
        color: T.rosso,
      },
    ];
  }, [listings, selected]);

  const series = useMemo(() => (selected ? [selected] : MODELS), [selected]);

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
        {kpis.map((k) => (
          <div key={k.label} style={{ background: T.panel, padding: "16px 24px" }}>
            <div
              style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: "0.14em" }}
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
          </div>
        ))}
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
                <LineChart data={stats} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                  <XAxis
                    dataKey="date"
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
                  <Tooltip
                    contentStyle={{
                      background: T.panelUp,
                      border: `1px solid ${T.line}`,
                      borderRadius: 4,
                      fontFamily: T.mono,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: T.dim }}
                    formatter={(v, n) => [v + "k", n.toUpperCase()]}
                  />
                  {series.map((m) => (
                    <Line
                      key={m.key}
                      type="stepAfter"
                      dataKey={m.key}
                      stroke={m.color}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  ))}
                </LineChart>
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
        <div style={{ width: 1, background: T.line, margin: "4px 8px" }} />
        <Tab val="active" cur={status} set={setStatus}>
          ON MARKET
        </Tab>
        <Tab val="delisted" cur={status} set={setStatus}>
          DELISTED
        </Tab>
      </div>

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
                          type="stepAfter"
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
            {status === "delisted"
              ? "No cars have left the market yet. Delistings appear once a tracked car disappears from two crawls in a row."
              : "No cars match this filter."}
          </div>
        )}
      </section>
    </Shell>
  );
}
