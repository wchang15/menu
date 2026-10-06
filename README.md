# Restaurant Tablet Menu Platform

[![CI](https://github.com/wchang15/menu/actions/workflows/ci.yml/badge.svg)](https://github.com/wchang15/menu/actions/workflows/ci.yml)

An authenticated bilingual menu-board application for restaurant tablets. The product lets staff build and publish portrait menus, upload private media, and play the finished experience inside an Android application.

[Portfolio case study](https://woochangchang.com/restaurant-platform.html)

## Product Scope

- English and Korean menu publishing
- Template-based and free-form menu composition
- Drag, resize, typography, image, logo, QR, and background controls
- Authenticated account, recovery, and session flows
- Intro-video upload and menu playback
- Authenticated uploads to a private Storage bucket and short-lived download URLs
- IndexedDB caching and offline fallback for tablet reliability
- Android and iOS packaging through Capacitor

## Architecture

| Area | Implementation |
| --- | --- |
| Web application | Next.js App Router and React |
| Authentication | Supabase Auth |
| Cloud data and media | Private Supabase Storage, authenticated client uploads, RLS-scoped signed downloads |
| Local resilience | IndexedDB cache with remote synchronization |
| Native runtime | Capacitor for Android and iOS |
| Editing | Reusable templates plus a free-form canvas |

The browser editor and tablet player use the same language-scoped layout model. Media is stored by asset path rather than by expiring URL, then resolved through short-lived signed URLs at runtime. Local bundles preserve the last usable menu while cloud content refreshes in the background.

## Repository Structure

```text
app/          Next.js pages and authentication (static export)
components/   Editor, template canvas, and tablet player
lib/          Cloud media, cache, and menu-bundle coordination
android/      Capacitor Android project
ios/          Capacitor iOS project
public/       Template photography and static assets
```

## Local Setup

1. Install Node.js 22 and dependencies.

```bash
npm ci
```

2. Create the local environment file.

```bash
cp .env.example .env.local
```

3. Add your Supabase project URL and public anonymous key to `.env.local`.
   Use a dedicated test project and run `supabase/storage-setup.sql`. Create a test
   account in Supabase Auth. Each account can access only its own UUID-prefixed
   objects in the private `assets` bucket. Never make the bucket public.

4. Start the application.

```bash
npm run dev
```

The normal web/tablet build does **not** require a service-role key. `next.config.js`
uses `output: "export"`; the Capacitor app loads `out/`, without a Next.js server.
`lib/cloudAssets.js` uploads through the signed-in Supabase client and requests
download URLs from Supabase Storage using that same session. Storage policies,
not a trusted frontend, enforce the user folder boundary. The old `/api/assets/*`
server-signing routes are retired and return 410 in development; they are not
part of the static tablet runtime. Do not enable them by adding service credentials.

On an existing Supabase project, inspect existing Storage policies before applying
the sample SQL: permissive policies are combined with OR, so an older broad policy
can defeat the folder restriction. The setup script deliberately does not alter
unrelated policies. Verify with two test accounts that account B cannot list,
download, overwrite, or sign account A's objects, and that anonymous access fails.
That live isolation check is not covered by the build-only CI job.

## Build

```bash
npm run build
```

The GitHub Actions workflow runs the same static production build without service
credentials for every pull request and push to `main`. Serve `out/` with a static
host to preview the build; `next start` is not the runtime for this export.

## Android

```bash
npm run build
npx cap sync android
npx cap open android
```

The October 2026 review updates Capacitor to 8.5.2. Rebuild and reinstall native
apps after syncing: changing JavaScript dependencies does not patch an APK or iOS
binary already on a device. CI verifies the web export, not native packages.

## Related System

This repository covers the restaurant-facing tablet menu surface. Review the
[TypeScript ordering companion](https://github.com/wchang15/restaurant-ordering-demo)
for customer QR ordering, payment, staff fulfillment, kitchen-print dispatch, and
its independent test suite. Both are internal-test demonstrations.
