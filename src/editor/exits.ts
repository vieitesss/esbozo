/**
 * The exit table: every way an in-flight interaction can end, and what each
 * held thing does when it happens.
 *
 * Rows are exits (`forget`, `sceneSwitch`, `disconnect`, `readOnly`,
 * `interrupt`, `focusOut`, `escape`, `pointerCancel`). Columns are the held
 * things (`notes`, `rail`, `typing`, `gesture`, `spacePan`, `bend`,
 * `selection`, `tool`). Each cell names what that column does on that exit.
 *
 * `editor.ts` reports which exit happened; the table owns the choices.
 */

/** Every exit the editor can report to the table. */
export type Exit =
  | 'forget'
  | 'sceneSwitch'
  | 'disconnect'
  | 'readOnly'
  | 'interrupt'
  | 'focusOut'
  | 'escape'
  | 'pointerCancel';

type NotesAction = 'keep' | 'shutTop' | 'clearPoint' | 'clearAll';
type RailAction = 'keep' | 'callOff' | 'endDrag' | 'forget';
type TypingAction = 'keep' | 'discard';
type GestureAction =
  | 'keep'
  | 'finishOrCancelEdits'
  | 'cancelEdits'
  | 'cancel'
  | 'release'
  | 'drop';
type SpacePanAction = 'keep' | 'end';
type BendAction = 'keep' | 'letGo';
type SelectionAction = 'keep' | 'clear';
type ToolAction = 'keep' | 'disarm';

/** One row of the exit table: what every held thing does on this exit. */
interface ExitRow {
  readonly notes: NotesAction;
  readonly rail: RailAction;
  readonly typing: TypingAction;
  readonly gesture: GestureAction;
  readonly spacePan: SpacePanAction;
  readonly bend: BendAction;
  readonly selection: SelectionAction;
  readonly tool: ToolAction;
  /**
   * When true (`escape`), the first held thing that consumes the exit stops
   * the row before selection and tool are cleared.
   */
  readonly firstConsumes?: boolean;
}

/**
 * The one table of exits by held things.
 *
 * Adding a gesture or an exit is one change here.
 */
const EXIT_TABLE: Readonly<Record<Exit, ExitRow>> = {
  forget: {
    notes: 'clearAll',
    rail: 'forget',
    typing: 'discard',
    gesture: 'drop',
    spacePan: 'end',
    bend: 'letGo',
    selection: 'keep',
    tool: 'disarm',
  },
  sceneSwitch: {
    notes: 'clearPoint',
    rail: 'keep',
    typing: 'discard',
    gesture: 'cancelEdits',
    spacePan: 'end',
    bend: 'letGo',
    selection: 'keep',
    tool: 'disarm',
  },
  disconnect: {
    notes: 'clearPoint',
    rail: 'endDrag',
    typing: 'discard',
    gesture: 'release',
    spacePan: 'end',
    bend: 'letGo',
    selection: 'keep',
    tool: 'disarm',
  },
  readOnly: {
    notes: 'clearPoint',
    rail: 'keep',
    typing: 'discard',
    gesture: 'cancelEdits',
    spacePan: 'keep',
    bend: 'letGo',
    selection: 'keep',
    tool: 'disarm',
  },
  interrupt: {
    notes: 'keep',
    rail: 'callOff',
    typing: 'keep',
    gesture: 'release',
    spacePan: 'end',
    bend: 'keep',
    selection: 'keep',
    tool: 'keep',
  },
  focusOut: {
    notes: 'keep',
    rail: 'keep',
    typing: 'keep',
    gesture: 'keep',
    spacePan: 'end',
    bend: 'keep',
    selection: 'keep',
    tool: 'keep',
  },
  escape: {
    notes: 'shutTop',
    rail: 'callOff',
    typing: 'keep',
    gesture: 'finishOrCancelEdits',
    spacePan: 'keep',
    bend: 'keep',
    selection: 'clear',
    tool: 'disarm',
    firstConsumes: true,
  },
  pointerCancel: {
    notes: 'keep',
    rail: 'keep',
    typing: 'keep',
    gesture: 'cancel',
    spacePan: 'keep',
    bend: 'keep',
    selection: 'keep',
    tool: 'keep',
  },
};

/** Optional detail carried by an exit (such as the cancelled pointer id). */
export interface ExitDetail {
  readonly pointerId?: number;
}

/** The held things registered with the exit table. */
export interface ExitHolders {
  readonly notes: {
    shutTop(): boolean;
    clearPoint(): void;
    clearAll(): void;
  };
  readonly rail: {
    callOff(): boolean;
    endDrag(): void;
    forget(): void;
  };
  readonly typing: {
    discard(): void;
  };
  readonly gesture: {
    finishOrCancelEdits(): boolean;
    cancelEdits(): void;
    cancel(pointerId?: number): void;
    release(): void;
    drop(): void;
  };
  readonly spacePan: {
    end(): void;
  };
  readonly bend: {
    letGo(): void;
  };
  readonly selection: {
    clear(): void;
  };
  readonly tool: {
    disarm(): void;
  };
}

/**
 * Runs the exit table against the registered held things.
 *
 * Returns `true` when a `firstConsumes` exit (`escape`) was consumed by a held
 * thing (open note, rail drag, or active gesture), and `false` otherwise.
 */
export class Exits {
  readonly #holders: ExitHolders;

  constructor(holders: ExitHolders) {
    this.#holders = holders;
  }

  run(exit: Exit, detail?: ExitDetail): boolean {
    const row = EXIT_TABLE[exit];
    const h = this.#holders;

    if (row.firstConsumes) {
      if (row.notes === 'shutTop' && h.notes.shutTop()) {
        return true;
      }
      if (row.rail === 'callOff' && h.rail.callOff()) {
        return true;
      }
      if (row.gesture === 'finishOrCancelEdits' && h.gesture.finishOrCancelEdits()) {
        return true;
      }
    }

    switch (row.typing) {
      case 'discard':
        h.typing.discard();
        break;
      case 'keep':
        break;
    }

    switch (row.gesture) {
      case 'drop':
        h.gesture.drop();
        break;
      case 'cancelEdits':
        h.gesture.cancelEdits();
        break;
      case 'cancel':
        h.gesture.cancel(detail?.pointerId);
        break;
      case 'release':
        h.gesture.release();
        break;
      case 'finishOrCancelEdits':
      case 'keep':
        break;
    }

    switch (row.spacePan) {
      case 'end':
        h.spacePan.end();
        break;
      case 'keep':
        break;
    }

    switch (row.rail) {
      case 'forget':
        h.rail.forget();
        break;
      case 'endDrag':
        h.rail.endDrag();
        break;
      case 'callOff':
        if (!row.firstConsumes) {
          h.rail.callOff();
        }
        break;
      case 'keep':
        break;
    }

    switch (row.bend) {
      case 'letGo':
        h.bend.letGo();
        break;
      case 'keep':
        break;
    }

    switch (row.notes) {
      case 'clearPoint':
        h.notes.clearPoint();
        break;
      case 'clearAll':
        h.notes.clearAll();
        break;
      case 'shutTop':
      case 'keep':
        break;
    }

    switch (row.selection) {
      case 'clear':
        h.selection.clear();
        break;
      case 'keep':
        break;
    }

    switch (row.tool) {
      case 'disarm':
        h.tool.disarm();
        break;
      case 'keep':
        break;
    }

    return false;
  }
}
