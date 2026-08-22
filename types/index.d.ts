import Electron = require('electron');

interface WinUITitleBarSearchOptions {
  placeholder?: string;
  text?: string;
  width?: number;
}

interface WinUIWindowOptions extends Omit<
  Electron.BrowserWindowConstructorOptions,
  'frame' | 'titleBarOverlay' | 'titleBarStyle'
> {
  winui?: {
    icon?: string;
    searchBox?: WinUITitleBarSearchOptions;
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
  getSubtitle(): string;
  getTitleBarIcon(): string | null;
  getTitleBarSearch(): Required<WinUITitleBarSearchOptions> | null;
  isMenuBarVisible(): boolean;
  removeMenu(): void;
  setMenu(menu: Electron.Menu | null): void;
  setMenuBarVisibility(visible: boolean): void;
  setSubtitle(subtitle: string): void;
  setTitleBarIcon(icon: string | null): void;
  setTitleBarSearch(options: WinUITitleBarSearchOptions | null): void;

  on(event: 'enter-html-full-screen', listener: () => void): this;
  on(event: 'leave-html-full-screen', listener: () => void): this;
  on(
    event: 'page-title-updated',
    listener: (
      event: Electron.Event,
      title: string,
      explicitSet: boolean
    ) => void
  ): this;
  on(event: 'ready-to-show', listener: () => void): this;
  on(event: 'responsive', listener: () => void): this;
  on(
    event: 'titlebar-search-changed',
    listener: (text: string) => void
  ): this;
  on(
    event: 'titlebar-search-submitted',
    listener: (query: string) => void
  ): this;
  on(event: 'unresponsive', listener: () => void): this;
  on(event: string, listener: (...args: any[]) => void): this;

  static fromId(id: number): WinUIWindow | null;
  static fromWebContents(webContents: Electron.WebContents): WinUIWindow | null;
  static getAllWindows(): WinUIWindow[];
  static getFocusedWindow(): WinUIWindow | null;
}

declare const electronWinUI: Omit<
  typeof Electron,
  'Menu' | 'dialog'
> & {
  WinUIWindow: typeof WinUIWindow;
  Menu: typeof Electron.Menu;
  dialog: typeof Electron.dialog;
  prepareElectronExecutable(executablePath?: string): Promise<string>;
};

export = electronWinUI;
