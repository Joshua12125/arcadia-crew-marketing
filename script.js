// Arcadia Crew Marketing — site + audit tool logic

document.addEventListener('DOMContentLoaded', () => {
  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // ---- Contact form -> mailto ----
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const site = document.getElementById('site').value.trim();
      const message = document.getElementById('message').value.trim();
      const subject = encodeURIComponent(`Project inquiry from ${name}`);
      const bodyLines = [
        `Name: ${name}`,
        `Email: ${email}`,
        site ? `Website: ${site}` : null,
        '',
        message
      ].filter(Boolean);
      const body = encodeURIComponent(bodyLines.join('\n'));
      window.location.href = `mailto:info@arcadiacrewmarketing.com?subject=${subject}&body=${body}`;
    });
  }

  // ---- Audit tool ----
  const scanBtn = document.getElementById('scanBtn');
  if (scanBtn) {
    scanBtn.addEventListener('click', runScan);
    document.getElementById('urlInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runScan();
    });
  }

  const rankBtn = document.getElementById('rankBtn');
  if (rankBtn) rankBtn.addEventListener('click', runRankCheck);

  const gbpBtn = document.getElementById('gbpBtn');
  if (gbpBtn) gbpBtn.addEventListener('click', runGbpCheck);
});

// Optional: paste a free Google PageSpeed Insights API key here to avoid
// the strict rate limits Google applies to unauthenticated requests.
// Get one at https://console.cloud.google.com/apis/credentials
// (enable "PageSpeed Insights API", no billing required for normal use).
const PAGESPEED_API_KEY = 'AIzaSyA1Ee18SAIyJ4JKwryYMTYIs0ZByOrlt1o';

function normalizeUrl(raw) {
  let u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).toString();
  } catch (e) {
    return null;
  }
}

async function fetchWithTimeout(url, ms = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function runScan() {
  const input = document.getElementById('urlInput');
  const url = normalizeUrl(input.value);
  const loadingRow = document.getElementById('loadingRow');
  const errorBox = document.getElementById('errorBox');
  const report = document.getElementById('report');

  errorBox.classList.remove('show');
  report.classList.remove('show');

  if (!url) {
    errorBox.textContent = 'Enter a valid URL, e.g. yourwebsite.com';
    errorBox.classList.add('show');
    return;
  }

  loadingRow.classList.add('show');
  document.getElementById('scoreMobile').textContent = '–';
  document.getElementById('scoreDesktop').textContent = '–';
  document.getElementById('scoreOverall').textContent = '–';
  document.getElementById('overallNote').textContent = '';
  document.getElementById('onpageList').innerHTML = '';

  const results = await Promise.allSettled([
    fetchPageSpeed(url, 'mobile'),
    fetchPageSpeed(url, 'desktop'),
    fetchOnPage(url)
  ]);

  loadingRow.classList.remove('show');

  const [mobileRes, desktopRes, onpageRes] = results;
  let anySuccess = false;
  const failures = [];

  if (mobileRes.status === 'fulfilled') {
    setScore('scoreMobile', mobileRes.value);
    anySuccess = true;
  } else {
    failures.push(`Mobile speed: ${mobileRes.reason?.message || 'request failed'}`);
  }

  if (desktopRes.status === 'fulfilled') {
    setScore('scoreDesktop', desktopRes.value);
    anySuccess = true;
  } else {
    failures.push(`Desktop speed: ${desktopRes.reason?.message || 'request failed'}`);
  }

  if (onpageRes.status === 'fulfilled') {
    renderOnPage(onpageRes.value);
    anySuccess = true;
  } else {
    renderOnPageError();
    failures.push(`On-page scan: ${onpageRes.reason?.message || 'request failed'}`);
  }

  if (failures.length) {
    errorBox.innerHTML = failures.map(f => `<div>${f}</div>`).join('');
    errorBox.classList.add('show');
  }

  if (!anySuccess) {
    return;
  }

  renderOverall({
    mobile: mobileRes.status === 'fulfilled' ? mobileRes.value : null,
    desktop: desktopRes.status === 'fulfilled' ? desktopRes.value : null,
    onpage: onpageRes.status === 'fulfilled' ? onpageRes.value.score : null
  });

  report.classList.add('show');
}

function renderOverall({ mobile, desktop, onpage }) {
  // Weighted: on-page content signals matter most for SEO, speed is a
  // secondary ranking factor. If a piece is missing (e.g. proxy blocked),
  // the average is taken over whatever actually came back.
  const parts = [];
  if (onpage !== null) parts.push({ value: onpage, weight: 2 });
  if (mobile !== null) parts.push({ value: mobile, weight: 1 });
  if (desktop !== null) parts.push({ value: desktop, weight: 1 });

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const overall = Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight);

  setScore('scoreOverall', overall);

  const note = document.getElementById('overallNote');
  const missing = [];
  if (mobile === null) missing.push('mobile speed');
  if (desktop === null) missing.push('desktop speed');
  if (onpage === null) missing.push('on-page scan');
  note.textContent = missing.length
    ? `Based on the checks that completed — ${missing.join(' and ')} couldn't be reached this time.`
    : 'Based on on-page content (weighted higher) and mobile/desktop speed.';
}

