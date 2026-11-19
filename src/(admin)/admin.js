/**
 * Admin routes - every route requires an authenticated admin session.
 * Role changes and vendor approvals go through Better Auth's admin plugin
 * APIs, so all privilege checks are enforced server-side.
 */
const express = require("express");
const { fromNodeHeaders } = require("better-auth/node");

const { getAuth } = require("../(auth)/auth");
const { getDB } = require("../config/db");
const { requireAdmin } = require("../(auth)/middleware");
const { sanitizeUser, toId } = require("../utils/helpers");

const router = express.Router();

const headers = (req) => fromNodeHeaders(req.headers);

/** GET /api/v1/admin/users - list users (paginated, searchable) */
router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const auth = getAuth();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await auth.api.listUsers({
      headers: headers(req),
      query: { limit, offset, sortBy: "createdAt", sortDirection: "desc" },
    });

    res.status(200).json({
      success: true,
      total: result.total,
      users: result.users.map(sanitizeUser),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/admin/users/:id/role - securely change a user's role.
 * Only "customer" | "vendor" | "admin" are accepted; admins cannot change
 * their own role (prevents accidental admin lockout).
 */
router.patch("/users/:id/role", requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body;
    const ALLOWED = ["customer", "vendor", "admin"];

    if (!ALLOWED.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `role must be one of: ${ALLOWED.join(", ")}.`,
      });
    }

    if (req.params.id === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Admins cannot change their own role.",
      });
    }

    const auth = getAuth();
    const result = await auth.api.setRole({
      headers: headers(req),
      body: { userId: req.params.id, role },
    });

    res.status(200).json({
      success: true,
      message: `User role updated to "${role}".`,
      user: sanitizeUser(result.user),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/admin/vendors/:id/approval - approve or reject a vendor.
 * Rejection also unpublishes the vendor's services from the public list.
 */
router.patch("/vendors/:id/approval", requireAdmin, async (req, res, next) => {
  try {
    const approved = req.body.approved;

    if (typeof approved !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Send { approved: true } or { approved: false }.",
      });
    }

    const db = getDB();
    const user = await db
      .collection("user")
      .findOne({ _id: toId(req.params.id), role: "vendor" });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    await db
      .collection("user")
      .updateOne(
        { _id: user._id },
        { $set: { vendorApproved: approved, updatedAt: new Date() } },
      );

    // Keep the service catalog consistent with vendor approval
    await db
      .collection("services")
      .updateMany(
        { vendorId: user._id.toHexString() },
        { $set: { availability: approved, updatedAt: new Date() } },
      );

    res.status(200).json({
      success: true,
      message: approved
        ? "Vendor approved successfully."
        : "Vendor rejected. Their services are now hidden.",
      vendor: sanitizeUser({ ...user, vendorApproved: approved }),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/admin/vendors/pending - vendors waiting for approval */
router.get("/vendors/pending", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();
    const vendors = await db
      .collection("user")
      .find({ role: "vendor", vendorApproved: { $ne: true } })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: vendors.length,
      vendors: vendors.map(sanitizeUser),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/admin/services - admin views all services */
router.get("/services", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();
    const services = await db
      .collection("services")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: services.length,
      services,
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/admin/users/:id/ban - ban a user (admin plugin) */
router.post("/users/:id/ban", requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "You cannot block your own account.",
      });
    }
    const auth = getAuth();
    await auth.api.banUser({
      headers: headers(req),
      body: {
        userId: req.params.id,
        banReason:
          typeof req.body.reason === "string" ? req.body.reason : undefined,
      },
    });

    res.status(200).json({ success: true, message: "User banned." });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/admin/users/:id/unban - unban a user (admin plugin) */
router.post("/users/:id/unban", requireAdmin, async (req, res, next) => {
  try {
    const auth = getAuth();
    await auth.api.unbanUser({
      headers: headers(req),
      body: { userId: req.params.id },
    });

    res.status(200).json({ success: true, message: "User unbanned." });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/v1/admin/users/:id - delete a user (admin plugin) */
router.delete("/users/:id", requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Admins cannot delete their own account.",
      });
    }

    const auth = getAuth();
    await auth.api.removeUser({
      headers: headers(req),
      body: { userId: req.params.id },
    });

    res.status(200).json({ success: true, message: "User deleted." });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/admin/transactions - transactions and financial records */
router.get("/transactions", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();

    // 1. Fetch bookings
    const bookings = await db
      .collection("bookings")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // 2. Fetch vendor subscriptions
    const vendorsWithSub = await db
      .collection("user")
      .find({
        role: "vendor",
        "subscription.plan": { $in: ["premium_monthly", "premium_yearly"] },
      })
      .toArray();

    const transactions = [];

    // Map bookings
    for (const b of bookings) {
      transactions.push({
        id: b._id.toHexString(),
        type: "booking",
        title: b.serviceName || "Wedding Service Reservation",
        customer: b.customerName || b.customerId || "Couple",
        vendor: b.vendorId || "Vendor",
        amount:
          typeof b.servicePrice === "number"
            ? b.servicePrice
            : Number(b.price) || 0,
        currency: "BDT",
        status: b.status || "pending",
        date: b.createdAt || new Date(),
        eventDate: b.eventDate,
      });
    }

    // Map subscriptions
    for (const v of vendorsWithSub) {
      const isYearly = v.subscription?.plan === "premium_yearly";
      transactions.push({
        id: `sub-${v._id.toHexString()}`,
        type: "subscription",
        title: isYearly
          ? "Vendor Premium Yearly Membership"
          : "Vendor Premium Monthly Membership",
        customer: v.name || v.email,
        vendor: v.businessName || v.studioName || v.name,
        amount: isYearly ? 290 : 29,
        currency: "USD",
        status: v.subscription?.status || "active",
        date:
          v.subscription?.startedAt || v.subscription?.updatedAt || new Date(),
      });
    }

    transactions.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const totalBookingValue = bookings
      .filter((b) => b.status === "accepted")
      .reduce((acc, curr) => acc + (Number(curr.servicePrice) || 0), 0);

    const totalSubRevenue = vendorsWithSub.reduce((acc, curr) => {
      return acc + (curr.subscription?.plan === "premium_yearly" ? 290 : 29);
    }, 0);

    res.status(200).json({
      success: true,
      total: transactions.length,
      transactions,
      summary: {
        totalBookingValue,
        totalSubRevenue,
        totalBookings: bookings.length,
        activeSubscriptions: vendorsWithSub.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
