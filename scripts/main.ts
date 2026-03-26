import { app, BrowserWindow, protocol } from "electron";
import path from "path";
import fs from "fs";
import Module from "module";

/**
 * 将 extraResources 中的 data 目录复制到用户数据目录（跳过已存在的文件，保留用户修改）
 */
function initializeData(): void {
  const srcDir = path.join(process.resourcesPath, "data");
  const destDir = path.join(app.getPath("userData"), "data");
  if (fs.existsSync(destDir)) return;
  copyDirRecursive(srcDir, destDir);
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

//获取全部依赖路径，优先从 unpacked 加载原生模块，其他模块从 asar 加载
function getNodeModulesPaths(): string[] {
  const paths: string[] = [];
  if (app.isPackaged) {
    // external 依赖（原生模块）在 unpacked 目录
    const unpackedNodeModules = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules");
    if (fs.existsSync(unpackedNodeModules)) {
      paths.push(unpackedNodeModules);
    }
    // 普通依赖在 asar 内
    const asarNodeModules = path.join(process.resourcesPath, "app.asar", "node_modules");
    paths.push(asarNodeModules);
  } else {
    paths.push(path.join(process.cwd(), "node_modules"));
  }
  return paths;
}

//动态加载
function requireWithCustomPaths(modulePath: string): any {
  const appNodeModulesPaths = getNodeModulesPaths();
  // 保存原始方法
  const originalNodeModulePaths = (Module as any)._nodeModulePaths;
  // 临时修改模块路径解析
  (Module as any)._nodeModulePaths = function (from: string): string[] {
    const paths = originalNodeModulePaths.call(this, from);
    // 将主程序的 node_modules 添加到前面
    for (let i = appNodeModulesPaths.length - 1; i >= 0; i--) {
      const p = appNodeModulesPaths[i];
      if (!paths.includes(p)) {
        paths.unshift(p);
      }
    }
    return paths;
  };
  try {
    // 清除缓存确保加载最新
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
  } finally {
    // 恢复原始方法
    (Module as any)._nodeModulePaths = originalNodeModulePaths;
  }
}

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    show: true,
    autoHideMenuBar: true,
    resizable: true,
    thickFrame: true,
  });
  mainWindow = win;
  win.setMenuBarVisibility(false);
  win.removeMenu();

  win.on("closed", () => {
    mainWindow = null;
  });

  const isDev = process.env.NODE_ENV === "dev" || !app.isPackaged;
  if (process.env.VITE_DEV) {
    void win.loadURL("http://localhost:50188");
  } else {
    const htmlPath = isDev ? path.join(process.cwd(), "data", "web", "index.html") : path.join(app.getPath("userData"), "data", "web", "index.html");
    void win.loadFile(htmlPath);
  }
}

let closeServeFn: (() => Promise<void>) | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "toonflow",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.whenReady().then(async () => {
  try {
    let servePath: string;
    if (app.isPackaged) {
      // 生产环境：从 extraResources 初始化数据到用户目录，然后从用户目录加载后端服务
      initializeData();
      servePath = path.join(app.getPath("userData"), "data", "serve", "app.js");
    } else {
      // 开发环境：直接加载源码（tsx 通过 -r tsx 注册了 require 钩子）
      servePath = path.join(process.cwd(), "src", "app.ts");
    }
    // 使用自定义路径加载模块
    const mod = requireWithCustomPaths(servePath);
    closeServeFn = mod.closeServe;
    const port = await mod.default(true);
    // 注册协议处理器
    protocol.handle("toonflow", (request) => {
      const url = new URL(request.url);
      const pathname = url.hostname.toLowerCase();
      const handlers: Record<string, () => object> = {
        getport: () => ({ port: port }),
        windowminimize: () => {
          mainWindow?.minimize();
          return { ok: true };
        },
        windowmaximize: () => {
          if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
          } else {
            mainWindow?.maximize();
          }
          return { ok: true };
        },
        windowclose: () => {
          app.exit(0);
          return { ok: true };
        },
        windowismaximized: () => ({
          maximized: mainWindow?.isMaximized() ?? false,
        }),
      };
      const handler = handlers[pathname];
      const responseData = handler ? handler() : { error: "未知接口" };
      return new Response(JSON.stringify(responseData), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    });

    createMainWindow();
  } catch (err) {
    console.error("[服务启动失败]:", err);
    // 如果服务启动失败，仍然创建窗口
    createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", async (event) => {
  if (closeServeFn) await closeServeFn();
});
