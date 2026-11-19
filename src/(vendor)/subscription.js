/**
 * Vendor subscription routes.
 *  - Premium is activated ONLY after a real Stripe Checkout session is
 *    retrieved from Stripe and verified as paid for the current vendor.
 *  - No client-supplied plan/session string can grant Premium by itself.
 */
const express = require("express");
const Stripe = require("stripe");

const { getDB } = require("../config/db");
const { requireVendor } = require("../(auth)/middleware");
const { toId } = require("../utils/helpers");
const {
  PREMIUM_PLANS,
  isPremiumActive,
} = require("../utils/subscription");

const router = express.Router();

let stripe = null;
const getStripe = () => {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY || "";
    if (!key) return null;
    stripe = new Stripe(key);
  }
  return stripe;
};

const PLANS = {
  free: {
    name: "Free",
    price: 0,
    interval: "month",
    activeServiceLimit: 3,
  },
  premium_monthly: {
    name: "Premium Monthly",
    price: 29,
    interval: "month",
    activeServiceLimit: null,
  },
  premium_yearly: {
    name: "Premium Yearly",
    price: 290,
    interval: "year",
    activeServiceLimit: null,
  },
};

const resolveVendorId = (user) =>
  String(user?.id || user?._id || "");

const getActiveServiceCount = async (db, vendorId) => {
  const vIdStr = String(vendorId);
  return db.collection("services").countDocuments({
    $or: [{ vendorId: vIdStr }, { vendorId: toId(vIdStr) }],
    availability: true,
  });
};

/** Public subscription shape: expired/inactive premium degrades to Free. */
const buildSubscriptionResponse = (subscription, activeServices) => {
  const premium = isPremiumActive(subscription);
  const effectivePlan = premium ? subscription.plan : "free";
  const plan = PLANS[effectivePlan] || PLANS.free;

  return {
    ...subscription,
    plan: effectivePlan,
    planName: plan.name,
    price: plan.price,
    interval: plan.interval,
    activeServiceLimit: plan.activeServiceLimit,
    activeServices,
    remainingServices:
      plan.activeServiceLimit === null
        ? null
        : Math.max(0, plan.activeServiceLimit - activeServices),
    isPremium: premium,
    expired: PREMIUM_PLANS.includes(subscription?.plan) && !premium,
  };
};

/** Public shape for stored cards — only these keys ever leave the server. */
const sanitizeCards = (cards) =>
  Array.isArray(cards)
    ? cards
        .filter((card) => card && typeof card.id === "string")
        .map((card) => ({
          id: card.id,
          brand: card.brand || "card",
          last4: card.last4 || "",
          expMonth: card.expMonth || null,
          expYear: card.expYear || null,
        }))
    : [];

// GET /api/v1/subscription/plans
router.get("/plans", (req, res) => {
  res.json({ success: true, plans: PLANS });
});

