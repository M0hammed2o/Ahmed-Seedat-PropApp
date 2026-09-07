import { launch, signIn, bodyText, BASE } from './uat-browser-lib.mjs';
const browser = await launch();
const { page } = await signIn(browser,'owner');
page.on('console', m=>{ if(m.type()==='error') console.log(`  CONSOLE ${m.text().slice(0,180)}`);});
page.on('pageerror', e=>console.log(`  PAGEERROR ${String(e).slice(0,180)}`));
for(const url of ['/properties?for=maintenance', `/properties?for=maintenance&cb=${Date.now()}`]){
  const r=await page.goto(`${BASE}${url}`,{waitUntil:'networkidle',timeout:60000});
  await page.waitForTimeout(1500);
  const t=await bodyText(page);
  const h=r.headers();
  console.log(`\n${url}`);
  console.log(`  HTTP ${r.status()}  cache-control: ${h['cache-control']||'-'}  x-nextjs-cache: ${h['x-nextjs-cache']||'-'}`);
  console.log(`  "Choose a property": ${/Choose a property/.test(t)}   title area: "${t.slice(t.indexOf('Portfolio'), t.indexOf('Portfolio')+120).replace(/\s+/g,' ')}"`);
}
await browser.close();
