export const DRAMA_STYLES = [
  {
    key: "anime-comic",
    name: "二次元漫画风",
    cover: "/drama/styles/anime-comic.jpg",
    fallback: "/drama/styles/anime-comic.svg",
  },
];

export const DEFAULT_DRAMA_STYLE_KEY = DRAMA_STYLES[0].key;

export function dramaStyleOf(key) {
  return DRAMA_STYLES.find((item) => item.key === key) || DRAMA_STYLES[0];
}