// GET /api/v1/subscription/mine
router.get("/mine", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();
    const vendorId = resolveVendorId(req.user);

    const vendor = await db.collection("user").findOne({
      $or: [{ _id: toId(vendorId) }, { id: vendorId }],
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    const activeServices = await getActiveServiceCount(db, vendorId);

    res.json({
      success: true,
      subscription: buildSubscriptionResponse(
        vendor.subscription || { plan: "free", status: "active" },
        activeServices,
      ),
      paymentMethods: sanitizeCards(vendor.paymentMethods),
      plans: PLANS,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/subscription/create-checkout-session
router.post(
  "/create-checkout-session",
  requireVendor,
  async (req, res, next) => {
    try {
      const stripeInstance = getStripe();
      if (!stripeInstance) {
        return res.status(503).json({
          success: false,
          message: "Stripe secret key is not configured on the server.",
        });
      }

      const requestedPlan = req.body?.planId || req.body?.plan;
      const plan = PREMIUM_PLANS.includes(requestedPlan)
        ? requestedPlan
        : "premium_monthly";
      const planInfo = PLANS[plan];

      const frontendUrl =
        process.env.FRONTEND_URL || "http://localhost:3000";
      const vendorId = resolveVendorId(req.user);

      // NOTE: do NOT send `payment_method_types` — Stripe now manages payment
      // methods from the Dashboard and rejects that parameter with a 400.
      const session = await stripeInstance.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `WedPlan ${planInfo.name}`,
                description: `Upgrade to ${planInfo.name} for unlimited listings and full booking access.`,
              },
              unit_amount: planInfo.price * 100,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: req.user.email || undefined,
        metadata: { vendorId, planId: plan },
        success_url: `${frontendUrl}/vendor/subscription?success=true&session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
        cancel_url: `${frontendUrl}/vendor/subscription?canceled=true`,
      });

      res.json({
        success: true,
        url: session.url,
        sessionId: session.id,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Builds the Premium subscription document stored on the vendor's user record.
 * Both the Stripe Checkout flow and the in-app card flow use this so the
 * stored shape (and expiry math) can never drift apart.
 */
const buildSubscriptionDoc = (plan, payment = {}) => {
  const now = new Date();
  const expiresAt = new Date(now);

  if (plan === "premium_yearly") {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }

  return {
    plan,
    status: "active",
    startedAt: now,
    expiresAt,
    paymentStatus: "paid",
    ...(payment.stripeSessionId ? { stripeSessionId: payment.stripeSessionId } : {}),
    ...(payment.paymentIntentId ? { paymentIntentId: payment.paymentIntentId } : {}),
    amountPaid:
      typeof payment.amountPaid === "number"
        ? payment.amountPaid
        : PLANS[plan].price,
    updatedAt: now,
  };
};

/** Loads the vendor's user document (or null). */
const findVendorDoc = async (db, vendorId) =>
  db
    .collection("user")
    .findOne({ $or: [{ _id: toId(vendorId) }, { id: vendorId }] });

/**
 * Shared activation used by both /verify-stripe-session and /upgrade.
 * The plan and the vendor come from Stripe's session metadata — never from
 * the request body.
 */
const activatePremium = async (req, res) => {
  const sessionId = req.body?.sessionId;

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({
      success: false,
      message: "sessionId is required.",
    });
  }

  const stripeInstance = getStripe();
  if (!stripeInstance) {
    return res.status(503).json({
      success: false,
      message: "Stripe is not configured on the server. Premium cannot be activated.",
    });
  }

  let session;
  try {
    session = await stripeInstance.checkout.sessions.retrieve(sessionId.trim());
  } catch (error) {
    console.error("Stripe session retrieval error:", error);
    return res.status(400).json({
      success: false,
      message: "Invalid Stripe checkout session.",
    });
  }

  if (session.payment_status !== "paid") {
    return res.status(400).json({
      success: false,
      message:
        "Payment has not been completed. Please finish the Stripe checkout.",
    });
  }

  const vendorId = resolveVendorId(req.user);
  if (!vendorId) {
    return res.status(401).json({
      success: false,
      message: "Could not identify your account. Please sign in again.",
    });
  }

  if (String(session.metadata?.vendorId || "") !== vendorId) {
    return res.status(403).json({
      success: false,
      message: "This payment belongs to a different vendor account.",
    });
  }

  const plan = PREMIUM_PLANS.includes(session.metadata?.planId)
    ? session.metadata.planId
    : "premium_monthly";

  const db = getDB();
  const subscription = buildSubscriptionDoc(plan, {
    stripeSessionId: session.id,
    amountPaid: session.amount_total
      ? session.amount_total / 100
      : PLANS[plan].price,
  });

  const result = await db.collection("user").updateOne(
    { $or: [{ _id: toId(vendorId) }, { id: vendorId }] },
    { $set: { subscription } },
  );

  if (!result.matchedCount) {
    return res.status(404).json({
      success: false,
      message: "Vendor not found.",
    });
  }

  return res.json({
    success: true,
    message: "Payment verified! Your Premium plan is now active.",
    subscription: buildSubscriptionResponse(
      subscription,
      await getActiveServiceCount(db, vendorId),
    ),
  });
};

/**
 * GET /api/v1/subscription/payment-methods
 * Cards the vendor saved during checkout (used by the payment page).
 */
router.get("/payment-methods", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();
    const vendorId = resolveVendorId(req.user);
    const vendor = await findVendorDoc(db, vendorId);

    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found." });
    }

    res.json({
      success: true,
      paymentMethods: sanitizeCards(vendor.paymentMethods),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/subscription/pay
 * In-app card payment: the browser tokenises the card with Stripe.js and the
 * server confirms a PaymentIntent with that PaymentMethod. Premium is only
 * granted once Stripe reports the intent as `succeeded`.
 *
 * Body: { paymentMethodId, planId?, saveCard?, useSavedCard? }
 */
router.post("/pay", requireVendor, async (req, res, next) => {
  try {
    const stripeInstance = getStripe();
    if (!stripeInstance) {
      return res.status(503).json({
        success: false,
        message: "Stripe secret key is not configured on the server.",
      });
    }

    const body = req.body || {};
    const requestedPlan = body.planId || body.plan;
    const plan = PREMIUM_PLANS.includes(requestedPlan)
      ? requestedPlan
      : "premium_monthly";
    const planInfo = PLANS[plan];

    const vendorId = resolveVendorId(req.user);
    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: "Could not identify your account. Please sign in again.",
      });
    }

    const db = getDB();
    const vendor = await findVendorDoc(db, vendorId);

    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found." });
    }

    const savedCards = sanitizeCards(vendor.paymentMethods);
    const useSavedCard = body.useSavedCard === true;
    const saveCard = body.saveCard === true && !useSavedCard;
    const paymentMethodId =
      typeof body.paymentMethodId === "string" ? body.paymentMethodId.trim() : "";

    if (useSavedCard) {
      if (!savedCards.some((card) => card.id === paymentMethodId)) {
        return res.status(400).json({
          success: false,
          message: "That saved card was not found. Please add a new card.",
        });
      }
    } else if (!/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) {
      return res.status(400).json({
        success: false,
        message: "A valid card is required. Please enter your card details.",
      });
    }

    // Saved cards must live on a Stripe Customer before they can be re-used.
    // The customer is created once and remembered on the vendor's user record.
    let customerId = vendor.stripeCustomerId || null;

    if (!customerId) {
      try {
        const customer = await stripeInstance.customers.create({
          ...(req.user.email ? { email: req.user.email } : {}),
          ...(req.user.name ? { name: req.user.name } : {}),
          metadata: { vendorId: String(vendorId) },
        });
        customerId = customer.id;
        await db.collection("user").updateOne(
          { $or: [{ _id: toId(vendorId) }, { id: vendorId }] },
          { $set: { stripeCustomerId: customerId } },
        );
      } catch (error) {
        if (useSavedCard) {
          return res.status(402).json({
            success: false,
            message:
              error?.message ||
              "We could not set up your saved card. Please add a new card.",
          });
        }
        // A first-time card payment still works without a customer — we just
        // cannot remember the card for next time.
      }
    }

    // Only promise to save the card when we actually have somewhere to store
    // it in Stripe, otherwise re-use would fail later.
    const willSaveCard = saveCard && Boolean(customerId);

    if (useSavedCard && customerId) {
      try {
        await stripeInstance.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });
      } catch (error) {
        // Already attached to this customer — that is the normal case.
        if (!/already attached/i.test(error?.message || "")) {
          return res.status(402).json({
            success: false,
            message: error?.message || "That saved card could not be used.",
          });
        }
      }
    }

    let intent;
    try {
      intent = await stripeInstance.paymentIntents.create({
        amount: planInfo.price * 100,
        currency: "usd",
        payment_method: paymentMethodId,
        confirm: true,
        ...(customerId ? { customer: customerId } : {}),
        // We only ever confirm card payments in-page, so redirects are
        // disabled (and no return_url is required).
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        // Stripe forbids `off_session: true` together with
        // `setup_future_usage` — saving a card must be an on-session confirm.
        ...(willSaveCard
          ? { setup_future_usage: "off_session" }
          : { off_session: true }),
        description: `WedPlan ${planInfo.name}`,
        ...(req.user.email ? { receipt_email: req.user.email } : {}),
        metadata: { vendorId, planId: plan },
      });
    } catch (error) {
      // Card problems (declined, expired, insufficient funds...) are expected
      // user-facing outcomes, not server errors.
      if (
        error?.type === "StripeCardError" ||
        error?.type === "StripeInvalidRequestError"
      ) {
        return res.status(402).json({
          success: false,
          message: error.message || "Your card could not be processed.",
          code: error.code || error.type,
        });
      }
      throw error;
    }

    if (intent.status !== "succeeded") {
      return res.status(402).json({
        success: false,
        code: intent.status,
        message:
          intent.status === "requires_action"
            ? "This card needs extra authentication. Please try a different card."
            : `Payment could not be completed (status: ${intent.status}).`,
      });
    }

    const update = {
      $set: {
        subscription: buildSubscriptionDoc(plan, {
          paymentIntentId: intent.id,
          amountPaid: intent.amount / 100,
        }),
        updatedAt: new Date(),
      },
    };

    if (willSaveCard) {
      try {
        const pm = await stripeInstance.paymentMethods.retrieve(paymentMethodId);
        const card = pm.card || {};
        const entry = {
          id: pm.id,
          brand: card.brand || "card",
          last4: card.last4 || "",
          expMonth: card.exp_month || null,
          expYear: card.exp_year || null,
          createdAt: new Date(),
        };
        // Keep at most 4 cards, newest first, no duplicates.
        update.$set.paymentMethods = [
          entry,
          ...savedCards.filter((card) => card.id !== entry.id),
        ].slice(0, 4);
      } catch {
        // Saving the card is a convenience — never fail the payment over it.
      }
    }

    const result = await db.collection("user").updateOne(
      { $or: [{ _id: toId(vendorId) }, { id: vendorId }] },
      update,
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    const subscription = update.$set.subscription;

    res.json({
      success: true,
      message: "Payment successful! Your Premium plan is now active.",
      paymentIntentId: intent.id,
      subscription: buildSubscriptionResponse(
        subscription,
        await getActiveServiceCount(db, vendorId),
      ),
      paymentMethods: sanitizeCards(update.$set.paymentMethods || savedCards),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/subscription/verify-stripe-session
router.post("/verify-stripe-session", requireVendor, (req, res, next) => {
  Promise.resolve(activatePremium(req, res)).catch(next);
});

// POST /api/v1/subscription/upgrade
router.post("/upgrade", requireVendor, async (req, res, next) => {
  try {
    const { plan, sessionId } = req.body || {};

    if (sessionId) {
      // Old clients may send plan too; it is ignored by activatePremium.
      void plan;
      return await activatePremium(req, res);
    }

    return res.status(402).json({
      success: false,
      message:
        "Payment is required to activate a Premium plan. Please proceed through Stripe checkout.",
      requiresPayment: true,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/subscription/downgrade - return to the Free plan.
router.post("/downgrade", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();
    const subscription = {
      plan: "free",
      status: "active",
      startedAt: new Date(),
      paymentStatus: "free",
      updatedAt: new Date(),
    };

    const vendorId = resolveVendorId(req.user);
    const result = await db.collection("user").updateOne(
      { $or: [{ _id: toId(vendorId) }, { id: vendorId }] },
      { $set: { subscription } },
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    res.json({
      success: true,
      message: "Switched to the Free plan.",
      subscription: buildSubscriptionResponse(
        subscription,
        await getActiveServiceCount(db, vendorId),
      ),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
