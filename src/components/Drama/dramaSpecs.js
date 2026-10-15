export const DRAMA_ASPECT_RATIOS = [
  { id: "21:9", label: "21:9" },
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
];

export const DRAMA_RESOLUTIONS = ["480P", "720P", "1080P", "2K"];

export function resolutionOptionsFor(model) {
  const listed = Array.isArray(model?.resolutions)
    ? model.resolutions.map((item) => String(item).toUpperCase()).filter((item) => DRAMA_RESOLUTIONS.includes(item))
    : [];
  return listed.length ? listed : DRAMA_RESOLUTIONS;
}

export function preferredResolution(options, current) {
  if (options.includes(current)) return current;
  if (options.includes("720P")) return "720P";
  return options[options.length - 1];
}
