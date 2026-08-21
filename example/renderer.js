document.getElementById('show-dialog').addEventListener('click', () => {
  window.example.showDialog();
});

const themeButtons = [...document.querySelectorAll('[data-theme-source]')];
const themeStatus = document.getElementById('theme-status');
const titleBarSearchStatus = document.getElementById('titlebar-search-status');

function applyTheme(state) {
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  themeStatus.textContent = `${state.source} / ${state.dark ? 'dark' : 'light'}`;
  for (const button of themeButtons) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.themeSource === state.source)
    );
  }
}

for (const button of themeButtons) {
  button.addEventListener('click', async () => {
    applyTheme(await window.example.setTheme(button.dataset.themeSource));
  });
}

window.example.onThemeChanged(applyTheme);
window.example.getTheme().then(applyTheme);
window.example.onTitleBarSearch(({ submitted, text }) => {
  titleBarSearchStatus.textContent = text
    ? `${submitted ? 'Submitted' : 'Typing'}: ${text}`
    : 'Waiting for input';
});
