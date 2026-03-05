import {v4 as uuidv4} from 'uuid';
import type {McpServer, McpServerConfig} from '../types/mcpServer.js';
import {getDb} from '../database/index.js';
import {getStatements} from '../database/statements.js';
import {safeJsonParse} from '../utils/safeJsonParse.js';
import {logger} from '../utils/logger.js';

interface McpServerRow {
    id: string;
    name: string;
    config_json: string;
}

function rowToMcpServer(row: McpServerRow): McpServer | null {
    const config = safeJsonParse<McpServerConfig>(row.config_json);
    if (!config) {
        logger.warn('McpServer', 'Warn', `MCP Server「${row.id}」的 config_json 解析失敗，已略過`);
        return null;
    }
    return {
        id: row.id,
        name: row.name,
        config,
    };
}

export class McpServerStore {
    private get stmts(): ReturnType<typeof getStatements> {
        return getStatements(getDb());
    }

    create(name: string, config: McpServerConfig): McpServer {
        const id = uuidv4();
        this.stmts.mcpServer.insert.run({$id: id, $name: name, $configJson: JSON.stringify(config)});
        return {id, name, config};
    }

    list(): McpServer[] {
        const rows = this.stmts.mcpServer.selectAll.all() as McpServerRow[];
        return rows.map(rowToMcpServer).filter((s): s is McpServer => s !== null);
    }

    getById(id: string): McpServer | undefined {
        const row = this.stmts.mcpServer.selectById.get(id) as McpServerRow | null;
        if (!row) return undefined;
        return rowToMcpServer(row) ?? undefined;
    }

    async exists(id: string): Promise<boolean> {
        return this.getById(id) !== undefined;
    }

    update(id: string, name: string, config: McpServerConfig): McpServer | undefined {
        const row = this.stmts.mcpServer.selectById.get(id) as McpServerRow | null;
        if (!row) return undefined;
        this.stmts.mcpServer.update.run({$id: id, $name: name, $configJson: JSON.stringify(config)});
        return {id, name, config};
    }

    delete(id: string): boolean {
        const result = this.stmts.mcpServer.deleteById.run(id);
        return result.changes > 0;
    }

    getByIds(ids: string[]): McpServer[] {
        if (ids.length === 0) return [];
        return ids.flatMap((id) => {
            const row = this.stmts.mcpServer.selectById.get(id) as McpServerRow | null;
            if (!row) return [];
            const server = rowToMcpServer(row);
            return server ? [server] : [];
        });
    }
}

export const mcpServerStore = new McpServerStore();
