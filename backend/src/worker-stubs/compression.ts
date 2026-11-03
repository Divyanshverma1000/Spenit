// Cloudflare compresses responses at the edge, so the gzip middleware (and zlib) isn't bundled.
export default function compression() {
  return (_req: unknown, _res: unknown, next: () => void) => next();
}
