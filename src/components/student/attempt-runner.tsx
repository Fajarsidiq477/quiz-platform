"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAnswered } from "@/features/student/grading";
import type { TakingItem } from "@/features/student/service";
import type { Answer, SaveResult, SubmitResult } from "@/features/student/types";
import { formatCountdown, timerState } from "./format-time";
import { SaveQueue, type SaveState } from "./save-queue";
import styles from "./student.module.css";
import ui from "@/components/admin/admin.module.css";

const TICK_MS = 250;
const RETRY_MS = 3000;

type Props = {
  title: string;
  description: string | null;
  items: TakingItem[];
  initialAnswers: Record<string, { optionIds?: string[]; text?: string }>;
  /** Time left by the SERVER's clock when the page was rendered. */
  initialRemainingMs: number;
  save: (itemId: string, answer: Answer) => Promise<SaveResult>;
  submit: (answers: Record<string, Answer>) => Promise<SubmitResult | void>;
};

function startingAnswers(items: TakingItem[], saved: Props["initialAnswers"]) {
  const out: Record<string, Answer> = {};
  for (const item of items) {
    const s = saved[item.id];
    if (!s) continue;
    out[item.id] = item.type === "short_answer" ? { text: s.text ?? "" } : { optionIds: s.optionIds ?? [] };
  }
  return out;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The quiz page. Everything here is convenience: the server decides what is accepted and when
 * time is up. The countdown runs from the server's "time left" (never the device's clock) and is
 * re-synced by every save; at zero the answers are handed in automatically.
 */
