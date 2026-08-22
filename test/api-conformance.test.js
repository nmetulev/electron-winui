const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  SUPPORTED_BROWSER_WINDOW_EVENTS,
  SUPPORTED_BROWSER_WINDOW_METHODS,
  SUPPORTED_BROWSER_WINDOW_PROPERTIES,
  SUPPORTED_BROWSER_WINDOW_STATIC_METHODS,
} = require('../src/window-api');

const packageRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('TypeScript declarations cover the supported BrowserWindow-like subset', () => {
  const declarations = read('types/index.d.ts');

  for (const property of SUPPORTED_BROWSER_WINDOW_PROPERTIES) {
    assert.match(declarations, new RegExp(`\\b${escaped(property)}\\s*:`));
  }
  for (const method of [
    ...SUPPORTED_BROWSER_WINDOW_METHODS,
    ...SUPPORTED_BROWSER_WINDOW_STATIC_METHODS,
  ]) {
    assert.match(declarations, new RegExp(`\\b${escaped(method)}\\s*\\(`));
  }
  for (const eventName of SUPPORTED_BROWSER_WINDOW_EVENTS) {
    assert.match(declarations, new RegExp(`event:\\s*'${escaped(eventName)}'`));
  }
});

test('runtime implements the supported BrowserWindow-like subset', () => {
  const runtime = read('src/window.js');

  for (const method of SUPPORTED_BROWSER_WINDOW_METHODS) {
    assert.match(
      runtime,
      new RegExp(`WinUIWindow\\.prototype\\.${escaped(method)}\\s*=`)
    );
  }
  for (const method of SUPPORTED_BROWSER_WINDOW_STATIC_METHODS) {
    assert.match(runtime, new RegExp(`WinUIWindow\\.${escaped(method)}\\s*=`));
  }
  assert.match(runtime, /webContents:\s*\{/);
});

test('README and guide document the same supported subset', () => {
  for (const documentPath of ['README.md', 'docs/winui-window.md']) {
    const document = read(documentPath);
    for (const member of [
      ...SUPPORTED_BROWSER_WINDOW_PROPERTIES,
      ...SUPPORTED_BROWSER_WINDOW_METHODS,
      ...SUPPORTED_BROWSER_WINDOW_STATIC_METHODS,
      ...SUPPORTED_BROWSER_WINDOW_EVENTS,
    ]) {
      assert.match(
        document,
        new RegExp(`\`${escaped(member)}\``),
        `${documentPath} does not document ${member}`
      );
    }
    assert.doesNotMatch(document, /window\.setTheme/);
  }
});

test('example follows automatic nativeTheme behavior and supported menu roles', () => {
  const example = read('example/main.js');

  assert.match(example, /nativeTheme\.themeSource\s*=\s*source/);
  assert.doesNotMatch(example, /\.setTheme\(/);
  for (const role of ['close', 'reload', 'toggledevtools']) {
    assert.match(example, new RegExp(`role:\\s*'${role}'`, 'i'));
  }
});
