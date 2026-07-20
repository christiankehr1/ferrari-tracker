import { useState, useEffect, useMemo } from "react";
import { T } from "./theme.js";
import { MODELS } from "./models.js";
import { CANTONS, VIEWBOX } from "./swissCantons.js";
import { cantonOf } from "./swissZipCanton.js";

const kchf = (n) => (n == null ? "—" : (n / 1000).toFixed(0) + "k");
const NAME = Object.fromEntries(CANTONS.map((c) => [c.id, c.name]));

// The map switches from map-beside-list to stacked below this width; the SVG
// itself is fluid, so this is only about the two columns, not the drawing.
const NARROW = "(max-width: 820px)";
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

// A car count → fill. The endpoints are both reds so the ramp stays clean (a
// blue-panel-to-red mix goes muddy in the middle). sqrt spreads the long tail —
// Zürich has ~50 cars and most cantons have one or two, so a linear ramp would
// leave everything but the leaders indistinguishably dark. A count of one still
// clears the floor so "has a car" reads apart from "has none".
const LOW = [74, 15, 20]; // #4A0F14 — dark rosso
const HIGH = [255, 43, 43]; // T.rosso
const heat = (count, max) => {
  if (!count) return T.panel;
  const t = 0.18 + 0.82 * Math.sqrt(count / max);
  const c = LOW.map((lo, i) => Math.round(lo + (HIGH[i] - lo) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

function Kpi({ label, value, sub, color }) {
  return (
    <div
      style={{
        background: T.panel,
        borderTop: `2px solid ${color ?? "transparent"}`,
        padding: "16px 24px",
      }}
    >
      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: "0.14em" }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 30,
          fontWeight: 600,
          color: color ?? T.text,
          lineHeight: 1.3,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: T.faint }}>{sub}</div>
    </div>
  );
}

