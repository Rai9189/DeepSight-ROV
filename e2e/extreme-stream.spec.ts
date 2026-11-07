import { expect, test, type WebSocketRoute } from '@playwright/test';
import { startVideo } from './helpers/ffmpeg';
import {
  API, activeMission, closeRunningMission, expectVideoPlaying, openStream, peerCount, recordingCount, startAndPlay, stopAndSave,
} from './helpers/stream';

// Failure and abuse paths of the live stream. A failure here is a finding, not a broken test.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.setTimeout(300_000);

let stopVideo: (() => void) | undefined;

test.afterEach(async ({ request }) => {
  stopVideo?.();
  stopVideo = undefined;
  await closeRunningMission(request);
});

test('camera dies mid-stream: Stop still works and the recording survives', async ({ page, request }) => {
  stopVideo = await startVideo();
  const before = await recordingCount(request);
  await openStream(page);
  await startAndPlay(page);
  await page.waitForTimeout(4000);

  stopVideo();
  stopVideo = undefined;
  await page.waitForTimeout(12_000);

  await stopAndSave(page, `Kamera Mati ${Date.now()}`);
  await expect(page.getByText(/saved\.$/)).toBeVisible();
  expect(await recordingCount(request)).toBe(before + 1);
});

test('reloading mid-stream keeps the recording and the mission can be resumed', async ({ page, request }) => {
  stopVideo = await startVideo();
  const before = await recordingCount(request);
  await openStream(page);
  await startAndPlay(page);
  await page.waitForTimeout(3000);
  const mission = await activeMission(request);

  await page.reload();
  await expect.poll(() => recordingCount(request), { timeout: 20_000 }).toBe(before + 1);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(mission.locationName, { exact: false })).toBeVisible();

  await startAndPlay(page);
  await stopAndSave(page, `Lanjut ${Date.now()}`);
  await expect(page.getByText(/saved\.$/)).toBeVisible();
  expect((await activeMission(request))).toBeNull();
});

test('closing the tab mid-stream saves the recording and frees the connection', async ({ context, page, request }) => {
  stopVideo = await startVideo();
  const before = await recordingCount(request);
  const tab = await context.newPage();
  await openStream(tab);
  await startAndPlay(tab);
  await tab.waitForTimeout(3000);
  await tab.close();

  await expect.poll(() => recordingCount(request), { timeout: 20_000 }).toBe(before + 1);
  await expect.poll(() => peerCount(request), { timeout: 20_000 }).toBe(0);
  await page.close();
});

test('double-clicking Start creates one mission and one recording', async ({ page, request }) => {
  stopVideo = await startVideo();
  const before = await recordingCount(request);
  const sessions = () => request.get(`${API}/api/sessions?status_filter=Running`).then(r => r.json());
  await openStream(page);

  await page.getByRole('button', { name: 'Start stream' }).dblclick();
  await expectVideoPlaying(page);
  await expect(page.getByText(/^REC /)).toBeVisible({ timeout: 30_000 });
  expect((await sessions()).pagination.total).toBe(1);

  await stopAndSave(page, `Klik Ganda ${Date.now()}`);
  await expect(page.getByText(/saved\.$/)).toBeVisible();
  expect(await recordingCount(request)).toBe(before + 1);
});

