/**
 * The core's command protocol: one table of commands keyed by kind, and the
 * `begin`/`answer` pair the host drives.
 */

/** The answer every command starts from, and the fields the host reads first. */
export interface Result {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly problems: readonly string[];
  readonly notes: readonly string[];
}

/** One command: the request keys it takes, and the work those keys feed. */
export interface Command {
  readonly keys: readonly string[];
  readonly run: (request: Record<string, unknown>) => Promise<Result>;
}

/** Every command the core has, by kind. */
export type Commands = Readonly<Record<string, Command>>;

/** The host's side of the protocol. */
export interface Protocol {
  begin(request: object, kind: string): void;

  answer(): Result;
}

/** Declare a command, so its request keys are checked before it runs. */
export function command<Request>(
  keys: readonly string[],
  run: (request: Request) => Promise<Result>,
): Command {
  return { keys, run: (request) => run(request as unknown as Request) };
}

/** Each command's request keys, as `describe` answers them. */
export function keysOf(commands: Commands): Record<string, readonly string[]> {
  return Object.fromEntries(Object.entries(commands).map(([kind, entry]) => [kind, [...entry.keys]]));
}

/**
 * The protocol over one command table, holding the answer in flight.
 *
 * Split into `begin` + `answer` because goja drains its promise queue when the
 * JS call returns to Go, so the host cannot await a returned promise.
 */
export function protocolOf(commands: Commands): Protocol {
  let settled: Result | null = null;
  let failure: { error: unknown } | null = null;

  function begin(request: object, kind: string): void {
    settled = null;
    failure = null;
    const found = Object.hasOwn(commands, kind) ? commands[kind] : undefined;
    if (found === undefined) {
      throw new Error(`the core has no command ${String(kind)}`);
    }
    void found.run(fieldsOf(request, kind, found)).then(
      (answer) => {
        settled = answer;
      },
      (error: unknown) => {
        failure = { error };
      },
    );
  }

  function answer(): Result {
    const answered = settled;
    const failed = failure;
    settled = null;
    failure = null;
    if (failed !== null) {
      throw failed.error;
    }
    if (answered === null) {
      throw new Error('the core has no answer: call begin first');
    }
    return answered;
  }

  return { begin, answer };
}

/**
 * The request the command reads: every key it declares, no other, and "" read
 * as null because an omitted option arrives that way.
 */
function fieldsOf(request: object, kind: string, { keys }: Command): Record<string, unknown> {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error(`${kind} expects a request object`);
  }
  const fields = Object.entries(request).map(
    ([key, value]) => [key, value === '' ? null : value] as const,
  );
  const takes = keys.length === 0 ? 'no keys' : `keys ${keys.join(', ')}`;
  for (const [key] of fields) {
    if (!keys.includes(key)) {
      throw new Error(`${kind} has no key ${key}: it takes ${takes}`);
    }
  }
  const present = new Set(fields.map(([key]) => key));
  for (const key of keys) {
    if (!present.has(key)) {
      throw new Error(`${kind} is missing the key ${key}: it takes ${takes}`);
    }
  }
  return Object.fromEntries(fields);
}
