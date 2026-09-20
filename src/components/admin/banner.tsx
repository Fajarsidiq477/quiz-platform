import styles from "./admin.module.css";

/** Confirmation text for `?notice=<code>`. Codes are fixed, so a URL cannot show arbitrary text. */
const NOTICES: Record<string, string> = {
  created: "Created.",
  imported: "Quiz imported as a draft. Check the questions, set the dates, then publish it.",
  saved: "Saved.",
  deleted: "Deleted.",
  archived: "It had activity, so it was hidden instead of deleted and its history is kept.",
  published: "Quiz published.",
  unpublished: "Quiz is a draft again and can be edited.",
  closed: "Quiz closed.",
  reopened: "Quiz reopened with the new rules. Students' results were kept.",
  reopened_draft: "Quiz reopened as a draft. Nobody had attempted it, so everything can be edited.",
  rules_saved: "Rules saved.",
  result_deleted: "The student's result was deleted. They can take the quiz again if it is open.",
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
