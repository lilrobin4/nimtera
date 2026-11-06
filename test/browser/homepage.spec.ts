import {test,expect} from '@playwright/test';
test('homepage explains seller/customer steps in six languages and plays the local 20-second demo',async({page})=>{
 await page.route('**/api/health',route=>route.fulfill({json:{ready:true,configured:{database:true,sessionSecret:true},databaseReachable:true}}));
 await page.goto('/');const guide=page.getByTestId('homepage-guide');await expect(guide.locator('article').nth(1)).toContainText('cashier screen');await expect(guide.locator('article')).toHaveCount(2);await expect(guide.locator('article ol li')).toHaveCount(6);
 const headings={en:'What is NimTera',id:'Apa itu NimTera','zh-CN':'什么是 NimTera',vi:'NimTera là gì',ms:'Apakah NimTera',ru:'Что такое NimTera'};
 for(const [locale,heading] of Object.entries(headings)){await page.locator('#landing-language').selectOption(locale);await expect(guide.getByRole('heading',{level:2})).toContainText(heading);await expect(page.locator('html')).toHaveAttribute('lang',locale);}
 await page.locator('#landing-language').selectOption('id');await page.reload();await expect(page.locator('#landing-language')).toHaveValue('id');
 const video=page.getByTestId('homepage-intro-video');await expect(video).toHaveAttribute('preload','none');await expect(video).toHaveAttribute('controls','');await expect(video).not.toHaveAttribute('autoplay','');
 await expect(video.locator('source')).toHaveAttribute('src','/media/nimtera-intro-en.mp4');await expect(video.locator('track')).toHaveAttribute('srclang','en');await expect(guide.locator('article').nth(1)).toContainText('layar kasir toko/restoran');
 await video.scrollIntoViewIfNeeded();
 const metadata=await video.evaluate(async element=>{const video=element as HTMLVideoElement;await video.play();return {duration:video.duration,width:video.videoWidth,height:video.videoHeight};});
 expect(metadata.duration).toBeCloseTo(20,1);expect(metadata.width).toBe(1280);expect(metadata.height).toBe(720);await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);await video.evaluate(element=>(element as HTMLVideoElement).pause());
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(392);
});
