// Vercel serverless function — /api/scan
// Fetches a URL's HTML server-side (no CORS, no third-party proxy) and
// runs the same on-page SEO checks the client used to run via DOMParser.
// Regex-based parsing is used instead of a DOM library to keep this
// dependency-free and fast to cold-start.

module.exports = async function handler(req, res) {
  const target = req.query.url;

  if (!target || typeof target !== 'string') {
    res.status(400).json({ error: 'missing url parameter' });
    return;
  }

  let url;
  try {
    url = new URL(target);
    if (!/^https?:$/.test(url.protocol)) throw new Error('bad protocol');
  } catch (e) {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let html;
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.status(200).json({ error: `target site returned ${response.status}` });
      return;
    }
    html = await response.text();
  } catch (e) {
    clearTimeout(timeout);
    const message = e.name === 'AbortError' ? 'target site timed out' : 'could not reach target site';
    res.status(200).json({ error: message });
    return;
  }

  const result = analyze(html, url.toString());
  res.status(200).json(result);
}

function getAttr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : '';
}

function analyze(html, url) {
  const checks = [];

  // Title tag
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  checks.push({
    label: 'Title tag',
    status: title ? (title.length >= 15 && title.length <= 60 ? 'pass' : 'warn') : 'fail',
    detail: title ? `${title.length} characters` : 'Missing'
  });

  // Meta tags
  const metaTags = html.match(/<meta[^>]*>/gi) || [];
  let description = '';
  let viewport = '';
  let robots = '';
  for (const tag of metaTags) {
    const name = getAttr(tag, 'name').toLowerCase();
    const content = getAttr(tag, 'content');
    if (name === 'description') description = content;
    if (name === 'viewport') viewport = content;
    if (name === 'robots') robots = content;
  }

  checks.push({
    label: 'Meta description',
    status: description ? (description.length >= 50 && description.length <= 160 ? 'pass' : 'warn') : 'fail',
    detail: description ? `${description.length} characters` : 'Missing'
  });

  // H1
  const h1s = html.match(/<h1[\s\S]*?<\/h1>/gi) || [];
  checks.push({
    label: 'H1 heading',
    status: h1s.length === 1 ? 'pass' : (h1s.length === 0 ? 'fail' : 'warn'),
    detail: `${h1s.length} found on page`
  });

  // Images / alt text
  const imgTags = html.match(/<img[^>]*>/gi) || [];
  const withAlt = imgTags.filter(t => getAttr(t, 'alt').length > 0).length;
  const altPct = imgTags.length ? Math.round((withAlt / imgTags.length) * 100) : 100;
  checks.push({
    label: 'Image alt text',
    status: imgTags.length === 0 ? 'pass' : (altPct >= 90 ? 'pass' : (altPct >= 50 ? 'warn' : 'fail')),
    detail: imgTags.length ? `${altPct}% of ${imgTags.length} images` : 'No images found'
  });

  // Canonical
  const linkTags = html.match(/<link[^>]*>/gi) || [];
  const canonical = linkTags.some(t => getAttr(t, 'rel').toLowerCase() === 'canonical');
  checks.push({
    label: 'Canonical tag',
    status: canonical ? 'pass' : 'warn',
    detail: canonical ? 'Present' : 'Not found'
  });

  // Viewport
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

  // Word count — strip scripts/styles/tags, roughly limit to <body>
  const bodyMatch = html.match(/<body[\s\S]*<\/body>/i);
  const scope = bodyMatch ? bodyMatch[0] : html;
  const text = scope
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = text ? text.split(' ').length : 0;
  checks.push({
    label: 'Body content length',
    status: wordCount >= 300 ? 'pass' : (wordCount >= 100 ? 'warn' : 'fail'),
    detail: `${wordCount} words`
  });

  // Robots directive
  checks.push({
    label: 'Robots directive',
    status: /noindex/i.test(robots) ? 'warn' : 'pass',
    detail: robots ? robots : 'No restrictive directive found'
  });

  const passCount = checks.filter(c => c.status === 'pass').length;
  const score = Math.round((passCount / checks.length) * 100);

  return { checks, score };
}