test('five Start/Stop cycles in a row leak no connection', async ({ page, request }) => {
  stopVideo = await startVideo();
  const before = await recordingCount(request);
  await openStream(page);
  for (let i = 0; i < 5; i++) {
    await startAndPlay(page);
    await stopAndSave(page, `Siklus ${i} ${Date.now()}`);
    await expect(page.getByText(`Mission "Siklus ${i}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start stream' })).toBeEnabled({ timeout: 15_000 });
  }
  expect(await recordingCount(request)).toBe(before + 5);
  await expect.poll(() => peerCount(request), { timeout: 15_000 }).toBe(0);
});

test('five tabs stream at once and every video plays', async ({ context, request }) => {
  stopVideo = await startVideo();
  const tabs = await Promise.all(Array.from({ length: 5 }, () => context.newPage()));
  for (const tab of tabs) {
    await openStream(tab);
    await tab.getByRole('button', { name: 'Start stream' }).click();
  }
  for (const tab of tabs) await expectVideoPlaying(tab);
  const peers: number[] = [];
  for (let i = 0; i < 6; i++) { await tabs[0].waitForTimeout(2000); peers.push(await peerCount(request)); }
  for (const tab of tabs) await expectVideoPlaying(tab);
  test.info().annotations.push({ type: 'perf', description: `peers tiap 2 dtk: ${peers.join(', ')}` });

  const perf = await (await request.get(`${API}/api/performance`)).json();
  test.info().annotations.push({ type: 'perf', description: `5 tabs: fps=${perf.fps}, inference=${perf.inference_ms}ms, cpu=${perf.cpu_percent}%` });
  expect(perf.active_peer_connections).toBe(5);
  expect(perf.fps).toBeGreaterThan(5);
  await Promise.all(tabs.map(t => t.close()));
  await expect.poll(() => peerCount(request), { timeout: 30_000 }).toBe(0);
});

test('two operators on one mission: neither loses the save', async ({ browser, page }) => {
  stopVideo = await startVideo();
  await openStream(page);
  await startAndPlay(page);

  const userContext = await browser.newContext({ storageState: 'e2e/.auth/user.json', baseURL: 'http://localhost:3000' });
  const userPage = await userContext.newPage();
  await openStream(userPage);
  await startAndPlay(userPage);

  const userMission = `Punya User ${Date.now()}`;
  await stopAndSave(userPage, userMission);
  await expect(userPage.getByText(/saved\.$/)).toBeVisible();

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save mission' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('Mission name').fill('Punya Admin');
  await dialog.getByLabel('Location').fill('Teluk Awur');
  await dialog.getByRole('button', { name: 'Save mission' }).click();
  await expect(page.getByText(/saved\.$|Couldn't save/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Couldn't save the mission. Try again.")).toHaveCount(0);
  await userContext.close();
});

test('a 4K 60 fps source still plays', async ({ page, request }) => {
  stopVideo = await startVideo({ size: '3840x2160', rate: 60 });
  await openStream(page);
  await startAndPlay(page);
  await expect(page.getByText(/^FPS [1-9]\d*$/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(15_000);
  const perf = await (await request.get(`${API}/api/performance`)).json();
  test.info().annotations.push({ type: 'perf', description: `4K60: fps=${perf.fps}, inference=${perf.inference_ms}ms, cpu=${perf.cpu_percent}%` });
  await stopAndSave(page, `4K ${Date.now()}`);
  await expect(page.getByText(/saved\.$/)).toBeVisible();
});

test('a 2K camera is scaled down to 480p', async ({ page, request }) => {
  stopVideo = await startVideo({ size: '2560x1440', rate: 30 });
  await openStream(page);
  await startAndPlay(page);
  await expect(page.getByText(/^FPS [1-9]\d*$/)).toBeVisible({ timeout: 30_000 });
  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => `${v.videoWidth}x${v.videoHeight}`)).toBe('854x480');
  await page.waitForTimeout(15_000);
  const perf = await (await request.get(`${API}/api/performance`)).json();
  test.info().annotations.push({ type: 'perf', description: `2K: fps=${perf.fps}, inference=${perf.inference_ms}ms, cpu=${perf.cpu_percent}%` });
  await stopAndSave(page, `2K ${Date.now()}`);
  await expect(page.getByText(/saved\.$/)).toBeVisible();
});

for (const [name, codec, profile, bitrate] of [
  ['VP8 + UDP', 'vp8', 'ultra', '500'],
  ['maximum bitrate', 'h264', 'balanced', '12000'],
  ['absurd bitrate', 'h264', 'balanced', '999999'],
  ['negative bitrate', 'h264', 'balanced', '-1'],
  ['zero bitrate', 'h264', 'balanced', '0'],
]) {
  test(`stream settings: ${name}`, async ({ page }) => {
    stopVideo = await startVideo();
    await openStream(page);
    await page.getByRole('button', { name: /Stream settings/ }).click();
    await page.getByLabel('Codec').selectOption(codec);
    await page.getByLabel('Profile').selectOption(profile);
    await page.getByLabel('Bitrate (kbps)').fill(bitrate);
    await startAndPlay(page);
    await stopAndSave(page, `Setelan ${name} ${Date.now()}`);
    await expect(page.getByText(/saved\.$/)).toBeVisible();
  });
}

test('a 90-second stream holds its frame rate and records the right length', async ({ page, request }) => {
  stopVideo = await startVideo();
  await openStream(page);
  await startAndPlay(page);
  const startedAt = Date.now();
  const fps: number[] = [];
  while (Date.now() - startedAt < 90_000) {
    await page.waitForTimeout(10_000);
    fps.push((await (await request.get(`${API}/api/performance`)).json()).fps);
  }
  const wall = (Date.now() - startedAt) / 1000;
  await stopAndSave(page, `Panjang ${Date.now()}`);
  await expect(page.getByText(/saved\.$/)).toBeVisible();

  const newest = (await (await request.get(`${API}/api/recordings?limit=1`)).json()).data[0];
  test.info().annotations.push({ type: 'perf', description: `fps tiap 10 dtk: ${fps.join(', ')}; rekaman ${newest.duration}s dari ${wall}s` });
  expect(Math.min(...fps)).toBeGreaterThan(Math.max(...fps) / 2);
  expect(newest.duration).toBeGreaterThan(wall * 0.8);
  expect(newest.duration).toBeLessThan(wall * 1.2);
});

test('losing the WebSocket mid-stream stops cleanly and keeps the recording', async ({ page, request }) => {
  stopVideo = await startVideo();
  const before = await recordingCount(request);
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/ws\//, ws => {
    const server = ws.connectToServer();
    ws.onMessage(m => server.send(m));
    server.onMessage(m => ws.send(m));
    socket = ws;
  });
  await openStream(page);
  await startAndPlay(page);
  await page.waitForTimeout(3000);

  await socket!.close();
  await expect(page.getByText('Connection lost. Recording was stopped on the server.')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => recordingCount(request), { timeout: 20_000 }).toBe(before + 1);
  await expect(page.getByRole('button', { name: 'Start stream' })).toBeVisible();
});

test('the login expiring mid-stream still keeps the recording', async ({ context, page, request }) => {
  stopVideo = await startVideo();
  const before = await recordingCount(request);
  await openStream(page);
  await startAndPlay(page);
  await page.waitForTimeout(3000);

  await context.clearCookies();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login/, { timeout: 30_000 });
  await expect.poll(() => recordingCount(request), { timeout: 20_000 }).toBe(before + 1);
});

test('save dialog: empty fields are refused', async ({ page }) => {
  stopVideo = await startVideo();
  await openStream(page);
  await startAndPlay(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save mission' });
  await dialog.getByRole('button', { name: 'Save mission' }).click();
  await expect(dialog.getByText('Enter a mission name')).toBeVisible();
  await expect(dialog.getByText('Enter a location')).toBeVisible();
  await dialog.getByLabel('Mission name').fill('   ');
  await dialog.getByLabel('Location').fill('   ');
  await dialog.getByRole('button', { name: 'Save mission' }).click();
  await expect(dialog.getByText('Enter a mission name')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Mission name').fill('Isi');
  await dialog.getByLabel('Location').fill('Isi');
  await dialog.getByRole('button', { name: 'Save mission' }).click();
  await expect(page.getByText(/saved\.$/)).toBeVisible();
});

test('save dialog: a 300-character name neither crashes nor leaves the mission open', async ({ page, request }) => {
  stopVideo = await startVideo();
  await openStream(page);
  await startAndPlay(page);
  await stopAndSave(page, 'N'.repeat(300));
  await expect(page.getByText(/saved\.$|Couldn't save/)).toBeVisible({ timeout: 10_000 });
  const left = await activeMission(request);
  expect.soft(left, 'mission left Running').toBeNull();
  await expect(page.getByText(/saved\.$/)).toBeVisible();
});

test('save dialog: script and emoji names stay plain text', async ({ page }) => {
  stopVideo = await startVideo();
  const name = `<script>window.__xss=1</script> 🐟 ${Date.now()}`;
  await openStream(page);
  await startAndPlay(page);
  await stopAndSave(page, name, `" onmouseover="window.__xss=1`);
  await expect(page.getByText(/saved\.$/)).toBeVisible();
  await page.goto('/dashboard/recordings');
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('JSON that is not an object does not stop the server listening', async ({ page }) => {
  await openStream(page);
  const replies = await page.evaluate(async () => {
    // A bad offer always gets an error reply, so a reply proves the server still reads this socket
    const repliesAfter = (payload: string) => new Promise<boolean>(resolve => {
      const ws = new WebSocket(`ws://localhost:8000/ws/garbage${Math.random().toString(36).slice(2, 10)}`);
      const finish = (replied: boolean) => { resolve(replied); ws.close(); };
      ws.onmessage = e => finish(JSON.parse(e.data).type === 'error');
      ws.onopen = () => {
        ws.send(payload);
        ws.send(JSON.stringify({ type: 'offer' }));
        setTimeout(() => finish(false), 5000);
      };
    });
    return Promise.all([repliesAfter('[1,2,3]'), repliesAfter('null'), repliesAfter('42'), repliesAfter('{}')]);
  });
  expect(replies).toEqual([true, true, true, true]);
});

test('the backend survives garbage on the WebSocket', async ({ page, request }) => {
  await openStream(page);
  const closed = await page.evaluate(async () => {
    const send = (payload: string) => new Promise<number>(resolve => {
      const ws = new WebSocket(`ws://localhost:8000/ws/garbage${Math.random().toString(36).slice(2, 10)}`);
      ws.onopen = () => { ws.send(payload); setTimeout(() => { ws.close(); }, 1000); };
      ws.onclose = e => resolve(e.code);
    });
    return Promise.all([
      send('not json'), send('[1,2,3]'), send('null'), send('42'),
      send(JSON.stringify({ type: 'offer' })),
      send(JSON.stringify({ type: 'offer', sdp: 'garbage', profile: 123, codec: null, maxBitrateKbps: 'x' })),
      send('x'.repeat(2_000_000)),
    ]);
  });
  test.info().annotations.push({ type: 'ws', description: `close codes: ${closed.join(', ')}` });
  expect((await request.get(`${API}/api/health`)).ok()).toBeTruthy();
  await expect.poll(() => peerCount(request), { timeout: 15_000 }).toBe(0);
});
