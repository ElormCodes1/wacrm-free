import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` exists to fail a CLIENT build that imports a server
      // module. Under vitest there is no such distinction, and its client
      // entry throws on import — so it is stubbed out here. The guarantee
      // it provides still holds where it matters: `next build`.
      'server-only': new URL('./src/test/server-only-stub.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
  },
});