export default function MapPage({ data, error }) {
  const [model, setModel] = useState("all");
  const [selected, setSelected] = useState(null); // clicked canton (expands its cars)
  const [hover, setHover] = useState(null); // hovered canton (readout only)
  const narrow = useNarrow();

  // Only cars on the market get a place on the map — a delisted car isn't
  // "available" anywhere. Everything else here is a bucketing of these.
  const cars = useMemo(
    () =>
      (data?.listings ?? []).filter(
        (l) => l.status === "active" && (model === "all" || l.model_key === model)
      ),
    [data, model]
  );

  // Cars grouped by canton, plus the ones whose PLZ isn't Swiss (Liechtenstein
  // shows up in the feed) — those can't sit on the map and are footnoted instead.
  const { byCanton, offMap } = useMemo(() => {
    const byCanton = new Map();
    const offMap = [];
    for (const l of cars) {
      const c = cantonOf(l.seller_zip);
      // The PLZ table also covers Liechtenstein ("LI"), which is a sovereign
      // country, not a Swiss canton — it has no outline on this map. Anything
      // that doesn't resolve to one of the 26 cantons is footnoted, not plotted.
      if (!c || !NAME[c]) offMap.push(l);
      else (byCanton.get(c) ?? byCanton.set(c, []).get(c)).push(l);
    }
    for (const arr of byCanton.values())
      arr.sort((a, b) => (a.current_price ?? 1e12) - (b.current_price ?? 1e12));
    return { byCanton, offMap };
  }, [cars]);

  const counts = useMemo(
    () => Object.fromEntries([...byCanton].map(([c, arr]) => [c, arr.length])),
    [byCanton]
  );
  const max = useMemo(() => Math.max(1, ...Object.values(counts)), [counts]);
  const total = cars.length - offMap.length;

  // Ranked for the side list — densest canton first, drop the empties.
  const ranked = useMemo(
    () =>
      [...byCanton.keys()]
        .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
        .map((id) => ({ id, name: NAME[id], n: counts[id], cars: byCanton.get(id) })),
    [byCanton, counts]
  );

  const top = ranked[0];
  const top3Share = total
    ? Math.round((ranked.slice(0, 3).reduce((a, r) => a + r.n, 0) / total) * 100)
    : 0;

  // Per-model tab counts follow the same "on the market" rule as the map.
  const tabCounts = useMemo(() => {
    const active = (data?.listings ?? []).filter((l) => l.status === "active");
    return {
      all: active.length,
      ...Object.fromEntries(
        MODELS.map((m) => [m.key, active.filter((l) => l.model_key === m.key).length])
      ),
    };
  }, [data]);

  const activeId = hover ?? selected;
  const readout = activeId
    ? { id: activeId, name: NAME[activeId], n: counts[activeId] ?? 0 }
    : null;

  const Tab = ({ val, children }) => (
    <button
      onClick={() => setModel(val)}
      style={{
        background: model === val ? T.panelUp : "transparent",
        color: model === val ? T.text : T.dim,
        border: `1px solid ${model === val ? T.line : "transparent"}`,
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

  if (error)
    return (
      <div style={{ padding: 48, fontFamily: T.mono, fontSize: 13, color: T.dim, lineHeight: 1.8 }}>
        <div style={{ color: T.rosso, marginBottom: 8 }}>Can't load crawl data ({error}).</div>
        The map needs data/dashboard.json. Check the latest "Crawl and publish" run.
      </div>
    );
  if (!data)
    return (
      <div style={{ padding: 48, fontFamily: T.mono, fontSize: 13, color: T.faint }}>
        Loading listings…
      </div>
    );

  return (
    <>
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
        <Kpi label="ON MARKET" value={total} sub={`across ${ranked.length} cantons`} />
        <Kpi label="CANTONS" value={`${ranked.length}/26`} sub="with a car for sale" color={T.giallo} />
        <Kpi
          label="DENSEST"
          value={top ? top.id : "—"}
          sub={top ? `${top.n} cars in ${top.name}` : "no cars"}
          color={T.rosso}
        />
        <Kpi label="TOP-3 SHARE" value={`${top3Share}%`} sub="of the market, 3 cantons" color={T.drop} />
      </div>

      <div style={{ padding: "20px 24px 0" }}>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: T.dim, lineHeight: 1.7, maxWidth: 760 }}>
          Where the tracked Ferraris sit today, by the seller's canton. Darker means
          more cars on the market. Hover a canton for its count, or click it — on the
          map or in the list — to see the cars listed there.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Tab val="all">
            ALL <span style={{ color: T.faint }}>{tabCounts.all}</span>
          </Tab>
          {MODELS.map((m) => (
            <Tab key={m.key} val={m.key}>
              <span style={{ color: m.color }}>■</span> {m.label}{" "}
              <span style={{ color: T.faint }}>{tabCounts[m.key]}</span>
            </Tab>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          // minmax(0, …) on both axes: a bare 1fr floors at the SVG's min-content
          // width, which lets the map push past a phone's viewport (same trap the
          // dashboard tower hits).
          gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(0, 1.35fr) minmax(0, 1fr)",
          gap: 20,
          padding: "16px 24px 0",
          alignItems: "start",
        }}
      >
        {/* Map */}
        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
            style={{ width: "100%", height: "auto", display: "block" }}
            role="img"
            aria-label="Ferrari listings per Swiss canton"
          >
            {CANTONS.map((c) => {
              const n = counts[c.id] ?? 0;
              const on = c.id === activeId;
              return (
                <path
                  key={c.id}
                  d={c.d}
                  fill={heat(n, max)}
                  stroke={on ? T.text : T.line}
                  strokeWidth={on ? 1.6 : 0.5}
                  strokeLinejoin="round"
                  style={{ cursor: n ? "pointer" : "default", transition: "fill 120ms" }}
                  onMouseEnter={() => setHover(c.id)}
                  onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
                  onClick={() => n && setSelected((s) => (s === c.id ? null : c.id))}
                >
                  <title>{`${c.name} — ${n} car${n === 1 ? "" : "s"}`}</title>
                </path>
              );
            })}
            {/* Labels last so borders never cross them; only where there are cars. */}
            {CANTONS.filter((c) => counts[c.id]).map((c) => (
              <text
                key={c.id}
                x={c.cx}
                y={c.cy}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontFamily: T.mono,
                  fontSize: 11,
                  fill: T.text,
                  paintOrder: "stroke",
                  stroke: T.bg,
                  strokeWidth: 2.5,
                  strokeLinejoin: "round",
                  pointerEvents: "none",
                }}
              >
                {c.id}
              </text>
            ))}
          </svg>

          {/* Readout — a fixed corner panel instead of a floating tooltip, so it
              never clips at the map edge or lags the cursor. */}
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              background: "rgba(11,13,16,0.82)",
              border: `1px solid ${T.line}`,
              borderRadius: 4,
              padding: "8px 12px",
              fontFamily: T.mono,
              fontSize: 12,
              pointerEvents: "none",
              minWidth: 150,
            }}
          >
            {readout ? (
              <>
                <span style={{ color: T.text }}>{readout.id}</span>
                <span style={{ color: T.dim }}> · {readout.name}</span>
                <div style={{ color: T.rosso, fontSize: 18, fontWeight: 600, marginTop: 2 }}>
                  {readout.n} car{readout.n === 1 ? "" : "s"}
                  {total ? (
                    <span style={{ color: T.faint, fontSize: 11, fontWeight: 400 }}>
                      {" "}
                      · {Math.round((readout.n / total) * 100)}%
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <span style={{ color: T.faint }}>Hover a canton</span>
            )}
          </div>

          {/* Legend + off-map footnote */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 10,
              fontFamily: T.mono,
              fontSize: 10,
              color: T.faint,
              flexWrap: "wrap",
            }}
          >
            <span>0</span>
            <div
              style={{
                width: 120,
                height: 8,
                borderRadius: 2,
                background: `linear-gradient(90deg, ${T.panel}, ${heat(
                  Math.max(1, Math.round(max / 2)),
                  max
                )}, ${heat(max, max)})`,
                border: `1px solid ${T.line}`,
              }}
            />
            <span>{max} cars</span>
            {offMap.length ? (
              <span style={{ marginLeft: "auto" }}>
                +{offMap.length} outside CH (not shown)
              </span>
            ) : null}
          </div>
        </div>

        {/* Ranked list — clicking a row expands the cars in that canton, mirroring
            the dashboard's expandable rows. */}
        <div>
          {ranked.map((r) => {
            const openRow = selected === r.id;
            return (
              <div key={r.id}>
                <div
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover((h) => (h === r.id ? null : h))}
                  onClick={() => setSelected((s) => (s === r.id ? null : r.id))}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "34px minmax(0,1fr) 40px",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 12px",
                    cursor: "pointer",
                    background: openRow || hover === r.id ? T.panelUp : T.panel,
                    borderBottom: `1px solid ${T.bg}`,
                  }}
                >
                  <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text }}>{r.id}</span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 12,
                        color: T.dim,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: "block",
                      }}
                    >
                      {r.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        height: 4,
                        marginTop: 4,
                        borderRadius: 2,
                        width: `${Math.max(6, (r.n / max) * 100)}%`,
                        background: heat(r.n, max),
                      }}
                    />
                  </span>
                  <span
                    style={{
                      fontFamily: T.mono,
                      fontSize: 13,
                      fontWeight: 600,
                      color: T.text,
                      textAlign: "right",
                    }}
                  >
                    {r.n}
                  </span>
                </div>

                {openRow && (
                  <div style={{ background: T.panelUp, padding: "4px 12px 12px" }}>
                    {r.cars.map((l) => (
                      <a
                        key={l.id}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "6px 0",
                          textDecoration: "none",
                          color: "inherit",
                          borderBottom: `1px solid ${T.line}`,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l.version}
                          <span style={{ color: T.faint, fontSize: 11, marginLeft: 6 }}>
                            {l.year} · {l.seller_city}
                          </span>
                        </span>
                        <span
                          style={{
                            fontFamily: T.mono,
                            fontSize: 12,
                            fontWeight: 600,
                            color: T.giallo,
                            flexShrink: 0,
                          }}
                        >
                          {kchf(l.current_price)}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {ranked.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: T.faint, fontFamily: T.mono, fontSize: 12 }}>
              No cars on the market for this model.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
