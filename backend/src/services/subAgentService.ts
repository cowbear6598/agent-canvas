import {config} from '../config';
import type {SubAgent} from '../types';
import {validateSubAgentId, validatePodId} from '../utils/pathValidator.js';
import {parseFrontmatterDescription, copyResourceFile, deleteResourceDirFromPath, findValidatedSrcPath} from './shared/fileResourceHelpers.js';
import {createMarkdownResourceService} from './shared/createMarkdownResourceService.js';

const baseService = createMarkdownResourceService<SubAgent>({
    resourceDir: config.agentsPath,
    resourceName: '子代理',
    createItem: (id, name, content, groupId) => ({
        id,
        name,
        description: parseFrontmatterDescription(content),
        groupId,
    }),
    updateItem: (id, content) => ({
        id,
        name: id,
        description: parseFrontmatterDescription(content),
        groupId: null,
    }),
    subDir: 'agents',
});

export const subAgentService = {
    ...baseService,

    async copySubAgentToPod(subAgentId: string, podId: string, podWorkspacePath: string): Promise<void> {
        if (!validatePodId(podId)) {
            throw new Error('無效的 Pod ID 格式');
        }

        const srcPath = await findValidatedSrcPath(baseService, subAgentId, validateSubAgentId, '子代理 ID');
        await copyResourceFile(srcPath, podWorkspacePath, 'agents', `${subAgentId}.md`);
    },

    async copySubAgentToRepository(subAgentId: string, repositoryPath: string): Promise<void> {
        const srcPath = await findValidatedSrcPath(baseService, subAgentId, validateSubAgentId, '子代理 ID');
        await copyResourceFile(srcPath, repositoryPath, 'agents', `${subAgentId}.md`);
    },

    async deleteSubAgentsFromPath(basePath: string): Promise<void> {
        await deleteResourceDirFromPath(basePath, 'agents');
    },
};
