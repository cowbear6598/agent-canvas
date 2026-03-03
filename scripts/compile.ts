import fs from 'fs';
import path from 'path';
import { getMimeType } from '../backend/src/utils/mimeTypes';

const ROOT_DIR = path.resolve(import.meta.dir, '..');
const FRONTEND_DIST = path.join(ROOT_DIR, 'frontend', 'dist');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const ENTRYPOINT = path.join(ROOT_DIR, 'backend', 'src', 'cli.ts');
const GENERATED_DIR = path.join(ROOT_DIR, 'backend', 'src', 'generated');
const VFS_FILE = path.join(GENERATED_DIR, 'vfs.ts');

const SUPPORTED_TARGETS = [
	'bun-darwin-arm64',
	'bun-darwin-x64',
	'bun-linux-x64',
	'bun-linux-arm64',
] as const;

type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

function isSupportedTarget(value: string): value is SupportedTarget {
	return SUPPORTED_TARGETS.includes(value as SupportedTarget);
}

function getOutfile(target: string | undefined): string {
	if (!target) return path.join(DIST_DIR, 'claude-canvas');

	const suffix = target.replace(/^bun-/, '');
	return path.join(DIST_DIR, `claude-canvas-${suffix}`);
}

/**
 * 遞迴掃描目錄，回傳所有檔案的絕對路徑（排除目錄本身）
 */
function scanFiles(dir: string): string[] {
	const results: string[] = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...scanFiles(fullPath));
		} else if (entry.isFile()) {
			results.push(fullPath);
		}
	}

	return results;
}

/**
 * 讀取所有前端靜態檔案並生成 VFS 模組
 */
function generateVFS(files: string[]): string {
	const entries: string[] = [];

	for (const filePath of files) {
		const relativePath = path.relative(FRONTEND_DIST, filePath);
		const urlPath = '/' + relativePath.replace(/\\/g, '/');
		const fileContent = fs.readFileSync(filePath);
		const base64Content = Buffer.from(fileContent).toString('base64');
		const mimeType = getMimeType(filePath);

		entries.push(
			`  ${JSON.stringify(urlPath)}: {\n    content: ${JSON.stringify(base64Content)},\n    mimeType: ${JSON.stringify(mimeType)},\n  }`,
		);
	}

	return [
		'// 此檔案由 scripts/compile.ts 自動生成，請勿手動修改',
		`export const VFS: Record<string, { content: string; mimeType: string }> = {`,
		entries.join(',\n'),
		`}`,
		'',
	].join('\n');
}

async function compile(): Promise<void> {
	const target = process.env.TARGET;

	if (target !== undefined && !isSupportedTarget(target)) {
		console.error(`錯誤：不支援的 TARGET「${target}」`);
		console.error(`支援的目標：${SUPPORTED_TARGETS.join('、')}`);
		process.exit(1);
	}

	const indexHtmlPath = path.join(FRONTEND_DIST, 'index.html');
	if (!fs.existsSync(indexHtmlPath)) {
		console.error('錯誤：frontend/dist/index.html 不存在，請先執行 bun run build:frontend');
		process.exit(1);
	}

	fs.mkdirSync(DIST_DIR, { recursive: true });
	fs.mkdirSync(GENERATED_DIR, { recursive: true });

	const outfile = getOutfile(target);
	const platformLabel = target ?? '當前平台';

	console.log(`開始編譯（目標：${platformLabel}）...`);
	console.log(`入口：${ENTRYPOINT}`);
	console.log(`前端靜態檔案目錄：${FRONTEND_DIST}`);
	console.log(`輸出：${outfile}`);

	const allFiles = scanFiles(FRONTEND_DIST);
	const vfsContent = generateVFS(allFiles);
	fs.writeFileSync(VFS_FILE, vfsContent, 'utf-8');
	console.log(`已生成 VFS 模組：${VFS_FILE}（共 ${allFiles.length} 個檔案）`);

	try {
		const args = [
			'build',
			'--compile',
			...(target ? ['--target', target] : []),
			ENTRYPOINT,
			'--outfile',
			outfile,
		];

		const proc = Bun.spawn(['bun', ...args], {
			cwd: ROOT_DIR,
			stdout: 'inherit',
			stderr: 'inherit',
			// 確保編譯時 NODE_ENV=production 被烘焙進二進位檔，讓靜態檔案服務在 compile 模式預設啟用
			env: { ...process.env, NODE_ENV: 'production' },
		});

		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			console.error(`錯誤：編譯失敗（exit code: ${exitCode}）`);
			process.exit(1);
		}
	} finally {
		// 編譯完成後還原 vfs.ts 為空白佔位檔，避免真實資料殘留在原始碼中
		fs.writeFileSync(
			VFS_FILE,
			[
				'// 此檔案由 scripts/compile.ts 自動生成，開發模式下為空白佔位檔',
				'export const VFS: Record<string, { content: string; mimeType: string }> = {}',
				'',
			].join('\n'),
			'utf-8',
		);
	}

	const stat = fs.statSync(outfile);
	const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
	console.log(`編譯完成：${outfile}（${sizeMB} MB）`);
}

compile();
