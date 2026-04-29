import { GENRE_KEYWORDS } from "./dictionaries";

export function guessGenre(text: string): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  for (const [keyword, genre] of Object.entries(GENRE_KEYWORDS)) {
    if (lower.includes(keyword.toLowerCase())) return genre;
  }
  return "";
}
