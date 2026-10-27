import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectPath, parseProjectURL } from '../../src/project-url.js';

test('identifies the workspace and project from a project page', () => {
  assert.deepEqual(parseProjectPath('/acme/project/mobile-app-3f2a1b9c8d7e/overview'), {
    workspace: 'acme', slug: 'mobile-app-3f2a1b9c8d7e', key: '3f2a1b9c8d7e', view: 'overview'
  });
  assert.deepEqual(parseProjectPath('/acme/project/mobile-app-3f2a1b9c8d7e'), {
    workspace: 'acme', slug: 'mobile-app-3f2a1b9c8d7e', key: '3f2a1b9c8d7e', view: null
  });
  assert.equal(parseProjectPath('/acme/project/mobile-app-3f2a1b9c8d7e/issues/all').view, 'issues');
});

test('a renamed project keeps the same key', () => {
  assert.equal(parseProjectPath('/acme/project/old-name-3f2a1b9c8d7e').key, parseProjectPath('/acme/project/new-name-3f2a1b9c8d7e').key);
});

test('ignores pages that are not a single project', () => {
  for (const path of ['/', '/acme', '/acme/projects/all', '/acme/team/ENG/projects/all', '/acme/issue/ENG-1/title', '/acme/project/', '/acme/project/bad-key!', '/acme/project/%E0%A4%A']) {
    assert.equal(parseProjectPath(path), null, path);
  }
});

test('only accepts Linear project URLs', () => {
  assert.equal(parseProjectURL('https://linear.app/acme/project/x-3f2a1b9c8d7e').key, '3f2a1b9c8d7e');
  assert.equal(parseProjectURL('https://evil.example/acme/project/x-3f2a1b9c8d7e'), null);
  assert.equal(parseProjectURL('not a url'), null);
  assert.equal(parseProjectURL(undefined), null);
});
