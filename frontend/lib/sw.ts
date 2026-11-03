/**
 * The service worker script URL. Caching is enabled only in production builds
 * (see public/sw.js). Everything that registers the worker must use this same URL,
 * otherwise browsers treat it as a different script and swap registrations.
 */
export const SW_URL =
  process.env.NODE_ENV === "production" ? "/sw.js?cache=1&v=1" : "/sw.js";
