import type { Page } from '@playwright/test';
export async function textContrastFailures(page: Page) { return page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      const rgba = (color: string) => { ctx.clearRect(0,0,1,1); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data).map((v,i) => i===3?v/255:v); };
      const lum = (c: number[]) => c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const errors: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const text=Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
        if (!text || !el.getClientRects().length || el.closest('select,button:disabled,[aria-disabled="true"],svg,script,style,video,.sr-only')) continue;
        const style=getComputedStyle(el); if (style.visibility==='hidden' || Number(style.opacity)<.5) continue;
        const chain: HTMLElement[]=[]; for(let p:HTMLElement|null=el;p;p=p.parentElement) chain.unshift(p);
        let bg=[11,16,28,1];
        for(const parent of chain) { const c=rgba(getComputedStyle(parent).backgroundColor); bg=[...c.slice(0,3).map((v,i)=>v*c[3]+bg[i]*(1-c[3])),1]; }
        const c=rgba(style.color);const fg=c.slice(0,3).map((v,i)=>v*c[3]+bg[i]*(1-c[3]));
        const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const large=parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && Number(style.fontWeight)>=700);
        if (ratio<(large?3:4.5)) errors.push(`${text.slice(0,65)}: ${ratio.toFixed(2)} (${style.color} on ${bg.slice(0,3)})`);
      }
      return errors;
    }); }
