// Leave headroom below Vercel's 4.5 MB request/response limit, including UTF-8 text.
export const REVIEW_PACKAGE_MAX_BYTES = 4_000_000;
export const REVIEW_PACKAGE_TOO_LARGE = "This review exceeds the 4 MB save limit, including image encoding. Choose Standard capture quality or a smaller image, or download and remove older attachments, then retry. Quality has not been reduced; your local draft is preserved.";
export function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
