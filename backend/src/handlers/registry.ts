import { z } from 'zod';
import { createValidatedHandler, type ValidatedHandler } from '../middleware/wsMiddleware.js';
import { eventRouter } from '../services/eventRouter.js';

export interface HandlerDefinition {
	event: string;
	handler: ValidatedHandler<unknown>;
	schema: z.ZodType<unknown>;
	responseEvent: string;
}

export interface HandlerGroup {
	name: string;
	handlers: HandlerDefinition[];
}

export function createHandlerDefinition<TSchema extends z.ZodType>(
	event: string,
	handler: ValidatedHandler<z.infer<TSchema>>,
	schema: TSchema,
	responseEvent: string
): HandlerDefinition {
	return {
		event,
		handler: handler as ValidatedHandler<unknown>,
		schema: schema as z.ZodType<unknown>,
		responseEvent,
	};
}

export class HandlerRegistry {
	private groups: HandlerGroup[] = [];

	registerGroup(group: HandlerGroup): void {
		this.groups.push(group);
	}

	registerToRouter(): void {
		for (const group of this.groups) {
			for (const definition of group.handlers) {
				const wrappedHandler = createValidatedHandler(
					definition.schema,
					definition.handler,
					definition.responseEvent
				);
				eventRouter.register(
					definition.event,
					wrappedHandler,
					definition.responseEvent
				);
			}
		}
	}
}
