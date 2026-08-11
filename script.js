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
});

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
  document.getElementById('onpageList').innerHTML = '';

  const results = await Promise.allSettled([
    fetchPageSpeed(url, 'mobile'),
    fetchPageSpeed(url, 'desktop'),
    fetchOnPage(url)
  ]);

  loadingRow.classList.remove('show');

  const [mobileRes, desktopRes, onpageRes] = results;
  let anySuccess = false;

  if (mobileRes.status === 'fulfilled') {
    setScore('scoreMobile', mobileRes.value);
    anySuccess = true;
  }
  if (desktopRes.status === 'fulfilled') {
    setScore('scoreDesktop', desktopRes.value);
    anySuccess = true;
  }

  if (onpageRes.status === 'fulfilled') {
    renderOnPage(onpageRes.value);
    anySuccess = true;
  } else {
    renderOnPageError();
  }

  if (!anySuccess) {
    errorBox.textContent = "Couldn't reach that site or the diagnostic services right now. Double-check the URL and try again in a moment.";
    errorBox.classList.add('show');
    return;
  }

  report.classList.add('show');
}

function setScore(elId, score) {
  const el = document.getElementById(elId);
  el.textContent = score;
  el.classList.remove('pass', 'fail');
  if (score >= 80) el.classList.add('pass');
  else if (score < 50) el.classList.add('fail');
}

async function fetchPageSpeed(url, strategy) {
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error('PageSpeed request failed');
  const data = await res.json();
  const score = data?.lighthouseResult?.categories?.performance?.score;
  if (score === undefined || score === null) throw new Error('No score returned');
  return Math.round(score * 100);
}

async function fetchOnPage(url) {
  // Uses a public read-only CORS proxy since most sites don't send
  // Access-Control-Allow-Origin headers for direct browser fetches.
  const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxied);
  if (!res.ok) throw new Error('Could not fetch page HTML');
  const html = await res.text();

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
