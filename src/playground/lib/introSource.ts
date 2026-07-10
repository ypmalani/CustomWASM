/** Showcase program for the first-visit autoplay intro (fib(10) → 55). */
export const INTRO_SOURCE = `fn fib(n: i32) -> i32 {
  if (n <= 1) { return n; }
  else { return fib(n - 1) + fib(n - 2); }
}
fn main() -> i32 { return fib(10); }
`;

/** localStorage key — set once so the intro never replays. */
export const INTRO_SEEN_KEY = "customwasm.introSeen";

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (s && typeof s.getItem === "function" && typeof s.setItem === "function") {
      return s;
    }
  } catch {
    // Ignore unavailable storage.
  }
  return null;
}

export function hasIntroSeen(): boolean {
  return storage()?.getItem(INTRO_SEEN_KEY) === "1";
}

export function markIntroSeen(): void {
  try {
    storage()?.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // Ignore quota / private-mode failures; intro may replay once.
  }
}

export function readInitialSource(): string {
  return hasIntroSeen() ? INTRO_SOURCE : "";
}
