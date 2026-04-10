import type { Canvas } from '../types/index.js';

export interface CanvasDto {
	id: string;
	name: string;
	sortIndex: number;
}

export function toCanvasDto(canvas: Canvas): CanvasDto {
	return {
		id: canvas.id,
		name: canvas.name,
		sortIndex: canvas.sortIndex,
	};
}
