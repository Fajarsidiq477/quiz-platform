-- Database-level enforcement of CLAUDE.md rules 1-4 that column constraints cannot express.
-- Hand-written (drizzle-kit `--custom`); Drizzle's schema files cannot model triggers or RLS.
-- Drizzle splits this file into separate statements at the breakpoint markers below, so a
-- PL/pgSQL function body must never contain one.

-- ============================================================================================
-- Rule 3: questions are versioned. Published versions and their options are immutable.
-- ============================================================================================

CREATE FUNCTION question_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n_options int;
  n_correct int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'question_versions: insert as a draft, add options, then publish';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'question_versions: published version % is immutable', OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- UPDATE of a draft. Publishing (published_at: null -> value) validates the content.
  IF NEW.published_at IS NOT NULL THEN
    IF NEW.type = 'short_answer' THEN
      IF NEW.accepted_answers IS NULL
         OR jsonb_typeof(NEW.accepted_answers) <> 'array'
         OR jsonb_array_length(NEW.accepted_answers) = 0 THEN
        RAISE EXCEPTION 'question_versions: short_answer needs a non-empty accepted_answers array';
      END IF;
      IF EXISTS (SELECT 1 FROM question_options WHERE question_version_id = NEW.id) THEN
        RAISE EXCEPTION 'question_versions: short_answer cannot have options';
      END IF;
    ELSE
      SELECT count(*), count(*) FILTER (WHERE is_correct)
        INTO n_options, n_correct
        FROM question_options WHERE question_version_id = NEW.id;
      IF n_options < 2 THEN
        RAISE EXCEPTION 'question_versions: choice questions need at least 2 options';
      END IF;
      IF NEW.type = 'true_false' AND n_options <> 2 THEN
        RAISE EXCEPTION 'question_versions: true_false needs exactly 2 options';
      END IF;
      IF NEW.type = 'multiple_choice' AND n_correct < 1 THEN
        RAISE EXCEPTION 'question_versions: multiple_choice needs at least 1 correct option';
      END IF;
      IF NEW.type IN ('single_choice', 'true_false') AND n_correct <> 1 THEN
        RAISE EXCEPTION 'question_versions: % needs exactly 1 correct option', NEW.type;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER question_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION question_versions_guard();
--> statement-breakpoint

CREATE FUNCTION question_options_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.question_version_id <> OLD.question_version_id THEN
    RAISE EXCEPTION 'question_options: an option cannot move to another version';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.question_version_id ELSE NEW.question_version_id END;
  IF EXISTS (SELECT 1 FROM question_versions WHERE id = v_id AND published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'question_options: version % is published and immutable', v_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER question_options_guard
  BEFORE INSERT OR UPDATE OR DELETE ON question_options
  FOR EACH ROW EXECUTE FUNCTION question_options_guard();
--> statement-breakpoint

-- ============================================================================================
-- Rule 3 (cont.): a quiz only pins published versions, and is frozen once attempts exist.
-- ============================================================================================

CREATE FUNCTION quiz_questions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_quiz uuid;
  new_quiz uuid;
BEGIN
  old_quiz := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.quiz_id END;
  new_quiz := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.quiz_id END;

  IF EXISTS (SELECT 1 FROM attempts WHERE quiz_id IN (old_quiz, new_quiz)) THEN
    RAISE EXCEPTION 'quiz_questions: quiz already has attempts; its items are frozen';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM question_versions
      WHERE id = NEW.question_version_id AND published_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'quiz_questions: only published question versions can be added to a quiz';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER quiz_questions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON quiz_questions
  FOR EACH ROW EXECUTE FUNCTION quiz_questions_guard();
--> statement-breakpoint

CREATE FUNCTION quizzes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM attempts WHERE quiz_id = OLD.id) THEN
    IF (NEW.class_id, NEW.time_limit_seconds) IS DISTINCT FROM (OLD.class_id, OLD.time_limit_seconds) THEN
      RAISE EXCEPTION 'quizzes: class and time limit are frozen once attempts exist';
    END IF;
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'quizzes: a quiz with attempts cannot go back to draft';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER quizzes_guard
  BEFORE UPDATE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION quizzes_guard();
--> statement-breakpoint

-- ============================================================================================
-- Rule 1: timers are server-side. The client never supplies a start time or a deadline.
-- ============================================================================================

