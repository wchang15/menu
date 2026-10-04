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
- Private cloud media with signed upload and download URLs
- IndexedDB caching and offline fallback for tablet reliability
- Android and iOS packaging through Capacitor

## Architecture

| Area | Implementation |
| --- | --- |
| Web application | Next.js App Router and React |
| Authentication | Supabase Auth |
| Cloud data and media | Supabase Storage with server-side signed URLs |
| Local resilience | IndexedDB cache with remote synchronization |
| Native runtime | Capacitor for Android and iOS |
| Editing | Reusable templates plus a free-form canvas |

The browser editor and tablet player use the same language-scoped layout model. Media is stored by asset path rather than by expiring URL, then resolved through short-lived signed URLs at runtime. Local bundles preserve the last usable menu while cloud content refreshes in the background.

## Repository Structure

```text
app/          Next.js routes, authentication, and server endpoints
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

3. Add a Supabase project URL, anonymous key, and server-only service-role key to `.env.local`.

4. Start the application.

```bash
npm run dev
```

Production credentials are not stored in this repository. The service-role key is used only by server routes that issue signed media operations.

## Build

```bash
npm run build
```

The GitHub Actions workflow runs the same production build for every pull request and push to `main`.

## Android

```bash
npm run build
npx cap sync android
npx cap open android
```

## Related System

This repository covers the restaurant-facing tablet menu surface. Customer QR ordering, payment, staff fulfillment, and kitchen-print dispatch are maintained as a separate operational service and are documented in the portfolio case study.
