// Display-name cleaning shared by the pipeline and the app.

/** ".Russell Square" → "Russell Square", "St. Paul's" → "St Paul's", collapses whitespace. */
export function cleanName(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .replace(/&harr;/g, '↔')
    .replace(/&amp;/g, '&')
    .replace(/\bSt\.(?=[A-Z])/g, 'St ') // "St.Paul's" → "St Paul's"
    .replace(/\bSt\./g, 'St')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    // strip leading punctuation, and trailing punctuation except a closing bracket
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N})]+$/u, '')
    .trim();
}

/** True if a name is display-clean (used by tests). */
export const NAME_OK = /^[\p{L}\p{N}](?:.*[\p{L}\p{N})])?$/u;
