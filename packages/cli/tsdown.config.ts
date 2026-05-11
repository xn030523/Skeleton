import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: "esm",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  platform: "node",
  jsx: "automatic",
  noExternal: ["@skeleton/ink"],
});
