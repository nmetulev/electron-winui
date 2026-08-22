const { setAutomationProperties } = require('./accessibility');

function createText(bindings, text, size, weight = 400) {
  const block = new bindings.TextBlock();
  block.text = text;
  block.fontSize = size;
  block.fontWeight = { weight };
  block.verticalAlignment = bindings.VerticalAlignment.Center;
  return block;
}

function appendChildren(bindings, panel, ...children) {
  const collection = panel.children.as(bindings.IVector_UIElement);
  for (const child of children) {
    collection.append(child);
  }
}

async function showContentDialog(state, options, syncShellBounds) {
  state.dialogOpen = true;
  syncShellBounds();

  const dialog = new state.bindings.ContentDialog();
  dialog.xamlRoot = state.root.xamlRoot;
  dialog.requestedTheme = state.root.requestedTheme;
  setAutomationProperties(state.bindings, dialog, {
    id: 'ElectronWinUI.ContentDialog',
    name: options.title || options.message || 'Message dialog',
  });
  if (options.title) {
    dialog.title = createText(state.bindings, options.title, 20, 600);
  }

  const content = new state.bindings.StackPanel();
  content.spacing = 8;
  const message = createText(state.bindings, options.message, 15, 600);
  message.textWrapping = state.bindings.TextWrapping.Wrap;
  message.maxWidth = 480;
  appendChildren(state.bindings, content, message);
  if (options.detail) {
    const detail = createText(state.bindings, options.detail, 14);
    detail.textWrapping = state.bindings.TextWrapping.Wrap;
    detail.maxWidth = 480;
    appendChildren(state.bindings, content, detail);
  }
  dialog.content = content;

  const buttons = options.buttons?.length ? options.buttons : ['OK'];
  dialog.primaryButtonText = buttons[0];
  if (buttons.length > 2) {
    dialog.secondaryButtonText = buttons[1];
  }
  if (buttons.length > 1) {
    dialog.closeButtonText = buttons.at(-1);
  }

  try {
    const result = await dialog.showAsync();
    let response = 0;
    if (result === state.bindings.ContentDialogResult.Secondary) {
      response = 1;
    } else if (result === state.bindings.ContentDialogResult.None) {
      response = buttons.length - 1;
    }
    return { checkboxChecked: false, response };
  } finally {
    state.dialogOpen = false;
    syncShellBounds();
  }
}

module.exports = {
  showContentDialog,
};
