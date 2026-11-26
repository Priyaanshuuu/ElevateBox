/**
 * Single source of truth for author attribution on the public showcase.
 *
 * This file is intentionally TRACKED, not gitignored. Attribution is enforced
 * by tests/showcase-attribution.test.ts (part of `pnpm eval`) and by NOTICE
 * at the repository root. Removing or renaming it breaks the gate.
 */
export const ATTRIBUTION = Object.freeze({
  author: "Priyanshu Sinha",
  email: "priyanshusinha636@gmail.com",
  project: "Voice Sales · ElevateBox",
  linkedin: "https://www.linkedin.com/in/priyanshu-sinha-519147225/",
  x: "https://x.com/Priyyaanshuuu",
} as const);

export const attributionEmailHref = `mailto:${ATTRIBUTION.email}`;
export const attributionLine = `${ATTRIBUTION.author} · ${ATTRIBUTION.email}`;
