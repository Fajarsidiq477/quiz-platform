"use server";

import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf, runAction } from "../action-helpers";
import { fieldErrorsFrom, formValue, type FormState } from "../form-state";
import { classInputSchema } from "./schemas";
import { createClass, deleteClass, setJoinCode, updateClass } from "./service";

const parse = (formData: FormData) =>
  classInputSchema.safeParse({ name: formValue(formData, "name"), term: formValue(formData, "term") });

export async function createClassAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("admin");
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  return runAction(async () => {
    await createClass(getDb(), ctxOf(user), parsed.data);
    return "/admin/classes?notice=created";
  });
}

export async function updateClassAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser("admin");
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  return runAction(async () => {
    await updateClass(getDb(), ctxOf(user), id, parsed.data);
    return "/admin/classes?notice=saved";
  });
}

/** Turns registration on, or replaces the code (the old one stops working immediately). */
export async function generateJoinCodeAction(id: string): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await setJoinCode(getDb(), ctxOf(user), id, "generate");
    return `/admin/classes/${id}?notice=code_generated`;
  });
}

export async function disableJoinCodeAction(id: string): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await setJoinCode(getDb(), ctxOf(user), id, "disable");
    return `/admin/classes/${id}?notice=code_off`;
  });
}

export async function deleteClassAction(
  id: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    const outcome = await deleteClass(getDb(), ctxOf(user), id);
    return `/admin/classes?notice=${outcome}`;
  });
}
