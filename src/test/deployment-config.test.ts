import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lovable.dev/vite-tanstack-config", () => ({
  defineConfig: (options: unknown) => options,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Deployment configuration", () => {
  it("keeps SPA shell prerendering without the Nitro adapter on Netlify", async () => {
    vi.stubEnv("NETLIFY", "true");

    const { default: config } = await import("../../vite.config");

    expect(config).toMatchObject({
      nitro: false,
      tanstackStart: {
        spa: { enabled: true },
        server: { entry: "server" },
      },
    });
  });

  it("preserves automatic Nitro configuration on other platforms", async () => {
    vi.stubEnv("NETLIFY", undefined);

    const { default: config } = await import("../../vite.config");

    expect(config).toHaveProperty("nitro", undefined);
    expect(config).toMatchObject({ tanstackStart: { spa: { enabled: true } } });
  });
});
