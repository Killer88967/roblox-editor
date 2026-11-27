/**
 * Roblox fonts as web fonts. FontFace families are asset paths like
 * "rbxasset://fonts/families/GothamSSm.json"; most have the same or a close font on Google
 * Fonts (Gotham → Montserrat). Fonts are loaded on demand, only the ones a place uses.
 */
const GOOGLE: Record<string, string> = {
  SourceSansPro: "Source Sans 3",
  GothamSSm: "Montserrat",
  Montserrat: "Montserrat",
  Arial: "Arimo",
  LegacyArial: "Arimo",
  Legacy: "Arimo",
  AccanthisADFStd: "Merriweather",
  Antique: "Merriweather",
  Cartoon: "Comic Neue",
  ComicNeueAngular: "Comic Neue",
  Garamond: "EB Garamond",
  SciFi: "Orbitron",
  Highway: "Overpass",
  Roboto: "Roboto",
  RobotoMono: "Roboto Mono",
  RobotoCondensed: "Roboto Condensed",
  Ubuntu: "Ubuntu",
  Oswald: "Oswald",
  Nunito: "Nunito",
  Merriweather: "Merriweather",
  FredokaOne: "Fredoka",
  Fredoka: "Fredoka",
  LuckiestGuy: "Luckiest Guy",
  Bangers: "Bangers",
  PressStart2P: "Press Start 2P",
  Arcade: "Press Start 2P",
  Creepster: "Creepster",
  DenkOne: "Denk One",
  Fondamento: "Fondamento",
  GrenzeGotisch: "Grenze Gotisch",
  IndieFlower: "Indie Flower",
  JosefinSans: "Josefin Sans",
  Jura: "Jura",
  Kalam: "Kalam",
  Michroma: "Michroma",
  PermanentMarker: "Permanent Marker",
  Sarpanch: "Sarpanch",
  SpecialElite: "Special Elite",
  TitilliumWeb: "Titillium Web",
  Inconsolata: "Inconsolata",
  AmaticSC: "Amatic SC",
  Bodoni: "Bodoni Moda",
  Guru: "Gurajada",
  HighwayGothic: "Overpass",
  Balthazar: "Balthazar",
  PatrickHand: "Patrick Hand",
  Zekton: "Exo 2",
  BuilderSans: "Inter",
  Inter: "Inter",
};

/** Families with a weight axis on Google Fonts (others are single-weight display fonts). */
const VARIABLE = new Set([
  "Source Sans 3",
  "Montserrat",
  "Arimo",
  "Roboto",
  "Roboto Mono",
  "Roboto Condensed",
  "Oswald",
  "Nunito",
  "Fredoka",
  "Josefin Sans",
  "Jura",
  "Inconsolata",
  "Exo 2",
  "Inter",
  "Overpass",
  "Bodoni Moda",
]);

/** The font family name in a FontFace family asset, e.g. "GothamSSm". */
export const familyName = (asset: string) =>
  asset.match(/families\/([^/]+?)\.json$/i)?.[1] ?? asset.match(/([^/]+?)(\.json)?$/)?.[1] ?? "";

const loaded = new Set<string>();

/** Starts loading a web font for a Roblox family (once). */
function load(google: string) {
  if (loaded.has(google) || typeof document === "undefined") return;
  loaded.add(google);
  const spec = VARIABLE.has(google)
    ? `${google.replace(/ /g, "+")}:ital,wght@0,100..900;1,100..900`
    : google.replace(/ /g, "+");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

export type CssFont = { family: string; weight: number; italic: boolean };

/** CSS font for a FontFace value (loading the web font if needed). */
export function cssFont(family: string, weight: number, italic: boolean): CssFont {
  const google = GOOGLE[familyName(family)];
  if (google) load(google);
  return {
    family: google
      ? `"${google}", "Source Sans 3", Arial, sans-serif`
      : `"Source Sans 3", Arial, sans-serif`,
    weight,
    italic,
  };
}

/** A canvas font string for measuring text. */
export const canvasFont = (f: CssFont, size: number) =>
  `${f.italic ? "italic " : ""}${f.weight} ${size}px ${f.family}`;
