/**
 * Shared subscription helpers. Keeps "who is Premium" consistent across the
 * subscription, booking and service routes.
 */

const PREMIUM_PLANS = ["premium_monthly", "premium_yearly"];

/** A premium plan only counts when active AND not expired. */
const isPremiumActive = (subscription) => {
  if (!subscription || !PREMIUM_PLANS.includes(subscription.plan)) return false;
  if (subscription.status && subscription.status !== "active") return false;
  if (subscription.expiresAt && new Date(subscription.expiresAt) <= new Date()) {
    return false;
  }
  return true;
};

module.exports = { PREMIUM_PLANS, isPremiumActive };
