import { expect, request as playwrightRequest, test } from '@playwright/test';
import { API, closeRunningMission } from './helpers/stream';

// Abuse of the HTTP API. Nothing here should ever answer 5xx. A failure is a finding.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.setTimeout(180_000);

test.afterEach(async ({ request }) => {
  await closeRunningMission(request);
});

const LISTS = ['/api/sessions', '/api/recordings', '/api/telemetry', '/api/detections', '/api/fish-counts', '/api/auv-status', '/api/users'];
const PROTECTED = [
  ...LISTS, '/api/analytics/sessions', '/api/analytics/detections', '/api/analytics/telemetry', '/api/analytics/auv-status',
  '/api/performance', '/api/model-info', '/api/auth/me', '/api/sessions/active', '/api/telemetry/latest', '/api/auv-status/latest',
  '/api/detections/stats', '/api/fish-counts/summary', '/api/telemetry/export', '/api/detections/export', '/api/fish-counts/export',
];

test('every protected endpoint refuses anonymous and forged tokens', async () => {
  // newContext() inherits test.use(storageState), so anonymous must be explicit
  const anonymous = await playwrightRequest.newContext({ storageState: { cookies: [], origins: [] } });
  const forged = [
    'garbage',
    // alg=none, role=ADMIN
    `${btoa('{"alg":"none","typ":"JWT"}')}.${btoa('{"sub":"x","role":"ADMIN","exp":9999999999}')}.`,
  ];
  for (const path of PROTECTED) {
    expect((await anonymous.get(API + path)).status(), path).toBe(401);
    for (const token of forged) {
      expect((await anonymous.get(API + path, { headers: { Authorization: `Bearer ${token}` } })).status(), path).toBe(401);
    }
  }
  await anonymous.dispose();
});

test('a USER cannot reach admin actions', async ({ browser, request }) => {
  const context = await browser.newContext({ storageState: 'e2e/.auth/user.json' });
  const user = context.request;
  const mission = (await (await request.get(`${API}/api/sessions?limit=1`)).json()).data[0];
  const recording = (await (await request.get(`${API}/api/recordings?limit=1`)).json()).data[0];
  const me = (await (await user.get(`${API}/api/auth/me`)).json());

  expect((await user.get(`${API}/api/users`)).status()).toBe(403);
  expect((await user.post(`${API}/api/users`, { data: { username: 'x', email: 'x@tes.com', phoneNumber: '081234567890' } })).status()).toBe(403);
  expect((await user.post(`${API}/api/auth/register`, { data: { username: 'x', email: 'x@tes.com', password: 'rahasia88', phoneNumber: '081234567890' } })).status()).toBe(403);
  expect((await user.delete(`${API}/api/sessions/${mission.id}`)).status()).toBe(403);
  expect((await user.delete(`${API}/api/recordings/${recording.id}`)).status()).toBe(403);
  expect((await user.put(`${API}/api/users/${me.id ?? me.data?.id}`, { data: { role: 'ADMIN' } })).status()).toBe(403);
  await context.close();
});

test('parallel Start requests create exactly one Running mission', async ({ request }) => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    request.post(`${API}/api/sessions`, { data: { locationName: `Balapan ${i}` } })));
  const created = results.filter(r => r.status() === 201).length;
  const running = (await (await request.get(`${API}/api/sessions?status_filter=Running`)).json()).pagination.total;
  // Close every Running mission this test left, or the rest of the run inherits them
  for (const s of (await (await request.get(`${API}/api/sessions?status_filter=Running&limit=50`)).json()).data) {
    await request.patch(`${API}/api/sessions/${s.id}`, { data: { status: 'Aborted' } });
  }
  expect(results.filter(r => r.status() >= 500).length).toBe(0);
  expect(created).toBe(1);
  expect(running).toBe(1);
});

test('absurd paging never answers 5xx', async ({ request }) => {
  for (const path of LISTS) {
    for (const query of ['limit=0', 'limit=-1', 'limit=999999999999', 'page=0', 'page=-5', 'page=99999999999999999999', 'offset=-1', 'offset=99999999999999999999', 'limit=abc', 'page=1e9']) {
      const res = await request.get(`${API}${path}?${query}`);
      expect.soft(res.status(), `${path}?${query}`).toBeLessThan(500);
    }
  }
});

test('injection and junk in parameters never answer 5xx or leak rows', async ({ request }) => {
  const junk = ["' OR 1=1 -- ", '"; DROP TABLE users; --', '../../etc/passwd', '%00', '🐟'.repeat(50), 'x'.repeat(5000), '<script>'];
  const before = (await (await request.get(`${API}/api/users`)).json()).pagination.total;
  for (const value of junk) {
    const v = encodeURIComponent(value);
    for (const url of [
      `/api/telemetry?session_id=${v}`, `/api/detections?session_id=${v}`, `/api/users?search=${v}`, `/api/sessions/${v}`,
      `/api/analytics/detections?session_id=${v}`, `/api/analytics/telemetry?session_id=${v}&hours=${v}`,
      `/api/analytics/detections?from_date=${v}&to_date=${v}`, `/api/telemetry/export?from=${v}`, `/api/sessions?status_filter=${v}`,
      `/api/recordings/stream/${v}`, `/api/recordings/download/${v}`, `/api/analytics/sessions/by-date?date=${v}`,
    ]) {
      const res = await request.get(API + url);
      expect(res.status(), `${url.slice(0, 80)}`).toBeLessThan(500);
    }
  }
  const list = await (await request.get(`${API}/api/telemetry?session_id=${encodeURIComponent("' OR 1=1 -- ")}`)).json();
  expect(list.data).toHaveLength(0);
  expect((await (await request.get(`${API}/api/users`)).json()).pagination.total).toBe(before);
});

