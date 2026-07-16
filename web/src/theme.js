// Shared palette and type. Lives outside App so the model directory page can
// use it without importing the dashboard.
const STYRENE = "'Styrene A', system-ui, -apple-system, 'Segoe UI', sans-serif";

export const T = {
  bg: "#0B0D10",
  panel: "#14181D",
  panelUp: "#1B2129",
  line: "#242B34",
  text: "#E8E4DA",
  dim: "#8A93A0",
  faint: "#5A6470",
  rosso: "#FF2B2B",
  giallo: "#FFC300",
  blu: "#3B82F6",
  rosa: "#E04A93",
  acqua: "#1A9AA8",
  drop: "#38D073",
  // One face everywhere (see the @font-face in index.html). The roles are kept
  // separate so a second face can be reintroduced without touching call sites.
  //
  // The fallbacks are load-bearing, not boilerplate: Styrene A has no ■ ● Δ ↓ →
  // glyphs, so those marks always render from the system font behind it.
  mono: STYRENE,
  display: STYRENE,
  body: STYRENE,
};
