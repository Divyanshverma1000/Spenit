#!/usr/bin/env node
/**
 * Run the Worker locally in Cloudflare's real runtime (workerd), against your local Postgres.
 *   npm run cf:dev
 * Needs backend/.dev.vars (local secrets, git-ignored). See .dev.vars.example.
 * Local Postgres defaults to the docker-compose one; override with LOCAL_DATABASE_URL.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
const cfg = JSON.parse(raw.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));

cfg.hyperdrive = [
  {
    binding: "HYPERDRIVE",
    id: "00000000000000000000000000000000", // placeholder: only the local connection string is used in dev
    localConnectionString:
      process.env.LOCAL_DATABASE_URL || "postgresql://spenit:spenit@127.0.0.1:5432/spenit",
  },
];

const localCfg = path.join(root, "wrangler.local.jsonc"); // git-ignored, regenerated every run
fs.writeFileSync(localCfg, JSON.stringify(cfg, null, 2));

const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const child = spawn(process.execPath, [wrangler, "dev", "-c", "wrangler.local.jsonc", "--port", "8787", "--local", "--test-scheduled"], {
  cwd: root,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
