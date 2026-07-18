/**
 * Light/dark theme. The chosen theme toggles the `dark` class on <html>,
 * which swaps the CSS token set (see index.css). Persisted per browser;
 * defaults to the OS preference on first run.
 */

export type Theme = 'light' | 'dark'

const KEY = 'drive:theme'

export const getStoredTheme = (): Theme | null => {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : null
}

export const systemTheme = (): Theme =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

export const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** Resolve + apply the initial theme (call once at startup). */
export const initTheme = (): Theme => {
  const theme = getStoredTheme() ?? systemTheme()
  applyTheme(theme)
  return theme
}

export const setTheme = (theme: Theme) => {
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}
