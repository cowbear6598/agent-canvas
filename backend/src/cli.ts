import fs from 'fs';
import path from 'path';
import os from 'os';
import pkg from '../../package.json';
import { safeJsonParse } from './utils/safeJsonParse.js';

const APP_DATA_DIR = path.join(os.homedir(), 'Documents', 'ClaudeCanvas');
const PID_FILE = path.join(APP_DATA_DIR, 'claude-canvas.pid');
const CONFIG_FILE = path.join(APP_DATA_DIR, 'config.json');
const LOG_DIR = path.join(APP_DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'claude-canvas.log');
const MAX_LOG_LINES = 10_000;
const MAX_LOG_READ_BYTES = 1 * 1024 * 1024;

export const VALID_CONFIG_KEYS = ['GITHUB_TOKEN', 'GITLAB_TOKEN', 'GITLAB_URL'];

export function getLocalIp(): string | null {
	const allInterfaces = Object.values(os.networkInterfaces()).flatMap(iface => iface ?? []);
	const ipv4External = allInterfaces.find(info => info.family === 'IPv4' && !info.internal);
	return ipv4External?.address ?? null;
}

const HELP_TEXT = `Claude Canvas - AI Agent 畫布工具

使用方式：
  claude-canvas <命令> [選項]

命令：
  start [--port <number>]       啟動服務（背景 daemon 模式）
  stop                          停止服務
  status                        查看服務狀態
  config set <key> <value>      設定配置
  config get <key>              查看配置
  config list                   列出所有配置
  logs [-n <number>]            查看最新日誌（預設 50 行）

選項：
  -v, --version                 顯示版本號
  -h, --help                    顯示此說明`;

const BOOLEAN_FLAGS: Record<string, string> = {
	'--version': 'version',
	'-v': 'version',
	'--help': 'help',
	'-h': 'help',
	'--daemon': 'daemon',
};

function parseFlagValue(rawArgs: string[], currentIndex: number): { value: string | boolean; skip: boolean } {
	const next = rawArgs[currentIndex + 1];
	if (next !== undefined && !next.startsWith('-')) {
		return { value: next, skip: true };
	}
	return { value: true, skip: false };
}

function processArg(
	rawArgs: string[],
	i: number,
	flags: Record<string, string | boolean>,
	positional: string[],
): number {
	const arg = rawArgs[i];

	if (BOOLEAN_FLAGS[arg]) {
		flags[BOOLEAN_FLAGS[arg]] = true;
		return i + 1;
	}

	if (arg === '-n' || arg.startsWith('--')) {
		const key = arg === '-n' ? 'n' : arg.slice(2);
		const { value, skip } = parseFlagValue(rawArgs, i);
		flags[key] = value;
		return skip ? i + 2 : i + 1;
	}

	positional.push(arg);
	return i + 1;
}

export function parseCommand(argv: string[]): {
	command: string | null;
	args: string[];
	flags: Record<string, string | boolean>;
} {
	const rawArgs = argv.slice(2);
	const flags: Record<string, string | boolean> = {};
	const positional: string[] = [];
	let i = 0;

	while (i < rawArgs.length) {
		i = processArg(rawArgs, i, flags, positional);
	}

	return { command: positional[0] ?? null, args: positional.slice(1), flags };
}

export function validatePort(value: string): number | null {
	const num = Number(value);
	if (!Number.isInteger(num) || num < 1 || num > 65535) return null;
	return num;
}

export function readConfig(configPath: string): Record<string, string> {
	if (!fs.existsSync(configPath)) return {};

	const content = fs.readFileSync(configPath, 'utf-8');
	const raw = safeJsonParse<Record<string, unknown>>(content);
	if (!raw) return {};

	const config: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === 'string') {
			config[key] = value;
		}
	}
	return config;
}

