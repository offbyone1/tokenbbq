import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { resolveProjectRoot } from './project.js';

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'tbq-proj-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    mkdir: (rel: string) => {
      mkdirSync(path.join(root, rel), { recursive: true });
      return path.join(root, rel);
    },
    touch: (rel: string) => {
      writeFileSync(path.join(root, rel), '');
    },
  };
}

describe('resolveProjectRoot', () => {
  test('returns cwd itself when no markers exist anywhere', () => {
    const fx = makeFixture();
    try {
      const dir = fx.mkdir('a/b/c');
      const res = resolveProjectRoot(dir);
      assert.equal(res.root, dir);
      assert.equal(res.name, 'c');
    } finally { fx.cleanup(); }
  });

  test('walks up to directory with .git (only marker, no inner)', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('myproj/src/nested');
      fx.mkdir('myproj/.git');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'myproj');
    } finally { fx.cleanup(); }
  });

  test('walks up to directory with package.json when no Git anywhere', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('localtool/lib/x');
      fx.touch('localtool/package.json');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'localtool');
    } finally { fx.cleanup(); }
  });

  test('OUTERMOST marker wins even when inner subfolder also has a marker', () => {
    // This is the core bug fix: NanoGolf (.git) / server (package.json) → NanoGolf
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('NanoGolf/server/sub');
      fx.mkdir('NanoGolf/.git');
      fx.touch('NanoGolf/server/package.json');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'NanoGolf');
    } finally { fx.cleanup(); }
  });

  test('Git and manifest are equal weight — outermost still wins', () => {
    // Only inner has .git, only outer has package.json → outer (package.json) wins because it is outermost
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('outer/inner/sub');
      fx.touch('outer/package.json');
      fx.mkdir('outer/inner/.git');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'outer');
    } finally { fx.cleanup(); }
  });

  test('local-only project with just package.json (no Git) is a valid root', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('MyTool/src');
      fx.touch('MyTool/package.json');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'MyTool');
    } finally { fx.cleanup(); }
  });

  test('monorepo subpackage rolls up to repo root', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('MegaApp/packages/frontend/src');
      fx.mkdir('MegaApp/.git');
      fx.touch('MegaApp/package.json');
      fx.touch('MegaApp/packages/frontend/package.json');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'MegaApp');
    } finally { fx.cleanup(); }
  });

  test('README.md alone is NOT a marker (too weak)', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('notaproj/sub');
      fx.touch('notaproj/README.md');
      const res = resolveProjectRoot(deep);
      // No marker → cwd itself is the root
      assert.equal(res.root, deep);
      assert.equal(res.name, 'sub');
    } finally { fx.cleanup(); }
  });

  test('.gitignore alone is NOT a marker (too weak — common in $HOME)', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('notaproj/sub');
      fx.touch('notaproj/.gitignore');
      const res = resolveProjectRoot(deep);
      assert.equal(res.root, deep);
      assert.equal(res.name, 'sub');
    } finally { fx.cleanup(); }
  });

  test('stops at $HOME boundary (does not ascend above)', () => {
    const home = homedir();
    const res = resolveProjectRoot(home);
    assert.equal(res.root, home);
    assert.equal(res.name, path.basename(home));
  });

  test('cached — same result on repeat calls', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('p/q');
      fx.touch('p/package.json');
      const a = resolveProjectRoot(deep);
      const b = resolveProjectRoot(deep);
      assert.equal(a.root, b.root);
      assert.equal(a.name, b.name);
    } finally { fx.cleanup(); }
  });

  test('*.csproj counts as a manifest marker', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('MyDotNet/src');
      fx.touch('MyDotNet/MyDotNet.csproj');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'MyDotNet');
    } finally { fx.cleanup(); }
  });
});
