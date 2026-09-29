// Safe embedding of a value as a JS string argument inside an inline handler attribute, e.g.
// onclick="fn(${jsq(name)})". esc() alone is NOT enough there: the browser decodes &#39; back to a quote
// before running the handler, so a name containing ' could break out and execute code.
const jsq = s => esc(JSON.stringify(String(s==null?'':s)));
// Only http(s)/mailto links are allowed through; blocks javascript:, data: and vbscript: URLs.
const safeUrl = u => { try { const x = new URL(String(u||'').trim(), location.href); return /^(https?:|mailto:)$/.test(x.protocol) ? x.href : '#'; } catch(_){ return '#'; } };
