// Colour tokens shared by CSS and the canvas, each defined in one place.
// UI colours (accent, inks, status) live in index.html's :root and are read here
// with tok(). Data-layer severity lives here, since the pure hazard modules (and
// their tests) need it without a DOM; publishSeverity() hands it to CSS as
// --sev-advisory, --sev-watch and --sev-warning.

/** Severity for data layers, low to high: advisories, watches, warnings and the top of every hazard scale. */
export const SEV = { advisory: '#ffd84d', watch: '#ff9f43', warning: '#ff4d5e' } as const;

let rootStyle: CSSStyleDeclaration | null | undefined;

/** A :root custom property's value, var()s resolved ('' where there's no DOM, e.g. in tests). */
export function tok(name: string): string {
  if (rootStyle === undefined) rootStyle = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  return rootStyle?.getPropertyValue(name).trim() ?? '';
}

/** Publish the severity colours as CSS custom properties on `root`. */
export function publishSeverity(root: HTMLElement) {
  for (const [name, color] of Object.entries(SEV)) root.style.setProperty(`--sev-${name}`, color);
}
