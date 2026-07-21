// Ferrari model directory, derived from AutoScout24.ch.
//
// AutoScout has no endpoint that lists models: /v1/makes?vehicleCategory=car
// returns every make, but each /v1/models sibling 404s and the search response
// carries no facets. So these keys were recovered the only way available —
// paginating every Ferrari listing and reading the model off each one.
//
// That means this is "models with at least one live Swiss listing", not the full
// catalogue the API accepts. The two are not the same and the gap cannot be closed:
// the search endpoint does not validate modelKey, so a real model with no cars
// (f40, laferrari) returns totalElements 0 — identical to a typo. Zero is ambiguous,
// which is why a new key must be seen in a sweep before it can be trusted.
//
// Regenerate by re-running the sweep; these counts are a snapshot, not live data.

export const SWEPT_AT = "2026-07-16";
export const SWEEP_SEEN = 1004;
export const SWEEP_TOTAL = 1006;

// Keys the hourly crawler actually tracks — kept in sync with crawler/crawl.py MODELS.
export const TRACKED = ["f430", "sf90", "812", "488", "f360", "296", "roma"];

// key, name, id: the API's own values. listings: cars seen in the sweep above.
export const MODEL_DIRECTORY = [
  { key: "296",         name: "296",             id: 3448,  listings: 88 },
  { key: "sf90",        name: "SF90",            id: 3138,  listings: 75 },
  { key: "488",         name: "488",             id: 2214,  listings: 72 },
  { key: "roma",        name: "Roma",            id: 3216,  listings: 66 },
  { key: "812",         name: "812",             id: 2446,  listings: 64 },
  { key: "f430",        name: "F430",            id: 650,   listings: 57 },
  { key: "california",  name: "CALIFORNIA",      id: 653,   listings: 47 },
  { key: "purosangue",  name: "PUROSANGUE",      id: 4635,  listings: 44 },
  { key: "458",         name: "458",             id: 1085,  listings: 38 },
  { key: "portofino",   name: "PORTOFINO",       id: 2810,  listings: 36 },
  { key: "f360",        name: "F360",            id: 645,   listings: 33 },
  { key: "f8",          name: "F8",              id: 3153,  listings: 32 },
  { key: "599",         name: "599",             id: 652,   listings: 29 },
  { key: "gtc",         name: "GTC",             id: 2323,  listings: 29 },
  { key: "575m",        name: "575M",            id: 643,   listings: 27 },
  { key: "ff",          name: "FF",              id: 1108,  listings: 26 },
  { key: "308",         name: "308",             id: 915,   listings: 23 },
  { key: "f12",         name: "F12",             id: 1871,  listings: 23 },
  { key: "456",         name: "456",             id: 642,   listings: 21 },
  { key: "12cilindri",  name: "12Cilindri",      id: 6250,  listings: 20 },
  { key: "348",         name: "348",             id: 640,   listings: 17 },
  { key: "328",         name: "328",             id: 639,   listings: 15 },
  { key: "testar-512",  name: "TESTAR./512",     id: 649,   listings: 15 },
  { key: "365",         name: "365",             id: 914,   listings: 13 },
  { key: "612",         name: "612",             id: 651,   listings: 13 },
  { key: "f355",        name: "F355",            id: 644,   listings: 11 },
  { key: "mondial",     name: "MONDIAL",         id: 648,   listings: 10 },
  { key: "400",         name: "400",             id: 916,   listings: 10 },
  { key: "dino",        name: "Dino",            id: 917,   listings: 9 },
  { key: "f550",        name: "F550",            id: 647,   listings: 9 },
  { key: "412",         name: "412",             id: 641,   listings: 8 },
  { key: "512bb",       name: "512BB",           id: 2052,  listings: 7 },
  { key: "330",         name: "330",             id: 2450,  listings: 3 },
  { key: "250",         name: "250",             id: 5887,  listings: 2 },
  { key: "208",         name: "208",             id: 2203,  listings: 1 },
  { key: "amalfi",      name: "AMALFI",          id: 9616,  listings: 1 },
  { key: "849",         name: "849",             id: 9555,  listings: 1 },
];
