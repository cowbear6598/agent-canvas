import {config} from '../config';
import type {OutputStyleListItem} from '../types';
import {createMarkdownResourceService} from './shared/createMarkdownResourceService.js';

export const outputStyleService = createMarkdownResourceService<OutputStyleListItem>({
    resourceDir: config.outputStylesPath,
    resourceName: 'Output Style',
    createItem: (id, name, _content, groupId) => ({id, name, groupId}),
    updateItem: (id, _content) => ({id, name: id, groupId: null}),
    subDir: 'output-styles',
});
