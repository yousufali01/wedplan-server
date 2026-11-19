/**
 * Authentication & authorization middleware for WedPlan.
 *
 * - Supports Better Auth session cookies and Bearer JWT.
 * - Always loads the current user from MongoDB.
 * - Blocked users cannot access protected APIs.
 * - Expired bans are allowed automatically.
 * - Roles and vendor approval are always read from MongoDB.
 */

const { fromNodeHeaders } = require("better-auth/node");
const { createRemoteJWKSet, jwtVerify } = require("jose");

const { getAuth } = require("./auth");
const { getDB } = require("../config/db");
const { sanitizeUser, toId } = require("../utils/helpers");

let jwks = null;

const getJWKSet = () => {
  if (!jwks) {
    const jwksURL = new URL("/api/auth/jwks", process.env.BETTER_AUTH_URL);
    jwks = createRemoteJWKSet(jwksURL);
  }

  return jwks;
};

const verifyBearerToken = async (token) => {
  const baseURL = process.env.BETTER_AUTH_URL;

  const { payload } = await jwtVerify(token, getJWKSet(), {
    issuer: baseURL,
    audience: baseURL,
  });

  return payload;
};

/**
 * Check whether a Better Auth banned user is currently blocked.
 * An expired temporary ban does not block access.
 */
const isUserBlocked = (user) => {
  if (user?.banned !== true) {
    return false;
  }

  if (!user.banExpires) {
    return true;
  }

  const expiresAt = new Date(user.banExpires).getTime();

  if (Number.isNaN(expiresAt)) {
    return true;
  }

  return expiresAt > Date.now();
};

/**
 * Authenticate and load fresh user data from MongoDB.
 */
const authenticateUser = async (req, res, next) => {
  try {
    const auth = getAuth();

    let userId = null;

    const authHeader = req.headers.authorization || "";

    // 1. Bearer JWT authentication
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();

      let payload;

      try {
        payload = await verifyBearerToken(token);
      } catch {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token.",
        });
      }

      userId = payload.sub;
    } else {
      // 2. Better Auth session authentication
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (session?.user?.id) {
        userId = session.user.id;
      }
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please log in first.",
      });
    }

    // 3. Always load the latest user from MongoDB
    const db = getDB();

    const query = {
      $or: [
        { _id: toId(userId) },
        { id: String(userId) },
      ],
    };

    const dbUser = await db.collection("user").findOne(query);

    if (!dbUser) {
      return res.status(401).json({
        success: false,
        message: "User account not found.",
      });
    }

    // 4. Blocked user protection
    if (isUserBlocked(dbUser)) {
      return res.status(403).json({
        success: false,
        blocked: true,
        message:
          "Your account has been blocked by the administrator. Please contact support.",
      });
    }

    // 5. Normalize current DB user
    const id =
      dbUser.id ??
      (dbUser._id?.toHexString ? dbUser._id.toHexString() : String(dbUser._id));

    req.user = {
      ...dbUser,
      id,
    };

    next();
  } catch (error) {
    next(error);
  }
};

/** Role authorization */
const requireRole =
  (...roles) =>
  (req, res, next) => {
    const userRole = req.user?.role ?? "customer";

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. This action requires the ${roles.join(" or ")} role.`,
      });
    }

    next();
  };

/** Vendor approval protection */
const requireVendorApproved = (req, res, next) => {
  if (req.user?.vendorApproved !== true) {
    return res.status(403).json({
      success: false,
      message:
        "Your vendor account has not been approved by an admin yet. Please wait for approval.",
    });
  }

  next();
};

const requireAuth = [authenticateUser];

const requireCustomer = [authenticateUser, requireRole("customer")];

const requireVendor = [
  authenticateUser,
  requireRole("vendor"),
  requireVendorApproved,
];

const requireAdmin = [authenticateUser, requireRole("admin")];

module.exports = {
  isUserBlocked,
  authenticateUser,
  requireRole,
  requireVendorApproved,
  requireAuth,
  requireCustomer,
  requireVendor,
  requireAdmin,
  sanitizeUser,
};