test('recording files cannot be reached outside the recordings folder', async ({ request }) => {
  for (const name of ['..%2f..%2f.env', '..%5c..%5c.env', '%2e%2e%2fconfig.py', 'clip.mp4']) {
    for (const route of ['stream', 'download']) {
      expect((await request.get(`${API}/api/recordings/${route}/${name}`)).status(), name).toBeGreaterThanOrEqual(400);
    }
  }
});

test('oversized and malformed mission names are refused cleanly', async ({ request }) => {
  const bad: unknown[] = [{ locationName: 'x'.repeat(256) }, { locationName: 'x'.repeat(1_000_000) }, { locationName: 123 }, { locationName: ['a'] },
    { locationName: { a: 1 } }, { locationName: null }, { locationName: '' }, { locationName: '   ' }, {}, [], 'text', 42];
  for (const data of bad) {
    const res = await request.post(`${API}/api/sessions`, { data });
    expect.soft(res.status(), JSON.stringify(data).slice(0, 60)).toBeLessThan(500);
    await closeRunningMission(request);
  }
});

test('finishing a mission with an oversized name is refused cleanly', async ({ request }) => {
  const created = await (await request.post(`${API}/api/sessions`, { data: { locationName: 'Panjang' } })).json();
  const res = await request.patch(`${API}/api/sessions/${created.data.id}`, { data: { status: 'Completed', locationName: 'x'.repeat(300) } });
  expect(res.status()).toBeLessThan(500);
});

test('impossible sensor values are refused cleanly', async ({ request }) => {
  const created = await (await request.post(`${API}/api/sessions`, { data: { locationName: 'Sensor' } })).json();
  const sessionId = created.data.id;
  for (const value of ['NaN', 'Infinity', '-Infinity', 1e308, 'abc', true, [], {}]) {
    const res = await request.post(`${API}/api/telemetry`, {
      data: { sessionId, phLevel: value, tdsValue: value, dissolvedOxygen: value, waterTemp: value, depth: value },
    });
    expect(res.status(), String(value)).toBeLessThan(500);
    expect((await request.get(`${API}/api/analytics/telemetry?session_id=${sessionId}&hours=876000`)).status(), `analytics ${value}`).toBe(200);
    expect((await request.get(`${API}/api/analytics/sessions`)).status(), `sessions ${value}`).toBe(200);
  }
});

test('login locks out after repeated failures, for that account only', async () => {
  const api = await playwrightRequest.newContext({ storageState: { cookies: [], origins: [] } });
  const login = (email: string, password: string) => api.post(`${API}/api/auth/login`, { data: { email, password } });
  for (let i = 0; i < 5; i++) expect((await login('korban@tes.com', 'salah')).status()).toBe(401);
  expect((await login('korban@tes.com', 'salah')).status()).toBe(429);
  expect((await login('user@tes.com', 'rahasia88')).status()).toBe(200);
  await api.dispose();
});

test('an admin cannot remove the last admin', async ({ request }) => {
  const me = await (await request.get(`${API}/api/auth/me`)).json();
  const id = me.id ?? me.data?.id;
  expect((await request.delete(`${API}/api/users/${id}`)).status()).toBeGreaterThanOrEqual(400);
  expect((await request.put(`${API}/api/users/${id}`, { data: { role: 'USER' } })).status()).toBeGreaterThanOrEqual(400);
  expect((await (await request.get(`${API}/api/auth/me`)).json())).toBeTruthy();
});

for (const count of [10, 30, 60, 100]) {
  test(`${count} parallel reads of the heaviest list all succeed`, async ({ request }) => {
    test.setTimeout(240_000);
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: count }, () => request.get(`${API}/api/analytics/sessions`, { timeout: 120_000 }).then(r => r.status(), () => 0)));
    const failed = results.filter(s => s !== 200).length;
    test.info().annotations.push({ type: 'perf', description: `${count} paralel: ${Date.now() - started} ms, gagal ${failed}` });
    await new Promise(r => setTimeout(r, 35_000)); // let the pool drain before the next size
    expect(failed).toBe(0);
  });
}

test('2000 parallel health checks all succeed', async () => {
  const api = await playwrightRequest.newContext();
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: 2000 }, () => api.get(`${API}/api/health`, { timeout: 120_000 }).then(r => r.status(), () => 0)));
  test.info().annotations.push({ type: 'perf', description: `2000 health: ${Date.now() - started} ms` });
  expect(results.filter(s => s !== 200).length).toBe(0);
  await api.dispose();
});

test('the 8-hour mission answers in under 3 seconds', async ({ request }) => {
  const missions = (await (await request.get(`${API}/api/analytics/sessions`)).json()).data;
  const big = missions.find((m: { locationName: string }) => m.locationName === 'Misi Besar');
  for (const url of [`/api/analytics/telemetry?session_id=${big.id}&hours=876000`, `/api/analytics/detections?session_id=${big.id}&hours=876000&bucket=minute`, `/api/sessions/${big.id}`]) {
    const started = Date.now();
    expect((await request.get(API + url)).status()).toBe(200);
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'perf', description: `${url.split('?')[0]}: ${ms} ms` });
    expect(ms, url).toBeLessThan(3000);
  }
});