function setScore(elId, score) {
  const el = document.getElementById(elId);
  el.textContent = score;
  el.classList.remove('pass', 'fail');
  if (score >= 80) el.classList.add('pass');
  else if (score < 50) el.classList.add('fail');
}

async function fetchPageSpeed(url, strategy) {
  let endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance`;
  if (PAGESPEED_API_KEY) endpoint += `&key=${PAGESPEED_API_KEY}`;

  let res;
  try {
    res = await fetchWithTimeout(endpoint, 28000);
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : 'network error reaching Google');
  }
  if (res.status === 429) throw new Error('rate limited by Google (add a free API key to fix this)');
  if (!res.ok) throw new Error(`Google returned an error (${res.status})`);
  const data = await res.json();
  const score = data?.lighthouseResult?.categories?.performance?.score;
  if (score === undefined || score === null) throw new Error(data?.error?.message || 'no score returned — the URL may be unreachable by Google');
  return Math.round(score * 100);
}

async function fetchOnPage(url) {
  // Preferred path: our own Vercel serverless function fetches the HTML
  // server-side — no CORS, no third-party proxy, no bot-blocking on the
  // proxy's IP. Falls back to public proxies only if /api/scan isn't
  // available (e.g. running the static files without Vercel).
  try {
    const res = await fetchWithTimeout(`/api/scan?url=${encodeURIComponent(url)}`, 10000);
    if (res.ok) {
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.checks) return data;
    }
  } catch (e) {
    // fall through to proxy fallback below
  }

  return fetchOnPageViaProxy(url);
}

async function fetchOnPageViaProxy(url) {
  // Uses public read-only CORS proxies since most sites don't send
  // Access-Control-Allow-Origin headers for direct browser fetches.
  // Races both proxies at once (instead of one after another) so a
  // slow/dead proxy doesn't double the wait.
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  ];

  const attempts = proxies.map(async (proxied) => {
    try {
      const res = await fetchWithTimeout(proxied, 12000);
      if (!res.ok) throw new Error(`proxy returned ${res.status}`);
      const html = await res.text();
      if (!html || html.length < 200) throw new Error('proxy returned an empty page');
      return html;
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'proxy timed out' : (e.message || 'proxy unreachable'));
    }
  });

  let html;
  try {
    html = await Promise.any(attempts);
  } catch (aggregate) {
    const reasons = (aggregate.errors || []).map(e => e.message).filter(Boolean);
    throw new Error(reasons[0] || 'could not fetch page HTML');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const checks = [];

  // Title tag
  const title = doc.querySelector('title')?.textContent?.trim() || '';
  checks.push({
    label: 'Title tag',
    status: title ? (title.length >= 15 && title.length <= 60 ? 'pass' : 'warn') : 'fail',
    detail: title ? `${title.length} characters` : 'Missing'
  });

  // Meta description
  const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
  checks.push({
    label: 'Meta description',
    status: desc ? (desc.length >= 50 && desc.length <= 160 ? 'pass' : 'warn') : 'fail',
    detail: desc ? `${desc.length} characters` : 'Missing'
  });

  // H1 count
  const h1s = doc.querySelectorAll('h1');
  checks.push({
    label: 'H1 heading',
    status: h1s.length === 1 ? 'pass' : (h1s.length === 0 ? 'fail' : 'warn'),
    detail: `${h1s.length} found on page`
  });

  // Image alt coverage
  const imgs = Array.from(doc.querySelectorAll('img'));
  const withAlt = imgs.filter(img => (img.getAttribute('alt') || '').trim().length > 0).length;
  const altPct = imgs.length ? Math.round((withAlt / imgs.length) * 100) : 100;
  checks.push({
    label: 'Image alt text',
    status: imgs.length === 0 ? 'pass' : (altPct >= 90 ? 'pass' : (altPct >= 50 ? 'warn' : 'fail')),
    detail: imgs.length ? `${altPct}% of ${imgs.length} images` : 'No images found'
  });

  // Canonical tag
  const canonical = doc.querySelector('link[rel="canonical"]');
  checks.push({
    label: 'Canonical tag',
    status: canonical ? 'pass' : 'warn',
    detail: canonical ? 'Present' : 'Not found'
  });

  // Viewport meta (mobile)
  const viewport = doc.querySelector('meta[name="viewport"]');
  checks.push({
    label: 'Mobile viewport tag',
    status: viewport ? 'pass' : 'fail',
    detail: viewport ? 'Present' : 'Missing'
  });

  // HTTPS
  checks.push({
    label: 'HTTPS',
    status: url.startsWith('https://') ? 'pass' : 'fail',
    detail: url.startsWith('https://') ? 'Enforced' : 'Not using HTTPS'
  });

  // Word count (rough, body text)
  const bodyText = doc.body ? doc.body.textContent.replace(/\s+/g, ' ').trim() : '';
  const wordCount = bodyText ? bodyText.split(' ').length : 0;
  checks.push({
    label: 'Body content length',
    status: wordCount >= 300 ? 'pass' : (wordCount >= 100 ? 'warn' : 'fail'),
    detail: `${wordCount} words`
  });

  // Robots meta (block accidental noindex on a real business page)
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  checks.push({
    label: 'Robots directive',
    status: /noindex/i.test(robots) ? 'warn' : 'pass',
    detail: robots ? robots : 'No restrictive directive found'
  });

  const passCount = checks.filter(c => c.status === 'pass').length;
  const score = Math.round((passCount / checks.length) * 100);

  return { checks, score };
}

function renderOnPage(result) {
  const list = document.getElementById('onpageList');
  list.innerHTML = '';
  result.checks.forEach(c => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${c.label} — <span style="color:var(--sand-dim)">${c.detail}</span></span><span class="status ${c.status}">${c.status}</span>`;
    list.appendChild(li);
  });
}

