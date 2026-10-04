# Atlas 14-day free trial

Atlas offers a 14-day free trial through Paddle recurring prices. A plan is shown as available only after Atlas reads the configured Paddle price and verifies that it is active, recurring, free for exactly 14 days, requires a payment method, has no paid trial-country overrides, and then renews at a non-zero base price. Checkout performs the same verification again before creating a transaction. A provider price that does not match fails closed.

The trial requires a payment method at signup. Paddle Checkout must show the renewal price and cadence before the customer agrees. Paddle transitions the subscription from `trialing` to paid billing at the end of the trial unless the customer cancels. Company billing administrators can open Paddle's authenticated customer portal from the Payments screen to view or cancel a subscription and manage payment details. Atlas never stores the temporary portal token links.

## Paddle setup

For each Atlas plan, configure an active recurring Paddle price against the correct Atlas product. Keep the recurring amount and cadence consistent with the plan presented to customers. The Paddle price needs a free trial with:

```json
{
  "billing_cycle": { "interval": "month", "frequency": 1 },
  "trial_period": {
    "interval": "day",
    "frequency": 14,
    "requires_payment_method": true
  }
}
```

Do not set a trial `unit_price` or country trial-price overrides. Configure Paddle to use its normal trial disclosures and customer portal. The account API key needs `price.read`, transaction creation permission, and `customer_portal_session.write`. Configure the matching sandbox or live `ATLAS_PADDLE_PRICE_STARTER`, `ATLAS_PADDLE_PRICE_GROWTH`, and `ATLAS_PADDLE_PRICE_SCALE` values, plus the environment, API key, webhook secret and subscription notifications. Paddle stores the trial on the price entity; checkout cannot manufacture a trial by adding a client-supplied duration.

Atlas accepts the Paddle `subscription.trialing` event only when it includes the configured 14-day free-trial price. V115 stores a tenant-scoped `trial_started_at` marker and keeps it after cancellation, so the same workspace cannot start another free trial. Active or trialing subscriptions block a second checkout. The provider event also updates the tenant billing record idempotently.

## Local verification

The repository tests use a deterministic Paddle API stub and PGlite. They verify price checks, exact 14-day/free/card-required rules, fail-closed checkout, no repeat trial after cancellation, Paddle portal link validation and retention of the tenant's trial-use marker. These tests do not create a real Paddle customer or verify a configured Paddle account. Before launch, configure Paddle sandbox prices and credentials, verify checkout and cancellation manually, then switch to approved live products and prices.

See [Paddle's trial guide](https://developer.paddle.com/build/trials/create-trial/) and [Paddle's customer portal API](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/) for provider behavior.