export function writeConfig(configPath: string, config: Record<string, string>): void {
	const dir = path.dirname(configPath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function readPidFile(pidPath: string): { pid: number; port: number; startedAt: string } | null {
	if (!fs.existsSync(pidPath)) return null;

	const content = fs.readFileSync(pidPath, 'utf-8');
	const data = safeJsonParse<{ pid: number; port: number; startedAt: string }>(content);
	if (!data) return null;

	if (typeof data.pid !== 'number' || typeof data.port !== 'number' || typeof data.startedAt !== 'string') {
		return null;
	}
	return data;
}

export function writePidFile(pidPath: string, data: { pid: number; port: number; startedAt: string }): void {
	const dir = path.dirname(pidPath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(pidPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function validateConfigKey(key: string, usage: string): void {
	if (VALID_CONFIG_KEYS.includes(key)) return;
	console.error(`錯誤：不支援的設定 key「${key}」`);
	console.error(`可用的 key：${VALID_CONFIG_KEYS.join('、')}`);
	console.error(`使用方式：${usage}`);
	process.exit(1);
}

function maskToken(value: string): string {
	if (value.length <= 4) return '****';
	return value.slice(0, 4) + '****';
}

function getDisplayValue(key: string, value: string): string {
	return key.endsWith('_TOKEN') ? maskToken(value) : value;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

function formatUptime(startedAt: string): string {
	const startMs = new Date(startedAt).getTime();
	const nowMs = Date.now();
	const diffSec = Math.floor((nowMs - startMs) / 1000);

	const days = Math.floor(diffSec / SECONDS_PER_DAY);
	const hours = Math.floor((diffSec % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
	const minutes = Math.floor((diffSec % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);

	return `${days}d ${hours}h ${minutes}m`;
}

function resolvePort(flags: Record<string, string | boolean>): number {
	const portStr = typeof flags.port === 'string' ? flags.port : '3001';
	const port = validatePort(portStr);

	if (port === null) {
		console.error(`錯誤：無效的 port 值「${portStr}」，必須是 1 到 65535 之間的整數`);
		process.exit(1);
	}

	return port!;
}

function checkAlreadyRunning(pidPath: string): void {
	const existingPid = readPidFile(pidPath);
	if (existingPid && isProcessAlive(existingPid.pid)) {
		console.error(`服務已在運行中（PID: ${existingPid.pid}, Port: ${existingPid.port}）`);
		process.exit(1);
	}
}

function buildEnvOverrides(config: Record<string, string>): Record<string, string> {
	const envOverrides: Record<string, string> = {};
	for (const key of VALID_CONFIG_KEYS) {
		if (config[key]) {
			envOverrides[key] = config[key];
		}
	}
	return envOverrides;
}

async function handleStart(flags: Record<string, string | boolean>): Promise<void> {
	const port = resolvePort(flags);

	checkAlreadyRunning(PID_FILE);

	const config = readConfig(CONFIG_FILE);
	const envOverrides = buildEnvOverrides(config);

	fs.mkdirSync(LOG_DIR, { recursive: true });
	const logFd = fs.openSync(LOG_FILE, 'a');

	const isCompiled = !process.argv[1] || process.argv[1].includes('$bunfs');
	const spawnArgs = isCompiled
		? [process.execPath, '--daemon', '--port', String(port)]
		: [process.execPath, process.argv[1], '--daemon', '--port', String(port)];

	const child = Bun.spawn(
		spawnArgs,
		{
			env: { ...process.env, ...envOverrides },
			stdout: logFd,
			stderr: logFd,
			detached: true,
		},
	);

	child.unref();
	fs.closeSync(logFd);

	writePidFile(PID_FILE, {
		pid: child.pid,
		port,
		startedAt: new Date().toISOString(),
	});

	const localIp = getLocalIp();
	const networkLine = localIp ? `\n  ➜ Network: http://${localIp}:${port}` : '';
	console.log(`服務已啟動（PID: ${child.pid}, Port: ${port}）\n\n  ➜ Local:   http://localhost:${port}${networkLine}`);
	process.exit(0);
}

function handleStop(): void {
	const pidData = readPidFile(PID_FILE);

	if (pidData === null) {
		console.log('服務未在運行中');
		process.exit(0);
	}

	if (!isProcessAlive(pidData.pid)) {
		console.log('服務未在運行中（PID 檔案已過期）');
		fs.unlinkSync(PID_FILE);
		return;
	}

	process.kill(pidData.pid, 'SIGTERM');
	fs.unlinkSync(PID_FILE);
	console.log('服務已停止');
}

function handleStatus(): void {
	const pidData = readPidFile(PID_FILE);

	if (pidData === null) {
		console.log('服務未在運行中');
		process.exit(0);
	}

	if (!isProcessAlive(pidData.pid)) {
		console.log('服務未在運行中（PID 檔案已過期）');
		fs.unlinkSync(PID_FILE);
		process.exit(0);
	}

	const uptime = formatUptime(pidData.startedAt);
	console.log(`狀態：運行中`);
	console.log(`PID：${pidData.pid}`);
	console.log(`Port：${pidData.port}`);
	console.log(`已運行：${uptime}`);
}

function handleConfigSet(args: string[]): void {
	const key = args[1];
	const value = args[2];

	if (!key || !value) {
		console.error('使用方式：claude-canvas config set <key> <value>');
		process.exit(1);
	}

	validateConfigKey(key, 'claude-canvas config set <key> <value>');

	const config = readConfig(CONFIG_FILE);
	config[key] = value;
	writeConfig(CONFIG_FILE, config);
	console.log(`已設定 ${key}`);
}

function handleConfigGet(args: string[]): void {
	const key = args[1];

	if (!key) {
		console.error('使用方式：claude-canvas config get <key>');
		process.exit(1);
	}

	validateConfigKey(key, 'claude-canvas config get <key>');

	const config = readConfig(CONFIG_FILE);
	const value = config[key];

	if (value === undefined) {
		console.log('尚未設定');
		return;
	}

	console.log(getDisplayValue(key, value));
}

function handleConfigList(): void {
	const config = readConfig(CONFIG_FILE);
	const entries = Object.entries(config);

	if (entries.length === 0) {
		console.log('尚無任何配置');
		return;
	}

	for (const [key, value] of entries) {
		console.log(`${key}=${getDisplayValue(key, value)}`);
	}
}

export function handleConfig(args: string[]): void {
	const subCommand = args[0];

	if (subCommand === 'set') {
		handleConfigSet(args);
		return;
	}
	if (subCommand === 'get') {
		handleConfigGet(args);
		return;
	}
	if (subCommand === 'list') {
		handleConfigList();
		return;
	}

	console.error('使用方式：claude-canvas config <set|get|list>');
	console.log(HELP_TEXT);
	process.exit(1);
}

export function handleLogs(flags: Record<string, string | boolean>, logFile = LOG_FILE): void {
	const requestedLineCountStr = typeof flags.n === 'string' ? flags.n : '50';
	const requestedLineCount = Number(requestedLineCountStr);
	const lines = Math.min(Number.isInteger(requestedLineCount) && requestedLineCount > 0 ? requestedLineCount : 50, MAX_LOG_LINES);

	if (!fs.existsSync(logFile)) {
		console.log('尚無日誌檔案，請先啟動服務');
		process.exit(0);
		return;
	}

	const fileSize = fs.statSync(logFile).size;
	const readBytes = Math.min(fileSize, MAX_LOG_READ_BYTES);
	const buffer = Buffer.alloc(readBytes);
	const fd = fs.openSync(logFile, 'r');
	fs.readSync(fd, buffer, 0, readBytes, fileSize - readBytes);
	fs.closeSync(fd);

	const content = buffer.toString('utf-8');

	if (content.trim() === '') {
		console.log('日誌檔案為空');
		return;
	}

	const allLines = content.split('\n').filter((line) => line.length > 0);
	const tail = allLines.slice(-lines);
	console.log(tail.join('\n'));
}

async function runDaemon(flags: Record<string, string | boolean>): Promise<void> {
	const port = resolvePort(flags);
	process.env.PORT = String(port);
	process.env.NODE_ENV = 'production';
	await import('./index.js');
}

const COMMAND_HANDLERS: Record<string, (args: string[], flags: Record<string, string | boolean>) => Promise<void> | void> = {
	start: (_, flags) => handleStart(flags),
	stop: () => handleStop(),
	status: () => handleStatus(),
	config: (args) => handleConfig(args),
	logs: (_, flags) => handleLogs(flags),
};

async function main(): Promise<void> {
	const { command, args, flags } = parseCommand(process.argv);

	if (flags.daemon) {
		await runDaemon(flags);
		return;
	}
	if (flags.version) {
		console.log(pkg.version);
		process.exit(0);
	}
	if (flags.help || command === null) {
		console.log(HELP_TEXT);
		process.exit(0);
	}

	const handler = COMMAND_HANDLERS[command];
	if (!handler) {
		console.error(`未知命令：${command}`);
		console.log(HELP_TEXT);
		process.exit(1);
	}

	await handler(args, flags);
}

// 只在直接執行時啟動，避免被 import 時觸發
if (import.meta.main) {
	main().catch((err) => {
		console.error('發生未預期的錯誤：', err);
		process.exit(1);
	});
}
