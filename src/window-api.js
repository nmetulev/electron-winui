const SUPPORTED_BROWSER_WINDOW_PROPERTIES = Object.freeze([
  'webContents',
]);

const SUPPORTED_BROWSER_WINDOW_METHODS = Object.freeze([
  'loadFile',
  'loadURL',
  'reload',
  'capturePage',
  'setMenu',
  'removeMenu',
  'setMenuBarVisibility',
  'isMenuBarVisible',
]);

const SUPPORTED_BROWSER_WINDOW_STATIC_METHODS = Object.freeze([
  'getAllWindows',
  'fromId',
  'fromWebContents',
  'getFocusedWindow',
]);

const FORWARDED_WEB_CONTENTS_EVENTS = Object.freeze([
  'enter-html-full-screen',
  'leave-html-full-screen',
  'responsive',
  'unresponsive',
]);

const SUPPORTED_BROWSER_WINDOW_EVENTS = Object.freeze([
  ...FORWARDED_WEB_CONTENTS_EVENTS,
  'page-title-updated',
  'ready-to-show',
]);

module.exports = {
  FORWARDED_WEB_CONTENTS_EVENTS,
  SUPPORTED_BROWSER_WINDOW_EVENTS,
  SUPPORTED_BROWSER_WINDOW_METHODS,
  SUPPORTED_BROWSER_WINDOW_PROPERTIES,
  SUPPORTED_BROWSER_WINDOW_STATIC_METHODS,
};
