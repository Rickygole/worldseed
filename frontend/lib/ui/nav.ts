/**
 * Client-side navigation from plain modules (keyboard handler, story actions). The root shell registers the
 * Next.js router once; everything navigates through it, so the persistent layout (map, simulator, worker pool)
 * never remounts and the browser's back and forward buttons work.
 */
export interface Nav {
  push(href: string): void;
  replace(href: string): void;
}

let nav: Nav | null = null;

export function registerNav(n: Nav | null): void {
  nav = n;
}

export function navigate(href: string, opts: { replace?: boolean } = {}): void {
  if (!nav) {
    // Before the shell mounts (never expected): fall back to a real navigation.
    if (typeof window !== "undefined") window.location.assign(href);
    return;
  }
  if (opts.replace) nav.replace(href);
  else nav.push(href);
}
