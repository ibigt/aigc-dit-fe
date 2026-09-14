export const DRAMA_STYLES = [
  {
    key: "anime-comic",
    name: "二次元漫画风",
    cover: "/drama/styles/anime-comic.jpg",
    fallback: "/drama/styles/anime-comic.svg",
  },
  {
    key: "live-realism",
    name: "真人写实风",
    cover: "/drama/styles/live-realism.jpg",
    fallback: "/drama/styles/live-realism.svg",
  },
  {
    key: "anime-wuxia",
    name: "动漫武侠风",
    cover: "/drama/styles/anime-wuxia.jpg",
    fallback: "/drama/styles/anime-wuxia.svg",
  },
  {
    key: "costume-comic",
    name: "古装漫画风",
    cover: "/drama/styles/costume-comic.jpg",
    fallback: "/drama/styles/costume-comic.svg",
  },
  {
    key: "republican-era",
    name: "民国漫画风",
    cover: "/drama/styles/republican-era.jpg",
    fallback: "/drama/styles/republican-era.svg",
  },
  {
    key: "cyberpunk",
    name: "赛博朋克风",
    cover: "/drama/styles/cyberpunk.jpg",
    fallback: "/drama/styles/cyberpunk.svg",
  },
  {
    key: "sci-fi",
    name: "未来科幻风",
    cover: "/drama/styles/sci-fi.jpg",
    fallback: "/drama/styles/sci-fi.svg",
  },
  {
    key: "rural",
    name: "乡土漫画风",
    cover: "/drama/styles/rural.jpg",
    fallback: "/drama/styles/rural.svg",
  },
];

export const DEFAULT_DRAMA_STYLE_KEY = DRAMA_STYLES[0].key;

export function dramaStyleOf(key) {
  return DRAMA_STYLES.find((item) => item.key === key) || DRAMA_STYLES[0];
}
