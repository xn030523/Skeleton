import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/bin.tsx"],
  format: "esm",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  platform: "node",
  jsx: "automatic",
});
