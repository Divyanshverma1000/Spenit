// Minimal typings for the Cloudflare Workers runtime modules this project imports.
// (They only exist inside the Workers runtime; Node never loads the files that use them.)
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  export function waitUntil(promise: Promise<unknown>): void;
}
declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response> | Response;
  };
}
