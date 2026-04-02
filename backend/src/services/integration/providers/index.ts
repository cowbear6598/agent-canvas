import { integrationRegistry } from "../integrationRegistry.js";
import { slackProvider } from "./slackProvider.js";
import { telegramProvider } from "./telegramProvider.js";
import { jiraProvider } from "./jiraProvider.js";
import { sentryProvider } from "./sentry/sentryProvider.js";

integrationRegistry.register(slackProvider);
integrationRegistry.register(telegramProvider);
integrationRegistry.register(jiraProvider);
integrationRegistry.register(sentryProvider);
