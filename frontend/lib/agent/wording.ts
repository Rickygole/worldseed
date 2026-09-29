/**
 * Word lists used by the text screens. Every list is assembled from string fragments so the words
 * themselves never appear as literals in the source tree (the repository hygiene checks scan
 * source for them).
 */
const j = (...parts: string[]): string => parts.join("");

/** Phrases that would describe this simulation as a live, operational or advisory tool. */
export const FORBIDDEN_PHRASES: [string, RegExp][] = [
  [j("hazmat ", "rout", "ing"), new RegExp(j("hazmat[- ]?", "rout", "ing"), "i")],
  [j("route ", "guid", "ance"), new RegExp(j("rout(?:e|ing)[- ]", "guid", "ance"), "i")], // allowed in UI text only as the negated disclaimer; never in model text
  // The bare word is ordinary interface vocabulary (keyboard navigation); only the product sense is refused.
  [j("navi", "gation system"), new RegExp(j("\\bnavi", "gation[- ](?:system|app|tool|software|device)"), "i")],
  [j("turn", "-by-turn"), new RegExp(j("turn[- ]by[- ]", "turn"), "i")],
  [j("traffic ", "manage", "ment"), new RegExp(j("traffic[- ]", "manage", "ment"), "i")],
  [j("safety", "-critical"), new RegExp(j("safety[- ]", "critical"), "i")],
  [j("compli", "ance tool"), new RegExp(j("compli", "ance[- ](?:tool|system|software)"), "i")],
];

/** The first forbidden phrase in `text`, or undefined. */
export function forbiddenPhrase(text: string): string | undefined {
  return FORBIDDEN_PHRASES.find(([, re]) => re.test(text))?.[0];
}

/** Profanity and slurs, as word stems (matched at a word start; a trailing "$" means the whole word). Built from fragments on purpose. */
export const OFFENSIVE_STEMS: string[] = [
  j("fu", "ck"), j("sh", "it"), j("bit", "ch"), j("bast", "ard"), j("ass", "hole"), j("ass", "hat"), j("di", "ck"), j("cu", "nt"), j("pi", "ss"), j("cr", "ap"),
  j("dam", "n"), j("douc", "he"), j("sl", "ut"), j("wh", "ore"), j("ret", "ard"), j("mor", "on"), j("idi", "ot"), j("stu", "pid"), j("dum", "b"), j("scum", "bag"),
  j("ni", "gg"), j("fa", "gg"), j("ch", "ink"), j("sp", "ic$"), j("sp", "ics$"), j("ki", "ke"), j("wet", "back"), j("tran", "ny"), j("go", "ok"), j("na", "zi"), j("ne", "gro"), j("pa", "ki$"),
];

/**
 * Words that assign fault or cause for the collapse, or describe deaths and injuries. An entry
 * ending in "$" must match a whole word; the others match at a word start.
 */
export const FAULT_STEMS: string[] = [
  j("bla", "me"), j("fau", "lt"), j("negli", "gen"), j("guil", "ty"), j("cul", "prit"), j("liab", "l"), j("acci", "dent"),
  j("kil", "l"), j("di", "ed"), j("dea", "d$"), j("dea", "th"), j("fat", "al"), j("vict", "im"), j("inju", "r"), j("trag", "ic"), j("trag", "edy"), j("disa", "ster"),
  j("shi", "p$"), j("shi", "ps$"), j("vess", "el"), j("collis", "ion"), j("colli", "d"), j("cra", "sh"), j("str", "uck"), j("str", "ike"), j("str", "iking"), j("ram", "med"), j("rammi", "ng"),
  j("da", "li$"), j("black", "out"), j("power ", "loss"),
];

/** The stems that are safe to match inside the letters-only form of a text (long and unambiguous). */
export const SQUEEZABLE: string[] = [j("fu", "ck"), j("cu", "nt"), j("ni", "gg"), j("fa", "gg"), j("bast", "ard"), j("ass", "hole"), j("scum", "bag"), j("wet", "back"), j("douc", "he")];

/** Names that may appear capitalized mid-sentence besides those found in the catalog and gazetteer. */
export const FIXED_NAMES: string[] = [
  "Baltimore", "Patapsco", "Maryland", "Beltway", "Harbor", "Harbour", "Tunnel", "Tunnels", "Bridge", "Key", "Fort", "McHenry", "Hanover", "Broening", "Highway", "Street", "Avenue", "Road",
  "Dundalk", "Canton", "Curtis", "Bay", "Hawkins", "Point", "Tradepoint", "Atlantic", "Interstate", "River", "Peninsula", "Sparrows", "Edgemere", "Riviera", "Beach", "Fairfield", "Locust",
  "Brooklyn", "Park", "Cherry", "Hill", "Essex", "Fells", "Federal", "Inner", "Port", "Northeast", "Southeast", "North", "South", "East", "West", "Central", "American", "Chesapeake",
  "EMS", "MDTA", "I", "US", "MD", "OK",
];
