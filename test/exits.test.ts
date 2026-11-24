import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { ExitHolders } from '../src/editor/exits.ts';
import { loadProjectModules } from './modules.ts';
import type { ProjectModules } from './modules.ts';

let M: ProjectModules;

before(async () => {
  M = await loadProjectModules();
});

interface FakeState {
  noteOpen?: boolean;
  railDragging?: boolean;
  gestureConsumesEscape?: boolean;
}

function fakeHolders(state: FakeState = {}): { holders: ExitHolders; calls: string[] } {
  const calls: string[] = [];
  const holders: ExitHolders = {
    notes: {
      shutTop: () => {
        if (!state.noteOpen) {
          return false;
        }
        calls.push('notes.shutTop');
        return true;
      },
      clearPoint: () => calls.push('notes.clearPoint'),
      clearAll: () => calls.push('notes.clearAll'),
    },
    rail: {
      callOff: () => {
        if (!state.railDragging) {
          calls.push('rail.callOff(idle)');
          return false;
        }
        calls.push('rail.callOff');
        return true;
      },
      endDrag: () => calls.push('rail.endDrag'),
      forget: () => calls.push('rail.forget'),
    },
    typing: {
      discard: () => calls.push('typing.discard'),
    },
    gesture: {
      finishOrCancelEdits: () => {
        if (!state.gestureConsumesEscape) {
          return false;
        }
        calls.push('gesture.finishOrCancelEdits');
        return true;
      },
      cancelEdits: () => calls.push('gesture.cancelEdits'),
      cancel: (pointerId?: number) =>
        calls.push(pointerId === undefined ? 'gesture.cancel' : `gesture.cancel(${pointerId})`),
      release: () => calls.push('gesture.release'),
      drop: () => calls.push('gesture.drop'),
    },
    spacePan: {
      end: () => calls.push('spacePan.end'),
    },
    bend: {
      letGo: () => calls.push('bend.letGo'),
    },
    selection: {
      clear: () => calls.push('selection.clear'),
    },
    tool: {
      disarm: () => calls.push('tool.disarm'),
    },
  };
  return { holders, calls };
}

describe('Exits', () => {
  it('forget drops gesture, discards typing, ends space pan, forgets rail, lets go bend, clears all notes, disarms tool', () => {
    const { holders, calls } = fakeHolders();
    const exits = new M.Exits(holders);
    assert.equal(exits.run('forget'), false);
    assert.deepEqual(calls, [
      'typing.discard',
      'gesture.drop',
      'spacePan.end',
      'rail.forget',
      'bend.letGo',
      'notes.clearAll',
      'tool.disarm',
    ]);
  });

  it('sceneSwitch discards typing, cancels edits, ends space pan, keeps rail, lets go bend, clears point note, disarms tool', () => {
    const { holders, calls } = fakeHolders();
    const exits = new M.Exits(holders);
    assert.equal(exits.run('sceneSwitch'), false);
    assert.deepEqual(calls, [
      'typing.discard',
      'gesture.cancelEdits',
      'spacePan.end',
      'bend.letGo',
      'notes.clearPoint',
      'tool.disarm',
    ]);
  });

  it('disconnect discards typing, releases gesture, ends space pan, ends rail drag, lets go bend, clears point note, disarms tool', () => {
    const { holders, calls } = fakeHolders();
    const exits = new M.Exits(holders);
    assert.equal(exits.run('disconnect'), false);
    assert.deepEqual(calls, [
      'typing.discard',
      'gesture.release',
      'spacePan.end',
      'rail.endDrag',
      'bend.letGo',
      'notes.clearPoint',
      'tool.disarm',
    ]);
  });

  it('readOnly discards typing, cancels edits, lets go bend, clears point note, disarms tool, and keeps space pan and rail', () => {
    const { holders, calls } = fakeHolders();
    const exits = new M.Exits(holders);
    assert.equal(exits.run('readOnly'), false);
    assert.deepEqual(calls, [
      'typing.discard',
      'gesture.cancelEdits',
      'bend.letGo',
      'notes.clearPoint',
      'tool.disarm',
    ]);
  });

  it('interrupt releases gesture, ends space pan, calls off rail drag, and keeps typing, bend, notes, selection, and tool', () => {
    const { holders, calls } = fakeHolders({ railDragging: true });
    const exits = new M.Exits(holders);
    assert.equal(exits.run('interrupt'), false);
    assert.deepEqual(calls, ['gesture.release', 'spacePan.end', 'rail.callOff']);
  });

  it('focusOut ends only space pan', () => {
    const { holders, calls } = fakeHolders();
    const exits = new M.Exits(holders);
    assert.equal(exits.run('focusOut'), false);
    assert.deepEqual(calls, ['spacePan.end']);
  });

  it('pointerCancel cancels only the active gesture and forwards pointerId', () => {
    const { holders, calls } = fakeHolders();
    const exits = new M.Exits(holders);
    assert.equal(exits.run('pointerCancel', { pointerId: 7 }), false);
    assert.deepEqual(calls, ['gesture.cancel(7)']);
  });

  it('escape shuts the top open note first and consumes the key', () => {
    const { holders, calls } = fakeHolders({
      noteOpen: true,
      railDragging: true,
      gestureConsumesEscape: true,
    });
    const exits = new M.Exits(holders);
    assert.equal(exits.run('escape'), true);
    assert.deepEqual(calls, ['notes.shutTop']);
  });

  it('escape calls off a rail drag before touching gestures, selection, or tool', () => {
    const { holders, calls } = fakeHolders({
      railDragging: true,
      gestureConsumesEscape: true,
    });
    const exits = new M.Exits(holders);
    assert.equal(exits.run('escape'), true);
    assert.deepEqual(calls, ['rail.callOff']);
  });

  it('escape finishes placing or cancels edits before clearing selection or disarming tool', () => {
    const { holders, calls } = fakeHolders({ gestureConsumesEscape: true });
    const exits = new M.Exits(holders);
    assert.equal(exits.run('escape'), true);
    assert.deepEqual(calls, ['rail.callOff(idle)', 'gesture.finishOrCancelEdits']);
  });

  it('escape clears selection and disarms tool when no held thing consumes it', () => {
    const { holders, calls } = fakeHolders();
    const exits = new M.Exits(holders);
    assert.equal(exits.run('escape'), false);
    assert.deepEqual(calls, ['rail.callOff(idle)', 'selection.clear', 'tool.disarm']);
  });
});
