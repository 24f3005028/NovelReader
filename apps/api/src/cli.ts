export {};
const base = process.env.NOVELREADER_API_URL || 'http://localhost:4000';
const [command, target] = process.argv.slice(2);
const headers = {
  'Content-Type': 'application/json',
  ...(process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {}),
};
async function call(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
  if (!response.ok) process.exitCode = 1;
}
switch (command) {
  case 'probe':
    if (!target) throw new Error('Usage: scrape probe SOURCE');
    await call(`/sources/${encodeURIComponent(target)}/probe`, 'POST');
    break;
  case 'catalog':
    if (!target) throw new Error('Usage: scrape catalog SOURCE');
    await call(`/catalog/${encodeURIComponent(target)}/start`, 'POST');
    break;
  case 'import':
    if (!target) throw new Error('Usage: scrape import NOVEL_URL');
    await call('/imports', 'POST', { url: target });
    break;
  case 'status':
    await call(target ? `/jobs/${encodeURIComponent(target)}` : '/catalog');
    break;
  case 'failures':
    if (!target) throw new Error('Usage: scrape failures JOB_ID');
    await call(`/jobs/${encodeURIComponent(target)}/failures`);
    break;
  default:
    console.log(
      'Commands: probe SOURCE | catalog SOURCE | import URL | status [JOB_ID] | failures JOB_ID',
    );
    process.exitCode = 1;
}
