// src/ci/prepare-android.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/core/actions/androidBuild.ts
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// src/core/build/nativeEdits.ts
function applyAndroidVersionCode(gradle, versionCode) {
  const re = /(\bversionCode\b\s*=?\s*)([^\n]+)/;
  if (!re.test(gradle)) {
    throw new UserFacingError("ShipKit couldn't find where the Android build number is set.", {
      hint: 'android/app/build.gradle should contain a "versionCode" line inside defaultConfig.'
    });
  }
  return gradle.replace(re, (_m, prefix) => `${prefix}${versionCode}`);
}

// src/core/actions/androidBuild.ts
function gradleFile(androidDir) {
  for (const name of ["build.gradle", "build.gradle.kts"]) {
    const f = join(androidDir, "app", name);
    if (existsSync(f)) return f;
  }
  throw new UserFacingError("ShipKit couldn't find the Android build file.", { hint: "android/app/build.gradle should exist after the project is prepared." });
}
var AAB_RELATIVE = join("android", "app", "build", "outputs", "bundle", "release", "app-release.aab");

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

// src/ci/prepare-android.ts
main(async () => {
  const buildNumber = Number(requireEnv("SHIPKIT_BUILD_NUMBER"));
  const file = gradleFile(join2(process.cwd(), "android"));
  writeFileSync2(file, applyAndroidVersionCode(readFileSync2(file, "utf8"), buildNumber));
  console.log(`Build number ${buildNumber} applied.`);
});
