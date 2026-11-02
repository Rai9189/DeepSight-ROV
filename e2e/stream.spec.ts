import { expect, test } from '@playwright/test';
import { startVideo } from './helpers/ffmpeg';
import { API, closeRunningMission, expectVideoPlaying, openStream, recordingCount, stopAndSave } from './helpers/stream';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.setTimeout(180_000);

let stopVideo: (() => void) | undefined;

test.afterEach(async ({ request }) => {
  stopVideo?.();
  stopVideo = undefined;
  await closeRunningMission(request);
});

test('a mission with video is streamed, saved and recorded', async ({ page }) => {
  stopVideo = await startVideo();
  const mission = `Survei ${Date.now()}`;

  await openStream(page);
  await page.getByRole('button', { name: 'Start stream' }).click();
  await expectVideoPlaying(page);

  await expect(page.getByText(/^FPS [1-9]\d*$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Inference [1-9]\d* ms$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^REC 00:00:0[3-9]$/)).toBeVisible({ timeout: 30_000 });

  await stopAndSave(page, mission);
  await expect(page.getByText(`Mission "${mission}" saved.`)).toBeVisible();

  await page.goto('/dashboard/recordings');
  await expect(page.getByText(mission).first()).toBeVisible({ timeout: 30_000 });
});

test('with no camera the mission is aborted and nothing is recorded', async ({ page, request }) => {
  const before = await recordingCount(request);

  await openStream(page);
  await page.getByRole('button', { name: 'Start stream' }).click();
  await expect(page.getByText('Camera stream not found. Check that the camera is sending video to MediaMTX.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No video received')).toBeVisible({ timeout: 20_000 });

  const created = page.waitForResponse(r => r.url().includes('/api/sessions/') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const id = (await (await created).json()).data.id;
  await expect(page.getByText(/No video was received, so the mission was closed as Aborted/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Save mission' })).toHaveCount(0);

  expect(await recordingCount(request)).toBe(before);
  await page.goto(`/dashboard/analytics?session=${id}`);
  await expect(page.getByText('Aborted').first()).toBeVisible({ timeout: 30_000 });
  expect((await (await request.get(`${API}/api/sessions/${id}`)).json()).data.status).toBe('Aborted');
});

test('Reconnect reports success and failure', async ({ page, context }) => {
  await openStream(page);
  const reconnect = page.getByRole('button', { name: 'Reconnect' });

  await reconnect.click();
  await expect(page.getByText('Connecting…')).toBeVisible();
  await expect(reconnect).toBeDisabled();
  await expect(page.getByText('Reconnected to the stream server.')).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);
  await reconnect.click();
  await expect(page.getByText("Couldn't reach the stream server. Check that the backend is running.")).toBeVisible({ timeout: 15_000 });
  await context.setOffline(false);
});
