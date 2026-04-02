import { createHmac } from "crypto";

const [appName, clientSecret] = process.argv.slice(2);

if (!appName || !clientSecret) {
  console.log(
    "使用方式：bun run backend/scripts/test-sentry-webhook.ts <app-name> <client-secret>",
  );
  console.log(
    "範例：bun run backend/scripts/test-sentry-webhook.ts my-sentry-app abc123...",
  );
  process.exit(1);
}

const payload = {
  action: "created",
  timestamp: new Date().toISOString(),
  data: {
    issue: {
      id: String(Date.now()),
      shortId: "MY-PROJECT-1",
      title: "TypeError: Cannot read property of undefined",
      culprit: "app/utils/helpers.ts in processData",
      level: "error",
      status: "unresolved",
      web_url: "https://sentry.io/organizations/my-org/issues/12345/",
      metadata: {
        type: "TypeError",
        value: "Cannot read property of undefined",
      },
    },
    project: {
      name: "my-project",
      slug: "my-project",
    },
  },
};

const bodyString = JSON.stringify(payload);
const signature = createHmac("sha256", clientSecret)
  .update(bodyString)
  .digest("hex");
const url = `http://localhost:3001/sentry/events/${appName}`;

console.log(`發送 Sentry webhook 到：${url}`);
console.log(`簽章：${signature}`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "sentry-hook-resource": "issue",
    "sentry-hook-signature": signature,
  },
  body: bodyString,
});

const body = await response.text();
console.log(`回應狀態：${response.status}`);
console.log(`回應內容：${body}`);

if (response.ok) {
  console.log("✓ Webhook 發送成功");
} else {
  console.error(`✗ Webhook 發送失敗（狀態碼 ${response.status}）`);
  process.exit(1);
}
