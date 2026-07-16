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

// Data is published next to the site by the GitHub Action.
// Cache-bust so a fresh crawl shows up without a hard refresh.
const DATA_URL = "./data/dashboard.json";

const T = {
  bg: "#0B0D10",
  panel: "#14181D",
  panelUp: "#1B2129",
  line: "#242B34",
  text: "#E8E4DA",
  dim: "#8A93A0",
  faint: "#5A6470",
  rosso: "#FF2B2B",
  giallo: "#FFC300",
  drop: "#38D073",
  mono: "'IBM Plex Mono', monospace",
  display: "'Michroma', sans-serif",
  body: "'Archivo', sans-serif",
};

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
    const acc = { f430: [], sf90: [] };
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
    return { date: d, f430: avg(acc.f430), sf90: avg(acc.sf90) };
  });
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [model, setModel] = useState("all");
  const [status, setStatus] = useState("active");
  const [open, setOpen] = useState(null);

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

  const kpis = useMemo(() => {
    const active = listings.filter((l) => l.status === "active");
    const cuts = active.filter((l) => l.current_price < l.first_price);
    const sold = listings.filter((l) => l.status === "delisted");
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
        sub: `${active.filter((l) => l.model_key === "f430").length} F430 · ${
          active.filter((l) => l.model_key === "sf90").length
        } SF90`,
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
  }, [listings]);

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

  const Shell = ({ children }) => (
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
          borderBottom: `1px solid ${T.line}`,
          padding: "20px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontFamily: T.display, fontSize: 15, letterSpacing: "0.18em" }}>
            <span style={{ color: T.rosso }}>■</span> CAVALLINO INDEX
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
            F430 · SF90 — AUTOSCOUT24.CH · SVIZZERA
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
      {children}
    </div>
  );

  if (error)
    return (
      <Shell>
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
      <Shell>
        <div style={{ padding: 48, fontFamily: T.mono, fontSize: 13, color: T.faint }}>
          Loading listings…
        </div>
      </Shell>
    );

  return (
    <Shell>
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
        </div>
        {stats.length < 2 ? (
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
            The trend line starts once prices move.
            <br />
            First crawl is the baseline — check back tomorrow.
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
                  <Line
                    type="stepAfter"
                    dataKey="sf90"
                    stroke={T.rosso}
                    dot={false}
                    strokeWidth={1.5}
                    connectNulls
                  />
                  <Line
                    type="stepAfter"
                    dataKey="f430"
                    stroke={T.giallo}
                    dot={false}
                    strokeWidth={1.5}
                    connectNulls
                  />
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
              <span>
                <span style={{ color: T.giallo }}>■</span> F430
              </span>
              <span>
                <span style={{ color: T.rosso }}>■</span> SF90
              </span>
            </div>
          </>
        )}
      </section>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, padding: "20px 24px 12px", flexWrap: "wrap" }}>
        <Tab val="all" cur={model} set={setModel}>
          ALL
        </Tab>
        <Tab val="f430" cur={model} set={setModel}>
          F430
        </Tab>
        <Tab val="sf90" cur={model} set={setModel}>
          SF90
        </Tab>
        <div style={{ width: 1, background: T.line, margin: "4px 8px" }} />
        <Tab val="active" cur={status} set={setStatus}>
          ON MARKET
        </Tab>
        <Tab val="delisted" cur={status} set={setStatus}>
          DELISTED
        </Tab>
      </div>

      {/* Timing tower */}
      <section style={{ padding: "0 24px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 84px 96px 66px 56px",
            gap: 8,
            padding: "8px 12px",
            fontFamily: T.mono,
            fontSize: 10,
            color: T.faint,
            letterSpacing: "0.12em",
          }}
        >
          <span>POS</span>
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
                display: "grid",
                gridTemplateColumns: "36px 1fr 84px 96px 66px 56px",
                gap: 8,
                alignItems: "center",
                padding: "10px 12px",
                cursor: "pointer",
                background: open === l.id ? T.panelUp : T.panel,
                borderLeft: `3px solid ${l.model_key === "sf90" ? T.rosso : T.giallo}`,
                borderBottom: `1px solid ${T.bg}`,
              }}
            >
              <span style={{ fontFamily: T.mono, fontSize: 12, color: T.faint }}>
                {String(i + 1).padStart(2, "0")}
              </span>
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
