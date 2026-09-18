-- ============================================================
-- WorkSession Tracker — Supabase Migration
-- Run this once in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Extensions (Supabase already has pgcrypto + citext, but safe to re-declare)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ENUMs (idempotent)
DO $$ BEGIN CREATE TYPE user_role        AS ENUM ('worker','manager','admin');       EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE session_status   AS ENUM ('active','ended','force_ended');   EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE clock_method     AS ENUM ('gps','manual_no_location');       EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE update_type      AS ENUM ('interval','distance','manual_ping','queued_offline'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE permission_state AS ENUM ('granted','denied','restricted','unknown'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE task_status      AS ENUM ('assigned','in_progress','completed'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Teams ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Users ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          user_role NOT NULL,
    team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Tasks ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT NOT NULL,
    description       TEXT,
    assigned_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status            task_status NOT NULL DEFAULT 'assigned',
    due_at            TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    completion_report TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_report_required CHECK (
        (status != 'completed') OR
        (completion_report IS NOT NULL AND length(trim(completion_report)) > 0)
    )
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assigner ON tasks(assigned_by, status, created_at DESC);

-- ── Manager team access ────────────────────────────────────
CREATE TABLE IF NOT EXISTS manager_team_access (
    manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (manager_id, team_id)
);

-- ── Consent ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_acks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_version   TEXT NOT NULL,
    policy_text_hash TEXT NOT NULL,
    acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address       INET,
    device_info      JSONB
);
CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_acks(user_id);

-- ── Work sessions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id           UUID NOT NULL REFERENCES users(id),
    status              session_status NOT NULL DEFAULT 'active',
    clock_method        clock_method NOT NULL DEFAULT 'gps',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    ended_reason        TEXT,
    update_interval_sec INT NOT NULL DEFAULT 60,
    distance_filter_m   INT NOT NULL DEFAULT 100,
    consent_ack_id      UUID NOT NULL REFERENCES consent_acks(id),
    last_location_id    UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ended_fields_consistent CHECK (
        (status = 'active' AND ended_at IS NULL) OR
        (status != 'active' AND ended_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_sessions_worker ON work_sessions(worker_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON work_sessions(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_worker
    ON work_sessions(worker_id) WHERE (status = 'active');

-- ── Location updates (plain lat/lng — no PostGIS needed) ───
CREATE TABLE IF NOT EXISTS location_updates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
    worker_id        UUID NOT NULL REFERENCES users(id),
    latitude         NUMERIC(10,7) NOT NULL,
    longitude        NUMERIC(10,7) NOT NULL,
    accuracy_m       NUMERIC(8,2),
    speed_mps        NUMERIC(8,2),
    heading_deg      NUMERIC(6,2),
    captured_at      TIMESTAMPTZ NOT NULL,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    update_type      update_type NOT NULL,
    is_delayed       BOOLEAN NOT NULL DEFAULT false,
    permission_state permission_state NOT NULL DEFAULT 'granted',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_session    ON location_updates(session_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_locations_worker_time ON location_updates(worker_id, captured_at DESC);

ALTER TABLE work_sessions
    DROP CONSTRAINT IF EXISTS fk_last_location;
ALTER TABLE work_sessions
    ADD CONSTRAINT fk_last_location
    FOREIGN KEY (last_location_id) REFERENCES location_updates(id);

-- Trigger: reject location if session not active
CREATE OR REPLACE FUNCTION reject_location_if_session_not_active()
RETURNS TRIGGER AS $$
DECLARE s_status session_status;
BEGIN
    SELECT status INTO s_status FROM work_sessions WHERE id = NEW.session_id;
    IF s_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Cannot record location: session % is not active', NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reject_inactive_session_location ON location_updates;
CREATE TRIGGER trg_reject_inactive_session_location
    BEFORE INSERT ON location_updates
    FOR EACH ROW EXECUTE FUNCTION reject_location_if_session_not_active();

-- ── Audit log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    UUID REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   UUID,
    metadata    JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at DESC);

-- ── Retention settings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS retention_settings (
    id                      BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    location_retention_days INT NOT NULL DEFAULT 90,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by              UUID REFERENCES users(id)
);
INSERT INTO retention_settings (location_retention_days)
    VALUES (90) ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- ACTIVITY LOG — rich event store for the admin dashboard
-- Stores: logins, punch-in/out, location updates, task events
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_log (
    id           BIGSERIAL PRIMARY KEY,
    event_type   TEXT NOT NULL,        -- 'login' | 'punch_in' | 'punch_out' | 'location_update' | 'task_assigned' | 'task_completed'
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email   TEXT,                 -- denormalized for fast display even after user deletion
    user_name    TEXT,
    user_role    TEXT,
    session_id   UUID,
    latitude     NUMERIC(10,7),
    longitude    NUMERIC(10,7),
    accuracy_m   NUMERIC(8,2),
    ip_address   TEXT,
    user_agent   TEXT,
    metadata     JSONB,                -- extra context (task title, clock method, etc.)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_user       ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_event_type ON activity_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created    ON activity_log(created_at DESC);

-- ── Seed data (development accounts) ──────────────────────
-- Passwords: admin@123, manager123, pass123
INSERT INTO teams (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Field Ops - North'),
  ('22222222-2222-2222-2222-222222222222', 'Field Ops - South')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, password_hash, full_name, role, team_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','admin@gmail.com',   '$2b$10$0caJI7SwcKjbAlwyJgdFmeDuIIoQ4G/SKw96cTXhxYM2RKIoemFcC','Ada Admin',   'admin',   NULL),
  ('aaaaaaaa-0000-0000-0000-000000000002','manager@gmail.com', '$2b$10$7Qo6RagQVsEpRSTUlUpheev0e.qAMmZfwZS6WYIS0aPXEufaAlY4G','Mona Manager','manager','11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003','worker@gmail.com',  '$2b$10$fikOJpoMsgWUg0OF0gXt0.x1FrCMnLmY4iFeXSyMn/098S63/CFlC','Wes Worker',  'worker', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000004','worker2@gmail.com', '$2b$10$fikOJpoMsgWUg0OF0gXt0.x1FrCMnLmY4iFeXSyMn/098S63/CFlC','Wanda Worker','worker', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000005','worker3@gmail.com', '$2b$10$fikOJpoMsgWUg0OF0gXt0.x1FrCMnLmY4iFeXSyMn/098S63/CFlC','Will Worker', 'worker', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO manager_team_access (manager_id, team_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;
