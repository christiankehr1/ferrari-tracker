import { T } from "./theme.js";
import {
  MODEL_DIRECTORY,
  TRACKED,
  SWEPT_AT,
  SWEEP_SEEN,
  SWEEP_TOTAL,
} from "./modelDirectory.js";

// Name and key say nearly the same thing ("599" / 599, "GTC" / gtc), so they
// share a column rather than each claiming width that the name then loses.
// Same trick as the dashboard's tower: everything fixed except that column,
// which ellipsises so a row shrinks instead of forcing a horizontal scrollbar.
const COLS = "32px 1fr 60px 112px 60px";
const BAR_MAX = 60;

function Note({ children }) {
  return (
    <p style={{ margin: "0 0 8px", fontSize: 12, color: T.dim, lineHeight: 1.7, maxWidth: 760 }}>
      {children}
    </p>
  );
}

export default function ModelsPage() {
  const max = Math.max(...MODEL_DIRECTORY.map((m) => m.listings));
  const tracked = MODEL_DIRECTORY.filter((m) => TRACKED.includes(m.key));
  const trackedCars = tracked.reduce((a, m) => a + m.listings, 0);
  const share = Math.round((trackedCars / SWEEP_SEEN) * 100);

  const kpis = [
    { label: "MODELS FOUND", value: MODEL_DIRECTORY.length, sub: `with a live listing` },
    { label: "LISTINGS SWEPT", value: SWEEP_SEEN, sub: `of ${SWEEP_TOTAL} reported`, color: T.giallo },
    { label: "TRACKED", value: tracked.length, sub: "on the dashboard", color: T.acqua },
    { label: "COVERAGE", value: share + "%", sub: `${trackedCars} of ${SWEEP_SEEN} cars`, color: T.drop },
  ];

  return (
    <>
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
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: "0.14em" }}>
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

      <section style={{ padding: "28px 24px 4px" }}>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            color: T.dim,
            letterSpacing: "0.14em",
            marginBottom: 12,
          }}
        >
          MODEL DIRECTORY · AUTOSCOUT24.CH
        </div>
        <Note>
          AutoScout publishes no endpoint that lists models — every <code>/v1/models</code> variant
          404s and the search response carries no facets. These keys were recovered by paginating
          all {SWEEP_TOTAL} Swiss Ferrari listings on {SWEPT_AT} and reading the model off each one.
        </Note>
        <Note>
          So this is <strong style={{ color: T.text }}>every model with at least one live listing</strong>
          , not every model the API accepts. Nothing distinguishes the two: the search endpoint
          doesn't validate <code>modelKey</code>, so a real model with no cars for sale (F40,
          LaFerrari) returns zero results — exactly like a misspelling. A model that nobody in
          Switzerland is selling is invisible here.
        </Note>
        <Note>
          Counts are a snapshot from that sweep, not live figures — the dashboard's hourly crawl only
          covers the {TRACKED.length} tracked models.
        </Note>
      </section>

      <section style={{ padding: "12px 24px 0" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COLS,
            gap: 8,
            padding: "8px 12px",
            fontFamily: T.mono,
            fontSize: 10,
            color: T.faint,
            letterSpacing: "0.12em",
          }}
        >
          <span>#</span>
          <span>MODEL · KEY</span>
          <span style={{ textAlign: "right" }}>ID</span>
          <span style={{ textAlign: "right" }}>LISTINGS</span>
          <span style={{ textAlign: "right" }}>TRACKED</span>
        </div>

        {MODEL_DIRECTORY.map((m, i) => {
          const on = TRACKED.includes(m.key);
          return (
            <div
              key={m.key}
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                gap: 8,
                alignItems: "center",
                padding: "10px 12px",
                background: T.panel,
                borderLeft: `3px solid ${on ? T.acqua : T.line}`,
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
                {m.name}
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, marginLeft: 8 }}>
                  {m.key}
                </span>
              </span>
              <span
                style={{ fontFamily: T.mono, fontSize: 12, color: T.faint, textAlign: "right" }}
              >
                {m.id}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                <span
                  aria-hidden="true"
                  style={{
                    height: 4,
                    width: Math.round((m.listings / max) * BAR_MAX),
                    flexShrink: 0,
                    background: on ? T.acqua : T.faint,
                    borderRadius: 2,
                  }}
                />
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 13,
                    fontWeight: 600,
                    minWidth: 26,
                    textAlign: "right",
                  }}
                >
                  {m.listings}
                </span>
              </span>
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11,
                  textAlign: "right",
                  color: on ? T.acqua : T.faint,
                }}
              >
                {on ? "● YES" : "—"}
              </span>
            </div>
          );
        })}
      </section>

      <section style={{ padding: "20px 24px 0" }}>
        <Note>
          Adding a model to the dashboard means adding its key to <code>MODELS</code> in{" "}
          <code>crawler/crawl.py</code>. Every key above is verified — each returned a non-zero
          result in the sweep.
        </Note>
      </section>
    </>
  );
}
