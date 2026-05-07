#!/usr/bin/env node
import { runCli } from '../src/cli/index.js';

runCli(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
