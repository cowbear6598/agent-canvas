import { Database } from "bun:sqlite";

// WeakMap 以 DB 實例為 key，避免多 DB 實例命中舊 cache
const statementsCache = new WeakMap<
  Database,
  ReturnType<typeof buildStatements>
>();

function buildStatements(db: Database): {
  canvas: {
    insert: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectByName: ReturnType<Database["prepare"]>;
    selectMaxSortIndex: ReturnType<Database["prepare"]>;
    updateName: ReturnType<Database["prepare"]>;
    updateSortIndex: ReturnType<Database["prepare"]>;
    updatePassword: ReturnType<Database["prepare"]>;
    clearPassword: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
  };
  pod: {
    insert: ReturnType<Database["prepare"]>;
    selectByCanvasId: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectByCanvasIdAndId: ReturnType<Database["prepare"]>;
    selectByCanvasIdAndName: ReturnType<Database["prepare"]>;
    countByCanvasIdAndName: ReturnType<Database["prepare"]>;
    update: ReturnType<Database["prepare"]>;
    updateSessionId: ReturnType<Database["prepare"]>;
    updateRepositoryId: ReturnType<Database["prepare"]>;
    updateScheduleJson: ReturnType<Database["prepare"]>;
    selectWithSchedule: ReturnType<Database["prepare"]>;
    selectByRepositoryId: ReturnType<Database["prepare"]>;
    selectByRepositoryIdAndCanvas: ReturnType<Database["prepare"]>;
    selectScheduleInfo: ReturnType<Database["prepare"]>;
    selectScheduleJsonByCanvasAndId: ReturnType<Database["prepare"]>;
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
  podMcpServerNames: {
    insert: ReturnType<Database["prepare"]>;
    selectByPodId: ReturnType<Database["prepare"]>;
    deleteByPodId: ReturnType<Database["prepare"]>;
  };
  managedMcp: {
    insert: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectByName: ReturnType<Database["prepare"]>;
    update: ReturnType<Database["prepare"]>;
    updateRuntimeState: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
  };
  managedPlugin: {
    selectAll: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    selectByGithubRepo: ReturnType<Database["prepare"]>;
    selectMaxSortIndex: ReturnType<Database["prepare"]>;
    insert: ReturnType<Database["prepare"]>;
    update: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
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
    updateReturning: ReturnType<Database["prepare"]>;
    updateConnectionStatus: ReturnType<Database["prepare"]>;
    updateConnectionStatusReturning: ReturnType<Database["prepare"]>;
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
  globalSettings: {
    selectByKey: ReturnType<Database["prepare"]>;
    upsert: ReturnType<Database["prepare"]>;
    selectAll: ReturnType<Database["prepare"]>;
    deleteByKey: ReturnType<Database["prepare"]>;
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
    selectRunning: ReturnType<Database["prepare"]>;
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
    updateLastResponseSummary: ReturnType<Database["prepare"]>;
    updateSessionId: ReturnType<Database["prepare"]>;
    selectRunningByRunId: ReturnType<Database["prepare"]>;
    selectActiveByPodId: ReturnType<Database["prepare"]>;
    deleteByRunId: ReturnType<Database["prepare"]>;
    settleAutoPathway: ReturnType<Database["prepare"]>;
    settleDirectPathway: ReturnType<Database["prepare"]>;
    selectRunRepoPathsByRunId: ReturnType<Database["prepare"]>;
    selectExecutionPathsByRunId: ReturnType<Database["prepare"]>;
    clearRunRepoPathsByRunId: ReturnType<Database["prepare"]>;
    clearExecutionPathsByRunId: ReturnType<Database["prepare"]>;
  };
  runMessage: {
    insert: ReturnType<Database["prepare"]>;
    selectByRunIdAndPodId: ReturnType<Database["prepare"]>;
    selectPageByRunIdAndPodId: ReturnType<Database["prepare"]>;
    upsert: ReturnType<Database["prepare"]>;
    deleteByRunId: ReturnType<Database["prepare"]>;
  };
  modelAlias: {
    insert: ReturnType<Database["prepare"]>;
    selectByProviderId: ReturnType<Database["prepare"]>;
    selectById: ReturnType<Database["prepare"]>;
    updateAliasAndOrderIdx: ReturnType<Database["prepare"]>;
    updateAliasAndModelId: ReturnType<Database["prepare"]>;
    updateThinkingPresets: ReturnType<Database["prepare"]>;
    deleteById: ReturnType<Database["prepare"]>;
    selectMaxOrderIdxByProviderId: ReturnType<Database["prepare"]>;
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
      updatePassword: db.prepare(
        "UPDATE canvases SET password_hash = $passwordHash, password_version = $passwordVersion WHERE id = $id",
      ),
      clearPassword: db.prepare(
        "UPDATE canvases SET password_hash = NULL, password_version = $passwordVersion WHERE id = $id",
      ),
      deleteById: db.prepare("DELETE FROM canvases WHERE id = ?"),
    },

    pod: {
      insert: db.prepare(
        `INSERT INTO pods (
          id, canvas_id, name, x, y, rotation, workspace_path,
          session_id, repository_id, goal_json, schedule_json,
          provider, provider_config_json
        ) VALUES (
          $id, $canvasId, $name, $x, $y, $rotation, $workspacePath,
          $sessionId, $repositoryId, $goalJson, $scheduleJson,
          $provider, $providerConfigJson
        )`,
      ),
      selectByCanvasId: db.prepare("SELECT * FROM pods WHERE canvas_id = ?"),
      selectById: db.prepare("SELECT * FROM pods WHERE id = ?"),
      selectByCanvasIdAndId: db.prepare(
        "SELECT * FROM pods WHERE canvas_id = ? AND id = ?",
      ),
      selectByCanvasIdAndName: db.prepare(
        "SELECT * FROM pods WHERE canvas_id = ? AND name = ?",
      ),
      countByCanvasIdAndName: db.prepare(
        "SELECT COUNT(*) as count FROM pods WHERE canvas_id = $canvasId AND name = $name AND id != $excludeId",
      ),
      update: db.prepare(
        `UPDATE pods SET
          name = $name, x = $x, y = $y, rotation = $rotation,
          session_id = $sessionId, repository_id = $repositoryId,
          goal_json = $goalJson, schedule_json = $scheduleJson,
          provider = $provider,
          provider_config_json = $providerConfigJson
        WHERE id = $id`,
      ),
      updateSessionId: db.prepare(
        "UPDATE pods SET session_id = $sessionId WHERE id = $id",
      ),
      updateRepositoryId: db.prepare(
        "UPDATE pods SET repository_id = $repositoryId WHERE id = $id",
      ),
      updateScheduleJson: db.prepare(
        "UPDATE pods SET schedule_json = $scheduleJson WHERE id = $id",
      ),
      selectWithSchedule: db.prepare(
        "SELECT * FROM pods WHERE schedule_json IS NOT NULL",
      ),
      selectByRepositoryId: db.prepare(
        "SELECT * FROM pods WHERE repository_id = ?",
      ),
      selectByRepositoryIdAndCanvas: db.prepare(
        "SELECT * FROM pods WHERE repository_id = ? AND canvas_id = ?",
      ),
      selectScheduleInfo: db.prepare(
        "SELECT canvas_id, id, schedule_json FROM pods WHERE schedule_json IS NOT NULL",
      ),
      selectScheduleJsonByCanvasAndId: db.prepare(
        "SELECT schedule_json FROM pods WHERE canvas_id = $canvasId AND id = $id",
      ),
      deleteById: db.prepare("DELETE FROM pods WHERE id = ?"),
      deleteByCanvasId: db.prepare("DELETE FROM pods WHERE canvas_id = ?"),
    },

    integrationBinding: {
      insert: db.prepare(
        `INSERT INTO integration_bindings (
          id, pod_id, canvas_id, provider, app_id, resource_id, extra_json
        ) VALUES (
          $id, $podId, $canvasId, $provider, $appId, $resourceId, $extraJson
        )`,
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

    podMcpServerNames: {
      insert: db.prepare(
        "INSERT OR IGNORE INTO pod_mcp_server_names (pod_id, mcp_server_name) VALUES ($podId, $mcpServerName)",
      ),
      selectByPodId: db.prepare(
        "SELECT mcp_server_name FROM pod_mcp_server_names WHERE pod_id = ?",
      ),
      deleteByPodId: db.prepare(
        "DELETE FROM pod_mcp_server_names WHERE pod_id = ?",
      ),
    },

    managedMcp: {
      insert: db.prepare(
        `INSERT INTO managed_mcp_servers (
          id, name, transport, command, args_json, cwd, env_json, url,
          enabled, created_at, updated_at, last_known_status, last_error
        ) VALUES (
          $id, $name, $transport, $command, $argsJson, $cwd, $envJson, $url,
          $enabled, $createdAt, $updatedAt, $lastKnownStatus, $lastError
        )`,
      ),
      selectAll: db.prepare(
        "SELECT * FROM managed_mcp_servers ORDER BY name COLLATE NOCASE ASC",
      ),
      selectById: db.prepare("SELECT * FROM managed_mcp_servers WHERE id = ?"),
      selectByName: db.prepare(
        "SELECT * FROM managed_mcp_servers WHERE name = ?",
      ),
      update: db.prepare(
        `UPDATE managed_mcp_servers SET
          name = $name,
          transport = $transport,
          command = $command,
          args_json = $argsJson,
          cwd = $cwd,
          env_json = $envJson,
          url = $url,
          enabled = $enabled,
          updated_at = $updatedAt
        WHERE id = $id`,
      ),
      updateRuntimeState: db.prepare(
        `UPDATE managed_mcp_servers SET
          last_known_status = $lastKnownStatus,
          last_error = $lastError,
          updated_at = $updatedAt
        WHERE name = $name`,
      ),
      deleteById: db.prepare("DELETE FROM managed_mcp_servers WHERE id = ?"),
    },

    managedPlugin: {
      selectAll: db.prepare(
        "SELECT * FROM managed_plugins ORDER BY sort_index ASC, installed_at ASC, id ASC",
      ),
      selectById: db.prepare("SELECT * FROM managed_plugins WHERE id = ?"),
      selectByGithubRepo: db.prepare(
        "SELECT * FROM managed_plugins WHERE github_repo = ?",
      ),
      selectMaxSortIndex: db.prepare(
        "SELECT COALESCE(MAX(sort_index), -1) as max_index FROM managed_plugins",
      ),
      insert: db.prepare(
        `INSERT INTO managed_plugins (
          id, github_repo, display_name, description, install_path, sort_index, installed_at, updated_at
        ) VALUES (
          $id, $githubRepo, $displayName, $description, $installPath, $sortIndex, $installedAt, $updatedAt
        )`,
      ),
      update: db.prepare(
        `UPDATE managed_plugins SET
          display_name = $displayName,
          description = $description,
          install_path = $installPath,
          updated_at = $updatedAt
        WHERE id = $id`,
      ),
      deleteById: db.prepare("DELETE FROM managed_plugins WHERE id = ?"),
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
        `INSERT INTO connections (
          id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor,
          trigger_mode, decide_status, decide_reason, connection_status,
          summary_model, summary_provider,
          label, description, branch_provider, branch_model
        ) VALUES (
          $id, $canvasId, $sourcePodId, $sourceAnchor, $targetPodId, $targetAnchor,
          $triggerMode, $decideStatus, $decideReason, $connectionStatus,
          $summaryModel, $summaryProvider,
          $label, $description, $branchProvider, $branchModel
        )`,
      ),
      selectByCanvasId: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = ?",
      ),
      selectById: db.prepare(
        "SELECT * FROM connections WHERE canvas_id = ? AND id = ?",
      ),
      update: db.prepare(
        `UPDATE connections SET
          source_pod_id = $sourcePodId, source_anchor = $sourceAnchor,
          target_pod_id = $targetPodId, target_anchor = $targetAnchor,
          trigger_mode = $triggerMode, decide_status = $decideStatus,
          decide_reason = $decideReason, connection_status = $connectionStatus,
          summary_model = $summaryModel, summary_provider = $summaryProvider,
          label = $label, description = $description,
          branch_provider = $branchProvider, branch_model = $branchModel
        WHERE canvas_id = $canvasId AND id = $id`,
      ),
      // RETURNING 版本：UPDATE 後直接回傳更新後的行，免去額外 SELECT
      updateReturning: db.prepare(
        `UPDATE connections SET
          source_pod_id = $sourcePodId, source_anchor = $sourceAnchor,
          target_pod_id = $targetPodId, target_anchor = $targetAnchor,
          trigger_mode = $triggerMode, decide_status = $decideStatus,
          decide_reason = $decideReason, connection_status = $connectionStatus,
          summary_model = $summaryModel, summary_provider = $summaryProvider,
          label = $label, description = $description,
          branch_provider = $branchProvider, branch_model = $branchModel
        WHERE canvas_id = $canvasId AND id = $id
        RETURNING *`,
      ),
      updateConnectionStatus: db.prepare(
        "UPDATE connections SET connection_status = $connectionStatus WHERE canvas_id = $canvasId AND id = $id",
      ),
      // RETURNING 版本：UPDATE 後直接回傳更新後的行，免去額外 SELECT
      updateConnectionStatusReturning: db.prepare(
        "UPDATE connections SET connection_status = $connectionStatus WHERE canvas_id = $canvasId AND id = $id RETURNING *",
      ),
      updateDecideStatus: db.prepare(
        `UPDATE connections SET
          decide_status = $decideStatus, decide_reason = $decideReason
        WHERE canvas_id = $canvasId AND id = $id`,
      ),
      clearDecideStatusByPodId: db.prepare(
        `UPDATE connections SET decide_status = 'none', decide_reason = NULL
        WHERE canvas_id = $canvasId AND source_pod_id = $podId`,
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
        `SELECT * FROM connections
        WHERE canvas_id = $canvasId
          AND source_pod_id = $sourcePodId
          AND trigger_mode = $triggerMode`,
      ),
    },

    note: {
      insert: db.prepare(
        `INSERT INTO notes (
          id, canvas_id, type, name, x, y,
          bound_to_pod_id, original_position_json, foreign_key_id
        ) VALUES (
          $id, $canvasId, $type, $name, $x, $y,
          $boundToPodId, $originalPositionJson, $foreignKeyId
        )`,
      ),
      selectByCanvasIdAndType: db.prepare(
        "SELECT * FROM notes WHERE canvas_id = $canvasId AND type = $type",
      ),
      selectById: db.prepare("SELECT * FROM notes WHERE id = ?"),
      update: db.prepare(
        `UPDATE notes SET
          name = $name, x = $x, y = $y,
          bound_to_pod_id = $boundToPodId,
          original_position_json = $originalPositionJson,
          foreign_key_id = $foreignKeyId
        WHERE id = $id`,
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

    repositoryMetadata: {
      upsert: db.prepare(
        `INSERT OR REPLACE INTO repository_metadata (
          id, name, path, current_branch
        ) VALUES (
          $id, $name, $path, $currentBranch
        )`,
      ),
      selectById: db.prepare("SELECT * FROM repository_metadata WHERE id = ?"),
      selectAll: db.prepare("SELECT * FROM repository_metadata"),
      deleteById: db.prepare("DELETE FROM repository_metadata WHERE id = ?"),
    },

    podManifest: {
      upsert: db.prepare(
        `INSERT OR REPLACE INTO pod_manifests (pod_id, repository_id, files_json)
        VALUES ($podId, $repositoryId, $filesJson)`,
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
      deleteByKey: db.prepare("DELETE FROM global_settings WHERE key = ?"),
    },

    integrationApp: {
      insert: db.prepare(
        `INSERT INTO integration_apps (id, provider, name, config_json, extra_json)
        VALUES ($id, $provider, $name, $configJson, $extraJson)`,
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
        `SELECT * FROM integration_apps
        WHERE provider = $provider
          AND json_extract(config_json, $jsonPath) = $value
        LIMIT 1`,
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
        `INSERT INTO workflow_runs (
          id, canvas_id, source_pod_id, trigger_message, status, created_at, completed_at
        ) VALUES (
          $id, $canvasId, $sourcePodId, $triggerMessage, $status, $createdAt, $completedAt
        )`,
      ),
      selectByCanvasId: db.prepare(
        "SELECT * FROM workflow_runs WHERE canvas_id = ? ORDER BY created_at DESC",
      ),
      selectById: db.prepare("SELECT * FROM workflow_runs WHERE id = ?"),
      selectRunning: db.prepare(
        `SELECT id, canvas_id, source_pod_id, trigger_message, status, created_at, completed_at
        FROM workflow_runs WHERE status = 'running'`,
      ),
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
        `INSERT INTO run_pod_instances (
          id, run_id, pod_id, status, session_id, error_message,
          triggered_at, completed_at, auto_pathway_settled,
          last_response_summary,
          direct_pathway_settled, run_repo_path, workspace_path
        ) VALUES (
          $id, $runId, $podId, $status, $sessionId, $errorMessage,
          $triggeredAt, $completedAt, $autoPathwaySettled,
          $lastResponseSummary,
          $directPathwaySettled, $runRepoPath, $workspacePath
        )`,
      ),
      selectByRunId: db.prepare(
        "SELECT * FROM run_pod_instances WHERE run_id = ?",
      ),
      selectByRunIdAndPodId: db.prepare(
        "SELECT * FROM run_pod_instances WHERE run_id = $runId AND pod_id = $podId",
      ),
      updateStatus: db.prepare(
        `UPDATE run_pod_instances SET
          status = $status, error_message = $errorMessage,
          triggered_at = CASE WHEN $status = 'running' THEN $triggeredAt ELSE triggered_at END,
          completed_at = $completedAt
        WHERE id = $id`,
      ),
      updateSessionId: db.prepare(
        "UPDATE run_pod_instances SET session_id = $sessionId WHERE id = $id",
      ),
      updateLastResponseSummary: db.prepare(
        "UPDATE run_pod_instances SET last_response_summary = $lastResponseSummary WHERE id = $id",
      ),
      selectRunningByRunId: db.prepare(
        `SELECT * FROM run_pod_instances
        WHERE run_id = ?
          AND status IN ('pending', 'running', 'summarizing', 'deciding', 'queued', 'waiting')`,
      ),
      selectActiveByPodId: db.prepare(
        `SELECT id FROM run_pod_instances
        WHERE pod_id = ?
          AND status IN ('running', 'pending', 'summarizing', 'deciding', 'queued', 'waiting')
        LIMIT 1`,
      ),
      deleteByRunId: db.prepare(
        "DELETE FROM run_pod_instances WHERE run_id = ?",
      ),
      settleAutoPathway: db.prepare(
        "UPDATE run_pod_instances SET auto_pathway_settled = 1 WHERE id = $id", // 1 = settled（已結算）
      ),
      settleDirectPathway: db.prepare(
        "UPDATE run_pod_instances SET direct_pathway_settled = 1 WHERE id = $id", // 1 = settled（已結算）
      ),
      selectRunRepoPathsByRunId: db.prepare(
        "SELECT pod_id, run_repo_path FROM run_pod_instances WHERE run_id = ? AND run_repo_path IS NOT NULL",
      ),
      selectExecutionPathsByRunId: db.prepare(
        `SELECT pod_id, run_repo_path, workspace_path
        FROM run_pod_instances
        WHERE run_id = ?
          AND (
            run_repo_path IS NOT NULL OR
            workspace_path IS NOT NULL
          )`,
      ),
      clearRunRepoPathsByRunId: db.prepare(
        "UPDATE run_pod_instances SET run_repo_path = NULL WHERE run_id = ?",
      ),
      clearExecutionPathsByRunId: db.prepare(
        `UPDATE run_pod_instances
        SET run_repo_path = NULL,
            workspace_path = NULL
        WHERE run_id = ?`,
      ),
    },

    runMessage: {
      insert: db.prepare(
        `INSERT INTO run_messages (
          id, run_id, pod_id, role, content, timestamp, sub_messages_json, metadata_json
        ) VALUES (
          $id, $runId, $podId, $role, $content, $timestamp, $subMessagesJson, $metadataJson
        )`,
      ),
      selectByRunIdAndPodId: db.prepare(
        `SELECT * FROM run_messages
        WHERE run_id = $runId AND pod_id = $podId
        ORDER BY timestamp ASC`,
      ),
      selectPageByRunIdAndPodId: db.prepare(
        `SELECT * FROM run_messages
        WHERE run_id = $runId
          AND pod_id = $podId
          AND (
            $hasCursor = 0 OR
            timestamp < $beforeTimestamp OR
            (timestamp = $beforeTimestamp AND id < $beforeMessageId)
          )
        ORDER BY timestamp DESC, id DESC
        LIMIT $limitPlusOne`,
      ),
      upsert: db.prepare(
        `INSERT OR REPLACE INTO run_messages (
          id, run_id, pod_id, role, content, timestamp, sub_messages_json, metadata_json
        ) VALUES (
          $id, $runId, $podId, $role, $content, $timestamp, $subMessagesJson, $metadataJson
        )`,
      ),
      deleteByRunId: db.prepare("DELETE FROM run_messages WHERE run_id = ?"),
    },

    modelAlias: {
      insert: db.prepare(
        `INSERT INTO model_aliases (
          id, provider_id, real_provider, real_model, alias, order_idx,
          thinking_levels_json, default_thinking_level, thinking_metadata_json, thinking_metadata_fetched_at,
          created_at, updated_at
        ) VALUES (
          $id, $providerId, $realProvider, $realModel, $alias, $orderIdx,
          $thinkingLevelsJson, $defaultThinkingLevel, $thinkingMetadataJson, $thinkingMetadataFetchedAt,
          $createdAt, $updatedAt
        )`,
      ),
      // 依 provider_id 查詢，並以 order_idx 升序排列（供 PodModelSelector 顯示）
      selectByProviderId: db.prepare(
        "SELECT * FROM model_aliases WHERE provider_id = $providerId ORDER BY order_idx ASC",
      ),
      // 依 id 查詢單筆（供 create/update handler 取回剛寫入的 row）
      selectById: db.prepare("SELECT * FROM model_aliases WHERE id = $id"),
      // 更新 alias 顯示別稱與排序位置（供 reorder handler 使用）
      updateAliasAndOrderIdx: db.prepare(
        "UPDATE model_aliases SET alias = $alias, order_idx = $orderIdx, updated_at = $updatedAt WHERE id = $id",
      ),
      // 更新 alias 顯示別稱與真實 model 對應（供編輯 handler 使用，不動 order_idx）
      updateAliasAndModelId: db.prepare(
        `UPDATE model_aliases
         SET alias = $alias,
             real_model = $realModel,
             thinking_levels_json = $thinkingLevelsJson,
             default_thinking_level = $defaultThinkingLevel,
             thinking_metadata_json = $thinkingMetadataJson,
             thinking_metadata_fetched_at = $thinkingMetadataFetchedAt,
             updated_at = $updatedAt
         WHERE id = $id`,
      ),
      updateThinkingPresets: db.prepare(
        `UPDATE model_aliases
         SET thinking_levels_json = $thinkingLevelsJson,
             default_thinking_level = $defaultThinkingLevel,
             thinking_metadata_json = $thinkingMetadataJson,
             thinking_metadata_fetched_at = $thinkingMetadataFetchedAt,
             updated_at = $updatedAt
         WHERE id = $id`,
      ),
      deleteById: db.prepare("DELETE FROM model_aliases WHERE id = ?"),
      // 查詢指定 provider_id 內目前最大的 order_idx，供 append 時計算下一個位置
      selectMaxOrderIdxByProviderId: db.prepare(
        "SELECT COALESCE(MAX(order_idx), -1) as max_order_idx FROM model_aliases WHERE provider_id = $providerId",
      ),
    },
  };
}

export function getStatements(
  db: Database,
): ReturnType<typeof buildStatements> {
  const cached = statementsCache.get(db);
  if (cached) {
    return cached;
  }

  const statements = buildStatements(db);
  statementsCache.set(db, statements);
  return statements;
}

export function resetStatements(db?: Database): void {
  if (db) {
    statementsCache.delete(db);
  }
  // db 未傳入時為 no-op：WeakMap 以 DB 實例為 key，
  // 新 DB 實例會自動建立新的 cache entry，不需手動清除全域快取。
}
