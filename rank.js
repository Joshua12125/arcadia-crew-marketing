// Vercel serverless function — /api/rank
// Checks a domain's organic search position for a keyword using SerpApi.
// The API key lives only in Vercel's environment variables (SERPAPI_KEY) —
// it is never sent to or requested from the visitor's browser.

module.exports = async function handler(req, res) {
  const apiKey = process.env.SERPAPI_KEY;
  const { domain, keyword } = req.query;

  if (!apiKey) {
    res.status(200).json({ error: 'Rank tracking isn\'t configured yet — add SERPAPI_KEY in Vercel project settings.' });
    return;
  }
  if (!domain || !keyword) {
    res.status(400).json({ error: 'domain and keyword are required' });
    return;
  }

  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const endpoint = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${apiKey}`;
    const response = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      res.status(200).json({ error: `search provider returned ${response.status}` });
      return;
    }

    const data = await response.json();
    const organic = data.organic_results || [];
    const index = organic.findIndex(r => (r.link || '').toLowerCase().includes(cleanDomain));

    res.status(200).json({
      keyword,
      domain: cleanDomain,
      found: index >= 0,
      position: index >= 0 ? index + 1 : null,
      resultUrl: index >= 0 ? organic[index].link : null,
      checkedResults: organic.length
    });
  } catch (e) {
    clearTimeout(timeout);
    const message = e.name === 'AbortError' ? 'search provider timed out' : 'could not reach search provider';
    res.status(200).json({ error: message });
  }
};
