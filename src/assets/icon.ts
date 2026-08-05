/**
 * Service icon, inlined as base64.
 *
 * Embedded rather than served from disk so the binary survives the TypeScript
 * build and container copy without a separate asset-copying step — a broken
 * iconUrl shows up as a broken Bazaar merchant listing.
 */
export const ARBITER_ICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABVElEQVR42u3dwQ2CQBRF0WnAhSursAErsALqsycaYmviBgcI/DcnuUtF8k+QgYTQbveHTqwZAQAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBgdc/XOzsAAAAAAACgAkDMWgUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADDAUzz5zsAAAAAAAAAAAAAAAAAAAAAAIB1s7tOAAAAAAAAwEiroO5lzMZV0F9fBAAAAAAAmwB2PzH2fazvdwEAAOBmnJtxAAAAAAAAAAAAAAAAAAAAAAAAAAAA8JSkpyQBAADws7t5ALtvuR26x2EAR2zZK0xODgAAAAIAQAAACAAAAQCgkQHKvQov8wgYYfRX/wsaYfoFzgHBoy9zEg6efqVVUN7o6y1D86Zf8jogZvSFL8Ripu9KGAAAIwAAQAAACAAAAQAgAAAEAIAAABAAAAIQ3QKuE5pX2Oo+XwAAAABJRU5ErkJggg==",
  "base64",
);
