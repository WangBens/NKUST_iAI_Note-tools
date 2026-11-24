import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSemver,
  parseSemver,
  pickReleaseAsset,
} from '../electron/updater-utils.mjs';

test('parseSemver and compareSemver handle v-prefixed and plain semantic versions', () => {
  assert.deepEqual(parseSemver('v1.2.0'), [1, 2, 0]);
  assert.deepEqual(parseSemver('1.10.3-beta.1'), [1, 10, 3]);
  assert.equal(compareSemver('v1.2.0', '1.1.0'), 1);
  assert.equal(compareSemver('v1.1.0', '1.1.0'), 0);
  assert.equal(compareSemver('v1.0.9', '1.1.0'), -1);
  assert.equal(compareSemver('v2.0.0', '1.99.99'), 1);
});

test('pickReleaseAsset selects the right installer for Windows, macOS (arm64/x64), and Linux', () => {
  const assets = [
    {
      name: 'NKUST iAI Note Tools-1.2.0-win.zip',
      browser_download_url: 'https://github.com/WangBens/NKUST_iAI_Note-tools/releases/download/v1.2.0/win.zip',
    },
    {
      name: 'NKUST iAI Note Tools Setup 1.2.0.exe',
      browser_download_url: 'https://github.com/WangBens/NKUST_iAI_Note-tools/releases/download/v1.2.0/setup.exe',
    },
    {
      name: 'NKUST iAI Note Tools-1.2.0-arm64.dmg',
      browser_download_url: 'https://github.com/WangBens/NKUST_iAI_Note-tools/releases/download/v1.2.0/arm64.dmg',
    },
    {
      name: 'NKUST iAI Note Tools-1.2.0.dmg',
      browser_download_url: 'https://github.com/WangBens/NKUST_iAI_Note-tools/releases/download/v1.2.0/x64.dmg',
    },
    {
      name: 'NKUST iAI Note Tools-1.2.0.AppImage',
      browser_download_url: 'https://github.com/WangBens/NKUST_iAI_Note-tools/releases/download/v1.2.0/app.AppImage',
    },
    {
      name: 'nkust-iai-note-tools_1.2.0_amd64.deb',
      browser_download_url: 'https://github.com/WangBens/NKUST_iAI_Note-tools/releases/download/v1.2.0/app.deb',
    },
  ];

  assert.equal(
    pickReleaseAsset(assets, 'win32', 'x64')?.name,
    'NKUST iAI Note Tools Setup 1.2.0.exe',
  );
  assert.equal(
    pickReleaseAsset(assets, 'darwin', 'arm64')?.name,
    'NKUST iAI Note Tools-1.2.0-arm64.dmg',
  );
  assert.equal(
    pickReleaseAsset(assets, 'darwin', 'x64')?.name,
    'NKUST iAI Note Tools-1.2.0.dmg',
  );
  assert.equal(
    pickReleaseAsset(assets, 'linux', 'x64')?.name,
    'NKUST iAI Note Tools-1.2.0.AppImage',
  );
  assert.equal(pickReleaseAsset([], 'win32', 'x64'), null);
});
