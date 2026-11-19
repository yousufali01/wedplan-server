/**
 * Ensures the required MongoDB indexes exist.
 * Better Auth already manages indexes for its own collections (user, session, account...);
 * here we add the application-level indexes for services and bookings.
 */


const ensureIndexes = async (db) => {
  const created = [];

  await db.collection("services").createIndex({ vendorId: 1 });
  created.push("services.vendorId");

  await db.collection("services").createIndex({ category: 1 });
  created.push("services.category");

  await db.collection("bookings").createIndex({ customerId: 1 });
  created.push("bookings.customerId");

  await db.collection("bookings").createIndex({ vendorId: 1 });
  created.push("bookings.vendorId");

  await db.collection("bookings").createIndex({ serviceId: 1 });
  created.push("bookings.serviceId");

  await db.collection("bookings").createIndex({ status: 1 });
  created.push("bookings.status");

  // TTL index: expired sessions are cleaned up automatically by MongoDB
  await db
    .collection("session")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  created.push("session.expiresAt (TTL)");

  console.log(`✅ Database indexes ready: ${created.join(", ")}`);
};

module.exports = { ensureIndexes };
