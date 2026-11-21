import { app, BrowserWindow, dialog, shell } from "electron";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const APP_SHORTCUT_NAME = "NKUST iAI Note Tools";

let mainWindow = null;
let gatewayUrl = "http://127.0.0.1:3000";
const serverCleanups = [];

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
  await promptShortcutOnFirstRun(mainWindow);
}

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
