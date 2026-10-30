import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  up(database: DatabaseSync): void
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-memory-records',
    up(database) {
      database.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `)
    }
  },
  {
    version: 2,
    name: 'memory-provenance-and-revisions',
    up(database) {
      database.exec(`
        ALTER TABLE memories RENAME TO memories_v1;
        CREATE TABLE memories (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          original_text TEXT NOT NULL CHECK (length(trim(original_text)) BETWEEN 1 AND 4000 AND instr(original_text, char(0)) = 0),
          current_text TEXT NOT NULL CHECK (length(trim(current_text)) BETWEEN 1 AND 4000 AND instr(current_text, char(0)) = 0),
          source_category TEXT NOT NULL CHECK (source_category = 'user_explicit_input'),
          status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0)
        ) STRICT;
        CREATE TABLE memory_revisions (
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision > 0),
          content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 4000 AND instr(content, char(0)) = 0),
          source_category TEXT NOT NULL CHECK (source_category = 'user_explicit_input'),
          status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
          change_type TEXT NOT NULL CHECK (change_type IN ('created', 'corrected', 'retracted', 'restored')),
          created_at TEXT NOT NULL,
          previous_revision INTEGER,
          PRIMARY KEY (memory_id, revision),
          FOREIGN KEY (memory_id, previous_revision)
            REFERENCES memory_revisions(memory_id, revision) ON DELETE CASCADE
        ) STRICT;
        INSERT INTO memories (id, original_text, current_text, source_category, status, created_at, updated_at, revision)
        SELECT id, content, content, 'user_explicit_input', status, created_at, updated_at, 1
        FROM memories_v1;
        INSERT INTO memory_revisions (memory_id, revision, content, source_category, status, change_type, created_at, previous_revision)
        SELECT id, 1, content, 'user_explicit_input', status, 'created', created_at, NULL
        FROM memories_v1;
        DROP TABLE memories_v1;
        CREATE INDEX memories_status_created_idx ON memories(status, created_at DESC, id);
        CREATE INDEX memory_revisions_created_idx ON memory_revisions(memory_id, revision DESC);
      `)
    }
  },
  {
    version: 3,
    name: 'bounded-goal-authorization-and-audit',
    up(database) {
      database.exec(`
        CREATE TABLE goals (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          intent TEXT NOT NULL CHECK (length(trim(intent)) BETWEEN 1 AND 800 AND instr(intent, char(0)) = 0),
          success_criterion TEXT NOT NULL CHECK (success_criterion = 'active_memory_count_matches_database'),
          constraints_text TEXT NOT NULL CHECK (length(trim(constraints_text)) BETWEEN 0 AND 2000 AND instr(constraints_text, char(0)) = 0),
          source_category TEXT NOT NULL CHECK (source_category = 'user_explicit_input'),
          status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE goal_tasks (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('queued', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'verification_failed', 'outcome_unknown')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (id, goal_id)
        ) STRICT;
        CREATE INDEX goal_tasks_goal_created_idx ON goal_tasks(goal_id, created_at DESC);
        CREATE INDEX goal_tasks_status_idx ON goal_tasks(status, created_at);
        CREATE TABLE goal_actions (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          task_id TEXT NOT NULL UNIQUE REFERENCES goal_tasks(id) ON DELETE CASCADE,
          tool_id TEXT NOT NULL CHECK (tool_id = 'memory.count_active'),
          tool_version TEXT NOT NULL CHECK (tool_version = '1'),
          parameters_json TEXT NOT NULL CHECK (parameters_json = '{}'),
          parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
          resource_scope TEXT NOT NULL CHECK (resource_scope = 'memory.active_count'),
          risk TEXT NOT NULL CHECK (risk = 'read-only'),
          status TEXT NOT NULL CHECK (status IN ('queued', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'verification_failed', 'outcome_unknown')),
          planned_at TEXT NOT NULL,
          approval_expires_at TEXT,
          started_at TEXT,
          completed_at TEXT,
          idempotency_key TEXT NOT NULL UNIQUE,
          result_count INTEGER CHECK (result_count IS NULL OR result_count >= 0),
          verified_count INTEGER CHECK (verified_count IS NULL OR verified_count >= 0),
          verification_status TEXT NOT NULL CHECK (verification_status IN ('not_run', 'matched', 'mismatch')),
          verification_at TEXT
        ) STRICT;
        CREATE TABLE goal_approvals (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          task_id TEXT NOT NULL UNIQUE REFERENCES goal_tasks(id) ON DELETE CASCADE,
          action_id TEXT NOT NULL UNIQUE REFERENCES goal_actions(id) ON DELETE CASCADE,
          tool_id TEXT NOT NULL CHECK (tool_id = 'memory.count_active'),
          tool_version TEXT NOT NULL CHECK (tool_version = '1'),
          parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
          resource_scope TEXT NOT NULL CHECK (resource_scope = 'memory.active_count'),
          risk TEXT NOT NULL CHECK (risk = 'read-only'),
          expires_at TEXT NOT NULL,
          approved_at TEXT NOT NULL,
          consumed_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE goal_audit (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          task_id TEXT REFERENCES goal_tasks(id) ON DELETE CASCADE,
          action_id TEXT REFERENCES goal_actions(id) ON DELETE CASCADE,
          event TEXT NOT NULL CHECK (event IN ('unknown_outcome_acknowledged', 'goal_created', 'goal_stopped', 'task_queued', 'approval_requested', 'approval_consumed', 'approval_rejected', 'approval_expired', 'task_cancelled', 'action_started', 'action_succeeded', 'action_failed', 'verification_failed', 'outcome_unknown')),
          reason TEXT NOT NULL CHECK (reason IN ('user_acknowledged_unknown', 'policy_denied', 'user_created', 'user_prepared', 'user_requested_approval', 'user_approved', 'user_rejected', 'approval_expired', 'user_cancelled', 'user_stopped_goal', 'timeout', 'tool_error', 'verification_mismatch', 'crash_recovery')),
          status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled', 'queued', 'awaiting_approval', 'running', 'succeeded', 'failed', 'verification_failed', 'outcome_unknown')),
          happened_at TEXT NOT NULL,
          result_count INTEGER CHECK (result_count IS NULL OR result_count >= 0),
          verified_count INTEGER CHECK (verified_count IS NULL OR verified_count >= 0)
        ) STRICT;
        CREATE INDEX goal_audit_goal_seq_idx ON goal_audit(goal_id, seq);
      `)
    }
  },
  {
    version: 4,
    name: 'consented-local-goal-reminders',
    up(database) {
      database.exec(`
        CREATE TABLE reminder_settings (
          id TEXT PRIMARY KEY NOT NULL CHECK (id = 'primary'),
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          goal_review_enabled INTEGER NOT NULL CHECK (goal_review_enabled IN (0, 1)),
          consent_status TEXT NOT NULL CHECK (consent_status IN ('never', 'active', 'withdrawn')),
          consent_version TEXT,
          consented_at TEXT,
          revoked_at TEXT,
          max_per_24_hours INTEGER NOT NULL CHECK (max_per_24_hours BETWEEN 1 AND 3),
          cooldown_minutes INTEGER NOT NULL CHECK (cooldown_minutes BETWEEN 30 AND 1440),
          quiet_hours_enabled INTEGER NOT NULL CHECK (quiet_hours_enabled IN (0, 1)),
          quiet_hours_start TEXT NOT NULL CHECK (
            quiet_hours_start GLOB '[01][0-9]:[0-5][0-9]' OR quiet_hours_start GLOB '2[0-3]:[0-5][0-9]'
          ),
          quiet_hours_end TEXT NOT NULL CHECK (
            quiet_hours_end GLOB '[01][0-9]:[0-5][0-9]' OR quiet_hours_end GLOB '2[0-3]:[0-5][0-9]'
          ),
          time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 80),
          muted_until TEXT,
          updated_at TEXT NOT NULL,
          CHECK ((enabled = 0) OR (consent_status = 'active' AND consent_version IS NOT NULL AND consented_at IS NOT NULL)),
          CHECK ((consent_status != 'never') OR (consent_version IS NULL AND consented_at IS NULL)),
          CHECK ((consent_status != 'active') OR (consent_version IS NOT NULL AND consented_at IS NOT NULL)),
          CHECK ((consent_status != 'withdrawn') OR revoked_at IS NOT NULL)
        ) STRICT;
        CREATE TABLE reminders (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind = 'goal_review'),
          status TEXT NOT NULL CHECK (status IN ('scheduled', 'showing', 'shown', 'suppressed', 'cancelled')),
          scheduled_at TEXT NOT NULL,
          scheduled_time_zone TEXT NOT NULL CHECK (length(scheduled_time_zone) BETWEEN 1 AND 80),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          shown_at TEXT,
          last_decision TEXT NOT NULL CHECK (last_decision IN ('scheduled', 'rescheduled', 'displaying', 'triggered', 'suppressed', 'cancelled')),
          last_reason TEXT NOT NULL CHECK (last_reason IN ('user_scheduled', 'user_rescheduled', 'triggered_on_time', 'triggered_after_restart', 'feature_disabled', 'consent_withdrawn', 'paused', 'type_disabled', 'invalid_state', 'goal_inactive', 'goal_deleted', 'quiet_hours', 'daily_limit', 'cooldown', 'muted', 'overdue', 'notification_unsupported', 'notification_failed', 'user_cancelled', 'history_cleared')),
          CHECK ((status = 'shown') = (shown_at IS NOT NULL))
        ) STRICT;
        CREATE INDEX reminders_due_idx ON reminders(status, scheduled_at, id);
        CREATE INDEX reminders_goal_idx ON reminders(goal_id, created_at DESC);
        CREATE TABLE reminder_decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
          happened_at TEXT NOT NULL,
          rule_version TEXT NOT NULL CHECK (length(rule_version) BETWEEN 1 AND 40),
          decision TEXT NOT NULL CHECK (decision IN ('scheduled', 'rescheduled', 'displaying', 'triggered', 'suppressed', 'cancelled')),
          reason TEXT NOT NULL CHECK (reason IN ('user_scheduled', 'user_rescheduled', 'triggered_on_time', 'triggered_after_restart', 'feature_disabled', 'consent_withdrawn', 'paused', 'type_disabled', 'invalid_state', 'goal_inactive', 'goal_deleted', 'quiet_hours', 'daily_limit', 'cooldown', 'muted', 'overdue', 'notification_unsupported', 'notification_failed', 'user_cancelled', 'history_cleared'))
        ) STRICT;
        CREATE INDEX reminder_decisions_recent_idx ON reminder_decisions(happened_at DESC, id DESC);
      `)
    }
  },
  {
    version: 5,
    name: 'local-conversations-and-memory-sensitivity',
    up(database) {
      database.exec(`
        ALTER TABLE memories ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'personal'
          CHECK (sensitivity IN ('normal', 'personal', 'sensitive'));
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120 AND instr(title, char(0)) = 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX conversations_updated_idx ON conversations(updated_at DESC, id);
        CREATE TABLE messages (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000 AND instr(body, char(0)) = 0),
          created_at TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence > 0),
          turn_id TEXT NOT NULL CHECK (length(turn_id) = 36),
          UNIQUE (conversation_id, sequence),
          UNIQUE (conversation_id, turn_id, role),
          UNIQUE (id, conversation_id)
        ) STRICT;
        CREATE INDEX messages_conversation_sequence_idx ON messages(conversation_id, sequence);
      `)
    }
  },
  {
    version: 6,
    name: 'deepseek-provider-and-versioned-personality',
    up(database) {
      database.exec(`
        CREATE TABLE provider_profiles (
          id TEXT PRIMARY KEY NOT NULL CHECK (id = 'deepseek'),
          provider_class TEXT NOT NULL CHECK (provider_class = 'remote'),
          endpoint TEXT NOT NULL CHECK (endpoint = 'https://api.deepseek.com'),
          model TEXT NOT NULL CHECK (model = 'deepseek-flash'),
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE personality_profiles (
          id TEXT PRIMARY KEY NOT NULL CHECK (id = 'primary'),
          version INTEGER NOT NULL CHECK (version > 0),
          warmth INTEGER NOT NULL CHECK (warmth BETWEEN 0 AND 100),
          directness INTEGER NOT NULL CHECK (directness BETWEEN 0 AND 100),
          humor INTEGER NOT NULL CHECK (humor BETWEEN 0 AND 100),
          disagreement_style TEXT NOT NULL CHECK (disagreement_style IN ('gentle', 'balanced', 'direct')),
          system_rules TEXT NOT NULL CHECK (length(system_rules) <= 1500 AND instr(system_rules, char(0)) = 0),
          updated_at TEXT NOT NULL
        ) STRICT;
      `)
    }
  },
  {
    version: 7,
    name: 'reviewable-memory-proposals',
    up(database) {
      database.exec(`
        CREATE TABLE memory_suggestions (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          conversation_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL,
          claim TEXT NOT NULL CHECK (length(trim(claim)) BETWEEN 1 AND 1000 AND instr(claim, char(0)) = 0),
          sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'personal', 'sensitive')),
          status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
          provider_model TEXT NOT NULL CHECK (provider_model = 'deepseek-flash'),
          evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
          created_at TEXT NOT NULL,
          reviewed_at TEXT,
          accepted_memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
          accepted_content TEXT CHECK (accepted_content IS NULL OR length(trim(accepted_content)) BETWEEN 1 AND 4000),
          FOREIGN KEY (source_message_id, conversation_id)
            REFERENCES messages(id, conversation_id) ON DELETE CASCADE,
          CHECK ((status = 'pending') = (reviewed_at IS NULL)),
          CHECK ((status = 'accepted') = (accepted_memory_id IS NOT NULL)),
          CHECK ((status = 'accepted') = (accepted_content IS NOT NULL))
        ) STRICT;
        CREATE INDEX memory_suggestions_conversation_created_idx ON memory_suggestions(conversation_id, created_at DESC);
        CREATE INDEX memory_suggestions_source_idx ON memory_suggestions(source_message_id, created_at);
        CREATE INDEX memory_suggestions_status_idx ON memory_suggestions(status, created_at DESC);
        CREATE UNIQUE INDEX memory_suggestions_source_claim_uq ON memory_suggestions(source_message_id, lower(claim));
      `)
    }
  },
  {
    version: 8,
    name: 'inspectable-personality-history',
    up(database) {
      database.exec(`
        CREATE TABLE personality_revisions (
          version INTEGER PRIMARY KEY NOT NULL CHECK (version > 0),
          warmth INTEGER NOT NULL CHECK (warmth BETWEEN 0 AND 100),
          directness INTEGER NOT NULL CHECK (directness BETWEEN 0 AND 100),
          humor INTEGER NOT NULL CHECK (humor BETWEEN 0 AND 100),
          disagreement_style TEXT NOT NULL CHECK (disagreement_style IN ('gentle', 'balanced', 'direct')),
          system_rules TEXT NOT NULL CHECK (length(system_rules) <= 1500 AND instr(system_rules, char(0)) = 0),
          created_at TEXT NOT NULL,
          change_type TEXT NOT NULL CHECK (change_type IN ('user_edit', 'restored'))
        ) STRICT;
      `)
    }
  },
  {
    version: 9,
    name: 'versioned-cognitive-turn-observations',
    up(database) {
      database.exec(`
        CREATE TABLE cognitive_turn_observations (
          conversation_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL,
          attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 1000000),
          analyzed_at TEXT NOT NULL CHECK (length(analyzed_at) BETWEEN 20 AND 40),
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          analyzer_version TEXT NOT NULL CHECK (length(analyzer_version) BETWEEN 1 AND 40),
          analysis_json TEXT NOT NULL CHECK (length(analysis_json) <= 50000 AND json_valid(analysis_json)),
          PRIMARY KEY (source_message_id, attempt),
          FOREIGN KEY (source_message_id, conversation_id)
            REFERENCES messages(id, conversation_id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX cognitive_turn_observations_conversation_idx
          ON cognitive_turn_observations(conversation_id, source_message_id, attempt);
        CREATE TABLE cognitive_core_settings (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40)
        ) STRICT;
      `)
    }
  },
  {
    version: 10,
    name: 'evidence-traceable-feeling-state',
    up(database) {
      database.exec(`
        CREATE TABLE cognitive_feeling_state (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          algorithm_version TEXT NOT NULL CHECK (algorithm_version = 'evidence-weighted-rules-v1'),
          state_json TEXT NOT NULL CHECK (length(state_json) <= 12000 AND json_valid(state_json)),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
          updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40)
        ) STRICT;
        INSERT INTO cognitive_feeling_state(id, schema_version, algorithm_version, state_json, revision, dirty, updated_at)
        VALUES (
          1,
          1,
          'evidence-weighted-rules-v1',
          json_object(
            'stateId', 'morrow-interaction-state',
            'schemaVersion', 1,
            'engineVersion', 'evidence-weighted-rules-v1',
            'scope', 'short_term_cross_conversation_interaction',
            'values', json_object('valence', 0, 'activation', 0, 'tension', 0),
            'attention', json_object('explorationPriority', 0, 'sourceEventId', NULL, 'updatedAt', NULL, 'evidenceRefs', json('[]')),
            'revision', 0,
            'evaluatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            'updatedAt', NULL,
            'sourceEventId', NULL,
            'evidenceRefs', json('[]'),
            'confidenceScore', NULL,
            'uncertainty', 'not_scored',
            'lastEventType', NULL
          ),
          0,
          0,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
        CREATE TABLE cognitive_feeling_events (
          event_id TEXT PRIMARY KEY NOT NULL,
          sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
          conversation_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL,
          related_assistant_message_id TEXT,
          result_message_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          occurred_at TEXT NOT NULL CHECK (length(occurred_at) BETWEEN 20 AND 40),
          processed_at TEXT NOT NULL CHECK (length(processed_at) BETWEEN 20 AND 40),
          event_type TEXT NOT NULL CHECK (event_type IN ('positive_feedback', 'negative_feedback', 'system_correction', 'exploration_request', 'user_context', 'preference_change')),
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          algorithm_version TEXT NOT NULL CHECK (algorithm_version = 'evidence-weighted-rules-v1'),
          event_json TEXT NOT NULL CHECK (length(event_json) <= 12000 AND json_valid(event_json)),
          FOREIGN KEY (source_message_id, conversation_id) REFERENCES messages(id, conversation_id) ON DELETE CASCADE,
          FOREIGN KEY (related_assistant_message_id, conversation_id) REFERENCES messages(id, conversation_id) ON DELETE CASCADE,
          FOREIGN KEY (result_message_id, conversation_id) REFERENCES messages(id, conversation_id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX cognitive_feeling_events_processed_idx ON cognitive_feeling_events(processed_at, event_id);
        CREATE INDEX cognitive_feeling_events_conversation_idx ON cognitive_feeling_events(conversation_id, processed_at);
        CREATE TABLE cognitive_feeling_revisions (
          revision INTEGER PRIMARY KEY NOT NULL CHECK (revision > 0),
          event_id TEXT NOT NULL UNIQUE REFERENCES cognitive_feeling_events(event_id) ON DELETE CASCADE,
          processed_at TEXT NOT NULL CHECK (length(processed_at) BETWEEN 20 AND 40),
          before_json TEXT NOT NULL CHECK (length(before_json) <= 12000 AND json_valid(before_json)),
          after_json TEXT NOT NULL CHECK (length(after_json) <= 12000 AND json_valid(after_json))
        ) STRICT;
        CREATE TRIGGER cognitive_feeling_insert_marks_dirty AFTER INSERT ON cognitive_feeling_events
        BEGIN UPDATE cognitive_feeling_state SET dirty = 1 WHERE id = 1; END;
        CREATE TRIGGER cognitive_feeling_update_marks_dirty AFTER UPDATE ON cognitive_feeling_events
        BEGIN UPDATE cognitive_feeling_state SET dirty = 1 WHERE id = 1; END;
        CREATE TRIGGER cognitive_feeling_delete_marks_dirty AFTER DELETE ON cognitive_feeling_events
        BEGIN UPDATE cognitive_feeling_state SET dirty = 1 WHERE id = 1; END;
      `)
    }
  },
  {
    version: 11,
    name: 'deletion-boundary-journal',
    up(database) {
      database.exec(`
        CREATE TABLE deletion_journal (
          entity TEXT NOT NULL CHECK (entity IN ('memory', 'conversation')),
          entity_id TEXT NOT NULL CHECK (length(entity_id) = 36),
          state TEXT NOT NULL CHECK (state IN ('deleted', 'retracted', 'unretracted')),
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (entity, entity_id)
        ) STRICT;
      `)
    }
  },
  {
    version: 12,
    name: 'unified-event-log',
    up(database) {
      database.exec(`
        CREATE TABLE event_journal (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          schema_version INTEGER NOT NULL,
          occurred_at TEXT NOT NULL,
          source_module TEXT NOT NULL,
          event_type TEXT NOT NULL,
          actor TEXT NOT NULL,
          subject_type TEXT NOT NULL,
          subject_id TEXT,
          correlation_id TEXT,
          payload_json TEXT NOT NULL
        ) STRICT;
        CREATE INDEX idx_event_journal_occurred ON event_journal(occurred_at);
        CREATE INDEX idx_event_journal_subject ON event_journal(subject_type, subject_id);
        CREATE INDEX idx_event_journal_correlation ON event_journal(correlation_id);
      `)
    }
  },
  {
    version: 13,
    name: 'local-openai-provider-profile',
    up(database) {
      // SQLite cannot alter a CHECK constraint, so the table is rebuilt. The
      // DeepSeek row stays pinned to the audited endpoint/model; the local
      // row is free to carry a user endpoint and model name, but its class
      // must stay 'local' so the loopback egress gate applies at dispatch.
      database.exec(`
        CREATE TABLE provider_profiles_v13 (
          id TEXT PRIMARY KEY NOT NULL CHECK (id IN ('deepseek', 'local-openai')),
          provider_class TEXT NOT NULL CHECK (provider_class IN ('remote', 'local')),
          endpoint TEXT NOT NULL CHECK (
            (id = 'deepseek' AND endpoint = 'https://api.deepseek.com')
            OR (id = 'local-openai' AND length(endpoint) BETWEEN 8 AND 2000)
          ),
          model TEXT NOT NULL CHECK (
            (id = 'deepseek' AND model = 'deepseek-flash')
            OR (id = 'local-openai' AND length(model) BETWEEN 1 AND 64)
          ),
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO provider_profiles_v13(id, provider_class, endpoint, model, enabled, updated_at)
          SELECT id, provider_class, endpoint, model, enabled, updated_at FROM provider_profiles;
        DROP TABLE provider_profiles;
        ALTER TABLE provider_profiles_v13 RENAME TO provider_profiles;
      `)
    }
  },
  {
    version: 14,
    name: 'memory-sources-confidence-confirmation',
    up(database) {
      // Provenance upgrade: memories gained by model inference and confirmed
      // by the user are distinguishable from directly typed ones; every
      // record carries a confidence (1-100) and a last-confirmed timestamp
      // so retrieval can downrank stale, weakly-supported entries.
      database.exec(`
        ALTER TABLE memories RENAME TO memories_v13;
        DROP INDEX IF EXISTS memories_status_created_idx;
        CREATE TABLE memories (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          original_text TEXT NOT NULL CHECK (length(trim(original_text)) BETWEEN 1 AND 4000 AND instr(original_text, char(0)) = 0),
          current_text TEXT NOT NULL CHECK (length(trim(current_text)) BETWEEN 1 AND 4000 AND instr(current_text, char(0)) = 0),
          source_category TEXT NOT NULL CHECK (source_category IN ('user_explicit_input', 'model_inferred_confirmed', 'turn_derived_confirmed')),
          status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
          created_at TEXT NOT NULL,
          sensitivity TEXT NOT NULL DEFAULT 'personal' CHECK (sensitivity IN ('normal', 'personal', 'sensitive')),
          updated_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          confidence INTEGER NOT NULL DEFAULT 80 CHECK (confidence BETWEEN 1 AND 100),
          last_confirmed_at TEXT
        ) STRICT;
        INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, sensitivity, updated_at, revision, confidence, last_confirmed_at)
          SELECT id, original_text, current_text, source_category, status, created_at, sensitivity, updated_at, revision, 80, NULL FROM memories_v13;
        CREATE INDEX memories_status_created_idx ON memories(status, created_at DESC, id);
        ALTER TABLE memory_revisions RENAME TO memory_revisions_v13;
        DROP INDEX IF EXISTS memory_revisions_created_idx;
        CREATE TABLE memory_revisions (
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision > 0),
          content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 4000 AND instr(content, char(0)) = 0),
          source_category TEXT NOT NULL CHECK (source_category IN ('user_explicit_input', 'model_inferred_confirmed', 'turn_derived_confirmed')),
          status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
          change_type TEXT NOT NULL CHECK (change_type IN ('created', 'corrected', 'retracted', 'restored', 'confirmed')),
          created_at TEXT NOT NULL,
          previous_revision INTEGER,
          confidence INTEGER NOT NULL DEFAULT 80 CHECK (confidence BETWEEN 1 AND 100),
          PRIMARY KEY (memory_id, revision),
          FOREIGN KEY (memory_id, previous_revision)
            REFERENCES memory_revisions(memory_id, revision) ON DELETE CASCADE
        ) STRICT;
        INSERT INTO memory_revisions(memory_id, revision, content, source_category, status, change_type, created_at, previous_revision, confidence)
          SELECT memory_id, revision, content, source_category, status, change_type, created_at, previous_revision, 80 FROM memory_revisions_v13;
        CREATE INDEX memory_revisions_created_idx ON memory_revisions(memory_id, revision DESC);
        DROP TABLE memory_revisions_v13;
        DROP TABLE memories_v13;
        -- memory_suggestions carries an FK to memories; the earlier RENAME
        -- rewrote that reference to memories_v13, so the table is rebuilt
        -- against the new memories table with identical constraints.
        ALTER TABLE memory_suggestions RENAME TO memory_suggestions_v13;
        DROP INDEX IF EXISTS memory_suggestions_conversation_created_idx;
        DROP INDEX IF EXISTS memory_suggestions_source_idx;
        DROP INDEX IF EXISTS memory_suggestions_status_idx;
        DROP INDEX IF EXISTS memory_suggestions_source_claim_uq;
        CREATE TABLE memory_suggestions (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          conversation_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL,
          claim TEXT NOT NULL CHECK (length(trim(claim)) BETWEEN 1 AND 1000 AND instr(claim, char(0)) = 0),
          sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'personal', 'sensitive')),
          status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
          provider_model TEXT NOT NULL,
          evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
          created_at TEXT NOT NULL,
          reviewed_at TEXT,
          accepted_memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
          accepted_content TEXT CHECK (accepted_content IS NULL OR length(trim(accepted_content)) BETWEEN 1 AND 4000),
          FOREIGN KEY (source_message_id, conversation_id)
            REFERENCES messages(id, conversation_id) ON DELETE CASCADE,
          CHECK ((status = 'pending') = (reviewed_at IS NULL)),
          CHECK ((status = 'accepted') = (accepted_memory_id IS NOT NULL)),
          CHECK ((status = 'accepted') = (accepted_content IS NOT NULL))
        ) STRICT;
        INSERT INTO memory_suggestions(id, conversation_id, source_message_id, claim, sensitivity, status, provider_model, evidence_hash, created_at, reviewed_at, accepted_memory_id, accepted_content)
          SELECT id, conversation_id, source_message_id, claim, sensitivity, status, provider_model, evidence_hash, created_at, reviewed_at, accepted_memory_id, accepted_content FROM memory_suggestions_v13;
        CREATE INDEX memory_suggestions_conversation_created_idx ON memory_suggestions(conversation_id, created_at DESC);
        CREATE INDEX memory_suggestions_source_idx ON memory_suggestions(source_message_id, created_at);
        CREATE INDEX memory_suggestions_status_idx ON memory_suggestions(status, created_at DESC);
        CREATE UNIQUE INDEX memory_suggestions_source_claim_uq ON memory_suggestions(source_message_id, lower(claim));
        DROP TABLE memory_suggestions_v13;
      `)
    }
  },
  {
    version: 15,
    name: 'interests-self-model-reflection',
    up(database) {
      database.exec(`
        CREATE TABLE interests (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 64 AND instr(label, char(0)) = 0),
          status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'archived', 'dropped')),
          evidence_count INTEGER NOT NULL CHECK (evidence_count > 0),
          conversation_count INTEGER NOT NULL CHECK (conversation_count > 0),
          strength REAL NOT NULL CHECK (strength >= 0 AND strength <= 1),
          confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 100),
          source_message_id TEXT NOT NULL CHECK (length(source_message_id) = 36),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) = 36),
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          terms_json TEXT NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX interests_label_uq ON interests(lower(label));

        CREATE TABLE self_model_entries (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          kind TEXT NOT NULL CHECK (kind IN ('fact', 'inference', 'unknown', 'correction')),
          statement TEXT NOT NULL CHECK (length(trim(statement)) BETWEEN 1 AND 4000 AND instr(statement, char(0)) = 0),
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'retracted')),
          confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 100),
          source_message_id TEXT CHECK (source_message_id IS NULL OR length(source_message_id) = 36),
          conversation_id TEXT CHECK (conversation_id IS NULL OR length(conversation_id) = 36),
          superseded_by TEXT REFERENCES self_model_entries(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX self_model_status_idx ON self_model_entries(status, updated_at DESC);

        CREATE TABLE reflection_runs (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'startup', 'post_conversation')),
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          examined_turns INTEGER NOT NULL CHECK (examined_turns >= 0),
          examined_events INTEGER NOT NULL CHECK (examined_events >= 0),
          findings_count INTEGER NOT NULL CHECK (findings_count >= 0),
          status TEXT NOT NULL CHECK (status IN ('completed', 'failed'))
        ) STRICT;

        CREATE TABLE reflection_findings (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          run_id TEXT NOT NULL REFERENCES reflection_runs(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('memory_gap', 'open_question', 'bias_hint', 'interest_candidate', 'consistency_note')),
          statement TEXT NOT NULL CHECK (length(trim(statement)) BETWEEN 1 AND 1000 AND instr(statement, char(0)) = 0),
          confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 100),
          evidence_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX reflection_findings_run_idx ON reflection_findings(run_id, created_at);
      `)
    }
  },
  {
    version: 16,
    name: 'spark-provider-profile',
    up(database) {
      // A second remote provider has to be persisted. The v13 table pinned the
      // id to deepseek/local-openai and its endpoint/model per id, so the table
      // is rebuilt with `spark` allowed and its endpoint pinned to the verified
      // MaaS base URL. The model id stays free-form (shape-checked in code)
      // because the account decides which ids exist.
      database.exec(`
        CREATE TABLE provider_profiles_v16 (
          id TEXT PRIMARY KEY NOT NULL CHECK (id IN ('deepseek', 'local-openai', 'spark')),
          provider_class TEXT NOT NULL CHECK (provider_class IN ('remote', 'local')),
          endpoint TEXT NOT NULL CHECK (
            (id = 'deepseek' AND endpoint = 'https://api.deepseek.com')
            OR (id = 'spark' AND endpoint = 'https://maas-api.cn-huabei-1.xf-yun.com/v1')
            OR (id = 'local-openai' AND length(endpoint) BETWEEN 8 AND 2000)
          ),
          model TEXT NOT NULL CHECK (
            (id = 'deepseek' AND model = 'deepseek-flash')
            OR (id IN ('spark', 'local-openai') AND length(model) BETWEEN 1 AND 64)
          ),
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO provider_profiles_v16(id, provider_class, endpoint, model, enabled, updated_at)
          SELECT id, provider_class, endpoint, model, enabled, updated_at FROM provider_profiles;
        DROP TABLE provider_profiles;
        ALTER TABLE provider_profiles_v16 RENAME TO provider_profiles;
      `)
    }
  },
  {
    version: 17,
    name: 'cognitive-turn-context-and-pending-items',
    up(database) {
      // Two things Phase 2.4 needs to persist, both keyed so that a retried
      // turn can never write a second row:
      //
      //   * the turn context answers "which memories, which personality and
      //     which internal state produced this answer" after the process is
      //     gone, so it is keyed by the turn id itself;
      //   * pending items are the minimal form of internal activity: one row
      //     per distinct concern, deduplicated by a derived key rather than by
      //     scanning text at read time.
      database.exec(`
        CREATE TABLE cognitive_turn_contexts (
          turn_id TEXT PRIMARY KEY NOT NULL CHECK (length(turn_id) = 36),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) = 36),
          status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
          recorded_at TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (length(payload_json) <= 20000)
        ) STRICT;
        CREATE INDEX cognitive_turn_contexts_conversation_idx
          ON cognitive_turn_contexts(conversation_id, recorded_at DESC);

        CREATE TABLE cognitive_pending_items (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 300 AND instr(dedupe_key, char(0)) = 0),
          source TEXT NOT NULL CHECK (source IN ('conflict', 'evidence_gap', 'open_question', 'reflection', 'interest')),
          kind TEXT NOT NULL CHECK (length(trim(kind)) BETWEEN 1 AND 64),
          summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 500 AND instr(summary, char(0)) = 0),
          priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
          status TEXT NOT NULL CHECK (status IN ('open', 'done', 'dropped')),
          conversation_id TEXT CHECK (conversation_id IS NULL OR length(conversation_id) = 36),
          detail_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        ) STRICT;
        CREATE UNIQUE INDEX cognitive_pending_items_dedupe_uq ON cognitive_pending_items(dedupe_key);
        CREATE INDEX cognitive_pending_items_status_idx
          ON cognitive_pending_items(status, priority DESC, created_at);
      `)
    }
  },
  {
    version: 18,
    name: 'reflection-summary-privacy-and-turn-finalization',
    up(database) {
      // (1) Privacy rewrite for rows written before the fix.
      //
      // `pendingItemFromReflection` used to copy the reflection statement into
      // `summary`, and a statement can quote a saved memory or a self-model
      // entry. New rows are content-free by construction; existing rows are
      // rewritten here to the same category templates.
      //
      // This is a rewrite, not a delete: the row, its id, its dedupe key, its
      // priority, its status and its timestamps are preserved, so nothing the
      // user has to act on disappears. The database upgrade path already takes
      // a validated `VACUUM INTO` backup before any migration runs, so the
      // previous text remains recoverable from that file.
      database.exec(`
        UPDATE cognitive_pending_items
        SET summary = CASE kind
              WHEN 'memory_gap' THEN '反思发现记忆记录存在缺口，需要与用户核对后再引用相关内容。'
              WHEN 'bias_hint' THEN '反思发现近期交互被多次纠正，回答应更谨慎地承认不确定性。'
              WHEN 'consistency_note' THEN '反思发现存在尚未确认的自我判断，等待用户澄清。'
              WHEN 'interest_candidate' THEN '反思发现一个候选兴趣话题，等待更多独立证据后再确认。'
              WHEN 'open_question' THEN '反思留下一个未解决的问题，等待后续对话澄清。'
              ELSE '反思产生了一条待核实的内部事项。'
            END,
            detail_json = CASE
              WHEN json_valid(detail_json) THEN json_object(
                'runId', json_extract(detail_json, '$.runId'),
                'statementDigest', json_extract(detail_json, '$.statementDigest'),
                'summaryPolicy', 'category_template_v1'
              )
              ELSE json_object('summaryPolicy', 'category_template_v1')
            END
        WHERE source = 'reflection';

        -- (2) Finalization intent, so an interrupted turn can be completed
        -- from persisted evidence instead of guessed.
        CREATE TABLE cognitive_turn_finalizations (
          turn_id TEXT PRIMARY KEY NOT NULL CHECK (length(turn_id) = 36),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) = 36),
          user_message_id TEXT NOT NULL CHECK (length(user_message_id) = 36),
          assistant_message_id TEXT NOT NULL CHECK (length(assistant_message_id) = 36),
          payload_json TEXT NOT NULL CHECK (length(payload_json) <= 40000),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX cognitive_turn_finalizations_created_idx
          ON cognitive_turn_finalizations(created_at);
      `)
    }
  },
  {
    version: 19,
    name: 'delete-derived-cognition-with-source-data',
    up(database) {
      // Derived companion state must not outlive the conversation/message that
      // supplied its evidence. Keep this in the database so every deletion path
      // (UI, service, restore/maintenance) receives the same privacy guarantee.
      database.exec(`
        CREATE TRIGGER self_model_entries_delete_with_source_message
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM self_model_entries WHERE source_message_id = OLD.id;
          DELETE FROM interests WHERE source_message_id = OLD.id;
        END;

        CREATE TRIGGER cognitive_turn_contexts_delete_with_conversation
        AFTER DELETE ON conversations
        BEGIN
          DELETE FROM cognitive_turn_contexts WHERE conversation_id = OLD.id;
          DELETE FROM cognitive_pending_items WHERE conversation_id = OLD.id;
          DELETE FROM cognitive_turn_finalizations WHERE conversation_id = OLD.id;
        END;
      `)
    }
  },
  {
    version: 20,
    name: 'self-model-statements-stop-copying-messages',
    up(database) {
      // Rows written before this migration stored `message.body` verbatim. The
      // statement is replaced by a non-semantic marker and the row is retracted,
      // so it stops reaching the prompt while the row, its evidence reference and
      // its audit trail survive. Only literal copies of the referenced message
      // are touched: a statement that is not a copy is left exactly as it is.
      // The message itself is untouched, so the fact remains recoverable from its
      // source of truth.
      database.exec(`
        UPDATE self_model_entries
        SET statement = '历史推断已撤回：原文不再保留，来源消息见 source_message_id。',
            status = 'retracted',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE kind = 'fact'
          AND status = 'active'
          AND source_message_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM messages m
            WHERE m.id = self_model_entries.source_message_id
              AND (m.body = self_model_entries.statement
                   OR substr(m.body, 1, 2000) = self_model_entries.statement)
          );
      `)
    }
  },
  {
    version: 21,
    name: 'finalization-intent-follows-its-messages',
    up(database) {
      // `cognitive_turn_finalizations` carries message ids without foreign keys,
      // so deleting one message used to leave a finalization row naming a row
      // that no longer exists. Migration 19 only covered conversation deletion.
      // A recovery pass could then try to settle a turn from a dangling intent.
      database.exec(`
        CREATE TRIGGER cognitive_turn_finalizations_delete_with_message
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM cognitive_turn_finalizations
          WHERE user_message_id = OLD.id OR assistant_message_id = OLD.id;
        END;
      `)
    }
  },
  {
    version: 22,
    name: 'bounded-personalization-state',
    up(database) {
      // Two tables on purpose. `personalization_state` is the bounded value the
      // prompt reads; `personalization_signals` is the per-turn evidence behind
      // it, so a value can always be recomputed or withdrawn instead of being an
      // opaque number nobody can audit.
      database.exec(`
        CREATE TABLE personalization_state (
          dimension TEXT PRIMARY KEY NOT NULL CHECK (dimension IN ('exploration', 'depth', 'pace')),
          value REAL NOT NULL CHECK (value >= 0 AND value <= 1),
          evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          last_turn_id TEXT CHECK (last_turn_id IS NULL OR length(last_turn_id) = 36)
        ) STRICT;

        CREATE TABLE personalization_signals (
          dimension TEXT NOT NULL CHECK (dimension IN ('exploration', 'depth', 'pace')),
          turn_id TEXT NOT NULL CHECK (length(turn_id) = 36),
          signal REAL NOT NULL CHECK (signal >= -1 AND signal <= 1),
          weight REAL NOT NULL CHECK (weight >= 0 AND weight <= 1),
          created_at TEXT NOT NULL,
          PRIMARY KEY (dimension, turn_id)
        ) STRICT;

        CREATE INDEX personalization_signals_turn_idx ON personalization_signals(turn_id);

        CREATE TRIGGER personalization_signals_delete_with_turn_message
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM personalization_signals WHERE turn_id = OLD.turn_id;
        END;
      `)
    }
  },
  {
    version: 23,
    name: 'persistent-turn-state',
    up(database) {
      // One row per turn holding where it stopped. The turn context keeps the
      // terminal verdict; this table is the lifecycle that leads to it, so an
      // interrupted turn can be told apart from one that never started.
      database.exec(`
        CREATE TABLE turn_states (
          turn_id TEXT PRIMARY KEY NOT NULL CHECK (length(turn_id) = 36),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) = 36),
          state TEXT NOT NULL CHECK (state IN (
            'received', 'analyzed', 'context_ready', 'awaiting_consent',
            'requesting', 'response_received', 'committed',
            'failed', 'cancelled', 'recovery_required'
          )),
          updated_at TEXT NOT NULL,
          reason TEXT CHECK (reason IS NULL OR length(reason) <= 64)
        ) STRICT;

        CREATE INDEX turn_states_conversation_idx ON turn_states(conversation_id, updated_at DESC);

        CREATE TRIGGER turn_states_delete_with_conversation
        AFTER DELETE ON conversations
        BEGIN
          DELETE FROM turn_states WHERE conversation_id = OLD.id;
        END;

        CREATE TRIGGER turn_states_delete_with_turn_message
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM turn_states WHERE turn_id = OLD.turn_id;
        END;
      `)
    }
  },
  {
    version: 24,
    name: 'interest-evidence-ledger',
    up(database) {
      // The interest aggregates (`evidence_count`, `conversation_count`) were
      // write-only counters: a replayed turn could inflate them, and deleting a
      // source message left them untouched, so a retracted observation kept
      // feeding an active interest. This migration makes the individual
      // observations the source of truth and demotes the aggregates to a cache
      // that is folded back from them.
      database.exec(`
        ALTER TABLE interests ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';

        CREATE TABLE interest_evidence (
          interest_id TEXT NOT NULL CHECK (length(interest_id) = 36),
          evidence_ref TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 96),
          evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('message', 'memory', 'legacy')),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 8 AND 96),
          polarity TEXT NOT NULL CHECK (polarity IN ('support', 'counter')),
          match_score REAL NOT NULL CHECK (match_score >= 0 AND match_score <= 1),
          match_reason TEXT NOT NULL CHECK (length(match_reason) BETWEEN 1 AND 64),
          created_at TEXT NOT NULL,
          PRIMARY KEY (interest_id, evidence_ref)
        ) STRICT;

        CREATE INDEX interest_evidence_ref_idx ON interest_evidence(evidence_ref);
        CREATE INDEX interest_evidence_conversation_idx ON interest_evidence(conversation_id);

        -- One observation can only ever be attributed to one interest; this is
        -- what makes a replayed turn idempotent instead of double-counted.
        CREATE UNIQUE INDEX interest_evidence_ref_uq ON interest_evidence(evidence_ref);

        CREATE TRIGGER interest_evidence_delete_with_message
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM interest_evidence WHERE evidence_kind = 'message' AND evidence_ref = OLD.id;
        END;

        CREATE TRIGGER interest_evidence_delete_with_conversation
        AFTER DELETE ON conversations
        BEGIN
          DELETE FROM interest_evidence WHERE conversation_id = OLD.id;
        END;
      `)

      // Backfill: the old rows only kept aggregate counts, so each count becomes
      // one synthetic evidence row. They are marked 'legacy' and cannot be
      // retracted, because the schema never recorded which message produced
      // them. The first row keeps the real conversation id and the next
      // `conversation_count - 1` get a synthetic id, so folding reproduces the
      // stored counts exactly instead of demoting existing interests.
      database.exec(`
        WITH RECURSIVE seq(n) AS (
          SELECT 1
          UNION ALL
          SELECT n + 1 FROM seq WHERE n < (SELECT COALESCE(MAX(evidence_count), 0) FROM interests)
        )
        INSERT INTO interest_evidence(
          interest_id, evidence_ref, evidence_kind, conversation_id, polarity, match_score, match_reason, created_at
        )
        SELECT
          i.id,
          'legacy:' || i.id || ':' || seq.n,
          'legacy',
          CASE
            WHEN seq.n = 1 OR seq.n > i.conversation_count THEN i.conversation_id
            ELSE 'legacy-conv:' || i.id || ':' || seq.n
          END,
          'support',
          1,
          'backfilled_legacy_aggregate',
          i.updated_at
        FROM interests i
        JOIN seq ON seq.n <= i.evidence_count;
      `)
    }
  },
  {
    version: 25,
    name: 'memory-backed-interest-evidence-invalidation',
    up(database) {
      // Reflection records a saved memory as interest evidence, but migration 24
      // only cleaned evidence when a *message* or *conversation* was deleted. A
      // retracted or corrected memory therefore kept feeding an interest, and the
      // interest could stay active and reach the next prompt on evidence the user
      // had already taken back.
      //
      // The evidence row also had no revision, so a correction could not be told
      // apart from the revision that was actually observed. `evidence_revision`
      // records which revision of the memory was seen; NULL means the row predates
      // this migration (or is a legacy aggregate), and is treated as stale as soon
      // as the memory is corrected.
      database.exec(`
        ALTER TABLE interest_evidence ADD COLUMN evidence_revision INTEGER
          CHECK (evidence_revision IS NULL OR evidence_revision > 0);

        CREATE INDEX interest_evidence_memory_idx
          ON interest_evidence(evidence_kind, evidence_ref);

        -- A deleted memory takes its evidence with it, in the same statement.
        CREATE TRIGGER interest_evidence_delete_with_memory
        AFTER DELETE ON memories
        BEGIN
          DELETE FROM interest_evidence
            WHERE evidence_kind = 'memory' AND evidence_ref = OLD.id;
        END;

        -- Retracting a memory is a statement that the stored fact is no longer
        -- wanted; evidence drawn from it is no longer valid, while the row itself
        -- is kept so a restore can be observed again.
        CREATE TRIGGER interest_evidence_invalidate_on_memory_retract
        AFTER UPDATE OF status ON memories
        WHEN NEW.status <> 'active'
        BEGIN
          DELETE FROM interest_evidence
            WHERE evidence_kind = 'memory' AND evidence_ref = OLD.id;
        END;

        -- A correction replaces the wording that was observed. Only evidence from
        -- an older revision is dropped: a row recorded against the new revision
        -- stays, so a re-observation after the correction is not thrown away.
        --
        -- The text comparison matters: confirming a memory also bumps its
        -- revision, but the wording the user saw is unchanged, so the evidence is
        -- still true. Without this guard a plain "confirm" deleted valid evidence.
        CREATE TRIGGER interest_evidence_invalidate_on_memory_revision
        AFTER UPDATE OF revision ON memories
        WHEN NEW.revision > OLD.revision AND NEW.current_text <> OLD.current_text
        BEGIN
          DELETE FROM interest_evidence
            WHERE evidence_kind = 'memory'
              AND evidence_ref = OLD.id
              AND (evidence_revision IS NULL OR evidence_revision < NEW.revision);
        END;
      `)
    }
  },
  {
    version: 26,
    name: 'reflection-finding-kinds',
    up(database) {
      // The reflection schema could describe gaps, questions, bias hints, interest
      // candidates and consistency notes, but not two categories the algorithm
      // actually produces: a correction of how the assistant understood the user
      // (`intent_correction`) and a bounded suggestion for the next turn
      // (`next_turn_suggestion`). SQLite cannot alter a CHECK, so the table is
      // rebuilt; the primary key, the cascade and the index are preserved and the
      // rows are copied verbatim.
      database.exec(`
        ALTER TABLE reflection_findings RENAME TO reflection_findings_v25;
        CREATE TABLE reflection_findings (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          run_id TEXT NOT NULL REFERENCES reflection_runs(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN (
            'memory_gap', 'open_question', 'bias_hint', 'interest_candidate', 'consistency_note',
            'intent_correction', 'next_turn_suggestion'
          )),
          statement TEXT NOT NULL CHECK (length(trim(statement)) BETWEEN 1 AND 1000 AND instr(statement, char(0)) = 0),
          confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 100),
          evidence_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO reflection_findings (id, run_id, kind, statement, confidence, evidence_json, created_at)
          SELECT id, run_id, kind, statement, confidence, evidence_json, created_at FROM reflection_findings_v25;
        DROP TABLE reflection_findings_v25;
        CREATE INDEX reflection_findings_run_idx ON reflection_findings(run_id, created_at);
      `)
    }
  },
  {
    version: 27,
    name: 'reflection-finding-identity-and-personality-pending',
    up(database) {
      // Two missing pieces of the reflection pipeline:
      //
      // 1. Identity. Re-running reflection over the same evidence produced a new
      //    finding and, for interest candidates, a second evidence row. The dedupe
      //    key makes one (kind, statement, evidence set) exist once, so a re-run is
      //    idempotent instead of additive.
      //
      // 2. A parking place for personality proposals. Reflection must never move
      //    the stable baseline; a proposal is stored as *pending* with its evidence,
      //    confidence and expiry, and only a user confirmation may consume it.
      database.exec(`
        ALTER TABLE reflection_findings ADD COLUMN dedupe_key TEXT;
        CREATE UNIQUE INDEX reflection_findings_dedupe_uq
          ON reflection_findings(dedupe_key) WHERE dedupe_key IS NOT NULL;

        CREATE TABLE pending_personality_candidates (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          finding_id TEXT NOT NULL REFERENCES reflection_findings(id) ON DELETE CASCADE,
          dimension TEXT NOT NULL CHECK (dimension IN ('exploration', 'depth', 'pace')),
          direction TEXT NOT NULL CHECK (direction IN ('increase', 'decrease')),
          confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 100),
          evidence_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX pending_personality_status_idx ON pending_personality_candidates(status, created_at);
      `)
    }
  },
  {
    version: 28,
    name: 'turn-state-recovering',
    up(database) {
      // The state machine gained `recovering`, but the table's CHECK still listed
      // only the ten original states, so every write of the new state failed and
      // was swallowed by the lifecycle recorder: the trace silently stayed at
      // `recovery_required` while the code believed it had moved on. SQLite cannot
      // alter a CHECK, so the table is rebuilt and its rows copied verbatim.
      database.exec(`
        ALTER TABLE turn_states RENAME TO turn_states_v27;
        CREATE TABLE turn_states (
          turn_id TEXT PRIMARY KEY NOT NULL CHECK (length(turn_id) = 36),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) = 36),
          state TEXT NOT NULL CHECK (state IN (
            'received', 'analyzed', 'context_ready', 'awaiting_consent',
            'requesting', 'response_received', 'committed',
            'failed', 'cancelled', 'recovery_required', 'recovering'
          )),
          updated_at TEXT NOT NULL,
          reason TEXT CHECK (reason IS NULL OR length(reason) <= 64)
        ) STRICT;
        INSERT INTO turn_states (turn_id, conversation_id, state, updated_at, reason)
          SELECT turn_id, conversation_id, state, updated_at, reason FROM turn_states_v27;
        DROP TABLE turn_states_v27;
        CREATE INDEX turn_states_conversation_idx ON turn_states(conversation_id, updated_at DESC);

        -- The cascades are triggers, not foreign keys (the table has no REFERENCES
        -- clause). After the rename they were re-pointed at the temporary name but
        -- stayed attached to the conversations / messages tables, so dropping the
        -- temporary table left them behind — still deleting from a table that no
        -- longer exists. They must be dropped and recreated against the rebuilt
        -- table, otherwise deleting a conversation or a message would leave
        -- lifecycle rows behind and recovery would act on turns whose source is gone.
        DROP TRIGGER IF EXISTS turn_states_delete_with_conversation;
        DROP TRIGGER IF EXISTS turn_states_delete_with_turn_message;
        CREATE TRIGGER turn_states_delete_with_conversation
        AFTER DELETE ON conversations
        BEGIN
          DELETE FROM turn_states WHERE conversation_id = OLD.id;
        END;
        CREATE TRIGGER turn_states_delete_with_turn_message
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM turn_states WHERE turn_id = OLD.turn_id;
        END;
      `)
    }
  },
  {
    version: 29,
    name: 'bounded-personality-growth',
    up(database) {
      // Stage 3 gives the stable personality a *bounded, reversible drift* that
      // is derived from interaction evidence instead of user editing.
      //
      // Three design decisions are encoded in the schema rather than in prose:
      //
      // 1. Evidence, not state, is the source of truth. `personality_growth_signals`
      //    holds one row per (dimension, turn); the offset is always folded from
      //    those rows. Deleting a turn deletes its signals (trigger below), so a
      //    withdrawn message cannot keep steering the personality.
      // 2. The drift is capped in the database. `offset` is CHECKed to ±8 points
      //    on a 0–100 scale, so no amount of evidence can turn a bounded drift
      //    into a rewrite of the baseline the user edited.
      // 3. Every movement is auditable. `personality_growth_events` records the
      //    before/after offset and why, including rollbacks, so "why did Morrow
      //    change" is answerable without replaying the whole ledger.
      database.exec(`
        CREATE TABLE personality_growth_signals (
          dimension TEXT NOT NULL CHECK (dimension IN ('warmth', 'directness', 'humor')),
          turn_id TEXT NOT NULL CHECK (length(turn_id) = 36),
          signal REAL NOT NULL CHECK (signal BETWEEN -1 AND 1),
          weight REAL NOT NULL CHECK (weight BETWEEN 0 AND 1),
          created_at TEXT NOT NULL,
          PRIMARY KEY (dimension, turn_id)
        ) STRICT;
        CREATE INDEX personality_growth_signals_turn_idx ON personality_growth_signals(turn_id);

        CREATE TABLE personality_growth_state (
          dimension TEXT PRIMARY KEY NOT NULL CHECK (dimension IN ('warmth', 'directness', 'humor')),
          offset REAL NOT NULL CHECK (offset BETWEEN -8 AND 8),
          evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          last_turn_id TEXT
        ) STRICT;

        CREATE TABLE personality_growth_events (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          dimension TEXT NOT NULL CHECK (dimension IN ('warmth', 'directness', 'humor')),
          kind TEXT NOT NULL CHECK (kind IN ('applied', 'withheld', 'rolled_back')),
          offset_before REAL NOT NULL,
          offset_after REAL NOT NULL,
          evidence_count INTEGER NOT NULL,
          reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 200),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX personality_growth_events_dimension_idx
          ON personality_growth_events(dimension, created_at DESC);

        CREATE TRIGGER personality_growth_signals_delete_with_turn
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM personality_growth_signals WHERE turn_id = OLD.turn_id;
        END;

        -- Stage 3 autonomy ledger. It records every time Morrow was *allowed* to
        -- raise a topic of its own, so the frequency limits can be enforced from
        -- data instead of from memory. There is deliberately no column for an
        -- outbound action: this build has no channel to contact the user outside
        -- a turn, and the schema must not imply one.
        CREATE TABLE exploration_events (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          turn_id TEXT NOT NULL CHECK (length(turn_id) = 36),
          interest_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('raised', 'declined')),
          reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 120),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX exploration_events_time_idx ON exploration_events(created_at DESC);
        CREATE INDEX exploration_events_turn_idx ON exploration_events(turn_id);

        CREATE TRIGGER exploration_events_delete_with_turn
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM exploration_events WHERE turn_id = OLD.turn_id;
        END;
      `)
    }
  },
  {
    version: 30,
    name: 'interest-origin-and-exploration-lifecycle',
    up(database) {
      // Three corrections to Stage 3 part one, all of them about *whose* a
      // signal is and *when* it happened:
      //
      // 1. Interest origin. The single `interests` table mixed "topics the user
      //    kept returning to" with "topics Morrow chose to pursue". They are not
      //    the same claim, so every row now says which one it is. Existing rows
      //    were all derived from user turns, so `user` is the honest default.
      //
      // 2. Exploration lifecycle. The old `kind` column could only say "raised"
      //    or "declined", and the only thing that ever wrote it was the prompt
      //    builder — before the model had replied. That recorded permission as
      //    if it were an event. The table is rebuilt around a state machine with
      //    one row per (turn, state), so a retry cannot double count and a
      //    provider failure cannot be mistaken for a raised topic. Historical
      //    `raised` rows are re-labelled `permitted`, which is what they
      //    actually were; `declined` becomes `not_raised`.
      //
      // 3. Evidence provenance. A growth signal now names the rule that produced
      //    it, so a movement can be explained without re-running the analyser.
      database.exec(`
        ALTER TABLE interests ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'
          CHECK (origin IN ('user', 'morrow', 'shared'));

        ALTER TABLE personality_growth_signals ADD COLUMN source TEXT NOT NULL DEFAULT 'unspecified';

        -- The v29 trigger follows the renamed table and is not removed by the
        -- DROP below, so it must be dropped explicitly before the new table
        -- reuses the name.
        DROP TRIGGER IF EXISTS exploration_events_delete_with_turn;
        ALTER TABLE exploration_events RENAME TO exploration_events_v29;
        CREATE TABLE exploration_events (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          turn_id TEXT NOT NULL CHECK (length(turn_id) = 36),
          interest_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN (
            'permitted', 'selected_for_prompt', 'actually_raised',
            'not_raised', 'provider_failed', 'user_rejected'
          )),
          reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 120),
          created_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO exploration_events (id, turn_id, interest_id, state, reason, created_at)
          SELECT id, turn_id, interest_id,
                 CASE kind WHEN 'raised' THEN 'permitted' ELSE 'not_raised' END,
                 reason, created_at
          FROM exploration_events_v29;
        DROP TABLE exploration_events_v29;
        CREATE UNIQUE INDEX exploration_events_turn_state_uq ON exploration_events(turn_id, state);
        CREATE INDEX exploration_events_time_idx ON exploration_events(created_at DESC);
        CREATE INDEX exploration_events_state_idx ON exploration_events(state, created_at DESC);

        CREATE TRIGGER exploration_events_delete_with_turn
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM exploration_events WHERE turn_id = OLD.turn_id;
        END;

        -- 4. Morrow's own interests need their own evidence kind. Until now the
        --    ledger could only cite a user message, a memory or a legacy
        --    aggregate — all of them user-side. A reflection finding is a
        --    different provenance, and letting it masquerade as a message would
        --    be exactly the confusion this migration is meant to remove.
        -- Every trigger that mentions the table must be dropped before the
        -- rename: SQLite rewrites trigger bodies to the new name, and a trigger
        -- that keeps pointing at the dropped _v29 table makes unrelated
        -- statements (any UPDATE on memories) fail with "no such table".
        DROP TRIGGER IF EXISTS interest_evidence_delete_with_message;
        DROP TRIGGER IF EXISTS interest_evidence_delete_with_conversation;
        DROP TRIGGER IF EXISTS interest_evidence_delete_with_memory;
        DROP TRIGGER IF EXISTS interest_evidence_invalidate_on_memory_retract;
        DROP TRIGGER IF EXISTS interest_evidence_invalidate_on_memory_revision;
        ALTER TABLE interest_evidence RENAME TO interest_evidence_v29;
        CREATE TABLE interest_evidence (
          interest_id TEXT NOT NULL CHECK (length(interest_id) = 36),
          evidence_ref TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 96),
          evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('message', 'memory', 'legacy', 'reflection')),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 8 AND 96),
          polarity TEXT NOT NULL CHECK (polarity IN ('support', 'counter')),
          match_score REAL NOT NULL CHECK (match_score >= 0 AND match_score <= 1),
          match_reason TEXT NOT NULL CHECK (length(match_reason) BETWEEN 1 AND 64),
          created_at TEXT NOT NULL,
          evidence_revision INTEGER CHECK (evidence_revision IS NULL OR evidence_revision > 0),
          PRIMARY KEY (interest_id, evidence_ref)
        ) STRICT;
        INSERT INTO interest_evidence (interest_id, evidence_ref, evidence_kind, conversation_id, polarity, match_score, match_reason, created_at, evidence_revision)
          SELECT interest_id, evidence_ref, evidence_kind, conversation_id, polarity, match_score, match_reason, created_at, evidence_revision
          FROM interest_evidence_v29;
        DROP TABLE interest_evidence_v29;
        CREATE INDEX interest_evidence_ref_idx ON interest_evidence(evidence_ref);
        CREATE INDEX interest_evidence_conversation_idx ON interest_evidence(conversation_id);
        CREATE UNIQUE INDEX interest_evidence_ref_uq ON interest_evidence(evidence_ref);

        CREATE TRIGGER interest_evidence_delete_with_message
        AFTER DELETE ON messages
        BEGIN
          DELETE FROM interest_evidence WHERE evidence_kind = 'message' AND evidence_ref = OLD.id;
        END;

        CREATE TRIGGER interest_evidence_delete_with_conversation
        AFTER DELETE ON conversations
        BEGIN
          DELETE FROM interest_evidence WHERE conversation_id = OLD.id;
        END;

        CREATE TRIGGER interest_evidence_delete_with_memory
        AFTER DELETE ON memories
        BEGIN
          DELETE FROM interest_evidence
            WHERE evidence_kind = 'memory' AND evidence_ref = OLD.id;
        END;

        CREATE TRIGGER interest_evidence_invalidate_on_memory_retract
        AFTER UPDATE OF status ON memories
        WHEN NEW.status <> 'active'
        BEGIN
          DELETE FROM interest_evidence
            WHERE evidence_kind = 'memory' AND evidence_ref = OLD.id;
        END;

        CREATE TRIGGER interest_evidence_invalidate_on_memory_revision
        AFTER UPDATE OF revision ON memories
        WHEN NEW.revision > OLD.revision AND NEW.current_text <> OLD.current_text
        BEGIN
          DELETE FROM interest_evidence
            WHERE evidence_kind = 'memory'
              AND evidence_ref = OLD.id;
        END;
      `)
    }
  },
  {
    version: 31,
    name: 'memory-importance-and-consolidation',
    up(database) {
      // Stage 3 §2A. Three additions, none of which changes what a memory *is*:
      //
      // 1. `archived_at`. Decay must not delete. A memory that lost the ranking
      //    competition is marked, excluded from retrieval, and can be restored;
      //    its text, revisions and provenance stay untouched. The status CHECK is
      //    deliberately not widened: `retracted` means the user withdrew it,
      //    `archived` means time pushed it down. Conflating them would lose that.
      // 2. `memory_importance`. The score is a cache over evidence (provenance,
      //    explicit markers, revisions, recency); it is recomputed, never
      //    incremented, so a deletion or a correction converges on the next read.
      // 3. `memory_consolidations`. Repeated statements of the same slot/value
      //    are grouped by reference. The member ids are stored; the text is not
      //    copied, so there is exactly one source of truth per memory.
      database.exec(`
        ALTER TABLE memories ADD COLUMN archived_at TEXT;

        CREATE TABLE memory_importance (
          memory_id TEXT PRIMARY KEY NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
          components_json TEXT NOT NULL,
          version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 64),
          computed_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX memory_importance_score_idx ON memory_importance(score);

        CREATE TABLE memory_consolidations (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          slot_key TEXT NOT NULL CHECK (length(slot_key) BETWEEN 1 AND 200),
          member_ids_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX memory_consolidations_slot_uq ON memory_consolidations(slot_key);
      `)
    }
  },
  {
    version: 32,
    name: 'companion-goals',
    up(database) {
      // Issue §2D. The existing `goals` table is a task-execution demo: its
      // `create()` only accepts one fixed intent / success criterion /
      // constraints triple and its lifecycle is bound to an approval gate and a
      // tool run. That is the Agent-shaped model this product deliberately keeps
      // out of the companion layer, so companionship goals get their own table
      // with the semantics §2D actually asks for:
      //
      //   - `owner` keeps "the user wants this", "we agreed on this" and "Morrow
      //     is curious about this" as three different claims;
      //   - `priority` and `due_at` make ordering and expiry explicit instead of
      //     implicit in creation time;
      //   - progress is a separate append-only table, so a goal's history is not
      //     a rewritten text field.
      database.exec(`
        CREATE TABLE companion_goals (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200 AND instr(title, char(0)) = 0),
          detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 1000 AND instr(detail, char(0)) = 0),
          owner TEXT NOT NULL CHECK (owner IN ('user', 'shared', 'morrow')),
          status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'expired')),
          priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
          due_at TEXT,
          source_message_id TEXT CHECK (source_message_id IS NULL OR length(source_message_id) = 36),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
        ) STRICT;
        CREATE INDEX companion_goals_status_idx ON companion_goals(status, priority ASC, updated_at DESC);

        CREATE TABLE companion_goal_progress (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
          goal_id TEXT NOT NULL REFERENCES companion_goals(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('note', 'step', 'blocker', 'decision')),
          note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 500 AND instr(note, char(0)) = 0),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX companion_goal_progress_idx ON companion_goal_progress(goal_id, created_at DESC);
      `)
    }
  }
]

export const CURRENT_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0

// The oldest schema the application still opens when newer migrations fail:
// v9 carries conversations and messages (core chat) without the optional
// cognitive tables. This is a named anchor, not a relative offset, so adding
// future migrations can never lock an already-degraded database out.
export const DEGRADED_OPEN_MINIMUM_VERSION = 9

export function applyMigrations(
  database: DatabaseSync,
  targetVersion = CURRENT_SCHEMA_VERSION,
  migrationSet: readonly Migration[] = migrations
): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)

  const current = Number(database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version ?? 0)
  const newestKnown = migrationSet.at(-1)?.version ?? 0
  if (current > newestKnown || targetVersion > newestKnown || targetVersion < current) {
    throw new Error('Unsupported database schema version.')
  }
  // Version numbers alone are not an identity: a database produced by a
  // different implementation line can carry the same versions with entirely
  // different table shapes. Fail closed before writing anything unless every
  // recorded migration name matches this application's history exactly.
  const recorded = database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{ version: number; name: string }>
  for (const row of recorded) {
    const expected = migrationSet.find((migration) => migration.version === row.version)
    if (!expected || expected.name !== row.name) {
      throw new Error('Unsupported database schema version.')
    }
  }

  for (const migration of migrationSet) {
    if (migration.version <= current || migration.version > targetVersion) continue
    database.exec('BEGIN IMMEDIATE')
    try {
      migration.up(database)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString())
      database.exec('COMMIT')
    } catch {
      try {
        database.exec('ROLLBACK')
      } catch {
        throw new Error('Database migration failed.')
      }
      throw new Error('Database migration failed.')
    }
  }

  return targetVersion
}
