import type { Metadata } from "next";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf } from "@/features/action-helpers";
import { listMyQuizzes, type Phase, type StudentQuiz } from "@/features/student/service";
import { QuizCard } from "@/components/student/quiz-card";
import styles from "@/components/student/student.module.css";

// The layout's title template only applies to child segments, not to this page beside it.
export const metadata: Metadata = { title: { absolute: "My quizzes · Quiz Platform" } };

const SECTIONS: { phase: Phase; heading: string }[] = [
  { phase: "in_progress", heading: "In progress" },
  { phase: "available", heading: "Available now" },
  { phase: "upcoming", heading: "Coming up" },
  { phase: "completed", heading: "Completed" },
  { phase: "missed", heading: "Missed" },
];

export default async function StudentHome() {
  const user = await requireUser("student");
  const quizzes = await listMyQuizzes(getDb(), ctxOf(user));

  const byPhase = new Map<Phase, StudentQuiz[]>();
  for (const quiz of quizzes) byPhase.set(quiz.phase, [...(byPhase.get(quiz.phase) ?? []), quiz]);

  return (
    <>
      <div className={styles.pageHeader}>
        <h1>My quizzes</h1>
        <p className={styles.note}>Welcome, {user.name}.</p>
      </div>

      {quizzes.length === 0 ? (
        <div className={styles.emptyBox}>
          <h2>No quizzes yet</h2>
          <p className={styles.note}>
            Quizzes from your teacher will appear here once they are published.
          </p>
        </div>
      ) : (
        SECTIONS.filter(({ phase }) => byPhase.has(phase)).map(({ phase, heading }) => (
          <section key={phase} className={styles.section} aria-labelledby={`h-${phase}`}>
            <h2 id={`h-${phase}`}>{heading}</h2>
            <ul className={styles.cards}>
              {byPhase.get(phase)!.map((quiz) => (
                <QuizCard key={quiz.id} quiz={quiz} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
