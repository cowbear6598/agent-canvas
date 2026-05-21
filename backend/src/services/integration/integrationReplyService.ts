import { getResultErrorString, type Result, ok, err } from "../../types/index.js";
import { podStore } from "../podStore.js";
import { integrationAppStore } from "./integrationAppStore.js";
import { verifyIntegrationReplyCapability } from "./integrationReplyCapability.js";
import { integrationRegistry } from "./integrationRegistry.js";
import type { IntegrationProvider } from "./types.js";
import "./providers/index.js";

export interface IntegrationReplyScope {
  provider: string;
  appId: string;
  resourceId: string;
  podId: string;
  extra: Record<string, unknown>;
  replyContext: Record<string, unknown>;
}

export function validateIntegrationReplyScope(
  scope: IntegrationReplyScope,
): Result<IntegrationProvider> {
  const app = integrationAppStore.getById(scope.appId);
  if (!app || app.provider !== scope.provider) {
    return err("Integration Reply scope app 驗證失敗");
  }

  const podRecord = podStore.getByIdGlobal(scope.podId);
  const binding = podRecord?.pod.integrationBindings?.find(
    (item) =>
      item.provider === scope.provider &&
      item.appId === scope.appId &&
      item.resourceId === scope.resourceId,
  );
  if (!binding) {
    return err("Integration Reply scope pod binding 驗證失敗");
  }

  const provider = integrationRegistry.get(scope.provider);
  if (!provider?.sendMessage) {
    return err(`Integration provider 不支援回覆：${scope.provider}`);
  }

  return ok(provider);
}

export async function executeIntegrationReply(
  capabilityToken: string,
  text: string,
): Promise<Result<void>> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return err("text 為必填");
  }

  let scope: IntegrationReplyScope;
  try {
    const verified = verifyIntegrationReplyCapability(capabilityToken);
    scope = {
      provider: verified.provider,
      appId: verified.appId,
      resourceId: verified.resourceId,
      podId: verified.podId,
      extra: verified.extra,
      replyContext: verified.replyContext,
    };
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }

  const providerResult = validateIntegrationReplyScope(scope);
  if (!providerResult.success) {
    return err(providerResult.error);
  }

  const sendResult = await providerResult.data.sendMessage!(
    scope.appId,
    scope.resourceId,
    trimmedText,
    {
      ...scope.extra,
      ...scope.replyContext,
    },
  );

  if (!sendResult.success) {
    return err(`錯誤: ${getResultErrorString(sendResult.error)}`);
  }

  return ok(undefined);
}
