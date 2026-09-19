"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registerAction } from "@/features/register/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? "Creating your account…" : "Create account"}
    </button>
  );
}

export function RegisterForm({ initialCode }: { initialCode: string }) {
  const [state, formAction] = useActionState(registerAction, null);
  const errors = state?.fieldErrors ?? {};

  // Kept in state so a failed attempt does not wipe what the student typed. The passwords are
  // deliberately left out: they are cleared and have to be typed again.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(initialCode);

  return (
    <form className="card" action={formAction}>
      <h1>Create your account</h1>
      <p className="muted">Ask your teacher for the class code, then fill in your details.</p>

      {state?.error ? (
        <p className="notice" role="alert">
          {state.error}
        </p>
      ) : null}

      <label className="field">
        Class code
        <input
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. K7M2-X9QP"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          required
        />
        {errors.code ? (
          <span className="field-error" role="alert">
            {errors.code}
          </span>
        ) : null}
      </label>

      <label className="field">
        Full name
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={100}
          required
        />
        {errors.name ? (
          <span className="field-error" role="alert">
            {errors.name}
          </span>
        ) : null}
      </label>

      <label className="field">
        Email
        <input
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        {errors.email ? (
          <span className="field-error" role="alert">
            {errors.email}
          </span>
        ) : null}
      </label>

      <label className="field">
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
        <span className="hint">At least 8 characters.</span>
        {errors.password ? (
          <span className="field-error" role="alert">
            {errors.password}
          </span>
        ) : null}
      </label>

      <label className="field">
        Confirm password
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          required
        />
        {errors.confirmPassword ? (
          <span className="field-error" role="alert">
            {errors.confirmPassword}
          </span>
        ) : null}
      </label>

      <Submit />

      <p className="muted">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
