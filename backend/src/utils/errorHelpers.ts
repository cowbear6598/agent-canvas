import { AbortError } from '@anthropic-ai/claude-agent-sdk';

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return '發生未知錯誤';
}

export function isAbortError(error: unknown): boolean {
	return error instanceof AbortError || (error instanceof Error && error.name === 'AbortError');
}

