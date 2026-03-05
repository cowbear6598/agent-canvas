import {v4 as uuidv4} from 'uuid';
import type {SlackApp, SlackAppConnectionStatus, SlackChannel} from '../../types/index.js';
import {Result, ok, err} from '../../types/index.js';
import {getDb} from '../../database/index.js';
import {getStatements} from '../../database/statements.js';

interface SlackAppRow {
    id: string;
    name: string;
    bot_token: string;
    signing_secret: string;
    bot_user_id: string;
}

class SlackAppStore {
    private runtimeState: Map<string, {connectionStatus: SlackAppConnectionStatus; channels: SlackChannel[]}> =
        new Map();

    private get stmts(): ReturnType<typeof getStatements>['slackApp'] {
        return getStatements(getDb()).slackApp;
    }

    private rowToSlackApp(row: SlackAppRow): SlackApp {
        const runtime = this.runtimeState.get(row.id);
        return {
            id: row.id,
            name: row.name,
            botToken: row.bot_token,
            signingSecret: row.signing_secret,
            botUserId: row.bot_user_id,
            connectionStatus: runtime?.connectionStatus ?? 'disconnected',
            channels: runtime?.channels ?? [],
        };
    }

    create(name: string, botToken: string, signingSecret: string): Result<SlackApp> {
        const existing = this.stmts.selectByBotToken.get(botToken) as SlackAppRow | undefined;
        if (existing) {
            return err('已存在使用相同 Bot Token 的 Slack App');
        }

        const id = uuidv4();
        this.stmts.insert.run({$id: id, $name: name, $botToken: botToken, $signingSecret: signingSecret, $botUserId: ''});

        return ok({
            id,
            name,
            botToken,
            signingSecret,
            botUserId: '',
            connectionStatus: 'disconnected',
            channels: [],
        });
    }

    list(): SlackApp[] {
        const rows = this.stmts.selectAll.all() as SlackAppRow[];
        return rows.map((row) => this.rowToSlackApp(row));
    }

    getById(id: string): SlackApp | undefined {
        const row = this.stmts.selectById.get(id) as SlackAppRow | undefined;
        if (!row) return undefined;
        return this.rowToSlackApp(row);
    }

    getByBotToken(botToken: string): SlackApp | undefined {
        const row = this.stmts.selectByBotToken.get(botToken) as SlackAppRow | undefined;
        if (!row) return undefined;
        return this.rowToSlackApp(row);
    }

    updateStatus(id: string, status: SlackAppConnectionStatus): void {
        const current = this.runtimeState.get(id) ?? {connectionStatus: 'disconnected', channels: []};
        this.runtimeState.set(id, {...current, connectionStatus: status});
    }

    updateChannels(id: string, channels: SlackChannel[]): void {
        const current = this.runtimeState.get(id) ?? {connectionStatus: 'disconnected', channels: []};
        this.runtimeState.set(id, {...current, channels});
    }

    updateBotUserId(id: string, botUserId: string): void {
        this.stmts.updateBotUserId.run({$botUserId: botUserId, $id: id});
    }

    delete(id: string): boolean {
        const result = this.stmts.deleteById.run(id);
        this.runtimeState.delete(id);
        return result.changes > 0;
    }

}

export const slackAppStore = new SlackAppStore();
