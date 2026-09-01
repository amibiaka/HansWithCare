/* Headless smoke test: serves the folder, walks every route in all six languages, exercises the
   request, prescription, order, practitioner, pharmacy and admin flows, and reports console errors.
   Run: node tools/smoke.js  (requires playwright + chromium available) */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end("window.DEHNA_CONFIG={appName:'Dehna',owner:\"Han's With Care\",supabaseUrl:'',supabaseAnonKey:'',syncIntervalSec:20};"); } const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
(async () => {
  await new Promise(r => srv.listen(8765, r));
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: [] });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|unpkg|openstreetmap|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  const base = 'http://localhost:8765/index.html';
  const go = async h => { await page.goto(base + h); await page.waitForTimeout(150); };
  await go('#/'); if (await page.$('[data-lang="en"]')) await page.click('[data-lang="en"]'); await page.waitForTimeout(100);
  const routes = ['#/', '#/emergency', '#/find?type=practitioner', '#/find?type=pharmacy', '#/find?type=facility', '#/find?type=wellbeing', '#/p/practitioner/PR-1', '#/p/pharmacy/PH-AA-1', '#/p/facility/F-AA-TASH', '#/p/wellbeing/WB-1', '#/request?to=PR-1', '#/rx?to=PH-AA-1', '#/products', '#/products?id=HP-1', '#/cart', '#/book/WB-1', '#/cases', '#/guide', '#/menu', '#/packs', '#/about', '#/privacy', '#/rights', '#/complaint', '#/pro/signin'];
  for (const l of ['en', 'am', 'ti', 'om', 'so', 'fr']) { await page.evaluate(c => setLang(c), l); for (const r of routes) { await go(r); const txt = await page.textContent('#main'); if (!txt || txt.trim().length < 20) errors.push('empty view ' + l + ' ' + r); } }
  await page.evaluate(() => setLang('en'));
  // Patient request flow
  await go('#/request?to=PR-1&reset=1'); await page.click('[data-need="general"]'); await page.click('[data-urg="urgent"]'); await page.click('#rNext');
  await page.fill('#rText', 'Fever and headache for two days'); await page.click('#rNext');
  await page.click('#rNext'); await page.fill('#rPhone', '0911223344'); await page.check('#rConsent'); await page.check('#rNotice'); await page.click('#rNext');
  await page.fill('#otpIn', '1234'); await page.click('#otpOk'); await page.waitForTimeout(100); await page.click('#rSend'); await page.waitForTimeout(200);
  const caseUrl = page.url(); if (!/#\/case\/RQ-/.test(caseUrl)) errors.push('request flow did not reach case view: ' + caseUrl);
  const caseId = caseUrl.split('/case/')[1];
  // Red-flag detection
  await go('#/request?reset=1'); await page.click('[data-need="general"]'); await page.click('[data-urg="urgent"]'); await page.click('#rNext'); await page.fill('#rText', 'my father has chest pain and cannot breathe'); await page.waitForTimeout(50); if (!(await page.$('#rfBox .alert'))) errors.push('red flag not shown');
  // Guide
  await go('#/guide'); await page.fill('#gIn', 'how do I wash reusable pads'); await page.click('#gSend'); await page.waitForTimeout(100); if (!(await page.textContent('#chat')).includes('Rinse')) errors.push('guide KB retrieval failed');
  await page.fill('#gIn', 'she is bleeding a lot'); await page.click('#gSend'); await page.waitForTimeout(100); if (!(await page.textContent('#chat')).includes('emergency')) errors.push('guide red flag failed');
  // Product order
  await go('#/products?id=HP-1'); await page.click('#pAdd'); await page.waitForTimeout(100); await page.fill('#oPhone', '0911223344'); await page.check('#oConsent'); await page.click('#oSend'); await page.fill('#otpIn', '1234'); await page.click('#otpOk'); await page.waitForTimeout(200); if (!/#\/order\/OR-/.test(page.url())) errors.push('order flow failed: ' + page.url());
  // Practitioner: sign in, open queue, accept, reply, refer
  await go('#/pro/signin'); await page.selectOption('#sUser', 'U-DR1'); await page.click('#sGo'); await page.waitForTimeout(150); if (!(await page.textContent('#main')).includes(caseId)) errors.push('case not in practitioner queue');
  await go('#/pro/case/' + caseId); await page.click('#aAccept'); await page.waitForTimeout(100); if (!(await page.textContent('#main')).includes('0911223344')) errors.push('phone not revealed after accept');
  await page.click('#pDraft'); await page.click('#pSend'); await page.waitForTimeout(100); await page.click('#aRefer'); await page.fill('#refWhy', 'needs paediatric review'); await page.click('#refOk'); await page.waitForTimeout(100);
  if (!(await page.textContent('#main')).includes('Referred')) errors.push('referral failed');
  // Admin
  await page.evaluate(() => DB.logout()); await go('#/pro/signin'); await page.selectOption('#sUser', 'U-ADM1'); await page.fill('#sPin', '2468'); await page.click('#sGo'); await page.waitForTimeout(150);
  for (const tab of ['overview', 'verif', 'geo', 'emergency', 'content', 'flags', 'complaints', 'hans', 'fees', 'audit', 'users']) { await go('#/admin?tab=' + tab); if ((await page.textContent('#adm')).trim().length < 10) errors.push('admin tab empty ' + tab); }
  await go('#/admin?tab=verif'); await page.click('[data-ap="PR-10"]'); await page.waitForTimeout(100); await page.evaluate(() => DB.logout()); await go('#/pro/signin'); await page.selectOption('#sUser', 'U-ADM2'); await page.fill('#sPin', '1357'); await page.click('#sGo'); await go('#/admin?tab=verif'); await page.click('[data-ap="PR-10"]'); await page.waitForTimeout(100);
  const st = await page.evaluate(() => DB.get('practitioners', 'PR-10').verification.state); if (st !== 'verified') errors.push('four-eyes verification failed: ' + st);
  const chain = await page.evaluate(() => { const arr = DB.all('audit'); let prev = '0'; for (const e of arr) { if (e.prev !== prev) return false; prev = e.hash; } return arr.length; }); if (!chain) errors.push('audit chain broken');
  // Pharmacy: prescription request then respond
  await page.evaluate(() => DB.logout()); await page.evaluate(() => setLang('en')); await go('#/rx?to=PH-AA-1');
  await page.setInputFiles('#rxFile', { name: 'rx.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'assets/icon-192.png')) }); await page.waitForTimeout(300); await page.click('#rNext'); await page.click('#rNext'); await page.fill('#rPhone', '0911223344'); await page.check('#rConsent'); await page.check('#rNotice'); await page.click('#rSend'); await page.fill('#otpIn', '1234'); await page.click('#otpOk'); await page.waitForTimeout(300);
  const rxUrl = page.url(); if (!/#\/case\/RX-/.test(rxUrl)) errors.push('rx flow failed: ' + rxUrl); const rxId = rxUrl.split('/case/')[1];
  await go('#/pro/signin'); await page.selectOption('#sUser', 'U-PH1'); await page.click('#sGo'); await page.waitForTimeout(150); await go('#/pro/case/' + rxId); await page.click('[data-rx="full"]'); await page.fill('#rxNote', 'All items in stock'); await page.fill('#rxPrep', '30 min'); await page.click('#rxOk'); await page.waitForTimeout(150);
  await page.evaluate(() => DB.logout()); await go('#/case/' + rxId); if (!(await page.$('[data-choose]'))) errors.push('pharmacy response not shown to patient'); else { await page.click('[data-choose]'); await page.waitForTimeout(150); if (!/#\/order\/OR-/.test(page.url())) errors.push('choose pharmacy did not create order'); }
  // Self-registration (demo mode): doctor registers, sees pending banner, appears pending in search, admin sees record
  await page.evaluate(() => DB.logout()); await go('#/register'); await page.click('[data-role="doctor"]'); await page.click('#rgNext');
  await page.fill('#rg_name', 'Dr. Test Registrant'); await page.fill('#rg_specialty', 'Dermatologist'); await page.fill('#rg_licenceNo', 'MD/TEST/1'); await page.fill('#rg_issuer', 'MOH HRL'); await page.fill('#rg_phone', '0911999999'); await page.check('[data-scope="general"]'); await page.check('[data-mode="secure_chat"]'); await page.click('#rgNext');
  await page.setInputFiles('#rg_doc', { name: 'licence.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'assets/icon-192.png')) }); await page.waitForTimeout(300); await page.click('#rgNext');
  await page.fill('#rg_email', 'test.registrant@example.com'); await page.fill('#rg_password', 'Password-123'); await page.check('#rg_consent'); await page.click('#rgSend'); await page.waitForTimeout(400);
  if (!(await page.textContent('#modal')).includes('Registration received')) errors.push('registration did not complete');
  const reg = await page.evaluate(() => DB.all('practitioners').find(p => p.name === 'Dr. Test Registrant')); if (!reg || reg.verification.state !== 'pending' || !reg.verification.documentId) errors.push('registered record missing or not pending');
  await go('#/pro'); if (!(await page.textContent('#main')).includes('Verification pending')) errors.push('pending banner missing on dashboard');
  await page.evaluate(() => DB.logout()); await go('#/find?type=practitioner'); if (!(await page.textContent('#main')).includes('Dr. Test Registrant')) errors.push('registered practitioner not listed as pending');
  await go('#/p/practitioner/' + reg.id); if ((await page.$('a[href^="#/request?to="]'))) errors.push('pending practitioner should not be requestable');
  await go('#/pro/signin'); await page.selectOption('#sUser', 'U-ADM1'); await page.fill('#sPin', '2468'); await page.click('#sGo'); await go('#/admin?tab=verif'); if (!(await page.$('[data-doc]'))) errors.push('admin cannot see licence document button'); await page.evaluate(() => DB.logout());
  // Offline queue
  await ctx.setOffline(true); await go('#/request?to=PR-1&reset=1'); await page.click('[data-need="child"]'); await page.click('[data-urg="soon"]'); await page.click('#rNext'); await page.fill('#rText', 'cough'); await page.click('#rNext'); await page.click('#rNext'); await page.fill('#rPhone', '0911223344'); await page.check('#rConsent'); await page.check('#rNotice'); await page.click('#rNext'); await page.fill('#otpIn', '1234'); await page.click('#otpOk'); await page.waitForTimeout(100); await page.click('#rSend'); await page.waitForTimeout(200);
  if (!(await page.textContent('#main')).includes('NOT SENT')) errors.push('offline queue state not shown');
  await ctx.setOffline(false); await page.waitForTimeout(300); await page.reload(); await page.waitForTimeout(300); const qc = await page.evaluate(() => DB.all('cases').filter(c => c.state === 'queued_offline').length); if (qc) errors.push('queued case not synced after reconnect: ' + qc);
  const dup = await page.evaluate(() => { const ids = DB.all('cases').map(c => c.idem); return ids.length !== new Set(ids).size; }); if (dup) errors.push('duplicate idempotency keys');
  // Screenshot
  await page.evaluate(() => setLang('am')); await go('#/'); await page.screenshot({ path: path.join(root, 'tools/home-am.png') });
  await page.evaluate(() => setLang('en')); await go('#/emergency'); await page.screenshot({ path: path.join(root, 'tools/emergency-en.png') });
  const shell = ['index.html', 'css/app.css', ...fs.readdirSync(path.join(root, 'js')).map(f => 'js/' + f), 'assets/logo.png', 'assets/icon-192.png'].reduce((s, f) => s + fs.statSync(path.join(root, f)).size, 0);
  console.log('critical shell bytes (uncompressed):', shell);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'SMOKE OK');
  await browser.close(); srv.close(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
