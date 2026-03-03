import path from 'path';
import { fileURLToPath } from 'url';
import { getMimeType } from './mimeTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST_PATH = path.resolve(__dirname, '../../../frontend/dist');

type VFSData = Record<string, { content: string; mimeType: string }>;

let vfsData: VFSData | null = null;

try {
	const mod = await import('../generated/vfs.js');
	vfsData = mod.VFS ?? null;
} catch {
	vfsData = null;
}

export async function isStaticFilesAvailable(): Promise<boolean> {
	if (vfsData !== null) {
		return vfsData['/index.html'] !== undefined;
	}

	const indexFile = Bun.file(path.join(FRONTEND_DIST_PATH, 'index.html'));
	return indexFile.exists();
}

export async function serveStaticFile(request: Request): Promise<Response> {
	if (vfsData !== null) {
		return serveFromVFS(request, vfsData);
	}

	return serveFromFilesystem(request);
}

export function serveFromVFS(
	request: Request,
	vfs: Record<string, { content: string; mimeType: string }>,
): Response {
	const url = new URL(request.url);
	const pathname = url.pathname === '/' ? '/index.html' : url.pathname;

	const entry = vfs[pathname];

	if (entry) {
		const headers = new Headers({
			'Content-Type': entry.mimeType,
			'X-Content-Type-Options': 'nosniff',
		});

		if (pathname.startsWith('/assets/')) {
			headers.set('Cache-Control', 'public, max-age=31536000, immutable');
		}

		return new Response(Buffer.from(entry.content, 'base64'), { headers });
	}

	const indexEntry = vfs['/index.html'];

	if (indexEntry) {
		return new Response(Buffer.from(indexEntry.content, 'base64'), {
			headers: {
				'Content-Type': 'text/html',
				'X-Content-Type-Options': 'nosniff',
			},
		});
	}

	return new Response('Not Found', { status: 404 });
}

function safeResolvePath(pathname: string): string | null {
	const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
	const filePath = path.join(FRONTEND_DIST_PATH, safePath);
	const resolvedPath = path.resolve(filePath);

	if (!resolvedPath.startsWith(FRONTEND_DIST_PATH)) {
		return null;
	}

	return resolvedPath;
}

function serveWithCacheHeaders(file: ReturnType<typeof Bun.file>, pathname: string): Response {
	const headers = new Headers({
		'Content-Type': getMimeType(pathname),
		'X-Content-Type-Options': 'nosniff',
	});

	// Vite 會在 /assets/ 下的檔名加 hash，可安全使用長期快取
	if (pathname.startsWith('/assets/')) {
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	}

	return new Response(file, { headers });
}

async function serveFallbackIndex(): Promise<Response> {
	const indexFile = Bun.file(path.join(FRONTEND_DIST_PATH, 'index.html'));
	const indexExists = await indexFile.exists();

	if (indexExists) {
		return new Response(indexFile, {
			headers: {
				'Content-Type': 'text/html',
				'X-Content-Type-Options': 'nosniff',
			},
		});
	}

	return new Response('Not Found', { status: 404 });
}

async function serveFromFilesystem(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const rawPathname = url.pathname === '/' ? '/index.html' : url.pathname;

	const resolvedPath = safeResolvePath(rawPathname);
	if (!resolvedPath) {
		return new Response('Forbidden', { status: 403 });
	}

	const file = Bun.file(resolvedPath);
	const exists = await file.exists();

	if (exists) {
		return serveWithCacheHeaders(file, rawPathname);
	}

	return serveFallbackIndex();
}
