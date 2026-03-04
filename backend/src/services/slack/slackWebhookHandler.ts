import {createHmac, timingSafeEqual} from 'crypto';
import {z} from 'zod';
import {slackAppStore} from './slackAppStore.js';
import {slackEventService} from './slackEventService.js';
import {logger} from '../../utils/logger.js';
import type {AppMentionEvent, SlackApp} from '../../types/index.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_BODY_SIZE = 1_000_000;
const MAX_DEDUP_MAP_SIZE = 10000;

// event_id -> 收到的時間戳（ms）
const processedEventIds = new Map<string, number>();

const slackEventSchema = z.object({
    type: z.string(),
    channel: z.string(),
    user: z.string().optional(),
    text: z.string(),
    ts: z.string(),
    event_ts: z.string(),
    thread_ts: z.string().optional(),
});

const slackEventPayloadSchema = z.object({
    type: z.literal('event_callback'),
    event_id: z.string().min(1),
    event_time: z.number(),
    api_app_id: z.string().min(1),
    event: slackEventSchema,
});

type SlackEventPayload = z.infer<typeof slackEventPayloadSchema>;

function isTimestampValid(timestampSeconds: string): boolean {
    const ts = parseInt(timestampSeconds, 10);
    if (isNaN(ts)) return false;
    return Math.abs(Date.now() - ts * 1000) < FIVE_MINUTES_MS;
}

function verifySlackSignature(signingSecret: string, timestamp: string, rawBody: string, signature: string): boolean {
    const baseString = `v0:${timestamp}:${rawBody}`;
    const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
    const expected = `v0=${hmac}`;

    try {
        return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
    } catch {
        return false;
    }
}

function cleanupExpiredEventIds(): void {
    const now = Date.now();
    for (const [id, ts] of processedEventIds.entries()) {
        if (now - ts >= FIVE_MINUTES_MS) {
            processedEventIds.delete(id);
        }
    }
}

function isDuplicateEvent(eventId: string): boolean {
    cleanupExpiredEventIds();

    if (processedEventIds.has(eventId)) {
        return true;
    }

    if (processedEventIds.size >= MAX_DEDUP_MAP_SIZE) {
        const firstKey = processedEventIds.keys().next().value;
        if (firstKey) processedEventIds.delete(firstKey);
    }

    processedEventIds.set(eventId, Date.now());
    return false;
}

function findMatchedApp(timestamp: string, rawBody: string, signature: string, apps: SlackApp[]): SlackApp | null {
    return apps.find((app) => verifySlackSignature(app.signingSecret, timestamp, rawBody, signature)) ?? null;
}

function verifySignatureHeaders(req: Request): {timestamp: string; signature: string} | Response {
    const timestamp = req.headers.get('x-slack-request-timestamp');
    const signature = req.headers.get('x-slack-signature');

    if (!timestamp) {
        logger.warn('Slack', 'Error', '缺少 x-slack-request-timestamp header');
        return new Response('Forbidden', {status: 403});
    }

    if (!signature) {
        logger.warn('Slack', 'Error', '缺少 x-slack-signature header');
        return new Response('Forbidden', {status: 403});
    }

    if (!isTimestampValid(timestamp)) {
        logger.warn('Slack', 'Error', 'Slack 請求 timestamp 已過期');
        return new Response('Forbidden', {status: 403});
    }

    return {timestamp, signature};
}

async function handleUrlVerification(body: Record<string, unknown>, timestamp: string, rawBody: string, signature: string): Promise<Response> {
    const matchedApp = findMatchedApp(timestamp, rawBody, signature, slackAppStore.list());

    if (!matchedApp) {
        logger.warn('Slack', 'Error', 'Slack 簽名驗證失敗（url_verification）');
        return new Response('Forbidden', {status: 403});
    }

    const challenge = body['challenge'];
    if (!challenge || typeof challenge !== 'string' || challenge.length === 0) {
        return new Response('缺少或無效的 challenge 欄位', {status: 400});
    }

    return Response.json({challenge});
}

async function handleEventCallback(body: Record<string, unknown>, timestamp: string, rawBody: string, signature: string): Promise<Response> {
    const apiAppId = body['api_app_id'];
    if (!apiAppId || typeof apiAppId !== 'string') {
        return new Response('缺少 api_app_id 欄位', {status: 400});
    }

    const app = findMatchedApp(timestamp, rawBody, signature, slackAppStore.list());

    if (!app) {
        logger.warn('Slack', 'Error', 'Slack 簽名驗證失敗');
        return new Response('Forbidden', {status: 403});
    }

    const parsed = slackEventPayloadSchema.safeParse(body);
    if (!parsed.success) {
        logger.warn('Slack', 'Error', `無效的事件格式: ${parsed.error.message}`);
        return new Response('無效的事件格式', {status: 400});
    }

    const eventPayload: SlackEventPayload = parsed.data;
    const {event_id, event} = eventPayload;

    if (isDuplicateEvent(event_id)) {
        logger.log('Slack', 'Complete', `重複的 event_id ${event_id}，略過處理`);
        return new Response('OK', {status: 200});
    }

    if (event.type !== 'app_mention') {
        return new Response('OK', {status: 200});
    }

    // Slack 要求 3 秒內回應，使用 fire-and-forget 非同步處理
    slackEventService.handleAppMention(app.id, event as AppMentionEvent).catch((error) => {
        logger.error('Slack', 'Error', `處理 app_mention 事件失敗`, error);
    });

    return new Response('OK', {status: 200});
}

export async function handleSlackWebhook(req: Request): Promise<Response> {
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
        return new Response('Payload Too Large', {status: 413});
    }

    const rawBody = await req.text();

    if (rawBody.length > MAX_BODY_SIZE) {
        return new Response('Payload Too Large', {status: 413});
    }

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return new Response('無效的 JSON body', {status: 400});
    }

    const body = payload as Record<string, unknown>;

    const headersResult = verifySignatureHeaders(req);
    if (headersResult instanceof Response) {
        return headersResult;
    }

    const {timestamp, signature} = headersResult;

    if (body.type === 'url_verification') {
        return handleUrlVerification(body, timestamp, rawBody, signature);
    }

    if (body.type === 'event_callback') {
        return handleEventCallback(body, timestamp, rawBody, signature);
    }

    logger.warn('Slack', 'Error', `收到未知的 Slack 事件類型: ${body.type}`);
    return new Response('OK', {status: 200});
}
