// Redis is optional and only used as a cache. It isn't available on Workers (the app falls
// back to its in-memory cache), so this stub just refuses to connect.
export default class Redis {
  constructor() {
    throw new Error("Redis is not supported on Cloudflare Workers");
  }
}
