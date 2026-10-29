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
