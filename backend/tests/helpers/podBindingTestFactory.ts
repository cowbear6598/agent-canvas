import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse } from "../setup";
import { getCanvasId } from "./canvasHelper.js";
import { createPod } from "./podHelper.js";
import { FAKE_UUID } from "./testConstants.js";

export interface PodBindingTestConfig {
  resourceName: string;
  createResource: (client: any) => Promise<{ id: string }>;
  fakeResourceId: string;
  bindEvent: { request: string; response: string };
  buildBindPayload: (
    canvasId: string,
    podId: string,
    resourceId: string,
  ) => any;
  verifyBoundResponse: (response: any, resourceId: string) => void;
}

export function describePodBindingTests(
  config: PodBindingTestConfig,
  getContext: () => { client: any; server: any },
): void {
  describe(`Pod 綁定 ${config.resourceName}`, () => {
    it("success_when_bound_to_pod", async () => {
      const { client } = getContext();
      const pod = await createPod(client);
      const resource = await config.createResource(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.bindEvent.request,
        config.bindEvent.response,
        {
          requestId: uuidv4(),
          ...config.buildBindPayload(canvasId, pod.id, resource.id),
        },
      );

      expect(response.success).toBe(true);
      config.verifyBoundResponse(response, resource.id);
    });

    it("failed_when_bind_with_nonexistent_pod", async () => {
      const { client } = getContext();
      const resource = await config.createResource(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.bindEvent.request,
        config.bindEvent.response,
        {
          requestId: uuidv4(),
          ...config.buildBindPayload(canvasId, FAKE_UUID, resource.id),
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("failed_when_bind_with_nonexistent_resource", async () => {
      const { client } = getContext();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.bindEvent.request,
        config.bindEvent.response,
        {
          requestId: uuidv4(),
          ...config.buildBindPayload(canvasId, pod.id, config.fakeResourceId),
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });
}
