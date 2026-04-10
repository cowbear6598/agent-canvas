import { Database } from "bun:sqlite";

let cachedStatements: ReturnType<typeof buildStatements> | null = null;

function buildStatements(db: Database): {
  canvas: {
    insert: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectByName: ReturnType<Database["prepare"]>;
    selectMaxSortIndex: ReturnType<Database["prepare"]>;
    updateName: ReturnType<Database["prepare"]>;
    updateSortIndex: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
  };
  pod: {
    insert: ReturnType<Database["prepare"]>;
    selectByCanvasId: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectByCanvasIdAndId: ReturnType<Database["prepare"]>;
    selectStatusByCanvasIdAndId: ReturnType<Database["prepare"]>;
    selectByCanvasIdAndName: ReturnType<Database["prepare"]>;
    countByCanvasIdAndName: ReturnType<Database["prepare"]>;
    update: ReturnType<Database["prepare"]>;
    updateStatus: ReturnType<Database["prepare"]>;
    updateClaudeSessionId: ReturnType<Database["prepare"]>;
    updateOutputStyleId: ReturnType<Database["prepare"]>;
    updateRepositoryId: ReturnType<Database["prepare"]>;
    updateCommandId: ReturnType<Database["prepare"]>;
    updateMultiInstance: ReturnType<Database["prepare"]>;
    updateScheduleJson: ReturnType<Database["prepare"]>;
    selectWithSchedule: ReturnType<Database["prepare"]>;
    selectByOutputStyleId: ReturnType<Database["prepare"]>;
    selectByRepositoryId: ReturnType<Database["prepare"]>;
    selectByCommandId: ReturnType<Database["prepare"]>;
    selectScheduleInfo: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
    deleteByCanvasId: ReturnType<Database["prepare"]>;
  };
  integrationBinding: {
    insert: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    selectByAppId: ReturnType<Database["prepare"]>;
    selectByAppIdAndResourceId: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
    deleteByPodIdAndProvider: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
    deleteByAppId: ReturnType<Database["prepare"]>;
  };
  podSkillIds: {
    insert: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
    deleteOne: ReturnType<Database["prepare"]>;
    selectBySkillId: ReturnType<Database["prepare"]>;
  };
  podSubAgentIds: {
    insert: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
    deleteOne: ReturnType<Database["prepare"]>;
    selectBySubAgentId: ReturnType<Database["prepare"]>;
  };
  podMcpServerIds: {
    insert: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
    deleteOne: ReturnType<Database["prepare"]>;
    selectByMcpServerId: ReturnType<Database["prepare"]>;
  };
  podPluginIds: {
    insert: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
    deleteOne: ReturnType<Database["prepare"]>;
    selectByPluginId: ReturnType<Database["prepare"]>;
  };
  connection: {
    insert: ReturnType<Database["prepare"]>;
    selectByCanvasId: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    update: ReturnType<Database["prepare"]>;
    updateConnectionStatus: ReturnType<Database["prepare"]>;
    updateDecideStatus: ReturnType<Database["prepare"]>;
    clearDecideStatusByPodId: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
    deleteByCanvasId: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    selectBySourcePodId: ReturnType<Database["prepare"]>;
    selectByTargetPodId: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
    selectByTriggerMode: ReturnType<Database["prepare"]>;
  };
  note: {
    insert: ReturnType<Database["prepare"]>;
    selectByCanvasIdAndType: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    update: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
    deleteByCanvasId: ReturnType<Database["prepare"]>;
    deleteByCanvasIdAndType: ReturnType<Database["prepare"]>;
    selectByBoundPodId: ReturnType<Database["prepare"]>;
    deleteByBoundPodId: ReturnType<Database["prepare"]>;
    deleteByForeignKeyId: ReturnType<Database["prepare"]>;
    selectByForeignKeyId: ReturnType<Database["prepare"]>;
  };
  message: {
    insert: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    upsert: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
    deleteByCanvasId: ReturnType<Database["prepare"]>;
  };
  repositoryMetadata: {
    upsert: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
  };
  podManifest: {
    upsert: ReturnType<Database["prepare"]>;
    selectByPodIdAndRepoId: ReturnType<Database["prepare"]>;
    selectByRepositoryId: ReturnType<Database["prepare"]>;
    deleteByPodIdAndRepoId: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
  };
  mcpServer: {
    insert: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    update: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
  };
  globalSettings: {
    selectByKey: ReturnType<Database["prepare"]>;
    upsert: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
  };
  integrationApp: {
    insert: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectByProvider: ReturnType<Database["prepare"]>;
    selectByProviderAndName: ReturnType<Database["prepare"]>;
    selectByProviderAndConfigField: ReturnType<Database["prepare"]>;
    updateExtraJson: ReturnType<Database["prepare"]>;
    updateConfigJson: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
  };
  workflowRun: {
    insert: ReturnType<Database["prepare"]>;
    selectByCanvasId: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    updateStatus: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
    countByCanvasId: ReturnType<Database["prepare"]>;
    selectOldestCompleted: ReturnType<Database["prepare"]>;
  };
  runPodInstance: {
    insert: ReturnType<Database["prepare"]>;
    selectByRunId: ReturnType<Database["prepare"]>;
    selectByRunIdAndPodId: ReturnType<Database["prepare"]>;
    updateStatus: ReturnType<Database["prepare"]>;
    updateClaudeSessionId: ReturnType<Database["prepare"]>;
    selectRunningByRunId: ReturnType<Database["prepare"]>;
    deleteByRunId: ReturnType<Database["prepare"]>;
    settleAutoPathway: ReturnType<Database["prepare"]>;
    settleDirectPathway: ReturnType<Database["prepare"]>;
    selectWorktreePathsByRunId: ReturnType<Database["prepare"]>;
    clearWorktreePathsByRunId: ReturnType<Database["prepare"]>;
  };
  runMessage: {
    insert: ReturnType<Database["prepare"]>;
    selectByRunIdAndPodId: ReturnType<Database["prepare"]>;
    upsert: ReturnType<Database["prepare"]>;
    deleteByRunId: ReturnType<Database["prepare"]>;
  };
} {
  return {
    canvas: {
      insert: db.prepare(
        "INSERT INTO canvases (id, name, sort_index) VALUES ($id, $name, $sortIndex)",
      ),
      selectAll: db.prepare("SELECT * FROM canvases ORDER BY sort_index ASC"),
      selectById: db.prepare("SELECT * FROM canvases WHERE id = ?"),
      selectByName: db.prepare("SELECT * FROM canvases WHERE name = ?"),
      selectMaxSortIndex: db.prepare(
        "SELECT COALESCE(MAX(sort_index), -1) as max_index FROM canvases",
      ),
      updateName: db.prepare("UPDATE canvases SET name = $name WHERE id = $id"),
      updateSortIndex: db.prepare(
        "UPDATE canvases SET sort_index = $sortIndex WHERE id = $id",
      ),
      deleteById: db.prepare("DELETE FROM canvases WHERE id = ?"),
    },

    pod: {
      insert: db.prepare(
        "INSERT INTO pods (id, canvas_id, name, status, x, y, rotation, model, workspace_path, claude_session_id, output_style_id, repository_id, command_id, multi_instance, schedule_json) VALUES ($id, $canvasId, $name, $status, $x, $y, $rotation, $model, $workspacePath, $claudeSessionId, $outputStyleId, $repositoryId, $commandId, $multiInstance, $scheduleJson)",
      ),
      selectByCanvasId: db.prepare("SELECT * FROM pods WHERE canvas_id = ?"),
      selectById: db.prepare("SELECT * FROM pods WHERE id = ?"),
      selectByCanvasIdAndId: db.prepare(
        "SELECT * FROM pods WHERE canvas_id = ? AND id = ?",
      ),
      selectStatusByCanvasIdAndId: db.prepare(
        "SELECT status FROM pods WHERE canvas_id = ? AND id = ?",
      ),
      selectByCanvasIdAndName: db.prepare(
        "SELECT * FROM pods WHERE canvas_id = ? AND name = ?",
      ),
      countByCanvasIdAndName: db.prepare(
        "SELECT COUNT(*) as count FROM pods WHERE canvas_id = $canvasId AND name = $name AND id != $excludeId",
      ),
      update: db.prepare(
        "UPDATE pods SET name = $name, status = $status, x = $x, y = $y, rotation = $rotation, model = $model, claude_session_id = $claudeSessionId, output_style_id = $outputStyleId, repository_id = $repositoryId, command_id = $commandId, multi_instance = $multiInstance, schedule_json = $scheduleJson WHERE id = $id",
      ),
      updateStatus: db.prepare(
        "UPDATE pods SET status = $status WHERE id = $id",
      ),
      updateClaudeSessionId: db.prepare(
        "UPDATE pods SET claude_session_id = $claudeSessionId WHERE id = $id",
      ),
      updateOutputStyleId: db.prepare(
        "UPDATE pods SET output_style_id = $outputStyleId WHERE id = $id",
      ),
      updateRepositoryId: db.prepare(
        "UPDATE pods SET repository_id = $repositoryId WHERE id = $id",
      ),
      updateCommandId: db.prepare(
        "UPDATE pods SET command_id = $commandId WHERE id = $id",
      ),
      updateMultiInstance: db.prepare(
        "UPDATE pods SET multi_instance = $multiInstance WHERE id = $id",
      ),
      updateScheduleJson: db.prepare(
        "UPDATE pods SET schedule_json = $scheduleJson WHERE id = $id",
      ),
      selectWithSchedule: db.prepare(
        "SELECT * FROM pods WHERE schedule_json IS NOT NULL",
      ),
      selectByOutputStyleId: db.prepare(
        "SELECT * FROM pods WHERE output_style_id = ?",
      ),
      selectByRepositoryId: db.prepare(
        "SELECT * FROM pods WHERE repository_id = ?",
      ),
      selectByCommandId: db.prepare("SELECT * FROM pods WHERE command_id = ?"),
      selectScheduleInfo: db.prepare(
        "SELECT canvas_id, id, schedule_json FROM pods WHERE schedule_json IS NOT NULL",
      ),
      deleteById: db.prepare("DELETE FROM pods WHERE id = ?"),
      deleteByCanvasId: db.prepare("DELETE FROM pods WHERE canvas_id = ?"),
    },

    integrationBinding: {
      insert: db.prepare(
        "INSERT INTO integration_bindings (id, pod_id, canvas_id, provider, app_id, resource_id, extra_json) VALUES ($id, $podId, $canvasId, $provider, $appId, $resourceId, $extraJson)",
      ),
      selectByPodId: db.prepare(
        "SELECT * FROM integration_bindings WHERE pod_id = ?",
      ),
      selectByAppId: db.prepare(
        "SELECT * FROM integration_bindings WHERE app_id = ?",
      ),
      selectByAppIdAndResourceId: db.prepare(
        "SELECT * FROM integration_bindings WHERE app_id = ? AND resource_id = ?",
      ),
      deleteById: db.prepare("DELETE FROM integration_bindings WHERE id = ?"),
      deleteByPodIdAndProvider: db.prepare(
        "DELETE FROM integration_bindings WHERE pod_id = ? AND provider = ?",
      ),
      deleteByPodId: db.prepare(
        "DELETE FROM integration_bindings WHERE pod_id = ?",
      ),
      deleteByAppId: db.prepare(
        "DELETE FROM integration_bindings WHERE app_id = ?",
      ),
    },

    podSkillIds: {
      insert: db.prepare(
        "INSERT OR IGNORE INTO pod_skill_ids (pod_id, skill_id) VALUES ($podId, $skillId)",
      ),
      selectByPodId: db.prepare(
        "SELECT skill_id FROM pod_skill_ids WHERE pod_id = ?",
      ),
      deleteByPodId: db.prepare("DELETE FROM pod_skill_ids WHERE pod_id = ?"),
      deleteOne: db.prepare(
        "DELETE FROM pod_skill_ids WHERE pod_id = $podId AND skill_id = $skillId",
      ),
      selectBySkillId: db.prepare(
        "SELECT pod_id FROM pod_skill_ids WHERE skill_id = ?",
      ),
    },

    podSubAgentIds: {
      insert: db.prepare(
        "INSERT OR IGNORE INTO pod_sub_agent_ids (pod_id, sub_agent_id) VALUES ($podId, $subAgentId)",
      ),
      selectByPodId: db.prepare(
        "SELECT sub_agent_id FROM pod_sub_agent_ids WHERE pod_id = ?",
      ),
      deleteByPodId: db.prepare(
        "DELETE FROM pod_sub_agent_ids WHERE pod_id = ?",
      ),
      deleteOne: db.prepare(
        "DELETE FROM pod_sub_agent_ids WHERE pod_id = $podId AND sub_agent_id = $subAgentId",
      ),
      selectBySubAgentId: db.prepare(
        "SELECT pod_id FROM pod_sub_agent_ids WHERE sub_agent_id = ?",
      ),
    },

    podMcpServerIds: {
      insert: db.prepare(
        "INSERT OR IGNORE INTO pod_mcp_server_ids (pod_id, mcp_server_id) VALUES ($podId, $mcpServerId)",
      ),
      selectByPodId: db.prepare(
        "SELECT mcp_server_id FROM pod_mcp_server_ids WHERE pod_id = ?",
      ),
      deleteByPodId: db.prepare(
        "DELETE FROM pod_mcp_server_ids WHERE pod_id = ?",
      ),
      deleteOne: db.prepare(
        "DELETE FROM pod_mcp_server_ids WHERE pod_id = $podId AND mcp_server_id = $mcpServerId",
      ),
      selectByMcpServerId: db.prepare(
        "SELECT pod_id FROM pod_mcp_server_ids WHERE mcp_server_id = ?",
      ),
    },

    podPluginIds: {
      insert: db.prepare(
        "INSERT OR IGNORE INTO pod_plugin_ids (pod_id, plugin_id) VALUES ($podId, $pluginId)",
      ),
      selectByPodId: db.prepare(
        "SELECT plugin_id FROM pod_plugin_ids WHERE pod_id = ?",
      ),
      deleteByPodId: db.prepare("DELETE FROM pod_plugin_ids WHERE pod_id = ?"),
      deleteOne: db.prepare(
        "DELETE FROM pod_plugin_ids WHERE pod_id = $podId AND plugin_id = $pluginId",
      ),
      selectByPluginId: db.prepare(
        "SELECT pod_id FROM pod_plugin_ids WHERE plugin_id = ?",
      ),
    },

    connection: {
      insert: db.prepare(
        "INSERT INTO connections (id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor, trigger_mode, decide_status, decide_reason, connection_status, summary_model, ai_decide_model) VALUES ($id, $canvasId, $sourcePodId, $sourceAnchor, $targetPodId, $targetAnchor, $triggerMode, $decideStatus, $decideReason, $connectionStatus, $summaryModel, $aiDecideModel)",
      ),
      selectByCanvasId: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = ?",
      ),
      selectById: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = ? AND id = ?",
      ),
      update: db.prepare(
        "UPDATE connections SET source_pod_id = $sourcePodId, source_anchor = $sourceAnchor, target_pod_id = $targetPodId, target_anchor = $targetAnchor, trigger_mode = $triggerMode, decide_status = $decideStatus, decide_reason = $decideReason, connection_status = $connectionStatus, summary_model = $summaryModel, ai_decide_model = $aiDecideModel WHERE canvas_id = $canvasId AND id = $id",
      ),
      updateConnectionStatus: db.prepare(
        "UPDATE connections SET connection_status = $connectionStatus WHERE canvas_id = $canvasId AND id = $id",
      ),
      updateDecideStatus: db.prepare(
        "UPDATE connections SET decide_status = $decideStatus, decide_reason = $decideReason WHERE canvas_id = $canvasId AND id = $id",
      ),
      clearDecideStatusByPodId: db.prepare(
        "UPDATE connections SET decide_status = 'none', decide_reason = NULL WHERE canvas_id = $canvasId AND source_pod_id = $podId",
      ),
      deleteById: db.prepare(
        "DELETE FROM connections WHERE canvas_id = ? AND id = ?",
      ),
      deleteByCanvasId: db.prepare(
        "DELETE FROM connections WHERE canvas_id = ?",
      ),
      selectByPodId: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = $canvasId AND (source_pod_id = $podId OR target_pod_id = $podId)",
      ),
      selectBySourcePodId: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = $canvasId AND source_pod_id = $sourcePodId",
      ),
      selectByTargetPodId: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = $canvasId AND target_pod_id = $targetPodId",
      ),
      deleteByPodId: db.prepare(
        "DELETE FROM connections WHERE canvas_id = $canvasId AND (source_pod_id = $podId OR target_pod_id = $podId)",
      ),
      selectByTriggerMode: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = $canvasId AND source_pod_id = $sourcePodId AND trigger_mode = $triggerMode",
      ),
    },

    note: {
      insert: db.prepare(
        "INSERT INTO notes (id, canvas_id, type, name, x, y, bound_to_pod_id, original_position_json, foreign_key_id) VALUES ($id, $canvasId, $type, $name, $x, $y, $boundToPodId, $originalPositionJson, $foreignKeyId)",
      ),
      selectByCanvasIdAndType: db.prepare(
        "SELECT * FROM notes WHERE canvas_id = $canvasId AND type = $type",
      ),
      selectById: db.prepare("SELECT * FROM notes WHERE id = ?"),
      update: db.prepare(
        "UPDATE notes SET name = $name, x = $x, y = $y, bound_to_pod_id = $boundToPodId, original_position_json = $originalPositionJson, foreign_key_id = $foreignKeyId WHERE id = $id",
      ),
      deleteById: db.prepare("DELETE FROM notes WHERE id = ?"),
      deleteByCanvasId: db.prepare("DELETE FROM notes WHERE canvas_id = ?"),
      deleteByCanvasIdAndType: db.prepare(
        "DELETE FROM notes WHERE canvas_id = $canvasId AND type = $type",
      ),
      selectByBoundPodId: db.prepare(
        "SELECT * FROM notes WHERE canvas_id = $canvasId AND type = $type AND bound_to_pod_id = $boundToPodId",
      ),
      deleteByBoundPodId: db.prepare(
        "DELETE FROM notes WHERE canvas_id = $canvasId AND type = $type AND bound_to_pod_id = $boundToPodId",
      ),
      deleteByForeignKeyId: db.prepare(
        "DELETE FROM notes WHERE canvas_id = $canvasId AND type = $type AND foreign_key_id = $foreignKeyId",
      ),
      selectByForeignKeyId: db.prepare(
        "SELECT * FROM notes WHERE canvas_id = $canvasId AND type = $type AND foreign_key_id = $foreignKeyId",
      ),
    },

    message: {
      insert: db.prepare(
        "INSERT INTO messages (id, pod_id, canvas_id, role, content, timestamp, sub_messages_json) VALUES ($id, $podId, $canvasId, $role, $content, $timestamp, $subMessagesJson)",
      ),
      selectByPodId: db.prepare(
        "SELECT * FROM messages WHERE pod_id = ? ORDER BY timestamp ASC",
      ),
      selectById: db.prepare("SELECT * FROM messages WHERE id = ?"),
      upsert: db.prepare(
        "INSERT OR REPLACE INTO messages (id, pod_id, canvas_id, role, content, timestamp, sub_messages_json) VALUES ($id, $podId, $canvasId, $role, $content, $timestamp, $subMessagesJson)",
      ),
      deleteByPodId: db.prepare("DELETE FROM messages WHERE pod_id = ?"),
      deleteByCanvasId: db.prepare("DELETE FROM messages WHERE canvas_id = ?"),
    },

    repositoryMetadata: {
      upsert: db.prepare(
        "INSERT OR REPLACE INTO repository_metadata (id, name, path, parent_repo_id, branch_name, current_branch) VALUES ($id, $name, $path, $parentRepoId, $branchName, $currentBranch)",
      ),
      selectById: db.prepare("SELECT * FROM repository_metadata WHERE id = ?"),
      selectAll: db.prepare("SELECT * FROM repository_metadata"),
      deleteById: db.prepare("DELETE FROM repository_metadata WHERE id = ?"),
    },

    mcpServer: {
      insert: db.prepare(
        "INSERT INTO mcp_servers (id, name, config_json) VALUES ($id, $name, $configJson)",
      ),
      selectAll: db.prepare("SELECT * FROM mcp_servers"),
      selectById: db.prepare("SELECT * FROM mcp_servers WHERE id = ?"),
      update: db.prepare(
        "UPDATE mcp_servers SET name = $name, config_json = $configJson WHERE id = $id",
      ),
      deleteById: db.prepare("DELETE FROM mcp_servers WHERE id = ?"),
    },

    podManifest: {
      upsert: db.prepare(
        "INSERT OR REPLACE INTO pod_manifests (pod_id, repository_id, files_json) VALUES ($podId, $repositoryId, $filesJson)",
      ),
      selectByPodIdAndRepoId: db.prepare(
        "SELECT * FROM pod_manifests WHERE pod_id = $podId AND repository_id = $repoId",
      ),
      selectByRepositoryId: db.prepare(
        "SELECT * FROM pod_manifests WHERE repository_id = ?",
      ),
      deleteByPodIdAndRepoId: db.prepare(
        "DELETE FROM pod_manifests WHERE pod_id = $podId AND repository_id = $repoId",
      ),
      deleteByPodId: db.prepare("DELETE FROM pod_manifests WHERE pod_id = ?"),
    },

    globalSettings: {
      selectByKey: db.prepare("SELECT * FROM global_settings WHERE key = ?"),
      upsert: db.prepare(
        "INSERT OR REPLACE INTO global_settings (key, value) VALUES ($key, $value)",
      ),
      selectAll: db.prepare("SELECT * FROM global_settings"),
    },

    integrationApp: {
      insert: db.prepare(
        "INSERT INTO integration_apps (id, provider, name, config_json, extra_json) VALUES ($id, $provider, $name, $configJson, $extraJson)",
      ),
      selectAll: db.prepare("SELECT * FROM integration_apps"),
      selectById: db.prepare("SELECT * FROM integration_apps WHERE id = ?"),
      selectByProvider: db.prepare(
        "SELECT * FROM integration_apps WHERE provider = ?",
      ),
      selectByProviderAndName: db.prepare(
        "SELECT * FROM integration_apps WHERE provider = $provider AND name = $name LIMIT 1",
      ),
      selectByProviderAndConfigField: db.prepare(
        "SELECT * FROM integration_apps WHERE provider = $provider AND json_extract(config_json, $jsonPath) = $value LIMIT 1",
      ),
      updateExtraJson: db.prepare(
        "UPDATE integration_apps SET extra_json = $extraJson WHERE id = $id",
      ),
      updateConfigJson: db.prepare(
        "UPDATE integration_apps SET config_json = $configJson WHERE id = $id",
      ),
      deleteById: db.prepare("DELETE FROM integration_apps WHERE id = ?"),
    },

    workflowRun: {
      insert: db.prepare(
        "INSERT INTO workflow_runs (id, canvas_id, source_pod_id, trigger_message, status, created_at, completed_at) VALUES ($id, $canvasId, $sourcePodId, $triggerMessage, $status, $createdAt, $completedAt)",
      ),
      selectByCanvasId: db.prepare(
        "SELECT * FROM workflow_runs WHERE canvas_id = ? ORDER BY created_at DESC",
      ),
      selectById: db.prepare("SELECT * FROM workflow_runs WHERE id = ?"),
      updateStatus: db.prepare(
        "UPDATE workflow_runs SET status = $status, completed_at = $completedAt WHERE id = $id",
      ),
      deleteById: db.prepare("DELETE FROM workflow_runs WHERE id = ?"),
      countByCanvasId: db.prepare(
        "SELECT COUNT(*) as count FROM workflow_runs WHERE canvas_id = ?",
      ),
      selectOldestCompleted: db.prepare(
        "SELECT id FROM workflow_runs WHERE canvas_id = ? AND status = 'completed' ORDER BY created_at ASC LIMIT ?",
      ),
    },

    runPodInstance: {
      insert: db.prepare(
        "INSERT INTO run_pod_instances (id, run_id, pod_id, status, claude_session_id, error_message, triggered_at, completed_at, auto_pathway_settled, direct_pathway_settled, worktree_path) VALUES ($id, $runId, $podId, $status, $claudeSessionId, $errorMessage, $triggeredAt, $completedAt, $autoPathwaySettled, $directPathwaySettled, $worktreePath)",
      ),
      selectByRunId: db.prepare(
        "SELECT * FROM run_pod_instances WHERE run_id = ?",
      ),
      selectByRunIdAndPodId: db.prepare(
        "SELECT * FROM run_pod_instances WHERE run_id = $runId AND pod_id = $podId",
      ),
      updateStatus: db.prepare(
        "UPDATE run_pod_instances SET status = $status, error_message = $errorMessage, triggered_at = CASE WHEN $status = 'running' THEN $triggeredAt ELSE triggered_at END, completed_at = $completedAt WHERE id = $id",
      ),
      updateClaudeSessionId: db.prepare(
        "UPDATE run_pod_instances SET claude_session_id = $claudeSessionId WHERE id = $id",
      ),
      selectRunningByRunId: db.prepare(
        "SELECT * FROM run_pod_instances WHERE run_id = ? AND status IN ('pending', 'running', 'summarizing', 'deciding', 'queued', 'waiting')",
      ),
      deleteByRunId: db.prepare(
        "DELETE FROM run_pod_instances WHERE run_id = ?",
      ),
      settleAutoPathway: db.prepare(
        "UPDATE run_pod_instances SET auto_pathway_settled = 1 WHERE id = $id",
      ),
      settleDirectPathway: db.prepare(
        "UPDATE run_pod_instances SET direct_pathway_settled = 1 WHERE id = $id",
      ),
      selectWorktreePathsByRunId: db.prepare(
        "SELECT pod_id, worktree_path FROM run_pod_instances WHERE run_id = ? AND worktree_path IS NOT NULL",
      ),
      clearWorktreePathsByRunId: db.prepare(
        "UPDATE run_pod_instances SET worktree_path = NULL WHERE run_id = ?",
      ),
    },

    runMessage: {
      insert: db.prepare(
        "INSERT INTO run_messages (id, run_id, pod_id, role, content, timestamp, sub_messages_json) VALUES ($id, $runId, $podId, $role, $content, $timestamp, $subMessagesJson)",
      ),
      selectByRunIdAndPodId: db.prepare(
        "SELECT * FROM run_messages WHERE run_id = $runId AND pod_id = $podId ORDER BY timestamp ASC",
      ),
      upsert: db.prepare(
        "INSERT OR REPLACE INTO run_messages (id, run_id, pod_id, role, content, timestamp, sub_messages_json) VALUES ($id, $runId, $podId, $role, $content, $timestamp, $subMessagesJson)",
      ),
      deleteByRunId: db.prepare("DELETE FROM run_messages WHERE run_id = ?"),
    },
  };
}

export function getStatements(
  db: Database,
): ReturnType<typeof buildStatements> {
  if (cachedStatements) {
    return cachedStatements;
  }

  cachedStatements = buildStatements(db);
  return cachedStatements;
}

export function resetStatements(): void {
  cachedStatements = null;
}
