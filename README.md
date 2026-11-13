# ShipKit workflows

The shared GitHub Actions workflow used by [ShipKit](https://github.com/gunjankothari/shipkit-app) cloud builds.

When you ask ShipKit for a cloud build, the one small file it added to your repository
(`.github/workflows/shipkit-build.yml`) calls `.github/workflows/build.yml` in this repository.
That workflow:

1. Checks out your app's code (read-only).
2. Installs packages and, for Expo apps, generates the native project.
3. Signs the build with keys ShipKit placed in your repository's encrypted secrets for the length of the build.
4. Uploads the build to the store, or leaves it as a one-day artifact for the ShipKit desktop app to upload.

It never commits to your repository and never runs on its own.

## Files

- `.github/workflows/build.yml` — the reusable workflow.
- `scripts/*.mjs` — helper scripts. These are generated from the ShipKit app's source
  (`npm run build:ci` in the app repository) so that local and cloud builds share the same logic. Do not edit them by hand.

## Versions

Users' workflow files pin a major version tag (`@v1`). Backwards-compatible fixes move the `v1` tag.
A breaking change gets a new major tag, delivered to users as a new pull request from the ShipKit app.
