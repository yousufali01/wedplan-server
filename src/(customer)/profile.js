/**
 * Profile routes (authenticated users).
 * Clients can only change name/image - role, vendorApproved and email
 * are never accepted from the request body (no mass assignment).
 */
const express = require("express");
const { fromNodeHeaders } = require("better-auth/node");

const { getAuth } = require("../(auth)/auth");
const { getDB } = require("../config/db");
const { authenticateUser, requireAuth, requireRole } = require("../(auth)/middleware");
const { sanitizeUser, isNonEmptyString, toId } = require("../utils/helpers");

const router = express.Router();

/**
 * Vendor business profile fields. Kept in a whitelist so a client can never
 * write role, vendorApproved, subscription or any other privileged field.
 */
const VENDOR_PROFILE_FIELDS = {
  businessName: { min: 2, max: 100, required: true },
  studioName: { min: 2, max: 100, required: false },
  phone: { min: 0, max: 30, required: false },
  location: { min: 0, max: 200, required: false },
  bio: { min: 0, max: 1000, required: false },
  website: { min: 0, max: 300, required: false },
};

const buildVendorProfile = (user) => {
  const profile = { ...sanitizeUser(user) };
  for (const field of Object.keys(VENDOR_PROFILE_FIELDS)) {
    profile[field] = user[field] ?? "";
  }
  return profile;
};

// Pending vendors must be able to complete their profile while awaiting approval.
const requireVendorAny = [authenticateUser, requireRole("vendor", "admin")];

/** GET /api/v1/profile - current authenticated user */
router.get("/", requireAuth, (req, res) => {
  res.status(200).json({
    success: true,
    user: sanitizeUser(req.user),
  });
});

/** POST /api/v1/profile/apply-vendor - request to become a vendor (pending admin approval) */
router.post("/apply-vendor", requireAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const userId = req.user.id || (req.user._id ? req.user._id.toHexString() : null);
    if (!userId) {
      return res.status(400).json({ success: false, message: "User not found." });
    }
    await db.collection("user").updateOne(
      { _id: toId(userId) },
      { $set: { role: "vendor", vendorApproved: false, updatedAt: new Date() } }
    );
    res.status(200).json({
      success: true,
      message: "Vendor application submitted successfully. Awaiting admin approval.",
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/profile - update own profile (name and image only) */
router.patch("/", requireAuth, async (req, res, next) => {
  try {
    const updates = {};

    if (req.body.name !== undefined) {
      if (!isNonEmptyString(req.body.name, 2, 50)) {
        return res.status(400).json({
          success: false,
          message: "Name must be a string between 2 and 50 characters.",
        });
      }
      updates.name = req.body.name.trim();
    }

    if (req.body.image !== undefined) {
      if (req.body.image !== null && !isNonEmptyString(req.body.image, 1, 500)) {
        return res.status(400).json({
          success: false,
          message: "Image must be a URL string (or null to remove it).",
        });
      }
      updates.image = req.body.image;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update. Send 'name' and/or 'image'.",
      });
    }

    const auth = getAuth();
    await auth.api.updateUser({
      headers: fromNodeHeaders(req.headers),
      body: updates,
    });

    // Re-fetch the fresh user record
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: sanitizeUser(session.user),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/profile/vendor - vendor business profile (fresh from DB). */
router.get("/vendor", requireVendorAny, async (req, res, next) => {
  try {
    const vendor = await getDB()
      .collection("user")
      .findOne({ _id: toId(req.user.id) });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }

    return res.status(200).json({
      success: true,
      profile: buildVendorProfile(vendor),
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/profile/vendor - update only whitelisted business fields. */
router.patch("/vendor", requireVendorAny, async (req, res, next) => {
  try {
    const updates = {};

    for (const [field, rule] of Object.entries(VENDOR_PROFILE_FIELDS)) {
      if (req.body[field] === undefined) continue;

      const value = req.body[field];

      if (typeof value !== "string") {
        return res.status(400).json({
          success: false,
          message: `${field} must be a string.`,
        });
      }

      // Optional fields can be cleared with an empty string; required ones cannot.
      if (
        value.trim().length > rule.max ||
        (value.trim().length > 0 && value.trim().length < rule.min) ||
        (rule.required && value.trim().length === 0)
      ) {
        return res.status(400).json({
          success: false,
          message: `${field} must be between ${rule.min} and ${rule.max} characters.`,
        });
      }

      if (field === "website" && value.trim() && !/^https?:\/\//i.test(value.trim())) {
        return res.status(400).json({
          success: false,
          message: "website must start with http:// or https://.",
        });
      }

      updates[field] = value.trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update.",
      });
    }

    const db = getDB();
    updates.updatedAt = new Date();

    await db.collection("user").updateOne(
      { _id: toId(req.user.id) },
      { $set: updates },
    );

    const vendor = await db
      .collection("user")
      .findOne({ _id: toId(req.user.id) });

    return res.status(200).json({
      success: true,
      message: "Vendor profile updated successfully.",
      profile: buildVendorProfile(vendor),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
