import {config} from '../config';
import type {Command} from '../types';
import {validatePodId, validateCommandId} from '../utils/pathValidator.js';
import {copyResourceFile, deleteResourceDirFromPath, findValidatedSrcPath} from './shared/fileResourceHelpers.js';
import {createMarkdownResourceService} from './shared/createMarkdownResourceService.js';

const baseService = createMarkdownResourceService<Command>({
    resourceDir: config.commandsPath,
    resourceName: 'Command',
    createItem: (id, name, _content, groupId) => ({id, name, groupId}),
    updateItem: (id, _content) => ({id, name: id, groupId: null}),
    subDir: 'commands',
});

export const commandService = {
    ...baseService,

    async copyCommandToPod(commandId: string, podId: string, podWorkspacePath: string): Promise<void> {
        if (!validatePodId(podId)) {
            throw new Error('無效的 Pod ID 格式');
        }

        const srcPath = await findValidatedSrcPath(baseService, commandId, validateCommandId, 'Command ID');
        await copyResourceFile(srcPath, podWorkspacePath, 'commands', `${commandId}.md`);
    },

    async copyCommandToRepository(commandId: string, repositoryPath: string): Promise<void> {
        const srcPath = await findValidatedSrcPath(baseService, commandId, validateCommandId, 'Command ID');
        await copyResourceFile(srcPath, repositoryPath, 'commands', `${commandId}.md`);
    },

    async deleteCommandFromPath(basePath: string): Promise<void> {
        await deleteResourceDirFromPath(basePath, 'commands');
    },
};
