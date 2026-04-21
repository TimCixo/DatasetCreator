# Deployment Guide

DatasetCreator is a static client-side Vite app. The default deployment target is GitHub Pages at:

```text
https://timcixo.github.io/DatasetCreator/
```

## GitHub Pages

The repository includes a GitHub Actions workflow:

```text
.github/workflows/deploy-pages.yml
```

It runs on every push to `main` and does the following:

1. Installs dependencies with `npm ci`.
2. Builds the app with `npm run build`.
3. Uploads the generated `dist/` folder as a Pages artifact.
4. Deploys it with the official GitHub Pages action.

## Required Repository Setting

In GitHub, open:

```text
Settings -> Pages -> Build and deployment
```

Set **Source** to:

```text
GitHub Actions
```

After that, every push to `main` will publish the latest build.

## Vite Base Path

GitHub Pages serves this repository from `/DatasetCreator/`, so Vite is configured with:

```ts
base: '/DatasetCreator/'
```

Do not change this unless the repository name or deployment path changes.

## Local Production Check

Before pushing deployment changes:

```bash
npm run build
npm run preview
```

The production preview should load correctly with the `/DatasetCreator/` base path.

## Notes

* `public/.nojekyll` is included so GitHub Pages serves generated assets without Jekyll processing.
* No backend or environment variables are required for the default workflow.
* Local model files for Stage 7 are selected by the user in the browser and are not deployed with the app.
* The generated `dist/` folder stays ignored by git and is uploaded only by GitHub Actions.

## Manual Static Hosting

For Vercel, Netlify, or another static host:

```bash
npm run build
```

Deploy the generated `dist/` folder.

If hosting from a root domain instead of `/DatasetCreator/`, update `vite.config.ts` accordingly.
