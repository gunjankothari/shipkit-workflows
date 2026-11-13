// src/ci/prepare-ios.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

// src/core/build/iosLocal.ts
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// src/core/types.ts
var UserFacingError = class extends Error {
  /** A plain-language next step for a non-technical reader. */
  hint;
  link;
  constructor(message, opts = {}) {
    super(message);
    this.name = "UserFacingError";
    this.hint = opts.hint;
    this.link = opts.link;
    if (opts.cause !== void 0) this.cause = opts.cause;
  }
};

// src/core/build/iosLocal.ts
var PROFILE_DIRS = [
  join(homedir(), "Library", "MobileDevice", "Provisioning Profiles"),
  join(homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles")
];
async function xcodeVersion(exec2) {
  const res = await exec2("xcodebuild", ["-version"], { allowFailure: true });
  return res.code === 0 ? res.stdout.match(/Xcode\s+([\d.]+)/)?.[1] : void 0;
}

// src/core/build/nativeEdits.ts
var MANAGED_KEYS = [
  "CODE_SIGN_STYLE",
  "DEVELOPMENT_TEAM",
  "PROVISIONING_PROFILE_SPECIFIER",
  "PROVISIONING_PROFILE",
  "CODE_SIGN_IDENTITY",
  '"CODE_SIGN_IDENTITY\\[sdk=iphoneos\\*\\]"',
  "CURRENT_PROJECT_VERSION"
];
function applyIosBuildSettings(pbx, bundleId, s) {
  let blocks = 0;
  const otherBundleIds = /* @__PURE__ */ new Set();
  const blockRe = /(buildSettings = \{\n)([\s\S]*?)(\n\t*\};)/g;
  const idRe = /PRODUCT_BUNDLE_IDENTIFIER = "?([^";\n]+)"?;/;
  const out = pbx.replace(blockRe, (whole, open, body, close) => {
    const id = body.match(idRe)?.[1]?.trim();
    if (!id) return whole;
    if (id !== bundleId) {
      if (!/tests?$/i.test(id) && !id.includes("$(")) otherBundleIds.add(id);
      return whole;
    }
    blocks++;
    const indent = body.match(/^(\t+)/)?.[1] ?? "				";
    const kept = body.split("\n").filter((line) => !MANAGED_KEYS.some((k) => new RegExp(`^\\s*${k} = `).test(line)));
    kept.push(
      `${indent}CODE_SIGN_IDENTITY = "Apple Distribution";`,
      `${indent}CODE_SIGN_STYLE = Manual;`,
      `${indent}CURRENT_PROJECT_VERSION = ${s.buildNumber};`,
      `${indent}DEVELOPMENT_TEAM = ${s.teamId};`,
      `${indent}PROVISIONING_PROFILE_SPECIFIER = "${s.profileName.replace(/"/g, '\\"')}";`
    );
    return `${open}${kept.join("\n")}${close}`;
  });
  if (blocks === 0) {
    throw new UserFacingError(`ShipKit couldn't find the app "${bundleId}" inside the iPhone project.`, {
      hint: "The bundle identifier in the project is different from the one ShipKit has for this app. Check the app details in ShipKit."
    });
  }
  return { pbx: out, blocks, otherBundleIds: [...otherBundleIds] };
}
function exportOptionsPlist(opts) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>${esc(opts.method)}</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>${esc(opts.teamId)}</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${esc(opts.bundleId)}</key><string>${esc(opts.profileName)}</string>
  </dict>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`;
}
function exportMethodFor(xcodeVersion2) {
  const [major = 0, minor = 0] = (xcodeVersion2 ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  return major > 15 || major === 15 && minor >= 3 ? "app-store-connect" : "app-store";
}

// src/core/build/prepare.ts
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join as join2, relative, sep } from "node:path";
function findWorkspace(iosDir) {
  const entries = existsSync(iosDir) ? readdirSync(iosDir) : [];
  const workspace = entries.find((f) => f.endsWith(".xcworkspace"));
  const project = entries.find((f) => f.endsWith(".xcodeproj") && f !== "Pods.xcodeproj");
  if (!workspace || !project) {
    throw new UserFacingError("ShipKit couldn't find the iPhone project inside this app.", {
      hint: 'The "ios" folder should contain an .xcworkspace file after packages are installed.'
    });
  }
  return { workspace: join2(iosDir, workspace), scheme: project.replace(/\.xcodeproj$/, ""), projectFile: join2(iosDir, project, "project.pbxproj") };
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
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing.`);
  return v;
}
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}
`);
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

// src/ci/prepare-ios.ts
main(async () => {
  const cfg = readConfig();
  const buildNumber = Number(requireEnv("SHIPKIT_BUILD_NUMBER"));
  if (!cfg.iosBundleId || !cfg.teamId || !cfg.profileName) throw new Error("The iPhone signing details are missing from the build settings.");
  const ws = findWorkspace(join3(process.cwd(), "ios"));
  const edited = applyIosBuildSettings(readFileSync2(ws.projectFile, "utf8"), cfg.iosBundleId, { teamId: cfg.teamId, profileName: cfg.profileName, buildNumber });
  if (edited.otherBundleIds.length > 0) throw new Error(`This app includes an extension, which ShipKit cannot sign yet: ${edited.otherBundleIds.join(", ")}`);
  writeFileSync2(ws.projectFile, edited.pbx);
  const plist = join3(process.cwd(), "ios", ws.scheme, "Info.plist");
  if (existsSync3(plist)) await exec("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleVersion ${buildNumber}`, plist], { allowFailure: true });
  mkdirSync("build", { recursive: true });
  writeFileSync2(join3("build", "ExportOptions.plist"), exportOptionsPlist({ method: exportMethodFor(await xcodeVersion(exec)), teamId: cfg.teamId, bundleId: cfg.iosBundleId, profileName: cfg.profileName }));
  setOutput("workspace", ws.workspace);
  setOutput("scheme", ws.scheme);
  console.log(`Signing applied to ${edited.blocks} build configuration(s); build ${buildNumber}.`);
});
