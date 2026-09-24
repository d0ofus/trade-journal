// Leave headroom below Vercel's 4.5 MB request/response limit, including UTF-8 text.
export const REVIEW_PACKAGE_MAX_BYTES = 4_000_000;
export const REVIEW_PACKAGE_TOO_LARGE = "The review metadata exceeds the 4 MB request limit. R2 image originals have a separate 50 MB allowance. Legacy inline images must finish storage migration before this review can be saved. Your local draft is preserved; image quality has not been reduced.";
export function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
