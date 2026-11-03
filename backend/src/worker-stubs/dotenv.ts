// Workers have no .env file: variables come from wrangler.jsonc "vars" and secrets.
const dotenv = { config: () => ({ parsed: {} as Record<string, string> }) };
export default dotenv;
export const config = dotenv.config;
