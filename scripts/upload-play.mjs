// src/core/google/play.ts
import { readFileSync } from "node:fs";

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

// src/core/google/play.ts
var API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
var UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";
var PLAY_LINKS = {
  console: "https://play.google.com/console",
  createApp: "https://play.google.com/console/developers/create-new-app",
  uploadKeyHelp: "https://support.google.com/googleplay/android-developer/answer/9842756"
};
var PlayClient = class {
  constructor(packageName, getAccessToken, fetchImpl = fetch) {
    this.packageName = packageName;
    this.getAccessToken = getAccessToken;
    this.fetchImpl = fetchImpl;
  }
  async request(method, url, body, raw) {
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...raw ? { "Content-Type": raw.contentType } : body ? { "Content-Type": "application/json" } : {}
      },
      body: raw ? raw.data : body ? JSON.stringify(body) : void 0
    });
    const text = await res.text();
    if (!res.ok) throw this.toError(res.status, text);
    return text ? JSON.parse(text) : void 0;
  }
  toError(status, text) {
    let message = text.slice(0, 400);
    try {
      message = JSON.parse(text).error?.message ?? message;
    } catch {
    }
    if (status === 404 && /package|not found|No application/i.test(message)) {
      return new UserFacingError(`Google Play doesn't have an app called "${this.packageName}" in this account yet.`, {
        hint: "Create the app in Play Console first (Google does not let other tools create it), then try again. Make sure you are connected with the Google account that owns the app.",
        link: PLAY_LINKS.createApp
      });
    }
    if (status === 401) {
      return new UserFacingError("Your Google Play connection has expired.", { hint: "Connect Google Play again. Nothing else is lost." });
    }
    if (status === 403) {
      return new UserFacingError("This Google account isn't allowed to manage this app.", {
        hint: "Connect with the account that owns the app, or ask the owner to give your account release permissions in Play Console.",
        link: PLAY_LINKS.console
      });
    }
    if (/first.*(upload|release)|must be uploaded.*Play Console|APK.*never.*uploaded/i.test(message)) {
      return new UserFacingError("Google needs the very first build of a new app to be uploaded by hand.", {
        hint: "ShipKit has saved the build file. Upload it once in Play Console under Testing \u2192 Internal testing. After that, ShipKit can upload every build for you.",
        link: PLAY_LINKS.console
      });
    }
    if (/closed test|production access|12 testers|not.*eligible.*production/i.test(message)) {
      return new UserFacingError("Google isn't letting this app go to production yet.", {
        hint: "New personal developer accounts must run a closed test with enough testers for two weeks before the first public release. Play Console shows your progress on the Dashboard.",
        link: PLAY_LINKS.console
      });
    }
    return new Error(`Google Play returned an error (${status}): ${message}`);
  }
  base() {
    return `${API}/${encodeURIComponent(this.packageName)}`;
  }
  async openEdit() {
    return (await this.request("POST", `${this.base()}/edits`)).id;
  }
  async discardEdit(editId) {
    await this.request("DELETE", `${this.base()}/edits/${editId}`).catch(() => void 0);
  }
  async commitEdit(editId) {
    await this.request("POST", `${this.base()}/edits/${editId}:commit`);
  }
  /** Runs a read-only block inside an edit that is always discarded. */
  async readOnly(fn) {
    const editId = await this.openEdit();
    try {
      return await fn(editId);
    } finally {
      await this.discardEdit(editId);
    }
  }
  /** Proves the connected account can see this app. */
  async validate() {
    await this.readOnly(async () => void 0);
  }
  /** Every version code Google has seen: uploaded bundles and anything assigned to a track. */
  async listVersionCodes() {
    return this.readOnly(async (editId) => {
      const codes = /* @__PURE__ */ new Set();
      const bundles = await this.request("GET", `${this.base()}/edits/${editId}/bundles`);
      for (const b of bundles?.bundles ?? []) codes.add(b.versionCode);
      const tracks = await this.request("GET", `${this.base()}/edits/${editId}/tracks`);
      for (const t of tracks?.tracks ?? []) for (const r of t.releases ?? []) for (const c of r.versionCodes ?? []) codes.add(Number(c));
      return [...codes].filter((n) => Number.isFinite(n));
    });
  }
  /** Uploads a bundle and assigns it to a track in one committed edit. */
  async uploadBundle(aabPath, track, releaseName) {
    const editId = await this.openEdit();
    try {
      const uploaded = await this.request(
        "POST",
        `${UPLOAD}/${encodeURIComponent(this.packageName)}/edits/${editId}/bundles?uploadType=media`,
        void 0,
        { data: readFileSync(aabPath), contentType: "application/octet-stream" }
      );
      const put = (status2) => this.request("PUT", `${this.base()}/edits/${editId}/tracks/${track}`, {
        track,
        releases: [{ name: releaseName, versionCodes: [String(uploaded.versionCode)], status: status2 }]
      });
      let status = "completed";
      try {
        await put("completed");
      } catch (err) {
        if (!(err instanceof Error) || !/draft/i.test(err.message)) throw err;
        status = "draft";
        await put("draft");
      }
      await this.commitEdit(editId);
      return { versionCode: uploaded.versionCode, status };
    } catch (err) {
      await this.discardEdit(editId);
      throw err;
    }
  }
  async getTrack(track) {
    return this.readOnly(async (editId) => {
      const t = await this.request("GET", `${this.base()}/edits/${editId}/tracks/${track}`);
      return t?.releases ?? [];
    });
  }
  /** Moves a version code that is already on Google Play onto another track. */
  async promote(versionCode, toTrack, releaseName) {
    const editId = await this.openEdit();
    try {
      await this.request("PUT", `${this.base()}/edits/${editId}/tracks/${toTrack}`, {
        track: toTrack,
        releases: [{ name: releaseName, versionCodes: [String(versionCode)], status: "completed" }]
      });
      await this.commitEdit(editId);
    } catch (err) {
      await this.discardEdit(editId);
      throw err;
    }
  }
  async listListings() {
    return this.readOnly(async (editId) => {
      const res = await this.request("GET", `${this.base()}/edits/${editId}/listings`);
      return res?.listings ?? [];
    });
  }
  async countImages(language, imageTypes) {
    return this.readOnly(async (editId) => {
      const out = {};
      for (const type of imageTypes) {
        const res = await this.request("GET", `${this.base()}/edits/${editId}/listings/${language}/${type}`);
        out[type] = res?.images?.length ?? 0;
      }
      return out;
    });
  }
};

// src/ci/common.ts
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
function main(fn) {
  fn().catch((err) => {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

// src/ci/upload-play.ts
main(async () => {
  const cfg = readConfig();
  if (!cfg.androidPackage) throw new Error("The Android package name is missing from the build settings.");
  const token = requireEnv("SHIPKIT_GOOGLE_ACCESS_TOKEN");
  const client = new PlayClient(cfg.androidPackage, async () => token, fetch);
  const res = await client.uploadBundle(requireEnv("SHIPKIT_AAB_PATH"), "internal", cfg.releaseName);
  console.log(`Uploaded build ${res.versionCode} to internal testing (${res.status}).`);
});
