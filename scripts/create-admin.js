/**
 * One-time secure admin initialization script.
 *
 * Usage:  npm run create-admin
 *
 * Reads ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD from .env (never from the API
 * or the frontend) and creates the first admin account through Better Auth's
 * server-side createUser API. Ordinary users can NEVER promote themselves.
 *
 * - If the admin already exists, the script does nothing (idempotent, no overwrite).
 * - If the email exists as a non-admin user, the script aborts with a message.
 */
require("dotenv").config();

const { connectDB, closeDB } = require("../src/config/db");
const { initAuth } = require("../src/(auth)/auth");
const { isNonEmptyString } = require("../src/utils/helpers");

const createAdmin = async () => {
  let exitCode = 0;

  try {
    const name = process.env.ADMIN_NAME;
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    const missing = [];
    if (!isNonEmptyString(name, 2, 50)) missing.push("ADMIN_NAME");
    if (!isNonEmptyString(email, 5, 100) || !email.includes("@"))
      missing.push("ADMIN_EMAIL (must be a valid email)");
    if (!isNonEmptyString(password, 8)) missing.push("ADMIN_PASSWORD (min 8 chars)");

    if (missing.length > 0) {
      throw new Error(
        `Missing/invalid environment variable(s): ${missing.join(", ")}. ` +
          "Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env first."
      );
    }

    const db = await connectDB();
    const auth = initAuth(db, null);

    // Server-side creation through Better Auth (handles password hashing, role field, etc.)
    await auth.api.createUser({
      body: { name: name.trim(), email: email.trim().toLowerCase(), password, role: "admin" },
    });

    console.log(`✅ Admin created successfully: ${email.trim().toLowerCase()}`);
    console.log("   You can now log in with this account through /api/auth/sign-in/email");
  } catch (error) {
    const message = error?.message || String(error);
    const bodyMessage = error?.body?.message;

    if (
      message.includes("already exists") ||
      message.includes("USER_ALREADY_EXISTS") ||
      (bodyMessage && bodyMessage.toLowerCase().includes("already"))
    ) {
      console.log(
        `ℹ️  An account with this email already exists. No changes were made.`
      );
      console.log(
        "   If it is not an admin yet, promote it with the admin role API by another admin."
      );
    } else {
      console.error("❌ Admin creation failed:", message);
      exitCode = 1;
    }
  } finally {
    await closeDB();
  }

  process.exit(exitCode);
};

createAdmin();
