-- Time away from the quiz page. Rule 1 applies: the browser only reports "I left" and "I am back",
-- and the database supplies both moments from its own clock, so a student cannot send a shorter
-- absence. Rule 4: the same tenant isolation as every other core table.

CREATE FUNCTION attempt_away_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a attempts%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO a FROM attempts WHERE id = NEW.attempt_id AND school_id = NEW.school_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'attempt_away_periods: attempt not found';
    END IF;
    IF a.status <> 'in_progress' THEN
      RAISE EXCEPTION 'attempt_away_periods: attempt is not in progress';
    END IF;
    IF now() > a.deadline_at + interval '5 seconds' THEN
      RAISE EXCEPTION 'attempt_away_periods: attempt deadline has passed';
    END IF;
    -- Whatever the caller sent, the period starts now and is open.
    NEW.started_at := now();
    NEW.ended_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: the only change allowed is closing an open period, and it closes now.
  IF (NEW.id, NEW.school_id, NEW.attempt_id, NEW.reason, NEW.started_at)
     IS DISTINCT FROM
     (OLD.id, OLD.school_id, OLD.attempt_id, OLD.reason, OLD.started_at) THEN
    RAISE EXCEPTION 'attempt_away_periods: only the end time can be set';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'attempt_away_periods: the period has already ended';
  END IF;
  NEW.ended_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER attempt_away_guard
  BEFORE INSERT OR UPDATE ON attempt_away_periods
  FOR EACH ROW EXECUTE FUNCTION attempt_away_guard();
--> statement-breakpoint

ALTER TABLE attempt_away_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attempt_away_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attempt_away_periods
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
