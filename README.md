# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Offline-installable PWA

Build the static app shell and PWA files with `pnpm build:pwa`. The installable files are written to `.output/public` (including `_shell.html`, `service-worker.js`, the web manifest, icons, and route fallback rules).

Serve that folder from a secure HTTPS address. Phones must open that address once while connected, then install from the browser and allow the first load to finish so the app shell and scripts are cached. Android users can install from Chrome. On iPhone/iPad, open the address in Safari and choose **Share → Add to Home Screen**. A ZIP or folder opened directly as `file://` cannot be installed as a PWA.

The service worker caches only app resources; patient records stay in the app's encrypted browser storage on that device. Offline use does not synchronize records between devices. Browser data can be lost if the browser profile or site data is cleared, so keep encrypted backups.

## Publish to GitHub Pages

The `Deploy GitHub Pages` workflow builds and publishes the static app whenever a commit reaches `main`. In the repository, open **Settings → Pages** and set the build source to **GitHub Actions**. The workflow publishes `.output/public` and creates a `404.html` fallback for app routes.

This repository is configured as a GitHub Pages project site at `/HDW-connect/`. The build sets that base path for assets, routing, the web manifest, and service worker. The published site is publicly reachable even though this source repository is private. Use synthetic or de-identified data unless an approved clinical environment is in use; each device still stores its own records locally.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
