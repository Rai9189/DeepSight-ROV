import { test, expect } from '@playwright/test';
import { getPhStatus, getDoStatus, getTempStatus, getTdsStatus, isDepthNearLimit } from '../src/lib/water-quality';

// Boundaries of the general seawater ranges agreed 2026-11-05. No browser needed.
test('water-quality labels flip exactly at each boundary', () => {
  const label = (s: { label: string } | null) => s?.label ?? null;

  expect([25.9, 26, 32, 32.1].map(v => label(getTempStatus(v)))).toEqual(['Cold', 'Normal', 'Normal', 'Hot']);
  expect([6.9, 7, 8.5, 8.6].map(v => label(getPhStatus(v)))).toEqual(['Acidic', 'Normal', 'Normal', 'Alkaline']);
  expect([4.9, 5, 20].map(v => label(getDoStatus(v)))).toEqual(['Low', 'Normal', 'Normal']);
  expect([0, 19999, 20000].map(v => label(getTdsStatus(v)))).toEqual([null, null, 'Above sensor limit']);
  expect([8.9, 9, 10].map(isDepthNearLimit)).toEqual([false, true, true]);
});
