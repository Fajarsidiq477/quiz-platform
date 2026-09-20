// Thin wrappers over the Fullscreen API, so the quiz screen (and its tests) have one place to look.
// Only the standard API is used. Where it is missing (iPhone Safari), `fullscreenSupported` is
// false and the quiz simply is not held back: leaving the page is still recorded.

export function fullscreenSupported(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

export function inFullscreen(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

export function subscribeFullscreen(callback: () => void): () => void {
  document.addEventListener("fullscreenchange", callback);
  return () => document.removeEventListener("fullscreenchange", callback);
}

/** Needs a click or key press to work. Returns false if the browser refused. */
export async function enterFullscreen(): Promise<boolean> {
  try {
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!inFullscreen()) return;
  try {
    await document.exitFullscreen();
  } catch {
    // Already leaving, or the page is going away: nothing to do.
  }
}
