import { app, BrowserWindow, dialog, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

let mainWindow = null;
let gatewayUrl = "http://127.0.0.1:3000";
const serverCleanups = [];

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
