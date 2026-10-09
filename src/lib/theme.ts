export const THEME_COOKIE = 'theme';
/** Paper (light), Carbon (dark), or follow the operating system. */
export type Theme = 'light' | 'dark' | 'system';
export const THEMES: Theme[] = ['light', 'dark', 'system'];
export const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark' || v === 'system';
/** The theme a cookie value means; anything unknown is Paper. */
export const themeFromCookie = (v: string | undefined): Theme => (isTheme(v) ? v : 'light');
