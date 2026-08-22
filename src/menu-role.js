const roleHandlers = {
  close: (window) => window.close(),
  reload: (window) => window.reload(),
  toggledevtools: (window) => window.webContents.toggleDevTools(),
};

function dispatchMenuRole(role, window) {
  const handler = roleHandlers[role?.toLowerCase()];
  if (!handler) {
    return false;
  }
  handler(window);
  return true;
}

function activateMenuItem(item, window) {
  if (dispatchMenuRole(item.role, window)) {
    return;
  }
  if (typeof item.click === 'function') {
    item.click(item, window, item.role ? window.webContents : {});
  }
}

module.exports = {
  activateMenuItem,
};
