import { T } from "./theme.js";

// The tracked models, in a fixed order. A series keeps its colour no matter
// which filter or page is on, and the hues are checked for colourblind
// separation as a sequence, so don't reshuffle them. Green is reserved for
// price drops and never used for a model. Shared so the dashboard and the map
// paint the same key with the same colour.
export const MODELS = [
  { key: "f430", label: "F430", color: T.giallo },
  { key: "sf90", label: "SF90", color: T.rosso },
  { key: "812", label: "812", color: T.blu },
  { key: "488", label: "488", color: T.rosa },
  { key: "f360", label: "F360", color: T.acqua },
];

export const COLOR = Object.fromEntries(MODELS.map((m) => [m.key, m.color]));
