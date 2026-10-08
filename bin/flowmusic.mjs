#!/usr/bin/env node
import { createRequire } from "node:module";
import { run } from "../src/cli.mjs";

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(createRequire(import.meta.url)("../package.json").version);
  process.exit(0);
}
try {
  await run(process.argv.slice(2));
  process.exit(process.exitCode || 0);
} catch (e) {
  console.error("error:", e.message);
  process.exit(1);
}
