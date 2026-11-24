import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareSemver,
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_RELEASES_PAGE_URL,
  pickReleaseAsset,
} from "./updater-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const APP_SHORTCUT_NAME = "NKUST iAI Note Tools";

let mainWindow = null;
let gatewayUrl = "http://127.0.0.1:3000";
const serverCleanups = [];

let updaterState = {
  status: "idle", // idle | checking | up-to-date | available | downloading | installing | error
  currentVersion: app.getVersion(),
  latestVersion: "",
  releaseUrl: GITHUB_RELEASES_PAGE_URL,
  assetName: "",
  assetUrl: "",
  percent: 0,
  message: "",
};

function setUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop-updater:status", updaterState);
  }
  return updaterState;
}

async function checkForUpdates() {
  if (
    updaterState.status === "downloading" ||
    updaterState.status === "installing"
  ) {
    return updaterState;
  }
  const currentVersion = app.getVersion();
  setUpdaterState({
    status: "checking",
    currentVersion,
    message: "",
  });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `NKUST-iAI-Note-Tools/${currentVersion}`,
      },
    });
    clearTimeout(timer);
    if (!response.ok) {
      return setUpdaterState({
        status: "up-to-date",
        currentVersion,
        message: "",
      });
    }
    const release = await response.json();
    const tag = String(release?.tag_name || "").trim();
    const latestVersion = tag.replace(/^v/i, "");
    const releaseUrl =
      typeof release?.html_url === "string" &&
      /^https:\/\//i.test(release.html_url)
        ? release.html_url
        : GITHUB_RELEASES_PAGE_URL;

    if (!latestVersion || compareSemver(latestVersion, currentVersion) <= 0) {
      return setUpdaterState({
        status: "up-to-date",
        currentVersion,
        latestVersion: latestVersion || currentVersion,
        releaseUrl,
        assetName: "",
        assetUrl: "",
        percent: 0,
        message: "",
      });
    }

    const asset = pickReleaseAsset(
      release?.assets,
      process.platform,
      process.arch,
    );
    return setUpdaterState({
      status: "available",
      currentVersion,
      latestVersion,
      releaseUrl,
      assetName: asset?.name || "",
      assetUrl: asset?.browser_download_url || "",
      percent: 0,
      message: "",
    });
  } catch {
    // Stay silent on offline / rate-limit startup checks so the user is not disturbed.
    return setUpdaterState({
      status: "up-to-date",
      currentVersion,
      message: "",
    });
  }
}

async function startAutoUpdate() {
  if (
    updaterState.status === "downloading" ||
    updaterState.status === "installing"
  ) {
    return updaterState;
  }
  if (!updaterState.assetUrl) {
    await shell.openExternal(updaterState.releaseUrl || GITHUB_RELEASES_PAGE_URL);
    return updaterState;
  }

  setUpdaterState({ status: "downloading", percent: 0, message: "" });
  const safeName =
    basename(updaterState.assetName || "NKUST-iAI-Note-Tools-Update").replace(
      /[^\w.\-()+ ]+/g,
      "_",
    );
  const updateDir = join(app.getPath("temp"), "nkust-iai-note-tools-updates");
  mkdirSync(updateDir, { recursive: true });
  const destPath = join(updateDir, safeName);

  try {
    const response = await fetch(updaterState.assetUrl, {
      headers: {
        "User-Agent": `NKUST-iAI-Note-Tools/${app.getVersion()}`,
      },
    });
    if (!response.ok || !response.body) {
      throw new Error(`下載更新失敗（HTTP ${response.status}）`);
    }

    const totalBytes = Number(response.headers.get("content-length") || 0);
    let receivedBytes = 0;
    let lastPercent = -1;
    const fileStream = createWriteStream(destPath);
    const reader = response.body.getReader();

    await new Promise(async (resolve, reject) => {
      fileStream.on("error", reject);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (!fileStream.write(Buffer.from(value))) {
            await new Promise((r) => fileStream.once("drain", r));
          }
          if (totalBytes > 0) {
            const percent = Math.min(
              99,
              Math.round((receivedBytes / totalBytes) * 100),
            );
            if (percent !== lastPercent) {
              lastPercent = percent;
              setUpdaterState({ status: "downloading", percent });
            }
          }
        }
        fileStream.end(resolve);
      } catch (err) {
        fileStream.destroy();
        reject(err);
      }
    });

    setUpdaterState({ status: "installing", percent: 100, message: "" });

    if (process.platform === "win32" && /\.exe$/i.test(destPath)) {
      const child = spawn(destPath, [], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      setTimeout(() => app.quit(), 400);
      return updaterState;
    }

    if (process.platform === "linux" && /\.AppImage$/i.test(destPath)) {
      chmodSync(destPath, 0o755);
      const child = spawn(destPath, [], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      setTimeout(() => app.quit(), 400);
      return updaterState;
    }

    // macOS .dmg / Windows .zip / Linux .deb -> open downloaded package with OS handler
    const openErr = await shell.openPath(destPath);
    if (openErr) {
      shell.showItemInFolder(destPath);
    }
    return setUpdaterState({
      status: "available",
      percent: 100,
      message: "已下載並開啟更新檔",
    });
  } catch (error) {
    return setUpdaterState({
      status: "error",
      percent: 0,
      message:
        error instanceof Error ? error.message : "下載更新時發生錯誤，請重試",
    });
  }
}

