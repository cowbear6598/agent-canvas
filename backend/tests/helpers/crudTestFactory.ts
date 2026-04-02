import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse } from "../setup";
import { getCanvasId } from "./canvasHelper.js";
import { createPod } from "./podHelper.js";

export interface CRUDTestConfig {
  resourceName: string;
  createResource: (
    client: any,
    name?: string,
  ) => Promise<{ id: string; name: string }>;
  fakeResourceId: string;
  events: {
    create?: { request: string; response: string };
    list: { request: string; response: string };
    read?: { request: string; response: string };
    update?: { request: string; response: string };
    delete: { request: string; response: string };
  };
  payloadBuilders: {
    create?: (canvasId: string, name: string) => any;
    list: (canvasId: string) => any;
    read?: (canvasId: string, resourceId: string) => any;
    update?: (canvasId: string, resourceId: string) => any;
    delete: (canvasId: string, resourceId: string) => any;
  };
  responseFieldName: {
    list: string;
    read?: string;
  };
  bindForDeleteTest: {
    bindEvent: { request: string; response: string };
    buildPayload: (canvasId: string, podId: string, resourceId: string) => any;
  };
  invalidNames?: Array<{ name: string; desc: string }>;
  hasContentValidation?: boolean;
}

export function describeCRUDTests(
  config: CRUDTestConfig,
  getContext: () => { client: any; server: any },
): void {
  const invalidNames = config.invalidNames ?? [
    { name: "測試", desc: "中文名稱" },
    { name: "my item!", desc: "特殊字元" },
  ];

  if (config.events.create) {
    describe(`${config.resourceName} 建立`, () => {
      it("success_when_created", async () => {
        const { client } = getContext();
        const name = `test-${uuidv4()}`;
        const resource = await config.createResource(client, name);

        expect(resource.id).toBeDefined();
        expect(resource.name).toBe(name);
      });

      it("failed_when_create_with_duplicate_name", async () => {
        const { client } = getContext();
        const name = `dup-${uuidv4()}`;
        await config.createResource(client, name);

        const canvasId = await getCanvasId(client);
        const response = await emitAndWaitResponse<any, Record<string, any>>(
          client,
          config.events.create!.request,
          config.events.create!.response,
          {
            requestId: uuidv4(),
            ...config.payloadBuilders.create!(canvasId, name),
          },
        );

        expect(response.success).toBe(false);
        expect(response.error).toEqual(
          expect.objectContaining({ key: expect.any(String) }),
        );
      });

      it.each(invalidNames)(
        "建立失敗 - 不合法名稱: $desc",
        async ({ name }) => {
          const { client } = getContext();
          const canvasId = await getCanvasId(client);
          const response = await emitAndWaitResponse<any, Record<string, any>>(
            client,
            config.events.create!.request,
            config.events.create!.response,
            {
              requestId: uuidv4(),
              ...config.payloadBuilders.create!(canvasId, name),
            },
          );

          expect(response.success).toBe(false);
          expect(response.error).toBeDefined();
        },
      );
    });
  }

  describe(`${config.resourceName} 列表`, () => {
    it("success_when_list_returns_all", async () => {
      const { client } = getContext();
      const resource = await config.createResource(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.list.request,
        config.events.list.response,
        { requestId: uuidv4(), ...config.payloadBuilders.list(canvasId) },
      );

      expect(response.success).toBe(true);
      const names = response[config.responseFieldName.list]!.map(
        (r: any) => r.name,
      );
      expect(names).toContain(resource.name);
    });
  });

  if (config.events.read) {
    describe(`${config.resourceName} 讀取`, () => {
      it("success_when_read_returns_content", async () => {
        const { client } = getContext();
        const resource = await config.createResource(client);

        const canvasId = await getCanvasId(client);
        const response = await emitAndWaitResponse<any, Record<string, any>>(
          client,
          config.events.read!.request,
          config.events.read!.response,
          {
            requestId: uuidv4(),
            ...config.payloadBuilders.read!(canvasId, resource.id),
          },
        );

        expect(response.success).toBe(true);
        if (config.hasContentValidation) {
          expect(
            response[config.responseFieldName.read!]!.content,
          ).toBeDefined();
        }
      });

      it("failed_when_read_with_nonexistent_id", async () => {
        const { client } = getContext();
        const canvasId = await getCanvasId(client);
        const response = await emitAndWaitResponse<any, Record<string, any>>(
          client,
          config.events.read!.request,
          config.events.read!.response,
          {
            requestId: uuidv4(),
            ...config.payloadBuilders.read!(canvasId, config.fakeResourceId),
          },
        );

        expect(response.success).toBe(false);
        expect(response.error).toEqual(
          expect.objectContaining({ key: expect.any(String) }),
        );
      });
    });
  }

  if (config.events.update) {
    describe(`${config.resourceName} 更新`, () => {
      it("success_when_updated", async () => {
        const { client } = getContext();
        const resource = await config.createResource(client);

        const canvasId = await getCanvasId(client);
        const response = await emitAndWaitResponse<any, Record<string, any>>(
          client,
          config.events.update!.request,
          config.events.update!.response,
          {
            requestId: uuidv4(),
            ...config.payloadBuilders.update!(canvasId, resource.id),
          },
        );

        expect(response.success).toBe(true);
      });

      it("failed_when_update_with_nonexistent_id", async () => {
        const { client } = getContext();
        const canvasId = await getCanvasId(client);
        const response = await emitAndWaitResponse<any, Record<string, any>>(
          client,
          config.events.update!.request,
          config.events.update!.response,
          {
            requestId: uuidv4(),
            ...config.payloadBuilders.update!(canvasId, config.fakeResourceId),
          },
        );

        expect(response.success).toBe(false);
        expect(response.error).toEqual(
          expect.objectContaining({ key: expect.any(String) }),
        );
      });
    });
  }

  describe(`${config.resourceName} 刪除`, () => {
    it("success_when_deleted", async () => {
      const { client } = getContext();
      const resource = await config.createResource(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.delete.request,
        config.events.delete.response,
        {
          requestId: uuidv4(),
          ...config.payloadBuilders.delete(canvasId, resource.id),
        },
      );

      expect(response.success).toBe(true);
    });

    it("failed_when_delete_with_nonexistent_id", async () => {
      const { client } = getContext();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.delete.request,
        config.events.delete.response,
        {
          requestId: uuidv4(),
          ...config.payloadBuilders.delete(canvasId, config.fakeResourceId),
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("failed_when_delete_while_in_use", async () => {
      const { client } = getContext();
      const pod = await createPod(client);
      const resource = await config.createResource(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.bindForDeleteTest.bindEvent.request,
        config.bindForDeleteTest.bindEvent.response,
        {
          requestId: uuidv4(),
          ...config.bindForDeleteTest.buildPayload(
            canvasId,
            pod.id,
            resource.id,
          ),
        },
      );

      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.delete.request,
        config.events.delete.response,
        {
          requestId: uuidv4(),
          ...config.payloadBuilders.delete(canvasId, resource.id),
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });
}
