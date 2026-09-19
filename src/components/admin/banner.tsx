import styles from "./admin.module.css";

/** Confirmation text for `?notice=<code>`. Codes are fixed, so a URL cannot show arbitrary text. */
const NOTICES: Record<string, string> = {
  created: "Created.",
  saved: "Saved.",
  deleted: "Deleted.",
  archived: "It had activity, so it was hidden instead of deleted and its history is kept.",
  published: "Quiz published.",
  unpublished: "Quiz is a draft again and can be edited.",
  closed: "Quiz closed.",
  question_saved: "Question saved.",
  question_removed: "Question removed from the quiz.",
  code_generated: "New class code created. Any earlier code no longer works.",
  code_off: "Registration is turned off for this class.",
};

export function Banner({ code }: { code: string | string[] | undefined }) {
  const key = Array.isArray(code) ? code[0] : code;
  const message = key ? NOTICES[key] : undefined;
  if (!message) return null;
  return (
    <p className={styles.notice} role="status">
      {message}
    </p>
  );
}
