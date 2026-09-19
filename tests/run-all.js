window.canvasTestsDone = (async () => {
  const results = [];
  for (const { name, fn } of TESTS) {
    // A state file read answers 404 unless the check says otherwise.
    window.fetch = async (url, init) => (String(url).includes('rf-test-') ? new Response('', { status: 404 }) : realFetch(url, init));
    try { await fn(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
    finally {
      if (h) h.unmount();
      h = null;
      window.fetch = realFetch;
      host.replaceChildren();
      Object.keys(localStorage).filter((k) => k.startsWith('dc2-')).forEach((k) => localStorage.removeItem(k));
    }
    document.getElementById('results').textContent = JSON.stringify(results, null, 2);
  }
  document.title = results.every((r) => r.pass) ? 'PASS: canvas regressions' : 'FAIL: canvas regressions';
  return results;
})();
