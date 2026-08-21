import Electron = require('electron');

interface WinUIWindowOptions extends Electron.BrowserWindowConstructorOptions {
  winui?: {
    shellHeight?: number;
    subtitle?: string;
  };
}

declare class WinUIWindow extends Electron.BaseWindow {
  constructor(options?: WinUIWindowOptions);

  readonly webContents: Electron.WebContents;

  loadFile(
    filePath: string,
    options?: Electron.LoadFileOptions
  ): Promise<void>;
  loadURL(url: string, options?: Electron.LoadURLOptions): Promise<void>;
  reload(): void;
  capturePage(rect?: Electron.Rectangle): Promise<Electron.NativeImage>;
  setMenu(menu: Electron.Menu | null): void;

  static fromId(id: number): WinUIWindow | null;
  static fromWebContents(webContents: Electron.WebContents): WinUIWindow | null;
  static getAllWindows(): WinUIWindow[];
  static getFocusedWindow(): WinUIWindow | null;
}

declare const electronWinUI: Omit<
  typeof Electron,
  'BrowserWindow' | 'Menu' | 'dialog'
> & {
  BrowserWindow: typeof WinUIWindow;
  WinUIWindow: typeof WinUIWindow;
  Menu: typeof Electron.Menu;
  dialog: typeof Electron.dialog;
  prepareElectronExecutable(executablePath?: string): Promise<string>;
};

export = electronWinUI;