CREATE FUNCTION attempts_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  q quizzes%ROWTYPE;
BEGIN
  SELECT * INTO q FROM quizzes WHERE id = NEW.quiz_id AND school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempts: quiz not found';
  END IF;
  IF q.status <> 'published' OR q.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'attempts: quiz is not open for attempts';
  END IF;
  IF now() < q.opens_at OR now() >= q.closes_at THEN
    RAISE EXCEPTION 'attempts: quiz is outside its open window';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.student_id AND school_id = NEW.school_id
      AND role = 'student' AND status = 'active' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'attempts: attempting user is not an active student';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM enrollments
    WHERE class_id = q.class_id AND student_id = NEW.student_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'attempts: student is not enrolled in the quiz''s class';
  END IF;
  IF NEW.attempt_no > q.max_attempts THEN
    RAISE EXCEPTION 'attempts: max attempts (%) exceeded', q.max_attempts;
  END IF;

  -- The database clock is the only clock. LEAST ignores NULL, so an untimed quiz ends at closes_at.
  NEW.started_at  := now();
  NEW.deadline_at := LEAST(now() + make_interval(secs => q.time_limit_seconds), q.closes_at);
  NEW.status      := 'in_progress';
  NEW.submitted_at := NULL;
  NEW.score       := NULL;
  NEW.graded_at   := NULL;
  NEW.max_score   := (SELECT sum(points) FROM quiz_questions WHERE quiz_id = NEW.quiz_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER attempts_before_insert
  BEFORE INSERT ON attempts
  FOR EACH ROW EXECUTE FUNCTION attempts_before_insert();
--> statement-breakpoint

-- Identity and timing are immutable; status only moves forward.
--   in_progress -> submitted   (only up to the deadline + grace)
--   in_progress -> expired     (only at/after the deadline)
--   submitted|expired -> graded
-- Final submit is therefore idempotent when written as
--   UPDATE attempts SET status = 'submitted' WHERE id = $1 AND status = 'in_progress'
-- (a replay matches 0 rows).
CREATE FUNCTION attempts_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.school_id, NEW.quiz_id, NEW.student_id, NEW.attempt_no, NEW.started_at, NEW.deadline_at)
     IS DISTINCT FROM
     (OLD.school_id, OLD.quiz_id, OLD.student_id, OLD.attempt_no, OLD.started_at, OLD.deadline_at) THEN
    RAISE EXCEPTION 'attempts: identity and timing columns are immutable';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'in_progress' AND NEW.status IN ('submitted', 'expired'))
      OR (OLD.status IN ('submitted', 'expired') AND NEW.status = 'graded')
    ) THEN
      RAISE EXCEPTION 'attempts: illegal status transition % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'submitted' THEN
      IF now() > OLD.deadline_at + interval '5 seconds' THEN
        RAISE EXCEPTION 'attempts: deadline passed; the attempt can only be expired';
      END IF;
      NEW.submitted_at := now();
    ELSIF NEW.status = 'expired' THEN
      IF now() < OLD.deadline_at THEN
        RAISE EXCEPTION 'attempts: cannot expire an attempt before its deadline';
      END IF;
      NEW.submitted_at := OLD.deadline_at;
    ELSIF NEW.status = 'graded' THEN
      NEW.graded_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER attempts_before_update
  BEFORE UPDATE ON attempts
  FOR EACH ROW EXECUTE FUNCTION attempts_before_update();
--> statement-breakpoint

-- Every answer write is checked against the server clock and the attempt state.
CREATE FUNCTION answers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a attempts%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.attempt_id, NEW.quiz_question_id) IS DISTINCT FROM (OLD.attempt_id, OLD.quiz_question_id) THEN
    RAISE EXCEPTION 'answers: attempt and question are immutable';
  END IF;

  IF TG_OP = 'INSERT' AND
     (NEW.is_correct IS NOT NULL OR NEW.points_awarded IS NOT NULL
      OR NEW.graded_by IS NOT NULL OR NEW.feedback IS NOT NULL) THEN
    RAISE EXCEPTION 'answers: grading fields cannot be set when an answer is created';
  END IF;

  -- Changing what the student answered is only allowed while the attempt is open.
  IF TG_OP = 'INSERT' OR NEW.response IS DISTINCT FROM OLD.response THEN
    SELECT * INTO a FROM attempts WHERE id = NEW.attempt_id AND school_id = NEW.school_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'answers: attempt not found';
    END IF;
    IF a.status <> 'in_progress' THEN
      RAISE EXCEPTION 'answers: attempt is not in progress';
    END IF;
    IF now() > a.deadline_at + interval '5 seconds' THEN
      RAISE EXCEPTION 'answers: attempt deadline has passed';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER answers_guard
  BEFORE INSERT OR UPDATE ON answers
  FOR EACH ROW EXECUTE FUNCTION answers_guard();
--> statement-breakpoint

-- ============================================================================================
-- Rule 4: Row-Level Security as a backstop. The app sets `app.school_id` per transaction
-- (see src/db/tenant.ts). With it unset, no rows are visible (fail closed).
-- Table owners and superusers bypass RLS, so the app must connect as a non-owner role.
-- ============================================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'classes', 'enrollments',
    'questions', 'question_versions', 'question_options',
    'quizzes', 'quiz_questions', 'attempts', 'answers', 'idempotency_keys'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (school_id = nullif(current_setting(''app.school_id'', true), '''')::uuid) WITH CHECK (school_id = nullif(current_setting(''app.school_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON schools
  USING (id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.school_id', true), '')::uuid);
