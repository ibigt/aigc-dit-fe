export const DRAMA_STYLES = [
  {
    key: "anime-comic",
    name: "二次元漫画风",
    category: "anime",
    cover: "/drama/styles/anime-comic.jpg",
    fallback: "/drama/styles/anime-comic.svg",
  },
  {
    key: "live-realism",
    name: "现代写实风",
    category: "realistic",
    cover: "/drama/styles/live-realism.jpg",
    fallback: "/drama/styles/live-realism.svg",
  },
  {
    key: "anime-wuxia",
    name: "动漫武侠风",
    category: "anime",
    cover: "/drama/styles/anime-wuxia.jpg",
    fallback: "/drama/styles/anime-wuxia.svg",
  },
  {
    key: "costume-comic",
    name: "古装漫画风",
    category: "anime",
    cover: "/drama/styles/costume-comic.jpg",
    fallback: "/drama/styles/costume-comic.svg",
  },
  {
    key: "republican-era",
    name: "民国漫画风",
    category: "anime",
    cover: "/drama/styles/republican-era.jpg",
    fallback: "/drama/styles/republican-era.svg",
  },
  {
    key: "cyberpunk",
    name: "赛博朋克风",
    category: "anime",
    cover: "/drama/styles/cyberpunk.jpg",
    fallback: "/drama/styles/cyberpunk.svg",
  },
  {
    key: "sci-fi",
    name: "未来科幻风",
    category: "anime",
    cover: "/drama/styles/sci-fi.jpg",
    fallback: "/drama/styles/sci-fi.svg",
  },
  {
    key: "rural",
    name: "乡土漫画风",
    category: "anime",
    cover: "/drama/styles/rural.jpg",
    fallback: "/drama/styles/rural.svg",
  },
  {
    key: "guofeng-3d",
    name: "古风写实风",
    category: "realistic",
    cover: "/drama/styles/guofeng-3d.jpg",
    fallback: "/drama/styles/guofeng-3d.svg",
  },
  {
    key: "neon-cyber",
    name: "霓虹赛博风",
    category: "realistic",
    cover: "/drama/styles/neon-cyber.jpg",
    fallback: "/drama/styles/neon-cyber.svg",
  },
  {
    key: "kdrama-soft",
    name: "韩剧柔光风",
    category: "realistic",
    cover: "/drama/styles/kdrama-soft.jpg",
    fallback: "/drama/styles/kdrama-soft.svg",
  },
  {
    key: "jp-youth",
    name: "日系青春风",
    category: "realistic",
    cover: "/drama/styles/jp-youth.jpg",
    fallback: "/drama/styles/jp-youth.svg",
  },
  {
    key: "sci-fi-cinema",
    name: "科技电影风",
    category: "realistic",
    cover: "/drama/styles/sci-fi-cinema.jpg",
    fallback: "/drama/styles/sci-fi-cinema.svg",
  },
  {
    key: "american-retro",
    name: "美式复古风",
    category: "realistic",
    cover: "/drama/styles/american-retro.jpg",
    fallback: "/drama/styles/american-retro.svg",
  },
];

export const DEFAULT_DRAMA_STYLE_KEY = "live-realism";

export function dramaStyleOf(key) {
  return DRAMA_STYLES.find((item) => item.key === key) || DRAMA_STYLES[0];
}
