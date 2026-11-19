const { ObjectId } = require("mongodb");

/**
 * Converts a string id to a MongoDB ObjectId when possible.
 * Better Auth stores user/session/account ids as ObjectId in MongoDB
 * but exposes them as strings, and the booking/service collections use
 * plain string references for those ids.
 */
const toId = (value) => {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) {
    return value;
  }
  try {
    return new ObjectId(value);
  } catch {
    return value;
  }
};

/** Whitelist of user fields that are safe to return in API responses. */
const sanitizeUser = (user) => {
  if (!user) return null;

  // Raw MongoDB docs have _id (ObjectId or string); Better Auth API responses have id (string)
  const id =
    user.id ??
    (user._id
      ? typeof user._id === "string"
        ? user._id
        : user._id.toHexString
          ? user._id.toHexString()
          : String(user._id)
      : undefined);

  const {
    name,
    email,
    emailVerified,
    image,
    role,
    vendorApproved,
    banned,
    banReason,
    banExpires,
    createdAt,
    updatedAt,
  } = user;

  return {
    id,
    name,
    email,
    emailVerified: Boolean(emailVerified),
    image: image ?? null,
    role: role ?? "customer",
    vendorApproved: Boolean(vendorApproved),
    banned: Boolean(banned),
    banReason: banReason ?? null,
    banExpires: banExpires ?? null,
    createdAt,
    updatedAt,
  };
};

/** Validates that a value is a non-empty string within a length range. */
const isNonEmptyString = (value, minLength = 1, maxLength = Infinity) =>
  typeof value === "string" &&
  value.trim().length >= minLength &&
  value.trim().length <= maxLength;

/** Validates that a value is a finite non-negative number. */
const isNonNegativeNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

module.exports = { toId, sanitizeUser, isNonEmptyString, isNonNegativeNumber };
