import type { Component } from "vue";

export type IntegrationConnectionStatus =
  | "connected"
  | "disconnected"
  | "error";

export interface FormFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password";
  validate: (value: string) => string;
}

export interface IntegrationResource {
  id: string | number;
  label: string;
}

export interface BindingExtraFieldDefinition {
  key: string;
  label: string;
  type: "radio";
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}

export interface ConnectionStatusStyle {
  dotClass: string;
  bg: string;
  label: string;
}

export interface IntegrationApp {
  id: string;
  name: string;
  connectionStatus: IntegrationConnectionStatus;
  provider: string;
  resources: IntegrationResource[];
  raw: Record<string, unknown>;
}

export interface IntegrationBinding {
  provider: string;
  appId: string;
  resourceId: string;
  extra: Record<string, unknown>;
}

export interface IntegrationProviderConfig {
  name: string;
  label: string;
  icon: Component;
  description: string;

  createFormFields: FormFieldDefinition[];
  resourceLabel: string;
  emptyResourceHint: string;
  emptyAppHint: string;
  bindingExtraFields?: BindingExtraFieldDefinition[];

  connectionStatusConfig: Record<
    IntegrationConnectionStatus,
    ConnectionStatusStyle
  >;

  transformApp: (rawApp: Record<string, unknown>) => IntegrationApp;
  getResources: (app: IntegrationApp) => IntegrationResource[];
  buildCreatePayload: (
    formValues: Record<string, string>,
  ) => Record<string, unknown>;
  buildDeletePayload: (appId: string) => Record<string, unknown>;
  buildBindPayload: (
    appId: string,
    resourceId: string,
    extra: Record<string, unknown>,
  ) => Record<string, unknown>;

  hasManualResourceInput?: (extra: Record<string, unknown>) => boolean;
  manualResourceInputConfig?: {
    label: string;
    placeholder: string;
    hint: string;
    validate: (value: string) => string;
  };

  hasNoResource?: boolean;
  getWebhookUrl?: (app: IntegrationApp) => string;

  getTokenValue?: (app: IntegrationApp) => string | null;
  tokenLabel?: string;
}
