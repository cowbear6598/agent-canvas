import { z } from 'zod';
import { requestIdSchema, canvasIdSchema, noteUpdateBaseSchema, createNoteCreateSchema, canvasRequestSchema, noteDeleteBaseSchema, podUnbindBaseSchema } from './base.js';

const RESERVED_NAMES = ['.git', 'HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD'];

const repositoryIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Repository ID 只能包含英文字母、數字、底線和連字號');

function isValidGitUrl(url: string): boolean {
  const gitUrlPattern = /^(https?:\/\/|git@|git:\/\/).+/;
  return gitUrlPattern.test(url);
}

export const repositoryListSchema = canvasRequestSchema;

export const repositoryCreateSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Repository 名稱只能包含英文字母、數字、底線和連字號'),
});

export const repositoryNoteCreateSchema = createNoteCreateSchema({ repositoryId: repositoryIdSchema });

export const repositoryNoteListSchema = canvasRequestSchema;

export const repositoryNoteUpdateSchema = noteUpdateBaseSchema;

export const repositoryNoteDeleteSchema = noteDeleteBaseSchema;

export const podBindRepositorySchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: z.uuid(),
  repositoryId: repositoryIdSchema,
});

export const podUnbindRepositorySchema = podUnbindBaseSchema;

export const repositoryDeleteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  repositoryId: repositoryIdSchema,
});

export const repositoryGitCloneSchema = z.object({
  requestId: requestIdSchema,
  repoUrl: z.string().min(1).refine(isValidGitUrl, {
    message: '無效的 Git 儲存庫 URL',
  }),
  branch: z.string().optional(),
});

export const repositoryCheckGitSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  repositoryId: repositoryIdSchema,
});

export const repositoryWorktreeCreateSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  repositoryId: repositoryIdSchema,
  worktreeName: z
    .string()
    .min(1, 'Worktree 名稱不可為空')
    .max(100, 'Worktree 名稱過長')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Worktree 名稱只能包含英文字母、數字、底線和連字號')
    .refine(
      (name) => !RESERVED_NAMES.includes(name.toLowerCase()),
      'Worktree 名稱不可使用保留名稱'
    ),
});

export const repositoryGetLocalBranchesSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  repositoryId: repositoryIdSchema,
});

export const repositoryCheckDirtySchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  repositoryId: repositoryIdSchema,
});

const branchOperationBaseSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  repositoryId: repositoryIdSchema,
  branchName: z.string().max(200, '分支名稱過長').regex(/^[a-zA-Z0-9_\-/]+$/, '分支名稱只能包含英文字母、數字、底線、連字號和斜線'),
  force: z.boolean().default(false),
});

export const repositoryCheckoutBranchSchema = branchOperationBaseSchema;
export const repositoryDeleteBranchSchema = branchOperationBaseSchema;

export const repositoryPullLatestSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  repositoryId: repositoryIdSchema,
});

export type RepositoryListPayload = z.infer<typeof repositoryListSchema>;
export type RepositoryCreatePayload = z.infer<typeof repositoryCreateSchema>;
export type PodBindRepositoryPayload = z.infer<typeof podBindRepositorySchema>;
export type PodUnbindRepositoryPayload = z.infer<typeof podUnbindRepositorySchema>;
export type RepositoryDeletePayload = z.infer<typeof repositoryDeleteSchema>;
export type RepositoryGitClonePayload = z.infer<typeof repositoryGitCloneSchema>;
export type RepositoryCheckGitPayload = z.infer<typeof repositoryCheckGitSchema>;
export type RepositoryWorktreeCreatePayload = z.infer<typeof repositoryWorktreeCreateSchema>;
export type RepositoryNoteCreatePayload = z.infer<typeof repositoryNoteCreateSchema>;
export type RepositoryNoteListPayload = z.infer<typeof repositoryNoteListSchema>;
export type RepositoryNoteUpdatePayload = z.infer<typeof repositoryNoteUpdateSchema>;
export type RepositoryNoteDeletePayload = z.infer<typeof repositoryNoteDeleteSchema>;
export type RepositoryGetLocalBranchesPayload = z.infer<typeof repositoryGetLocalBranchesSchema>;
export type RepositoryCheckDirtyPayload = z.infer<typeof repositoryCheckDirtySchema>;
export type RepositoryCheckoutBranchPayload = z.infer<typeof repositoryCheckoutBranchSchema>;
export type RepositoryDeleteBranchPayload = z.infer<typeof repositoryDeleteBranchSchema>;
export type RepositoryPullLatestPayload = z.infer<typeof repositoryPullLatestSchema>;
