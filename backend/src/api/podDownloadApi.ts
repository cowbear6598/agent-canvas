import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { Zip, ZipDeflate } from "fflate";
import ignore from "ignore";
import { requireCanvas, resolvePod } from "./apiHelpers.js";
import { repositoryService } from "../services/repositoryService.js";
import { HTTP_STATUS } from "../constants.js";
import { logger } from "../utils/logger.js";
import { isPathWithinDirectory } from "../utils/pathValidator.js";
import { config } from "../config/index.js";

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f\r\n;]/g, "_"); // eslint-disable-line no-control-regex
}

async function streamZipDirectory(
  baseDir: string,
  currentDir: string,
  ig: ReturnType<typeof ignore>,
  zip: Zip,
  signal: AbortSignal,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const dirent of entries) {
    if (signal.aborted) {
      zip.terminate();
      return;
    }

    const fullPath = path.join(currentDir, dirent.name);
    const relativePath = path.relative(baseDir, fullPath);

    // .git 目錄及其內容一律保留，跳過 ignore 規則檢查
    const isInsideGit =
      relativePath === ".git" ||
      relativePath.startsWith(".git/") ||
      relativePath.startsWith(".git" + path.sep);

    if (!isInsideGit && ig.ignores(relativePath)) {
      continue;
    }

    if (dirent.isDirectory()) {
      await streamZipDirectory(baseDir, fullPath, ig, zip, signal);
    } else if (dirent.isFile()) {
      try {
        const content = await readFile(fullPath);
        // ZIP 規格要求路徑分隔符使用正斜線
        const zipEntryPath = relativePath.split(path.sep).join("/");
        const entry = new ZipDeflate(zipEntryPath, { level: 6 });
        zip.add(entry);
        entry.push(content, true);
      } catch (fileErr) {
        logger.error(
          "Pod",
          "Error",
          `讀取檔案失敗，略過：${relativePath}`,
          fileErr,
        );
      }
    }
  }
}

async function loadGitignore(
  targetPath: string,
): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();
  const gitignorePath = path.join(targetPath, ".gitignore");
  try {
    const gitignoreContent = await readFile(gitignorePath, "utf-8");
    ig.add(gitignoreContent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("Pod", "Error", `讀取 .gitignore 失敗，略過`, err);
    }
    // ENOENT：.gitignore 不存在，靜默略過
  }
  return ig;
}

function createZipStream(
  baseDir: string,
  ig: ReturnType<typeof ignore>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      let streamError: Error | null = null;

      const zip = new Zip((err, data, final) => {
        if (err) {
          streamError = err;
          controller.error(err);
          return;
        }
        controller.enqueue(data);
        if (final) {
          controller.close();
        }
      });

      try {
        await streamZipDirectory(baseDir, baseDir, ig, zip, signal);
        if (!streamError && !signal.aborted) {
          zip.end();
        }
      } catch (traversalErr) {
        logger.error("Pod", "Error", "打包工作目錄失敗", traversalErr);
        zip.terminate();
        controller.error(traversalErr);
      }
    },
  });
}

export async function handleDownloadPodDirectory(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const pod = resolvePod(canvas.id, decodeURIComponent(params.podId));
  if (!pod) {
    return new Response(JSON.stringify({ error: "找不到 Pod" }), {
      status: HTTP_STATUS.NOT_FOUND,
      headers: { "Content-Type": "application/json" },
    });
  }

  let targetPath: string;
  let rootDir: string;
  if (pod.repositoryId) {
    targetPath = repositoryService.getRepositoryPath(pod.repositoryId);
    rootDir = config.repositoriesRoot;
  } else {
    targetPath = pod.workspacePath;
    rootDir = config.canvasRoot;
  }

  // 路徑邊界驗證，防止路徑穿越攻擊
  const resolvedTarget = path.resolve(targetPath);
  if (!isPathWithinDirectory(resolvedTarget, rootDir)) {
    return new Response(JSON.stringify({ error: "無權限存取此目錄" }), {
      status: HTTP_STATUS.FORBIDDEN,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await stat(resolvedTarget);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Response(JSON.stringify({ error: "目標目錄不存在" }), {
        status: HTTP_STATUS.NOT_FOUND,
        headers: { "Content-Type": "application/json" },
      });
    }
    logger.error("Pod", "Error", "無法存取目標目錄", err);
    return new Response(JSON.stringify({ error: "無法存取目標目錄" }), {
      status: HTTP_STATUS.INTERNAL_ERROR,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const signal =
      (req as Request & { signal?: AbortSignal }).signal ??
      new AbortController().signal;
    const ig = await loadGitignore(resolvedTarget);
    const readableStream = createZipStream(resolvedTarget, ig, signal);

    const safeName = sanitizeFilename(pod.name);
    const headers = new Headers({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}.zip"`,
    });

    return new Response(readableStream, { status: HTTP_STATUS.OK, headers });
  } catch (err) {
    logger.error("Pod", "Error", "打包工作目錄失敗", err);
    return new Response(
      JSON.stringify({ error: "打包工作目錄時發生錯誤，請稍後再試" }),
      {
        status: HTTP_STATUS.INTERNAL_ERROR,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
