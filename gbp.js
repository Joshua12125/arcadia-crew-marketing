// Vercel serverless function — /api/gbp
// Checks a business's position in Google's local map pack for a keyword,
// using SerpApi's Google Maps engine. The API key lives only in Vercel's
// environment variables (SERPAPI_KEY) — visitors never see or enter it.

module.exports = async function handler(req, res) {
  const apiKey = process.env.SERPAPI_KEY;
  const { business, keyword } = req.query;

  if (!apiKey) {
    res.status(200).json({ error: 'Local rank tracking isn\'t configured yet — add SERPAPI_KEY in Vercel project settings.' });
    return;
  }
  if (!business || !keyword) {
    res.status(400).json({ error: 'business and keyword are required' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const endpoint = `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(keyword)}&type=search&api_key=${apiKey}`;
    const response = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      res.status(200).json({ error: `search provider returned ${response.status}` });
      return;
    }

    const data = await response.json();
    const results = data.local_results || [];
    const needle = business.toLowerCase();
    const index = results.findIndex(r => (r.title || '').toLowerCase().includes(needle));

    res.status(200).json({
      keyword,
      business,
      found: index >= 0,
      position: index >= 0 ? index + 1 : null,
      rating: index >= 0 ? results[index].rating : null,
      checkedResults: results.length
    });
  } catch (e) {
    clearTimeout(timeout);
    const message = e.name === 'AbortError' ? 'search provider timed out' : 'could not reach search provider';
    res.status(200).json({ error: message });
  }
};
