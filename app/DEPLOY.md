# Deploying Read It Out

The app is a fully static site (it talks to OpenRouter / a local Kokoro server / the
browser voice directly — no backend required), so the simplest, free option is
**Firebase Hosting**. A container route for **Cloud Run** is included as well, for when you
want the optional server-side `/api` voice proxy.

The build output is `dist/public` (`npm run build:static`).

---

## Option A — Firebase Hosting (recommended, free)

Free Spark tier covers this comfortably: global CDN, free SSL, custom domains,
~10 GB storage and ~360 MB/day transfer.

One-time setup:

```bash
npm i -g firebase-tools      # or rely on npx (the script does)
firebase login
# put your project id in .firebaserc (replace YOUR_FIREBASE_PROJECT_ID)
```

Deploy:

```bash
npm run deploy:firebase
# or: ./scripts/deploy-firebase.sh
# or: PROJECT_ID=my-firebase-project ./scripts/deploy-firebase.sh
```

Config lives in `firebase.json` (serves `dist/public`, long-cache for hashed assets,
no-cache for `index.html`).

---

## Option B — Google Cloud Run (container, runs the Node server)

Use this if you want the server-side `/api/speech` proxy (e.g. to offer premium voices
without each user bringing their own key). Builds the `Dockerfile` (frontend + bundled
Node server), serves on the `PORT` Cloud Run provides.

One-time: enable the Cloud Build, Artifact Registry, and Cloud Run APIs, and
`gcloud auth login`.

```bash
PROJECT_ID=my-gcp-project ./scripts/build.sh     # build + push image to Artifact Registry
PROJECT_ID=my-gcp-project ./scripts/deploy.sh    # deploy to Cloud Run
```

Both scripts take optional `REGION` (default `europe-west1`), `SERVICE`, `REPO`, `TAG`.
`deploy.sh` sets `PUBLIC_DEPLOY=true` by default — hosted mode: the operator's key is
never spent, the free browser voice stays available, and premium requires each user's own
key.
