/**
 * Seam 2, one level down: the browser contract that events a test dispatches by
 * hand cannot reach.
 *
 * `tests/cdp.ts` holds the helper and says how it reaches the page. This file
 * proves the helper is really driving Chromium, on a plain `<textarea>` page
 * with no editor in it: an input method's preedit is the field's own value
 * while the composition is still open, and only losing the composition ends it.
 * That is the state #10's editor work has to tell apart, and the reason
 * `compositionstart`/`input`/`compositionend` dispatched from a test looked
 * right while the real thing still saved unconfirmed words.
 *
 * Model-free, so it runs under `pnpm e2e` with no key set.
 */
import { test } from '@e2e-dev/web';
import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import { imeCommit, imeCompose, livePage, throttleCpu } from './cdp.ts';

/** A field, and a record of the events the browser itself delivers to it. */
const FIELD_PAGE = `<!doctype html>
<meta charset="utf-8">
<textarea id="field" style="width: 320px; height: 120px"></textarea>
<script>
  const field = document.getElementById('field');
  const seen = [];
  field.dataset.seen = '[]';
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input', 'blur']) {
    field.addEventListener(type, (event) => {
      seen.push({
        type,
        isTrusted: event.isTrusted,
        isComposing: event.isComposing ?? null,
        inputType: event.inputType ?? null,
        value: field.value,
      });
      // The record rides on the field, where any reader of the page finds it.
      field.dataset.seen = JSON.stringify(seen);
    });
  }
</script>
`;

type Delivered = {
  readonly type: string;
  readonly isTrusted: boolean;
  readonly isComposing: boolean | null;
  readonly inputType: string | null;
  readonly value: string;
};

/** The field's text and every event the browser delivered to it so far. */
const state = (browser: Browser): Promise<{ value: string; seen: Delivered[] }> =>
  browser.evaluate(() => {
    const field = document.querySelector('#field') as HTMLTextAreaElement;
    return {
      value: field.value,
      seen: JSON.parse(field.dataset.seen ?? '[]') as Delivered[],
    };
  });

/** The field's events, oldest first, as their type names. */
const kinds = (seen: readonly Delivered[]): string[] => seen.map((event) => event.type);

test('an input method leaves unconfirmed words in the field until the composition ends', async ({
  browser,
}) => {
  // The harness makes the page; the field on it is this test's own.
  await browser.goto('/');
  await livePage().setContent(FIELD_PAGE);
  await livePage().click('#field');

  // Composing: the preedit is the field's value already, the browser is still
  // holding it, and nothing has ended the composition. Every event came from
  // the browser, not from a test.
  await imeCompose('にほん');
  const composing = await state(browser);
  expect(composing.value).toBe('にほん');
  expect(kinds(composing.seen)).toEqual(['compositionstart', 'compositionupdate', 'input']);
  expect(composing.seen[0]?.isTrusted).toBe(true);
  expect(composing.seen.at(-1)).toEqual({
    type: 'input',
    isTrusted: true,
    isComposing: true,
    inputType: 'insertCompositionText',
    value: 'にほん',
  });

  // Committed, with the word the person picked rather than the preedit they
  // were shown: the composition the browser held is over, and the field holds
  // the confirmed words. Chromium ends a CDP-driven composition with an
  // untrusted event, so only the kind is asserted here.
  await imeCommit('日本');
  const committed = await state(browser);
  expect(committed.value).toBe('日本');
  expect(kinds(committed.seen)).toEqual([
    'compositionstart',
    'compositionupdate',
    'input',
    'compositionupdate',
    'input',
    'compositionend',
  ]);

  // A preedit the person never confirmed, on a field that loses focus: the
  // words are the field's value and the browser ends the composition itself.
  // This is the click-away the editor has to refuse to save.
  await imeCompose('だめ');
  await browser.evaluate(() => {
    (document.querySelector('#field') as HTMLTextAreaElement).blur();
    return true;
  });
  const left = await state(browser);
  expect(left.value).toBe('日本だめ');
  expect(kinds(left.seen).slice(committed.seen.length)).toEqual([
    'compositionstart',
    'compositionupdate',
    'input',
    'compositionend',
    'blur',
  ]);
});

test('the CPU runs as slow as the helper asks', async ({ browser }) => {
  await browser.goto('/');
  const spin = () =>
    browser.evaluate(() => {
      const start = performance.now();
      let total = 0;
      for (let index = 0; index < 20_000_000; index += 1) total += index % 7;
      return { ms: performance.now() - start, total };
    });

  // One spin to warm the loop up, so the comparison is of the throttle alone.
  await spin();
  const fast = await spin();
  await throttleCpu(4);
  const slow = await spin();
  await throttleCpu(1);

  // 4× the CPU cost leaves a wide margin over the noise of one measurement.
  expect(slow.ms).toBeGreaterThan(fast.ms * 2);
});
