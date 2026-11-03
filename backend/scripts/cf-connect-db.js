#!/usr/bin/env node
/**
 * Connect the deployed Spenit Worker to your Postgres, in one command.
 *
 *   npm run cf:connect-db -- "postgresql://USER:PASSWORD@HOST:5432/postgres"
 *   (or set DATABASE_URL in the environment instead of passing it as an argument)
 *
 * Query caching is switched OFF on the Hyperdrive config: it is on by default (60 s) and is not
 * cleared when you write, so a refresh right after adding an expense could show the old list.
 *
 * What it does:
 *   1. builds the backend and applies every SQL migration to your database
 *   2. creates (or updates) a Cloudflare Hyperdrive config named "spenit-db" for it
 *   3. writes the Hyperdrive binding into wrangler.jsonc
 *   4. deploys the Worker
 *   5. checks https://<worker>/health
 *
 * Supabase note: its "Direct connection" host (db.<ref>.supabase.co) has only an IPv6 address,
 * which many home networks cannot reach. If step 1 cannot connect, the script looks up your
 * project's IPv4 "Session pooler" itself and retries through it.
 *
 * Options:
 *   --migrate-url=<url>  use a different connection string for step 1 only
 *   --no-ssl             the database does not use TLS (local Docker only)
 *   --skip-migrate       skip step 1
 *   --dry                run step 1 only (no Cloudflare changes)
 *
 * The connection string is never printed (the password is masked).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.find((a) => a.startsWith(name + "=")) || "").slice(name.length + 1) || undefined;
const positional = args.find((a) => !a.startsWith("--"));

const databaseUrl = positional || process.env.DATABASE_URL;
const migrateUrl = opt("--migrate-url") || databaseUrl;
const ssl = !flag("--no-ssl");

const say = (m) => console.log(m);
const fail = (m) => {
  console.error("\n✗ " + m + "\n");
  process.exit(1);
};
const mask = (u) => u.replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:****@");
const scrub = (t) => t.replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgresql://<hidden>");

if (!databaseUrl || !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  fail(
    'Pass your Postgres connection string, e.g.\n  npm run cf:connect-db -- "postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres"'
  );
}

const node = process.execPath;
// Package "exports" hide the bin files from require.resolve, so locate them directly.
const bin = (pkg, file) => path.join(root, "node_modules", pkg, "bin", file);
const wrangler = bin("wrangler", "wrangler.js");
const run = (file, fileArgs, extra = {}) => spawnSync(file, fileArgs, { cwd: root, encoding: "utf8", ...extra });

// ── Supabase: find the IPv4 "Session pooler" of a project ─────────────────────────────
// The region is not in the direct URL, so ask each pooler: the right one recognises the
// project (it connects, or answers with a password error); the others say "Tenant or user not found".
const POOLER_REGIONS = [
  "ap-southeast-1", "ap-south-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1", "ca-central-1", "sa-east-1",
];

async function discoverSupabasePooler(directUrl) {
  const m = /^postgres(?:ql)?:\/\/([^:]+):([^@]*)@db\.([a-z0-9]+)\.supabase\.co(?::\d+)?\/(.*)$/i.exec(directUrl);
  if (!m) return null; // not a Supabase direct URL
  const password = m[2];
  const ref = m[3];
  const dbPath = m[4];
  const { Client } = require("pg");

  const hosts = [];
  for (const prefix of ["aws-0", "aws-1"]) for (const region of POOLER_REGIONS) hosts.push(`${prefix}-${region}.pooler.supabase.com`);

  const probes = await Promise.all(
    hosts.map(async (host) => {
      const c = new Client({
        host,
        port: 5432,
        user: `postgres.${ref}`,
        password: decodeURIComponent(password),
        database: decodeURIComponent(dbPath.split("?")[0] || "postgres"),
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 7000,
      });
      try {
        await c.connect();
        await c.end();
        return { host, found: true };
      } catch (e) {
        const msg = String((e && e.message) || e);
        return { host, found: !/tenant or user not found|ENOTFOUND|ECONNREFUSED|timeout|ETIMEDOUT/i.test(msg) };
      }
    })
  );
  const hit = probes.find((p) => p.found);
  return hit ? `postgresql://postgres.${ref}:${password}@${hit.host}:5432/${dbPath}` : null;
}

const UNREACHABLE = /ENETUNREACH|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/;

async function main() {
  let poolerUrl = null; // set when we had to discover it

  // ── 1. migrations ───────────────────────────────────────────────────────────────
  if (!flag("--skip-migrate")) {
    say("1/5  Building and applying database migrations…");
    const tsc = run(node, [bin("typescript", "tsc")]);
    if (tsc.status !== 0) fail("TypeScript build failed:\n" + tsc.stdout + tsc.stderr);

    const migrateWith = (url) => {
      say("     database: " + mask(url));
      const r = run(node, [path.join("dist", "db", "migrate.js")], {
        env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: ssl ? "true" : "false" },
      });
      return { ok: r.status === 0, text: (r.stdout || "") + (r.stderr || "") };
    };

    let result = migrateWith(migrateUrl);

    if (!result.ok && !opt("--migrate-url") && UNREACHABLE.test(result.text)) {
      say("     Cannot reach the database directly (its address is IPv6-only and this network has no IPv6).");
      say("     Looking for your project's IPv4 Session pooler…");
      poolerUrl = await discoverSupabasePooler(databaseUrl);
      if (poolerUrl) {
        say("     found it: " + mask(poolerUrl).replace(/^postgresql:\/\/[^@]+@/, ""));
        result = migrateWith(poolerUrl);
      } else {
        say("     Could not find it automatically.");
      }
    }

    if (!result.ok) {
      const authFailed = /password authentication failed|SASL|authentication failed/i.test(result.text);
      let hint = "";
      if (authFailed) {
        hint = "\n  The database rejected the password. Check it (Supabase → Project Settings → Database → Reset database password).";
      } else if (UNREACHABLE.test(result.text)) {
        hint =
          '\n  This network cannot reach the database. Copy the "Session pooler" connection string from Supabase\n  (Connect → Session pooler) and pass it with --migrate-url="..."';
      }
      // Show the meaningful lines, not the whole error object dump.
      const lines = scrub(result.text).split("\n").filter(Boolean);
      const key = lines.filter((l) => /error:|failed|ENOTFOUND|ENETUNREACH|ECONN|ETIMEDOUT|authentication|code:/i.test(l));
      const tail = (key.length ? key : lines).slice(0, 4).join("\n");
      fail("Migrations failed:\n" + tail + hint);
    }
    process.stdout.write(
      result.text.split("\n").filter((l) => /apply|skip|✅/i.test(l)).join("\n") + "\n"
    );
  } else {
    say("1/5  Skipping migrations (--skip-migrate)");
  }

  if (flag("--dry")) {
    say("\n✓ Dry run finished: migrations are applied. No Cloudflare changes were made.");
    return;
  }

  // ── 2. Hyperdrive config ──────────────────────────────────────────────────────────
  say("2/5  Creating the Hyperdrive config on Cloudflare…");
  const NAME = "spenit-db";
  let hyperdriveUrl = databaseUrl;
  let created = run(node, [wrangler, "hyperdrive", "create", NAME, "--connection-string=" + hyperdriveUrl, "--caching-disabled"]);
  let createdOut = (created.stdout || "") + (created.stderr || "");
  if (created.status !== 0 && !/already exists/i.test(createdOut) && poolerUrl) {
    say("     Cloudflare could not use the direct address: trying the pooler address instead…");
    hyperdriveUrl = poolerUrl;
    created = run(node, [wrangler, "hyperdrive", "create", NAME, "--connection-string=" + hyperdriveUrl, "--caching-disabled"]);
    createdOut = (created.stdout || "") + (created.stderr || "");
  }

  let id;
  if (created.status === 0) {
    id = (createdOut.match(/"id":\s*"([0-9a-f]{32})"/i) || [])[1];
  } else if (/already exists/i.test(createdOut)) {
    say("     a config named spenit-db already exists: updating it");
    const list = run(node, [wrangler, "hyperdrive", "list"]);
    const row = ((list.stdout || "").split("\n").find((l) => l.includes(NAME)) || "");
    id = (row.match(/[0-9a-f]{32}/i) || [])[0] || (row.match(/[0-9a-f-]{36}/i) || [])[0];
    if (!id) fail("Could not find the existing Hyperdrive config id. Run: npx wrangler hyperdrive list");
    const upd = run(node, [wrangler, "hyperdrive", "update", id, "--connection-string=" + hyperdriveUrl, "--caching-disabled"]);
    if (upd.status !== 0) fail("Could not update Hyperdrive:\n" + scrub((upd.stderr || upd.stdout).split("\n").slice(-8).join("\n")));
  } else {
    fail(
      "Cloudflare could not create the Hyperdrive config (it tests the connection first):\n" +
        scrub(createdOut).split("\n").slice(-12).join("\n") +
        "\n  Check the connection string, the password, and that the database accepts connections from the internet."
    );
  }
  if (!id) fail("Hyperdrive was created but its id could not be read. Run: npx wrangler hyperdrive list");
  say("     config id: " + id);

  // ── 3. wire it into wrangler.jsonc ────────────────────────────────────────────────
  say("3/5  Adding the binding to wrangler.jsonc…");
  const cfgPath = path.join(root, "wrangler.jsonc");
  let cfg = fs.readFileSync(cfgPath, "utf8");
  const block = '"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "' + id + '" }]';
  if (/"hyperdrive":\s*\[[^\]]*\]/.test(cfg)) cfg = cfg.replace(/"hyperdrive":\s*\[[^\]]*\]/, block);
  else fail('wrangler.jsonc has no "hyperdrive" entry to update.');
  fs.writeFileSync(cfgPath, cfg);

  // ── 4. deploy ─────────────────────────────────────────────────────────────────────
  say("4/5  Deploying the Worker…");
  const dep = run(node, [wrangler, "deploy"]);
  const depOut = (dep.stdout || "") + (dep.stderr || "");
  if (dep.status !== 0) fail("Deploy failed:\n" + depOut.split("\n").slice(-12).join("\n"));
  const url = (depOut.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0];

  // ── 5. verify ─────────────────────────────────────────────────────────────────────
  say("5/5  Checking the live API…");
  if (!url) {
    say("     deployed (could not detect the URL: run `npm run cf:tail` to look)");
    return;
  }
  let health = null;
  for (let i = 0; i < 6 && !health; i++) {
    try {
      const r = await fetch(url + "/health", { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.services && j.services.postgres === "ok") health = j;
    } catch {}
    if (!health) await new Promise((r) => setTimeout(r, 3000));
  }
  if (health) {
    say("\n✓ Done. " + url + "/health reports: " + JSON.stringify(health.services));
    say("\nNext: set BACKEND_URL=" + url + " in Vercel and redeploy the frontend (see DEPLOYMENT.md, step C).");
  } else {
    say("\n⚠ Deployed, but " + url + "/health does not report Postgres ok yet.");
    say("   Run `npm run cf:tail`, open the URL again, and read the error. DEPLOYMENT.md has a troubleshooting table.");
    process.exit(2);
  }
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
