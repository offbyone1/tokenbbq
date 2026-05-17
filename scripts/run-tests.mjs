#!/usr/bin/env node
// Cross-platform test runner. `node --test "src/**/*.test.ts"` only
// works on Node 22+ (native glob); on Node 20 the literal pattern is
// passed through and the runner errors with "Could not find ...". We
// support Node ≥ 20 (see package.json engines), so expand the glob
// in JS via tinyglobby and pass the resolved file list.

import { spawn } from 'node:child_process';
import { glob } from 'tinyglobby';

const files = await glob(['src/**/*.test.ts', 'widget/tests/**/*.test.ts']);
if (files.length === 0) {
  console.error('[run-tests] no test files matched src/**/*.test.ts');
  process.exit(1);
}

const args = ['--test', '--import', 'tsx', ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