function getShortcutStatePath() {
  return join(app.getPath("userData"), "shortcut-prompt-v1.json");
}

function getInstallFolder() {
  if (process.platform === "darwin") {
    // Inside /Applications/NKUST iAI Note Tools.app/Contents/MacOS/...
    const appBundleIdx = process.execPath.indexOf(".app/");
    if (appBundleIdx > 0) {
      return dirname(process.execPath.slice(0, appBundleIdx + 4));
    }
  }
  return dirname(process.execPath);
}

function getAppTargetPath() {
  if (process.platform === "darwin") {
    const appBundleIdx = process.execPath.indexOf(".app/");
    if (appBundleIdx > 0) {
      return process.execPath.slice(0, appBundleIdx + 4);
    }
  }
  return process.execPath;
}

function createPlatformShortcut(targetDir) {
  const execTarget = getAppTargetPath();
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  if (process.platform === "win32") {
    const shortcutPath = join(targetDir, `${APP_SHORTCUT_NAME}.lnk`);
    const ok = shell.writeShortcutLink(shortcutPath, "create", {
      target: execTarget,
      cwd: dirname(execTarget),
      description: "知音筆記｜高科 iAI 課堂錄音轉學習講義工具",
    });
    return { ok, path: shortcutPath };
  }

  if (process.platform === "darwin") {
    const linkPath = join(targetDir, `${APP_SHORTCUT_NAME}.app`);
    if (linkPath === execTarget) {
      const aliasPath = join(targetDir, `${APP_SHORTCUT_NAME} 捷徑.app`);
      try {
        if (existsSync(aliasPath)) unlinkSync(aliasPath);
        symlinkSync(execTarget, aliasPath);
        return { ok: true, path: aliasPath };
      } catch {
        return { ok: false, path: aliasPath };
      }
    }
    try {
      if (existsSync(linkPath)) unlinkSync(linkPath);
      symlinkSync(execTarget, linkPath);
      return { ok: true, path: linkPath };
    } catch {
      return { ok: false, path: linkPath };
    }
  }

  // Linux (.desktop launcher)
  const desktopFilePath = join(targetDir, "NKUST-iAI-Note-Tools.desktop");
  const iconCandidate = join(rootDir, "public", "icon.png");
  const desktopEntry = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${APP_SHORTCUT_NAME}`,
    "Comment=NKUST iAI Lecture Audio to Study Notes Tool",
    `Exec="${execTarget}" %U`,
    ...(existsSync(iconCandidate) ? [`Icon=${iconCandidate}`] : []),
    "Terminal=false",
    "Categories=Education;Utility;",
    "",
  ].join("\n");
  try {
    writeFileSync(desktopFilePath, desktopEntry, "utf8");
    chmodSync(desktopFilePath, 0o755);
    return { ok: true, path: desktopFilePath };
  } catch {
    return { ok: false, path: desktopFilePath };
  }
}

async function promptShortcutOnFirstRun(parentWindow) {
  if (!app.isPackaged && process.env.FORCE_SHORTCUT_PROMPT !== "1") {
    return;
  }
  const statePath = getShortcutStatePath();
  if (existsSync(statePath)) {
    try {
      const saved = JSON.parse(readFileSync(statePath, "utf8"));
      if (saved?.prompted) return;
    } catch {
      /* re-prompt if corrupted */
    }
  }

  const installDir = getInstallFolder();
  const desktopDir = app.getPath("desktop");

  const { response } = await dialog.showMessageBox(parentWindow, {
    type: "question",
    title: "建立捷徑｜Create Shortcut",
    message: "是否要在桌面建立「知音筆記（NKUST iAI Note Tools）」捷徑？",
    detail:
      "• 選擇「是」：將捷徑新增至您的桌面。\n• 選擇「否」：將捷徑新增至您安裝此程式的資料夾中。\n\nCreate a shortcut on your Desktop? (Selecting 'No' will place the shortcut in the installation folder instead.)",
    buttons: ["是 (建立於桌面)", "否 (建立於安裝資料夾)"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  const createOnDesktop = response === 0;
  const targetDir = createOnDesktop ? desktopDir : installDir;
  const result = createPlatformShortcut(targetDir);

  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          prompted: true,
          choice: createOnDesktop ? "desktop" : "installDir",
          shortcutPath: result.path,
          ok: result.ok,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    /* ignore state write error */
  }
}

function resolveFfmpegBinary() {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const unpackedCandidate = join(
    process.resourcesPath || "",
    "app.asar.unpacked",
    "node_modules",
    "ffmpeg-static",
    exe,
  );
  if (existsSync(unpackedCandidate)) return unpackedCandidate;
  const resourceCandidate = join(process.resourcesPath || "", "bin", exe);
  if (existsSync(resourceCandidate)) return resourceCandidate;
  const localCandidate = join(rootDir, "node_modules", "ffmpeg-static", exe);
  if (existsSync(localCandidate)) return localCandidate;
  return "";
}

async function bootLocalServices() {
  const ffmpegBin = resolveFfmpegBinary();
  if (ffmpegBin && !process.env.FFMPEG_BIN) {
    process.env.FFMPEG_BIN = ffmpegBin;
  }

  const outDir = existsSync(join(rootDir, "dist", "standalone", "dist"))
    ? join(rootDir, "dist", "standalone", "dist")
    : join(rootDir, "dist");

  if (!existsSync(join(outDir, "server", "index.js"))) {
    throw new Error(
      "找不到前端建置產物（dist/server/index.js），請先執行 pnpm run build。",
    );
  }

  const [{ startBridgeServer }, { startProdServer }, { startGatewayServer }] =
    await Promise.all([
      import("../local/iai-bridge.mjs"),
      import("vinext/server/prod-server"),
      import("../local/ubuntu-gateway.mjs"),
    ]);

  const bridge = await startBridgeServer({ host: "127.0.0.1", port: 0 });
  serverCleanups.push(() => bridge.server.close());

  const web = await startProdServer({
    host: "127.0.0.1",
    port: 0,
    outDir,
    silent: true,
  });
  serverCleanups.push(() => web.server.close());

  const preferredGatewayPort = Number(process.env.STUDY_PORT || 3000);
  let gatewayEntries;
  try {
    gatewayEntries = await startGatewayServer({
      hosts: ["127.0.0.1"],
      port: preferredGatewayPort,
      webPort: web.port,
      bridgePort: bridge.port,
    });
  } catch {
    gatewayEntries = await startGatewayServer({
      hosts: ["127.0.0.1"],
      port: 0,
      webPort: web.port,
      bridgePort: bridge.port,
    });
  }

  for (const entry of gatewayEntries) {
    serverCleanups.push(() => entry.server.close());
  }

  const activePort = gatewayEntries[0]?.port || preferredGatewayPort;
  gatewayUrl = `http://127.0.0.1:${activePort}`;
  return gatewayUrl;
}

async function createMainWindow() {
  const iconPath = existsSync(join(rootDir, "public", "icon.png"))
    ? join(rootDir, "public", "icon.png")
    : join(rootDir, "public", "favicon.png");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "知音筆記｜高科 iAI 錄音學習助手",
    icon: existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(gatewayUrl)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  await mainWindow.loadURL(gatewayUrl);
  void checkForUpdates();
  await promptShortcutOnFirstRun(mainWindow);
}

ipcMain.handle("desktop-updater:get-status", () => updaterState);
ipcMain.handle("desktop-updater:check", () => checkForUpdates());
ipcMain.handle("desktop-updater:start", () => startAutoUpdate());

app.whenReady().then(async () => {
  try {
    await bootLocalServices();
    await createMainWindow();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "啟動本機服務失敗";
    dialog.showErrorBox("NKUST iAI Note Tools 啟動錯誤", message);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  for (const cleanup of serverCleanups) {
    try {
      cleanup();
    } catch {
      /* ignore shutdown errors */
    }
  }
  setTimeout(() => process.exit(0), 200).unref();
});
