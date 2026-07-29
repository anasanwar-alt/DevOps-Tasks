// Pure input validation — no Express, no database, no I/O.
//
// Keeping it in its own module is what makes the first three tests in
// app.test.ts a one-liner each: there is nothing to set up.

/**
 * An error that carries the HTTP status it should become. The error-handling
 * middleware in app.ts reads `.status`; anything else it sees becomes a 500.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const MAX_TITLE_LENGTH = 200;

/** Accepts unknown JSON input and returns a clean title, or throws a 400. */
export function validateTitle(input: unknown): string {
  if (typeof input !== "string") {
    throw new HttpError(400, "title is required and must be a string");
  }
  const title = input.trim();
  if (title.length === 0) {
    throw new HttpError(400, "title must not be empty");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(
      400,
      `title must be ${MAX_TITLE_LENGTH} characters or fewer`,
    );
  }
  return title;
}

/**
 * Turns a `:id` path segment into a positive integer, or throws a 400.
 *
 * Takes `unknown` for the same reason validateTitle does. Express 5 types
 * req.params values as `string | string[]` (a pattern like `/:id+` can match
 * repeatedly), so this must handle a non-string rather than assume one.
 *
 * Note the explicit `typeof raw === "string"` guard: `Number(["7"])` is 7,
 * because JS stringifies a one-element array first. Coercing blindly would
 * silently accept input the route was never meant to take.
 */
export function parseId(raw: unknown): number {
  const id = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(400, `invalid id: ${String(raw)}`);
  }
  return id;
}
