/* Geography helpers: flexible hierarchy (ToR §8), proximity, GPS, location summaries, region packs */
const GEO = (() => {
  const LEVEL_NAMES = { 0: 'country', 1: 'region', 2: 'zone', 3: 'woreda', 4: 'zone', 5: 'woreda', 6: 'kebele' };
  function unit(id) { return DB.get('geo', id); }
  function children(parentId) { return DB.all('geo').filter(u => u.parent === parentId && u.active !== false); }
  function ancestors(id) { const out = []; let u = unit(id); while (u && u.parent) { u = unit(u.parent); if (u) out.unshift(u); } return out; }
  function regionOf(id) { const u = unit(id); if (!u) return null; if (u.level === 1) return u; const a = ancestors(id).find(x => x.level === 1); return a || null; }
  function label(u, lang) { if (!u) return ''; return (lang && lang !== 'en' && u.local) ? u.local + ' (' + u.name + ')' : u.name; }
  function path(id, lang) { const u = unit(id); if (!u) return ''; return ancestors(id).filter(x => x.level > 0).map(x => label(x, lang)).concat([label(u, lang)]).join(' › '); }
  function isWithin(id, ancestorId) { if (!id) return false; if (id === ancestorId) return true; return ancestors(id).some(a => a.id === ancestorId); }
  function km(a, b) { if (!a || !b || a.lat == null || b.lat == null) return null; const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }
  function nearestUnit(pt, minLevel) { let best = null, bd = 1e9; DB.all('geo').forEach(u => { if (u.level < (minLevel || 3) || u.lat == null) return; const d = km(pt, u); if (d !== null && d < bd) { bd = d; best = u; } }); return best ? { unit: best, km: bd } : null; }
  function gps(opts) {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('nogeo'));
      navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }), e => rej(e), Object.assign({ enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }, opts || {}));
    });
  }
  function summary(loc, lang) {
    // Plain-language location summary that can be copied or sent (ToR §6 emergency access)
    const parts = [];
    if (loc.adminUnit) parts.push(path(loc.adminUnit, lang));
    if (loc.landmark) parts.push((lang === 'fr' ? 'Repère: ' : 'Landmark: ') + loc.landmark);
    if (loc.lat != null) parts.push('GPS ' + loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) + (loc.acc ? ' (±' + Math.round(loc.acc) + ' m)' : ''));
    if (loc.lat != null) parts.push('https://maps.google.com/?q=' + loc.lat.toFixed(5) + ',' + loc.lng.toFixed(5));
    return parts.join('\n');
  }
  // Saved location for this device (never sent unless the user chooses to)
  function saved() { try { return JSON.parse(localStorage.getItem('hwc.loc') || 'null'); } catch (e) { return null; } }
  function save(loc) { try { localStorage.setItem('hwc.loc', JSON.stringify(loc)); } catch (e) {} }

  // Region packs (offline directories). Pack files live at data/packs/<REGION>.json and are cached by the service worker.
  function packs() { try { return JSON.parse(localStorage.getItem('hwc.packs') || '[]'); } catch (e) { return []; } }
  function setPacks(p) { try { localStorage.setItem('hwc.packs', JSON.stringify(p)); } catch (e) {} }
  function packUrl(region) { return new URL('data/packs/' + region + '.json', location.href).pathname; }
  function downloadPack(region) {
    return new Promise((res, rej) => {
      const url = packUrl(region);
      const done = ev => { if (ev.data && ev.data.url === url) { navigator.serviceWorker.removeEventListener('message', done); if (ev.data.type === 'PACK_CACHED') { const p = packs().filter(x => x !== region); p.push(region); setPacks(p); res(); } else rej(new Error('failed')); } };
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener('message', done);
        navigator.serviceWorker.controller.postMessage({ type: 'CACHE_PACK', url });
        setTimeout(() => { navigator.serviceWorker.removeEventListener('message', done); rej(new Error('timeout')); }, 15000);
      } else {
        // No service worker (e.g. file:// or unsupported): fetch to verify and record locally
        fetch(url).then(r => { if (!r.ok) throw new Error('http'); const p = packs().filter(x => x !== region); p.push(region); setPacks(p); res(); }).catch(rej);
      }
    });
  }
  function removePack(region) { setPacks(packs().filter(x => x !== region)); if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'DROP_PACK', url: packUrl(region) }); }
  return { LEVEL_NAMES, unit, children, ancestors, regionOf, label, path, isWithin, km, nearestUnit, gps, summary, saved, save, packs, downloadPack, removePack };
})();