function renderOnPageError() {
  const list = document.getElementById('onpageList');
  list.innerHTML = '<li>Couldn\'t fetch the page HTML directly — some sites block outside requests. Speed scores above still reflect Google\'s own data.</li>';
}

// ---- Rank tracking: server-side, no key required from the visitor ----
async function runRankCheck() {
  const note = document.getElementById('rankNote');
  const domain = document.getElementById('rankDomain').value.trim();
  const keyword = document.getElementById('rankKeyword').value.trim();

  if (!domain || !keyword) {
    note.textContent = 'Add your domain and a target keyword to check a position.';
    return;
  }

  note.textContent = 'Checking…';
  try {
    const res = await fetchWithTimeout(`/api/rank?domain=${encodeURIComponent(domain)}&keyword=${encodeURIComponent(keyword)}`, 15000);
    const data = await res.json();
    if (data.error) { note.textContent = data.error; return; }
    note.textContent = data.found
      ? `Ranking #${data.position} for "${data.keyword}" (checked top ${data.checkedResults} results).`
      : `Not found in the top ${data.checkedResults} results for "${data.keyword}".`;
  } catch (e) {
    note.textContent = e.name === 'AbortError' ? 'Timed out — try again.' : 'Could not check that position right now.';
  }
}

async function runGbpCheck() {
  const note = document.getElementById('gbpNote');
  const business = document.getElementById('gbpBusiness').value.trim();
  const keyword = document.getElementById('gbpKeyword').value.trim();

  if (!business || !keyword) {
    note.textContent = 'Add your business name and a target keyword to check a local position.';
    return;
  }

  note.textContent = 'Checking…';
  try {
    const res = await fetchWithTimeout(`/api/gbp?business=${encodeURIComponent(business)}&keyword=${encodeURIComponent(keyword)}`, 15000);
    const data = await res.json();
    if (data.error) { note.textContent = data.error; return; }
    note.textContent = data.found
      ? `Local pack position #${data.position} for "${data.keyword}".`
      : `Not found in the local results returned for "${data.keyword}".`;
  } catch (e) {
    note.textContent = e.name === 'AbortError' ? 'Timed out — try again.' : 'Could not check that position right now.';
  }
}
