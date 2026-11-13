// src/core/build/profilePack.ts
import { gunzipSync, gzipSync } from "node:zlib";
function unpackProfiles(packed) {
  return JSON.parse(gunzipSync(Buffer.from(packed, "base64")).toString("utf8"));
}

// src/core/apple/signing.ts
function inspectProfile(base64Profile) {
  const text = Buffer.from(base64Profile, "base64").toString("latin1");
  const value = (key) => text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1] ?? null;
  const team = text.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
  return { name: value("Name"), uuid: value("UUID"), teamId: team };
}

// src/core/build/iosLocal.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
var PROFILE_DIRS = [
  join(homedir(), "Library", "MobileDevice", "Provisioning Profiles"),
  join(homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles")
];
function installProfile(base64Profile, uuid) {
  const files = [];
  for (const dir of PROFILE_DIRS) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${uuid}.mobileprovision`);
    if (!existsSync(file)) {
      writeFileSync(file, Buffer.from(base64Profile, "base64"));
      files.push(file);
    }
  }
  return () => files.forEach((f) => rmSync(f, { force: true }));
}

// src/ci/common.ts
import { appendFileSync, existsSync as existsSync2 } from "node:fs";
import { resolve, sep } from "node:path";
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
  if (dir !== root && !dir.startsWith(root + sep)) throw new Error("The app folder must be inside the repository.");
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

// src/ci/install-profiles.ts
main(async () => {
  const profiles = unpackProfiles(requireEnv("SHIPKIT_IOS_PROFILE_BASE64"));
  for (const content of profiles) {
    const info = inspectProfile(content);
    if (!info.uuid) throw new Error("A provisioning profile could not be read.");
    installProfile(content, info.uuid);
    console.log(`Installed profile "${info.name ?? info.uuid}".`);
  }
});
