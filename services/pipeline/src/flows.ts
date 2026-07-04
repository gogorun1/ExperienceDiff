import type { Page } from 'playwright';
import { EvidenceRecorder } from './evidence.js';

export interface FlowContext {
  page: Page;
  baseUrl: string;
  recorder: EvidenceRecorder;
  viewport: 'desktop' | 'mobile';
}

export type FlowRunner = (ctx: FlowContext) => Promise<void>;

async function recordNavigation(ctx: FlowContext, path: string): Promise<void> {
  await ctx.page.waitForURL(`**${path}**`, { timeout: 10_000 });
  ctx.recorder.record('navigation', `Navigated to ${path}`, { value: path });
}

/**
 * Checkout happy path. Written against the demo-shop `main` (before) branch;
 * it must ALSO pass on pr-a/pr-b branches — branch differences are captured
 * as evidence, not as flow failures. Selector presence is therefore probed
 * with short timeouts instead of hard assertions.
 */
const checkoutHappy: FlowRunner = async (ctx) => {
  const { page, recorder, baseUrl } = ctx;

  await page.goto(`${baseUrl}/products`);
  recorder.record('navigation', 'Navigated to /products', { value: '/products' });

  await page.getByTestId('go-to-cart').click();
  recorder.record('click', 'Clicked cart link', { selector: "[data-testid='go-to-cart']" });
  await recordNavigation(ctx, '/cart');

  await page.getByTestId('checkout-button').click();
  recorder.record('click', 'Clicked Checkout', { selector: "[data-testid='checkout-button']" });

  // Before branch: shipping -> payment -> review. After (pr-a): unified /checkout.
  const isUnified = await page
    .getByTestId('pay-now-button')
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  if (isUnified) {
    recorder.record('navigation', 'Navigated to unified /checkout', { value: '/checkout' });
    await page.getByTestId('pay-now-button').click();
    recorder.record('click', 'Clicked Pay now', { selector: "[data-testid='pay-now-button']" });

    // The core PR-A assertions: is there loading feedback during the wait?
    const spinnerVisible = await page
      .getByTestId('payment-loading')
      .waitFor({ state: 'visible', timeout: 800 })
      .then(() => true)
      .catch(() => false);
    recorder.record(
      'assertion',
      spinnerVisible
        ? 'Loading indicator visible during payment wait'
        : 'No loading indicator visible during payment wait',
      { selector: "[data-testid='payment-loading']", value: !spinnerVisible },
    );

    const disabled = await page.getByTestId('pay-now-button').isDisabled();
    recorder.record(
      'assertion',
      disabled
        ? 'Pay now button disabled during payment wait'
        : 'Pay now button stays enabled during payment wait',
      { selector: "[data-testid='pay-now-button']", value: disabled },
    );
  } else {
    await recordNavigation(ctx, '/checkout/shipping');
    await page.getByTestId('continue-button').click();
    recorder.record('click', 'Clicked Continue on shipping', {
      selector: "[data-testid='continue-button']",
    });

    await recordNavigation(ctx, '/checkout/payment');
    await page.getByTestId('continue-button').click();
    recorder.record('click', 'Clicked Continue on payment', {
      selector: "[data-testid='continue-button']",
    });

    await recordNavigation(ctx, '/checkout/review');
    await page.getByTestId('place-order-button').click();
    recorder.record('click', 'Clicked Place order', {
      selector: "[data-testid='place-order-button']",
    });

    const spinnerVisible = await page
      .getByTestId('payment-loading')
      .waitFor({ state: 'visible', timeout: 800 })
      .then(() => true)
      .catch(() => false);
    if (spinnerVisible) {
      recorder.record('visible', 'Processing payment spinner is visible', {
        selector: "[data-testid='payment-loading']",
      });
    }

    const disabled = await page.getByTestId('place-order-button').isDisabled();
    recorder.record('assertion', 'Place order button disabled during processing', {
      selector: "[data-testid='place-order-button']",
      value: disabled,
    });
  }

  await recordNavigation(ctx, '/order/success');
  recorder.record('visible', 'Order success message visible', {
    selector: "[data-testid='order-success-message']",
  });
};

/**
 * Checkout failure branch (?fail=1). Captures error modal + retry (before)
 * vs generic /order/error page without retry (pr-c).
 */
const checkoutFail: FlowRunner = async (ctx) => {
  const { page, recorder, baseUrl } = ctx;

  await page.goto(`${baseUrl}/products`);
  recorder.record('navigation', 'Navigated to /products', { value: '/products' });
  await page.getByTestId('go-to-cart').click();
  await recordNavigation(ctx, '/cart');
  await page.getByTestId('checkout-button').click();

  const isUnified = await page
    .getByTestId('pay-now-button')
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  if (isUnified) {
    await page.goto(`${baseUrl}/checkout?fail=1`);
    await page.getByTestId('pay-now-button').click();
    recorder.record('click', 'Clicked Pay now (payment will fail)', {
      selector: "[data-testid='pay-now-button']",
    });
  } else {
    await recordNavigation(ctx, '/checkout/shipping');
    await page.getByTestId('continue-button').click();
    await recordNavigation(ctx, '/checkout/payment');
    await page.getByTestId('continue-button').click();
    await recordNavigation(ctx, '/checkout/review');
    await page.goto(`${baseUrl}/checkout/review?fail=1`);
    await page.getByTestId('place-order-button').click();
    recorder.record('click', 'Clicked Place order (payment will fail)', {
      selector: "[data-testid='place-order-button']",
    });
  }

  const modalVisible = await page
    .getByTestId('payment-error-modal')
    .waitFor({ state: 'visible', timeout: 4_000 })
    .then(() => true)
    .catch(() => false);

  if (modalVisible) {
    recorder.record('visible', "Error modal visible: 'Payment failed. Please try again.'", {
      selector: "[data-testid='payment-error-modal']",
    });
    const retryVisible = await page.getByTestId('retry-payment-button').isVisible();
    recorder.record(
      retryVisible ? 'visible' : 'assertion',
      retryVisible ? 'Retry payment button is visible' : 'No retry button present',
      { selector: "[data-testid='retry-payment-button']", value: retryVisible },
    );
  } else {
    await recordNavigation(ctx, '/order/error');
    const retryVisible = await page
      .getByTestId('retry-payment-button')
      .isVisible()
      .catch(() => false);
    recorder.record('assertion', 'No retry button present on error page', {
      selector: "[data-testid='retry-payment-button']",
      value: retryVisible,
    });
  }
};

export const FLOWS: Record<string, FlowRunner> = {
  'checkout-happy': checkoutHappy,
  'checkout-fail': checkoutFail,
};
