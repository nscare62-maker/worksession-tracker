-- Work-Session Location Tracking — schema.sql
-- Requires PostgreSQL 14+ with PostGIS extension.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email

CREATE TYPE user_role AS ENUM ('worker', 'manager', 'admin');
CREATE TYPE session_status AS ENUM ('active', 'ended', 'force_ended');
CREATE TYPE clock_method AS ENUM ('gps', 'manual_no_location');
CREATE TYPE update_type AS ENUM ('interval', 'distance', 'manual_ping', 'queued_offline');
CREATE TYPE permission_state AS ENUM ('granted', 'denied', 'restricted', 'unknown');

-- ---------------------------------------------------------------------------
-- Teams & Users
-- ---------------------------------------------------------------------------
CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          user_role NOT NULL,
    team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE task_status AS ENUM ('assigned', 'in_progress', 'completed');

CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               TEXT NOT NULL,
    description         TEXT,
    assigned_by         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              task_status NOT NULL DEFAULT 'assigned',
    due_at              TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    completion_report   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_report_required CHECK (
        (status != 'completed') OR (completion_report IS NOT NULL AND length(trim(completion_report)) > 0)
    )
);
CREATE INDEX idx_tasks_assignee ON tasks(assigned_to, status, created_at DESC);
CREATE INDEX idx_tasks_assigner ON tasks(assigned_by, status, created_at DESC);

-- Managers can be granted access to specific teams beyond their own (admin-assigned)
CREATE TABLE manager_team_access (
    manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (manager_id, team_id)
);

-- ---------------------------------------------------------------------------
-- Consent — required before any tracking may occur
-- ---------------------------------------------------------------------------
CREATE TABLE consent_acks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_version   TEXT NOT NULL,
    policy_text_hash TEXT NOT NULL,
    acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address       INET,
    device_info      JSONB
);
CREATE INDEX idx_consent_user ON consent_acks(user_id);

-- ---------------------------------------------------------------------------
-- Work sessions (punch in -> punch out)
-- ---------------------------------------------------------------------------
CREATE TABLE work_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id           UUID NOT NULL REFERENCES users(id),
    status              session_status NOT NULL DEFAULT 'active',
    clock_method        clock_method NOT NULL DEFAULT 'gps',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    ended_reason        TEXT, -- e.g. 'worker_punch_out', 'admin_force_end'
    update_interval_sec INT NOT NULL DEFAULT 60,
    distance_filter_m   INT NOT NULL DEFAULT 100,
    consent_ack_id      UUID NOT NULL REFERENCES consent_acks(id),
    last_location_id    UUID, -- FK added after location_updates exists
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ended_fields_consistent CHECK (
        (status = 'active' AND ended_at IS NULL) OR
        (status != 'active' AND ended_at IS NOT NULL)
    )
);
CREATE INDEX idx_sessions_worker ON work_sessions(worker_id);
CREATE INDEX idx_sessions_status ON work_sessions(status);
-- Enforce only one active session per worker at a time
CREATE UNIQUE INDEX uq_one_active_session_per_worker
    ON work_sessions(worker_id) WHERE (status = 'active');

-- ---------------------------------------------------------------------------
-- Location updates
-- ---------------------------------------------------------------------------
CREATE TABLE location_updates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
    worker_id     UUID NOT NULL REFERENCES users(id),
    geom          geography(Point, 4326) NOT NULL,
    accuracy_m    NUMERIC(8,2),
    speed_mps     NUMERIC(8,2),
    heading_deg   NUMERIC(6,2),
    captured_at   TIMESTAMPTZ NOT NULL, -- device clock, when the fix was taken
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(), -- server clock, when it arrived
    update_type   update_type NOT NULL,
    is_delayed    BOOLEAN NOT NULL DEFAULT false, -- true if queued offline then flushed
    permission_state permission_state NOT NULL DEFAULT 'granted',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_locations_session ON location_updates(session_id, captured_at);
CREATE INDEX idx_locations_worker_time ON location_updates(worker_id, captured_at DESC);
CREATE INDEX idx_locations_geom ON location_updates USING GIST(geom);

ALTER TABLE work_sessions
    ADD CONSTRAINT fk_last_location
    FOREIGN KEY (last_location_id) REFERENCES location_updates(id);

-- Trigger: reject any location_update whose session is not active (belt-and-braces;
-- the service layer also checks this before insert).
CREATE OR REPLACE FUNCTION reject_location_if_session_not_active()
RETURNS TRIGGER AS $$
DECLARE
    s_status session_status;
BEGIN
    SELECT status INTO s_status FROM work_sessions WHERE id = NEW.session_id;
    IF s_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Cannot record location: session % is not active', NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_inactive_session_location
    BEFORE INSERT ON location_updates
    FOR EACH ROW EXECUTE FUNCTION reject_location_if_session_not_active();

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    UUID REFERENCES users(id),
    action      TEXT NOT NULL,          -- e.g. 'session.start', 'session.end', 'route.view'
    target_type TEXT,                    -- e.g. 'work_session'
    target_id   UUID,
    metadata    JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Retention config (single row; admin-editable)
-- ---------------------------------------------------------------------------
CREATE TABLE retention_settings (
    id                    BOOLEAN PRIMARY KEY DEFAULT true CHECK (id), -- singleton
    location_retention_days INT NOT NULL DEFAULT 90,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            UUID REFERENCES users(id)
);
INSERT INTO retention_settings (location_retention_days) VALUES (90);
