CREATE TABLE position_changes (
  id uuid PRIMARY KEY,
  discussion_id uuid NOT NULL REFERENCES discussions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_position text,
  to_position text NOT NULL,
  reason text,
  triggering_argument_id uuid REFERENCES arguments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT position_changes_from_position_check CHECK (
    from_position IS NULL OR from_position IN ('FOR', 'AGAINST', 'UNDECIDED')
  ),
  CONSTRAINT position_changes_to_position_check CHECK (
    to_position IN ('FOR', 'AGAINST', 'UNDECIDED')
  ),
  CONSTRAINT position_changes_reason_length_check CHECK (
    reason IS NULL OR char_length(reason) BETWEEN 1 AND 500
  )
);

CREATE INDEX position_changes_discussion_created_idx
  ON position_changes (discussion_id, created_at DESC);
CREATE INDEX position_changes_argument_user_idx
  ON position_changes (triggering_argument_id, user_id)
  WHERE triggering_argument_id IS NOT NULL;
CREATE INDEX position_changes_user_created_idx
  ON position_changes (user_id, created_at DESC);

ALTER TABLE arguments
  ADD COLUMN depth smallint NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN edited_at timestamptz,
  ADD CONSTRAINT arguments_depth_check CHECK (depth BETWEEN 0 AND 3),
  ADD CONSTRAINT arguments_body_length_check CHECK (char_length(body) BETWEEN 1 AND 2000);

CREATE INDEX arguments_discussion_active_created_idx
  ON arguments (discussion_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX arguments_parent_active_created_idx
  ON arguments (parent_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE TABLE argument_reactions (
  argument_id uuid NOT NULL REFERENCES arguments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (argument_id, user_id, kind),
  CONSTRAINT argument_reactions_kind_check CHECK (kind IN ('WELL_REASONED', 'FAIR_POINT'))
);

CREATE INDEX argument_reactions_argument_kind_idx
  ON argument_reactions (argument_id, kind);
