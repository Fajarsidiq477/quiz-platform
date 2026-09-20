/** 66.666 -> "67%". */
export const pct = (n: number) => `${Math.round(n)}%`;

/** 8 -> "8", 2.5 -> "2.5", 2.50 -> "2.5": no trailing zeros. */
export const num = (n: number) => String(Number(n.toFixed(2)));

/** "6 / 8". */
export const score = (got: number, max: number) => `${num(got)} / ${num(max)}`;
