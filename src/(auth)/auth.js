/**
 * Better Auth configuration for WedPlan.
 *
 * Reuses the existing MongoDB connection created in src/config/db.js
 * (no new MongoClient is created here).
 *
 * Roles: customer (default) | vendor | admin
 *  - New users are always "customer". The role sent by the frontend is never trusted.
 *  - "vendor" / "admin" roles can only be granted through admin-only APIs
 *    (Better Auth admin plugin) or the protected create-admin script.
 *  - vendorApproved is an admin-controlled flag required for vendor access.
 */
const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("@better-auth/mongo-adapter");
const { admin, jwt } = require("better-auth/plugins");

const ROLES = ["customer", "vendor", "admin"];

/** Validates required Better Auth environment variables and returns a clear error if missing. */
const validateEnv = () => {
  const missing = [];
  if (!process.env.BETTER_AUTH_SECRET) missing.push("BETTER_AUTH_SECRET");
  if (!process.env.BETTER_AUTH_URL) missing.push("BETTER_AUTH_URL");
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) in .env: ${missing.join(", ")}. ` +
        "Please add them to your .env file and restart the server."
    );
  }

  if (
    process.env.BETTER_AUTH_SECRET === process.env.GOOGLE_CLIENT_SECRET
  ) {
    throw new Error(
      "BETTER_AUTH_SECRET must NOT be the same value as GOOGLE_CLIENT_SECRET. " +
        "Set BETTER_AUTH_SECRET to a long random string (e.g. generated with crypto.randomBytes(32).toString('hex'))."
    );
  }
};

let auth = null;

/**
 * Creates (once) the Better Auth instance on top of the existing MongoDB connection.
 * @param {import("mongodb").Db} db - the database handle from src/config/db.js
 * @param {import("mongodb").MongoClient} client - the shared MongoClient (enables transactions)
 */
const initAuth = (db, client) => {
  if (auth) return auth;

  validateEnv();

  auth = betterAuth({
    // MongoDB adapter on the EXISTING connection
    database: mongodbAdapter(db, {
      client,
      transaction: true,
    }),

    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,

    trustedOrigins: [
      process.env.FRONTEND_URL,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].filter(Boolean),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh the session once a day
    },

    user: {
      additionalFields: {
        // Admin-controlled vendor approval flag.
        // input: false  ->  clients can NEVER set it during signup/update (no privilege escalation)
        vendorApproved: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },

        // Vendor business profile. `input: false` means these can only be
        // written by the server (PATCH /api/v1/profile/vendor) — never by a
        // client through signup or Better Auth's updateUser endpoint.
        businessName: { type: "string", required: false, input: false },
        studioName: { type: "string", required: false, input: false },
        phone: { type: "string", required: false, input: false },
        location: { type: "string", required: false, input: false },
        bio: { type: "string", required: false, input: false },
        website: { type: "string", required: false, input: false },
      },
    },

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },

    plugins: [
      // Role management: default role is "customer", only "admin" has admin powers.
      // The admin plugin adds role to the user model and guards every /admin/* endpoint.
      admin({
        defaultRole: "customer",
        adminRoles: ["admin"],
      }),

      // JWT plugin: issues API tokens at /api/auth/token and publishes JWKS at /api/auth/jwks.
      // Session cookies are preferred; JWTs are for external API integration.
      jwt(),
    ],
  });

  return auth;
};

/** Returns the initialized Better Auth instance. Throws if initAuth() has not run yet. */
const getAuth = () => {
  if (!auth) {
    throw new Error(
      "Better Auth is not initialized! Make sure initAuth(db) runs after connectDB()."
    );
  }
  return auth;
};

module.exports = { initAuth, getAuth, ROLES };
