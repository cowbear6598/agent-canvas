import { describe, expect, it } from "vitest";
import { allHandlerGroups, registerAllHandlers } from "../../src/handlers/index.js";
import { webSocketHandlerManifest } from "../../src/handlers/websocketHandlerManifest.js";
import {
  serverEventManifest,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas/index.js";
import { eventRouter } from "../../src/services/eventRouter.js";

function expectNoDuplicates(values: string[]): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  expect([...new Set(duplicates)]).toEqual([]);
}

describe("WebSocket contract manifest", () => {
  it("handler manifest 與 handler groups 的 event、handler、request schema 對應一致", () => {
    const groupDefinitions = allHandlerGroups.flatMap((group) =>
      group.handlers.map((definition) => ({
        groupName: group.name,
        event: definition.event,
        handlerName: definition.handler.name,
        requestSchema: definition.schema,
        responseEvent: definition.responseEvent,
      })),
    );

    expect(webSocketHandlerManifest).toHaveLength(groupDefinitions.length);
    expect(webSocketHandlerManifest).toEqual(groupDefinitions);
    expectNoDuplicates(webSocketHandlerManifest.map((entry) => entry.event));
  });

  it("request event enum、handler manifest 與 event router 註冊結果沒有缺漏", () => {
    registerAllHandlers();

    const requestEvents = Object.values(WebSocketRequestEvents).sort();
    const manifestEvents = webSocketHandlerManifest.map((entry) => entry.event).sort();
    const routerEvents = eventRouter.getRegisteredEvents().sort();

    expect(manifestEvents).toEqual(requestEvents);
    expect(routerEvents).toEqual(requestEvents);
  });

  it("server event manifest 涵蓋所有後端會送出的 response event 且沒有重複", () => {
    const responseEvents = Object.values(WebSocketResponseEvents).sort();
    const manifestEvents = serverEventManifest.map((entry) => entry.event).sort();

    expect(manifestEvents).toEqual(responseEvents);
    expectNoDuplicates(manifestEvents);
    for (const entry of serverEventManifest) {
      expect(entry.schema).toBeDefined();
      expect(entry.schemaName).toBe("serverEventPayloadSchema");
    }
  });
});
