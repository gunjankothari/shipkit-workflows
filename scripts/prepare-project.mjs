// src/ci/prepare-project.ts
import { writeFileSync as writeFileSync2 } from "node:fs";

// src/core/build/prepare.ts
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
function installCommand(pm, hasLockfile) {
  switch (pm) {
    case "yarn":
      return { cmd: "yarn", args: ["install", "--frozen-lockfile"] };
    case "pnpm":
      return { cmd: "pnpm", args: ["install", "--frozen-lockfile"] };
    case "bun":
      return { cmd: "bun", args: ["install", "--frozen-lockfile"] };
    default:
      return hasLockfile ? { cmd: "npm", args: ["ci"] } : { cmd: "npm", args: ["install"] };
  }
}
async function installDependencies(exec2, dir, pm, env, onLine) {
  const { cmd, args } = installCommand(pm, existsSync(join(dir, "package-lock.json")));
  await exec2(cmd, args, { cwd: dir, env, onLine });
}
function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
    if (!m || !m[1]) continue;
    let v = m[2] ?? "";
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2 || v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
      const quote = v[0];
      v = v.slice(1, -1);
      if (quote === '"') v = v.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      v = v.replace(/\s+#.*$/, "").trim();
    }
    out[m[1]] = v;
  }
  return out;
}
async function expoPrebuild(exec2, dir, platform, ids, env, onLine) {
  const appJsonFile = join(dir, "app.json");
  if (existsSync(appJsonFile)) {
    const json = JSON.parse(readFileSync(appJsonFile, "utf8"));
    const expo = json.expo ??= {};
    const ios = expo.ios ??= {};
    const android = expo.android ??= {};
    expo.ios = ios;
    expo.android = android;
    if (ids.iosBundleId && !ios.bundleIdentifier) ios.bundleIdentifier = ids.iosBundleId;
    if (ids.androidPackage && !android.package) android.package = ids.androidPackage;
    writeFileSync(appJsonFile, JSON.stringify(json, null, 2));
  }
  await exec2("npx", ["expo", "prebuild", "--platform", platform, "--no-install", "--non-interactive"], {
    cwd: dir,
    env: { ...env, CI: "1", EXPO_NO_TELEMETRY: "1" },
    onLine
  });
}

// src/core/util/exec.ts
import { spawn } from "node:child_process";
var CommandError = class extends Error {
  constructor(cmd, result) {
    super(`${cmd} exited with code ${result.code}
${tail(result.stderr || result.stdout, 30)}`);
    this.cmd = cmd;
    this.result = result;
    this.name = "CommandError";
  }
};
function tail(text, lines) {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}
var exec = (cmd, args, opts = {}) => new Promise((resolve2, reject) => {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let pending = "";
  const feed = (chunk, isErr) => {
    const text = chunk.toString("utf8");
    if (isErr) stderr += text;
    else stdout += text;
    if (!opts.onLine) return;
    pending += text;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    for (const p of parts) opts.onLine(p);
  };
  child.stdout.on("data", (c) => feed(c, false));
  child.stderr.on("data", (c) => feed(c, true));
  const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : void 0;
  child.on("error", (err) => {
    if (timer) clearTimeout(timer);
    if (opts.allowFailure) resolve2({ code: 127, stdout, stderr: String(err) });
    else reject(err);
  });
  child.on("close", (code) => {
    if (timer) clearTimeout(timer);
    if (pending && opts.onLine) opts.onLine(pending);
    const result = { code: code ?? 1, stdout, stderr };
    if (result.code !== 0 && !opts.allowFailure) reject(new CommandError(cmd, result));
    else resolve2(result);
  });
  if (opts.input !== void 0) child.stdin.write(opts.input);
  child.stdin.end();
});

// src/ci/common.ts
import { appendFileSync, existsSync as existsSync2 } from "node:fs";
import { resolve, sep as sep2 } from "node:path";
function readConfig() {
  const raw = process.env.SHIPKIT_CONFIG;
  if (!raw) throw new Error("SHIPKIT_CONFIG is missing.");
  return JSON.parse(raw);
}
function exportEnv(name, value) {
  if (!process.env.GITHUB_ENV) return;
  const delim = `SHIPKIT_EOF_${Math.random().toString(36).slice(2)}`;
  appendFileSync(process.env.GITHUB_ENV, `${name}<<${delim}
${value}
${delim}
`);
}
function enterProjectDir() {
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const sub = (readConfig().projectDir ?? "").trim();
  const dir = resolve(root, sub);
  if (dir !== root && !dir.startsWith(root + sep2)) throw new Error("The app folder must be inside the repository.");
  if (!existsSync2(dir)) throw new Error(`The folder "${sub}" does not exist in this repository. Has it been pushed to GitHub?`);
  process.chdir(dir);
  return dir;
}
function main(fn) {
  Promise.resolve().then(() => {
    const dir = enterProjectDir();
    if (!existsSync2("package.json")) {
      throw new Error(`There is no package.json in "${readConfig().projectDir || "the top of the repository"}" on GitHub. Check that your app's code has been pushed.`);
    }
    exportEnv("SHIPKIT_PROJECT_DIR", dir);
  }).then(fn).catch((err) => {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

// src/ci/prepare-project.ts
main(async () => {
  const cfg = readConfig();
  const platform = process.argv[2] === "android" ? "android" : "ios";
  const dir = process.cwd();
  const log = (l) => console.log(l);
  const envText = process.env.SHIPKIT_ENV_FILE ?? "";
  const vars = parseEnvFile(envText);
  if (Object.keys(vars).length > 0) {
    writeFileSync2(".env", `${envText}
`, { mode: 384 });
    for (const [k, v] of Object.entries(vars)) {
      for (const line of v.split("\n")) if (line.length >= 4) console.log(`::add-mask::${line}`);
      exportEnv(k, v);
    }
  }
  const env = { ...process.env, ...vars, CI: "1" };
  if (cfg.packageManager === "bun") await exec("npm", ["install", "-g", "bun"], { onLine: log });
  if (cfg.packageManager === "yarn" || cfg.packageManager === "pnpm") await exec("corepack", ["enable"], { onLine: log, allowFailure: true });
  await installDependencies(exec, dir, cfg.packageManager, env, log);
  if (cfg.framework === "expo" && !cfg.hasNativeDirs) {
    await expoPrebuild(exec, dir, platform, { iosBundleId: cfg.iosBundleId, androidPackage: cfg.androidPackage }, env, log);
  }
});
