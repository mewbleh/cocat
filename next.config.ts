import type { NextConfig } from "next";

const devTraceExcludes = [
  ".git/**/*",
  ".dockerignore",
  ".gitignore",
  ".env*",
  "*.log",
  "*.tsbuildinfo",
  "README.md",
  "app/globals.css",
  "app/icon.svg",
  "components.json",
  "eslint.config.mjs",
  "package.json",
  "playwright-report/**/*",
  "playwright.config.ts",
  "postcss.config.mjs",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "test-results/**/*",
  "tests/**/*",
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.setup.ts"
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/api/remux": [
      ...devTraceExcludes,
      "app/**/*.ts",
      "app/**/*.tsx",
      "components/**/*.ts",
      "components/**/*.tsx",
      "hooks/**/*.ts",
      "hooks/**/*.tsx",
      "lib/**/*.ts"
    ],
    "/app/api/remux/route": [
      ...devTraceExcludes,
      "app/**/*.ts",
      "app/**/*.tsx",
      "components/**/*.ts",
      "components/**/*.tsx",
      "hooks/**/*.ts",
      "hooks/**/*.tsx",
      "lib/**/*.ts"
    ]
  },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true
};

export default nextConfig;
