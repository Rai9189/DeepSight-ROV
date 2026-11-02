import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:8000';

export async function openStream(page: Page) {
  await page.goto('/dashboard/stream');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 });
}

export async function expectVideoPlaying(page: Page) {
  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 60_000 }).toBeGreaterThan(0);
  const t = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(t);
}

export async function startAndPlay(page: Page) {
  await page.getByRole('button', { name: 'Start stream' }).click();
  await expectVideoPlaying(page);
  await expect(page.getByText(/^REC /)).toBeVisible({ timeout: 30_000 });
}

export async function stopAndSave(page: Page, mission: string, location = 'Teluk Awur') {
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save mission' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('Mission name').fill(mission);
  await dialog.getByLabel('Location').fill(location);
  await dialog.getByRole('button', { name: 'Save mission' }).click();
}

export async function recordingCount(request: APIRequestContext) {
  const body = await (await request.get(`${API}/api/recordings?limit=1`)).json();
  return body.pagination.total as number;
}

export async function activeMission(request: APIRequestContext) {
  const res = await request.get(`${API}/api/sessions/active`);
  return res.ok() ? (await res.json()).data : null;
}

export async function peerCount(request: APIRequestContext) {
  return (await (await request.get(`${API}/api/performance`)).json()).active_peer_connections as number;
}

/** Leaves no Running mission behind, so one failing test can't change the next. */
export async function closeRunningMission(request: APIRequestContext) {
  const mission = await activeMission(request);
  if (mission) await request.patch(`${API}/api/sessions/${mission.id}`, { data: { status: 'Aborted' } });
}
