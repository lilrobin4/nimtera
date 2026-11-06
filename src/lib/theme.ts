export type ThemeMode = 'day' | 'night';
export const THEME_KEY = 'nimtera.ui.theme';
export function savedTheme(storage?: Pick<Storage, 'getItem'>): ThemeMode {
  try { return storage?.getItem(THEME_KEY) === 'day' ? 'day' : 'night'; } catch { return 'night'; }
}
export function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'night');
}
