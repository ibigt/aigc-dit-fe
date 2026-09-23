export function resolveConsoleTheme(storedTheme, prefersDark = false) {
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return prefersDark ? "dark" : "light";
}