export function AttemptRunner({
  title,
  description,
  items,
  initialAnswers,
  initialRemainingMs,
  save,
  submit,
}: Props) {
  const [answers, setAnswers] = useState(() => startingAnswers(items, initialAnswers));
  const answersRef = useRef(answers);
  const [saveStates, setSaveStates] = useState<Record<string, { state: SaveState; message?: string }>>({});
  const [remainingMs, setRemainingMs] = useState(initialRemainingMs);
  const deadlineRef = useRef<number | null>(null);
  const queueRef = useRef<SaveQueue | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  // The latest callbacks, so the long-lived queue and timers never call a stale one.
  const saveRef = useRef(save);
  const submitRef = useRef(submit);
  useEffect(() => {
    saveRef.current = save;
    submitRef.current = submit;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Autosave.
  useEffect(() => {
    const queue = new SaveQueue((id, answer) => saveRef.current(id, answer), {
      state: (id, state, message) => setSaveStates((s) => ({ ...s, [id]: { state, message } })),
      remaining: (ms) => {
        deadlineRef.current = performance.now() + ms; // re-sync to the server's clock
        setRemainingMs(ms);
      },
      closed: (message) => setClosedMessage(message),
    });
    queueRef.current = queue;
    return () => {
      queue.dispose();
      queueRef.current = null;
    };
  }, []);

  // Countdown, from the server's time left. `performance.now()` is a steady clock: it does not
  // jump when the device's date or time is changed.
  useEffect(() => {
    deadlineRef.current = performance.now() + initialRemainingMs;
    const id = setInterval(() => {
      if (deadlineRef.current !== null) setRemainingMs(deadlineRef.current - performance.now());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [initialRemainingMs]);

  const runSubmit = useCallback(async () => {
    if (submittingRef.current) return; // double click, or the timer and the button together
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setConfirming(false);
    queueRef.current?.dispose(); // the full set of answers travels with the submit

    while (mountedRef.current) {
      try {
        const result = await submitRef.current(answersRef.current);
        // On success the server redirects to the result and this page goes away.
        if (result && result.ok === false) {
          setSubmitError(result.error);
          submittingRef.current = false;
          setSubmitting(false);
        }
        return;
      } catch {
        setSubmitError("Could not reach the server. Trying again…");
        await wait(RETRY_MS);
      }
    }
  }, []);

  const timeIsUp = remainingMs <= 0;
  useEffect(() => {
    if (timeIsUp) void runSubmit();
  }, [timeIsUp, runSubmit]);

  function setAnswer(itemId: string, answer: Answer, when: "now" | "soon") {
    answersRef.current = { ...answersRef.current, [itemId]: answer };
    setAnswers(answersRef.current);
    queueRef.current?.update(itemId, answer, when);
  }

  function choose(item: TakingItem, optionId: string) {
    const current = (answers[item.id] as { optionIds: string[] } | undefined)?.optionIds ?? [];
    const next =
      item.type === "multiple_choice"
        ? current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
        : [optionId];
    setAnswer(item.id, { optionIds: next }, "now");
  }

  const answeredCount = items.filter((item) => isAnswered(item, answers[item.id])).length;
  const unanswered = items.length - answeredCount;
  const states = Object.values(saveStates);
  const overall = states.some((s) => s.state === "error")
    ? "Some answers are not saved yet. Trying again…"
    : states.some((s) => s.state === "saving")
      ? "Saving…"
      : answeredCount > 0
        ? "All answers saved"
        : "";
  const tState = timerState(remainingMs);
  const announcement =
    tState === "warning" ? "Less than 5 minutes left" : tState === "danger" ? "Less than 1 minute left" : tState === "over" ? "Time is up" : "";
  const locked = submitting || closedMessage !== null;

  return (
    <div>
      <div className={styles.bar}>
        <div className={styles.barTitle}>{title}</div>
        <div className={styles.barInfo}>
          <span>
            Answered {answeredCount} of {items.length}
          </span>
          <span aria-live="polite">{overall}</span>
          <span
            className={`${styles.timer} ${styles[`timer_${tState}`] ?? ""}`}
            role="timer"
            aria-label="Time remaining"
          >
            {formatCountdown(remainingMs)}
          </span>
        </div>
        <p className={styles.srOnly} aria-live="assertive">
          {announcement}
        </p>
      </div>

      {description ? <p className={styles.note} style={{ marginBottom: 16 }}>{description}</p> : null}

      {closedMessage ? (
        <p className={styles.alert} role="alert" style={{ marginBottom: 16 }}>
          This attempt has closed: {closedMessage}{" "}
          <button type="button" className={styles.linkButton} onClick={() => window.location.reload()}>
            See what happened
          </button>
        </p>
      ) : null}

      {items.map((item, index) => {
        const answer = answers[item.id];
        const chosen = (answer as { optionIds?: string[] } | undefined)?.optionIds ?? [];
        const text = (answer as { text?: string } | undefined)?.text ?? "";
        const state = saveStates[item.id];
        const isMulti = item.type === "multiple_choice";
        return (
          <fieldset key={item.id} className={styles.question} disabled={locked}>
            <legend className={styles.legend}>
              Question {index + 1}{" "}
              <span>
                · {item.points} {item.points === 1 ? "point" : "points"}
              </span>
            </legend>
            <p className={styles.prompt}>{item.prompt}</p>

            {item.type === "short_answer" ? (
              <textarea
                className={styles.answerBox}
                value={text}
                onChange={(e) => setAnswer(item.id, { text: e.target.value }, "soon")}
                onBlur={() => queueRef.current?.flush()}
                maxLength={2000}
                aria-label={`Your answer to question ${index + 1}`}
                placeholder="Type your answer"
              />
            ) : (
              <div className={styles.options}>
                {isMulti ? <span className={styles.hint}>Select all that apply.</span> : null}
                {item.options.map((option) => {
                  const checked = chosen.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className={`${styles.option} ${checked ? styles.optionChosen : ""}`}
                    >
                      <input
                        type={isMulti ? "checkbox" : "radio"}
                        name={item.id}
                        checked={checked}
                        onChange={() => choose(item, option.id)}
                      />
                      <span>{option.text}</span>
                    </label>
                  );
                })}
                {!isMulti && chosen.length > 0 ? (
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setAnswer(item.id, { optionIds: [] }, "now")}
                  >
                    Clear my answer
                  </button>
                ) : null}
              </div>
            )}

            <p
              className={`${styles.saveNote} ${state?.state === "error" ? styles.saveNoteError : ""}`}
              aria-live="polite"
            >
              {state?.state === "saving"
                ? "Saving…"
                : state?.state === "error"
                  ? (state.message ?? "Not saved")
                  : state?.state === "saved"
                    ? "Saved"
                    : ""}
            </p>
          </fieldset>
        );
      })}

      <div className={styles.submitBox}>
        {submitError ? (
          <p className={styles.alert} role="alert">
            {submitError}
          </p>
        ) : null}
        {confirming ? (
          <div role="group" aria-label="Confirm submit" style={{ display: "grid", gap: 12 }}>
            <p>
              {unanswered > 0
                ? `You have ${unanswered} unanswered ${unanswered === 1 ? "question" : "questions"}. Hand in anyway?`
                : "Hand in your answers now? You cannot change them afterwards."}
            </p>
            <div className={ui.formActions}>
              <button type="button" className={ui.btn} onClick={() => void runSubmit()} disabled={submitting}>
                Yes, submit
              </button>
              <button
                type="button"
                className={`${ui.btn} ${ui.btnSecondary}`}
                onClick={() => setConfirming(false)}
              >
                Keep working
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={ui.btn}
            style={{ justifySelf: "start" }}
            onClick={() => setConfirming(true)}
            disabled={locked}
          >
            Submit quiz
          </button>
        )}
      </div>

      {timeIsUp || submitting ? (
        <div className={styles.overlay} role="alert">
          <p>{timeIsUp ? "Time is up. Handing in your answers…" : "Handing in your answers…"}</p>
        </div>
      ) : null}
    </div>
  );
}
