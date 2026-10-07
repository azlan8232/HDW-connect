import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { lockVault, useDB } from "../lib/hdw/store";
import { VaultGate } from "@/components/hdw/VaultGate";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="btn">Go home</Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">This page didn't load</h1>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="btn">Try again</button>
          <a href={import.meta.env.BASE_URL} className="btn btn-outline">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#142f59" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "HDW CONNECT" },
      { title: "HDW CONNECT" },
      { name: "description", content: "One Patient. One Clinical Record. Connected Care." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: `${import.meta.env.BASE_URL}favicon.ico`, type: "image/x-icon" },
      { rel: "manifest", href: `${import.meta.env.BASE_URL}manifest.webmanifest` },
      { rel: "apple-touch-icon", href: `${import.meta.env.BASE_URL}icons/apple-touch-icon.png`, sizes: "180x180" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { ready, storageError } = useDB();
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { scope: import.meta.env.BASE_URL }).catch((error) => {
        console.warn("HDW CONNECT offline support could not be enabled.", error);
      });
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void lockVault(); }, 5 * 60 * 1000);
    };
    const events: (keyof DocumentEventMap)[] = ["pointerdown", "keydown", "touchstart", "click"];
    events.forEach((event) => document.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => document.removeEventListener(event, reset));
    };
  }, [ready]);
  return (
    <QueryClientProvider client={queryClient}>
      {ready ? <>
        <header className="no-print sticky top-0 z-20 border-b-4 border-accent bg-primary text-primary-foreground">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link to="/" className="flex items-baseline gap-3">
              <span className="font-serif text-xl font-bold tracking-wide">HDW CONNECT</span>
              <span className="hidden text-xs opacity-80 sm:inline">One Patient. One Clinical Record. Connected Care.</span>
            </Link>
            <nav className="flex items-center gap-3 text-sm sm:gap-4">
              <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "underline underline-offset-4" }}>Patients</Link>
              <Link to="/about" activeProps={{ className: "underline underline-offset-4" }}>About & Backup</Link>
              <button className="rounded-sm border border-primary-foreground/40 px-2 py-1" onClick={() => void lockVault()} aria-label="Lock encrypted vault">Lock</button>
            </nav>
          </div>
        </header>
        {storageError && <div role="alert" className="mx-auto max-w-6xl border-x border-b border-destructive bg-card px-4 py-3 text-sm text-destructive">{storageError}</div>}
        <Outlet />
      </> : <VaultGate />}
    </QueryClientProvider>
  );
}
