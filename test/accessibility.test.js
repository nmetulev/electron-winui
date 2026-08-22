const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  menuItemAutomationId,
  setAutomationProperties,
} = require('../src/accessibility');

test('derives menu automation IDs from explicit Electron item IDs', () => {
  assert.equal(
    menuItemAutomationId('MenuBar', { id: 'open-recent' }, [0, 2]),
    'ElectronWinUI.MenuBar.Item.Id.Raw.open-recent'
  );
  assert.equal(
    menuItemAutomationId('ContextMenu', { id: 'open recent/now' }, [4]),
    'ElectronWinUI.ContextMenu.Item.Id.B64.b3BlbiByZWNlbnQvbm93'
  );
});

test('falls back to the index path for duplicate explicit item IDs', () => {
  const usedIds = new Set();
  assert.equal(
    menuItemAutomationId('MenuBar', { id: 'open' }, [0, 0], usedIds),
    'ElectronWinUI.MenuBar.Item.Id.Raw.open'
  );
  assert.equal(
    menuItemAutomationId('MenuBar', { id: 'open' }, [1, 0], usedIds),
    'ElectronWinUI.MenuBar.Item.Index.1.0'
  );
});

test('keeps literal and encoded item ID token spaces distinct', () => {
  assert.notEqual(
    menuItemAutomationId('MenuBar', { id: 'b3Blbg' }, [0]),
    menuItemAutomationId('MenuBar', { id: 'open!' }, [1])
  );
  assert.notEqual(
    menuItemAutomationId('MenuBar', { id: 'open' }, [0]),
    menuItemAutomationId('MenuBar', { id: ' open ' }, [1])
  );
});

test('uses deterministic menu index paths when item IDs are absent', () => {
  assert.equal(
    menuItemAutomationId('MenuBar', {}, [1, 3]),
    'ElectronWinUI.MenuBar.Item.Index.1.3'
  );
  assert.equal(
    menuItemAutomationId('ContextMenu', {}, [2]),
    'ElectronWinUI.ContextMenu.Item.Index.2'
  );
});

test('sets stable automation IDs and accessible names through WinUI', () => {
  const calls = [];
  const element = {};
  const bindings = {
    AutomationProperties: {
      setAutomationId(target, value) {
        calls.push(['id', target, value]);
      },
      setName(target, value) {
        calls.push(['name', target, value]);
      },
    },
  };

  setAutomationProperties(bindings, element, {
    id: 'ElectronWinUI.TitleBar.Search',
    name: 'Search commands',
  });

  assert.deepEqual(calls, [
    ['id', element, 'ElectronWinUI.TitleBar.Search'],
    ['name', element, 'Search commands'],
  ]);
});
