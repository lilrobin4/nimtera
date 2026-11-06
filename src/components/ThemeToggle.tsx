import { Sun, Moon } from 'lucide-react';
import type { SupportedLocale } from '../lib/i18n';
import type { ThemeMode } from '../lib/theme';
const COPY: Record<SupportedLocale, { label: string; day: string; night: string }> = {
  en: { label: 'Appearance', day: 'Day', night: 'Night' },
  id: { label: 'Tampilan', day: 'Siang', night: 'Malam' },
  'zh-CN': { label: '外观', day: '日间', night: '夜间' },
  vi: { label: 'Giao diện', day: 'Ban ngày', night: 'Ban đêm' },
  ms: { label: 'Paparan', day: 'Siang', night: 'Malam' },
  ru: { label: 'Оформление', day: 'День', night: 'Ночь' },
};
export function ThemeToggle({ locale, theme, onChange }: { locale: SupportedLocale; theme: ThemeMode; onChange: (theme: ThemeMode) => void }) {
  const copy = COPY[locale];
  return <div className="theme-toolbar px-4 py-2 flex items-center justify-end gap-3 border-b border-[var(--border-soft)] bg-[var(--surface-inset)]" data-testid="theme-switcher">
    <span className="text-xs text-[var(--ink-muted)]">{copy.label}</span>
    <div role="group" aria-label={copy.label} className="inline-flex p-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-base)] gap-1">
      {(['day', 'night'] as const).map(mode => {
        const Icon = mode === 'day' ? Sun : Moon;
        return <button key={mode} type="button" data-testid={`theme-${mode}`} aria-pressed={theme === mode} onClick={() => onChange(mode)} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold cursor-pointer focus-visible:outline-2 ${theme === mode ? 'bg-[#DFC496] text-[#101827]' : 'text-[var(--ink-muted)] hover:bg-[var(--surface-raised)]'}`}>
          <Icon size={14} aria-hidden="true" />{copy[mode]}
        </button>;
      })}
    </div>
  </div>;
}
