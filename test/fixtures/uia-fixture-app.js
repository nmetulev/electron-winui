// Dedicated, deterministic UIA (Windows UI Automation) fixture for the
// `winapp ui` scripted/batch harness under test/uia. This file intentionally
// mirrors the existing fixture conventions in test/*.js (see test/smoke-app.js
// and test/window.test.js's runElectronFixture helper): it requires the
// built `../../dist` package, uses stdout markers of the form
// `NAME:value` for process-level log correlation, and keeps every native
// WinUI control's automation identity aligned with what src/window.js and
// src/content-dialog.js actually assign (see src/accessibility.js).
//
// Unlike the other fixtures under test/*.js, this fixture does NOT close
// itself after a fixed delay: the UIA harness (test/uia/run-uia-tests.ps1)
// drives it live via `winapp ui` and is responsible for shutting it down
// (by invoking the native File > Close MenuBar item, with a forced
// process-tree kill as a fallback). This is required because assertions are
// made against the *running* native XAML island rather than replayed logs.
const path = require('node:path');
const { app, dialog, Menu, WinUIWindow } = require('../../dist');

const windowTitle = `UIA Fixture ${process.pid}`;

let mainWindow;

function showFixtureContextMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      id: 'ctx-ping',
      label: 'Context Ping',
      click: () => console.log('CONTEXT_MENU_PING_CLICKED'),
    },
    { type: 'separator' },
    {
      id: 'ctx-info',
      label: 'Context Info',
      click: () => console.log('CONTEXT_MENU_INFO_CLICKED'),
    },
  ]);
  console.log('CONTEXT_MENU_OPENING');
  contextMenu.popup({ window: mainWindow, x: 60, y: 60 });
}

async function showFixtureContentDialog() {
  console.log('CONTENT_DIALOG_OPENING');
  // Three buttons exercise all three ContentDialog template-part buttons
  // (PrimaryButton / SecondaryButton / CloseButton) built by
  // src/content-dialog.js's showContentDialog().
  const result = await dialog.showMessageBox(mainWindow, {
    title: 'Confirm action',
    message: 'This ContentDialog is rendered natively by WinUI 3.',
    detail:
      'Its Primary/Secondary/Close buttons are audited for AutomationId by the UIA harness.',
    buttons: ['Accept', 'Maybe', 'Cancel'],
  });
  console.log(`CONTENT_DIALOG_RESULT:${JSON.stringify(result)}`);
}

function buildFixtureMenu() {
  return Menu.buildFromTemplate([
    {
      id: 'file',
      label: 'File',
      submenu: [{ id: 'file-close', label: 'Close', role: 'close' }],
    },
    {
      id: 'view',
      label: 'View',
      submenu: [{ id: 'view-reload', label: 'Reload', role: 'reload' }],
    },
    {
      id: 'actions',
      label: 'Actions',
      submenu: [
        {
          id: 'ping',
          label: 'Ping',
          click: () => console.log('ACTIONS_PING_CLICKED'),
        },
        { type: 'separator' },
        {
          id: 'show-context-menu',
          label: 'Show context menu',
          click: showFixtureContextMenu,
        },
        {
          id: 'show-content-dialog',
          label: 'Show content dialog',
          click: () => {
            showFixtureContentDialog().catch((error) => {
              console.error(error);
            });
          },
        },
      ],
    },
  ]);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildFixtureMenu());

  mainWindow = new WinUIWindow({
    show: false,
    title: windowTitle,
    width: 900,
    height: 640,
    winui: {
      subtitle: 'UIA AUTOMATION FIXTURE',
      searchBox: {
        placeholder: 'Search fixture',
        width: 260,
      },
    },
  });

  mainWindow.on('titlebar-search-changed', (text) => {
    console.log(`TITLEBAR_SEARCH_CHANGED:${text}`);
  });
  mainWindow.on('titlebar-search-submitted', (text) => {
    console.log(`TITLEBAR_SEARCH_SUBMITTED:${text}`);
  });

  const ready = new Promise((resolve) => {
    mainWindow.once('ready-to-show', resolve);
  });
  await mainWindow.loadFile(path.join(__dirname, 'uia-fixture.html'));
  await ready;

  mainWindow.setTitle(windowTitle);
  mainWindow.show();
  // Preserve the readiness marker used by the repository's other Electron
  // fixtures while also emitting fixture-specific metadata for diagnostics.
  console.log(`WINUI_WINDOW_READY:${process.pid}`);
  console.log(`UIA_FIXTURE_READY:${mainWindow.id}:${process.pid}:${windowTitle}`);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  console.log('UIA_FIXTURE_CLOSING');
  app.quit();
});

process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  app.exit(1);
});