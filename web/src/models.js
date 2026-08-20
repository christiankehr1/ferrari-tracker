import { T } from "./theme.js";

// The tracked models, in a fixed order. A series keeps its colour no matter
// which filter or page is on, and the hues are checked for colourblind
// separation as a sequence, so don't reshuffle them. Green is reserved for
// price drops and never used for a model. Shared so the dashboard and the map
// paint the same key with the same colour.
//
// Eleven series is past what hue alone can separate on this background: the
// last four steps sit at the floor (worst adjacent pair ΔE 5.6 under deutan —
// rosa/acqua, which predates them; the new four clear 6.4). Searching for a
// twelfth that keeps ΔE >= 6 against the other eleven and the drop green comes
// back empty, so the next model needs a second channel (dashes, markers) rather
// than another colour. Identity here never rests on colour alone — the legend
// and the model filter carry it.
export const MODELS = [
  { key: "f430", label: "F430", color: T.giallo },
  { key: "sf90", label: "SF90", color: T.rosso },
  { key: "812", label: "812", color: T.blu },
  { key: "488", label: "488", color: T.rosa },
  { key: "f360", label: "F360", color: T.acqua },
  { key: "296", label: "296", color: T.viola },
  { key: "roma", label: "Roma", color: T.arancio },
  { key: "california", label: "California", color: T.cremisi },
  { key: "purosangue", label: "Purosangue", color: T.indaco },
  { key: "458", label: "458", color: T.ottone },
  { key: "portofino", label: "Portofino", color: T.porpora },
];

export const COLOR = Object.fromEntries(MODELS.map((m) => [m.key, m.color]));
