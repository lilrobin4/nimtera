import React, { useEffect, useRef, useState } from 'react';
import { X, Shield, Lock, BookOpen } from 'lucide-react';
import { PUBLIC_HELP, type HelpTab } from '../lib/publicDocs';
import type { SupportedLocale } from '../lib/i18n';

interface DocsAndPoliciesModalProps { open: boolean; onClose: () => void; locale: SupportedLocale }

// Public help only. Operator runbooks and deployment instructions do not belong in the client.
export const DocsAndPoliciesModal: React.FC<DocsAndPoliciesModalProps> = ({ open, onClose, locale }) => {
  const [tab, setTab] = useState<HelpTab>('overview');
  const dialog = useRef<HTMLDivElement>(null);
  const copy = PUBLIC_HELP[locale] || PUBLIC_HELP.en;
  useEffect(() => {
    if (!open) return;
    setTab('overview');
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="docs-modal-title" className="bg-[#131C2E] text-slate-300 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[88dvh] flex flex-col overflow-hidden shadow-2xl" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
        const first=buttons?.[0], last=buttons?.[buttons.length-1];
        if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <h2 id="docs-modal-title" className="text-lg font-semibold text-[#F3F4F6] flex items-center gap-2"><BookOpen className="w-5 h-5 text-[#DFC496] shrink-0" />{copy.title}</h2>
        <button type="button" onClick={onClose} aria-label={copy.close} className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white shrink-0"><X className="w-4 h-4" /></button>
      </div>
      <div role="group" aria-label={copy.title} className="px-5 pt-3 border-b border-slate-800 flex items-center gap-2 overflow-x-auto shrink-0">
        {([['overview',BookOpen],['security',Shield],['privacy',Lock]] as const).map(([id,Icon]) => <button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)} className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 flex items-center gap-1.5 whitespace-nowrap ${tab===id?'border-[#14B8A6] text-[#2DD4BF] bg-[#182338]':'border-transparent text-slate-400 hover:text-slate-200'}`}><Icon className="w-3.5 h-3.5" />{copy.tabs[id]}</button>)}
      </div>
      <section className="p-5 overflow-y-auto text-sm leading-relaxed space-y-4" aria-live="polite">
        <h3 className="font-semibold text-[#DFC496]">{copy.content[tab].heading}</h3>
        <ul className="list-disc pl-5 space-y-3">{copy.content[tab].points.map(point=><li key={point}>{point}</li>)}</ul>
      </section>
    </div>
  </div>;
};
