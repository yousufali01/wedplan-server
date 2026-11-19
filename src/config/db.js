const { MongoClient, ServerApiVersion } = require("mongodb");

let client = null;
let db = null;

/**
 * Builds the MongoDB connection string from environment variables.
 *
 * Supports the Atlas template format:
 *   DB_URI=mongodb+srv://<db_username>:<db_password>@cluster0.xxxxx.mongodb.net/...
 * The <db_username> and <db_password> placeholders are filled automatically
 * from DB_USER and DB_PASSWORD (the password is URL-encoded so special
 * characters like @ : / # ? work safely).
 *
 * A full URI with credentials already embedded is also supported and used as-is.
 */
const buildUri = () => {
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbUri = process.env.DB_URI;

  // 1. Make sure the required variables exist
  const missing = [];
  if (!dbUri) missing.push("DB_URI");
  if (!dbUser) missing.push("DB_USER");
  if (!dbPassword) missing.push("DB_PASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) in .env: ${missing.join(", ")}. ` +
        "Please add them to your .env file and restart the server.",
    );
  }

  // 2. Detect unfilled placeholder values in the credentials (e.g. "<your-atlas-username>")
  for (const [name, value] of [
    ["DB_USER", dbUser],
    ["DB_PASSWORD", dbPassword],
  ]) {
    if (value.includes("<")) {
      throw new Error(
        `${name} in .env is still a placeholder ("${value}"). ` +
          "Replace it with your real MongoDB Atlas credentials.",
      );
    }
  }

  let uri = dbUri;

  if (uri.includes("<db_username>") || uri.includes("<db_password>")) {
    // Atlas template: fill in the placeholders from DB_USER / DB_PASSWORD
    uri = uri
      .replace("<db_username>", encodeURIComponent(dbUser))
      .replace("<db_password>", encodeURIComponent(dbPassword));
  } else if (!uri.includes("@")) {
    // URI has no credentials embedded: build them from DB_USER / DB_PASSWORD
    const scheme = uri.startsWith("mongodb+srv://")
      ? "mongodb+srv://"
      : uri.startsWith("mongodb://")
        ? "mongodb://"
        : "mongodb+srv://";
    const rest = uri.startsWith(scheme) ? uri.slice(scheme.length) : uri;
    uri = `${scheme}${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${rest}`;
  }
  // Otherwise the URI already contains credentials and is used as-is.

  return uri;
};

/**
 * Connects to MongoDB Atlas and verifies the connection with a real ping command.
 * Throws (and therefore prevents the Express server from starting) on failure.
 */
const connectDB = async () => {
  const uri = buildUri();

  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    // Fail fast with a meaningful error if the cluster cannot be reached
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();

    db = client.db(process.env.DB_NAME || "WedPlan");

    // Real connectivity check - not a fake success message
    await db.command({ ping: 1 });

    console.log("MongoDB Connected Successfully!");

    return db;
  } catch (error) {
    console.error("❌ MongoDB Connection Failed:", error.message);
    throw error;
  }
};

/** Returns the connected database. Throws if connectDB() has not succeeded yet. */
const getDB = () => {
  if (!db) {
    throw new Error(
      "Database is not connected! Make sure connectDB() ran successfully first.",
    );
  }

  return db;
};

/** Closes the MongoDB connection gracefully. */
const closeDB = async () => {
  if (client) {
    await client.close();
    console.log("MongoDB connection closed.");
  }
};

module.exports = {
  connectDB,
  getDB,
  closeDB,
  getClient: () => client,
  buildUri,
};
