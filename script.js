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
  document.getElementById('scoreOnpage').textContent = '–';
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
    res = await fetchWithTimeout(endpoint, 25000);
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
  // Uses public read-only CORS proxies since most sites don't send
  // Access-Control-Allow-Origin headers for direct browser fetches.
  // Tries a primary proxy, then a fallback, since free proxies are flaky.
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  ];

  let html = null;
  let lastError = null;

  for (const proxied of proxies) {
    try {
      const res = await fetchWithTimeout(proxied, 20000);
      if (!res.ok) { lastError = `proxy returned ${res.status}`; continue; }
      html = await res.text();
      if (html && html.length > 200) break;
      lastError = 'proxy returned an empty page';
      html = null;
    } catch (e) {
      lastError = e.name === 'AbortError' ? 'proxy timed out' : 'proxy unreachable';
    }
  }

  if (!html) throw new Error(lastError || 'could not fetch page HTML');

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
  setScore('scoreOnpage', result.score);
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

// ---- Rank tracking: best-effort client-side attempt ----
async function runRankCheck() {
  const note = document.getElementById('rankNote');
  const key = document.getElementById('rankKey').value.trim();
  const keyword = document.getElementById('rankKeyword').value.trim();

  if (!key || !keyword) {
    note.textContent = 'Add both an API key and a target keyword to check a position.';
    return;
  }

  note.textContent = 'Checking…';
  try {
    // Most SERP-data providers block direct browser requests (CORS) by
    // design, since exposing a paid key in client-side JS isn't secure.
    // This attempt will typically fail in-browser — real rank tracking
    // needs a small server-side endpoint holding the key instead.
    const res = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error('blocked');
    await res.json();
    note.textContent = 'Provider responded — wire this result into your report as needed.';
  } catch (e) {
    note.textContent = 'This provider blocks direct browser requests (expected — API keys shouldn\'t live in client-side code). Rank tracking needs a small backend endpoint; we set this up as part of paid engagements.';
  }
}

async function runGbpCheck() {
  const note = document.getElementById('gbpNote');
  const key = document.getElementById('gbpKey').value.trim();
  const business = document.getElementById('gbpBusiness').value.trim();
  const keyword = document.getElementById('gbpKeyword').value.trim();

  if (!key || !business || !keyword) {
    note.textContent = 'Add an API key, your business name, and a target keyword to check a local position.';
    return;
  }

  note.textContent = 'Checking…';
  try {
    // Same constraint as rank tracking above: local-pack/Maps search-data
    // providers don't allow direct browser requests with a live key.
    // This is a best-effort attempt — expect it to fail client-side.
    const res = await fetch(`https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(keyword)}&api_key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error('blocked');
    const data = await res.json();
    const results = data?.local_results || [];
    const match = results.findIndex(r => (r.title || '').toLowerCase().includes(business.toLowerCase()));
    note.textContent = match >= 0
      ? `Found at local pack position ${match + 1} for "${keyword}".`
      : `Not found in the top local results returned for "${keyword}".`;
  } catch (e) {
    note.textContent = 'This provider blocks direct browser requests (expected — API keys shouldn\'t live in client-side code). Grid-based local rank tracking needs a small backend endpoint; we set this up as part of local SEO engagements.';
  }
}
