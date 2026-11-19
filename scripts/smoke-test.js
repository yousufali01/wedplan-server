/**
 * WedPlan authentication & authorization smoke test.
 *
 * Usage:
 *   1. Start the server:            npm run dev   (or npm start)
 *   2. In another terminal run:     npm run smoke-test
 *
 * Tests (real HTTP requests against the running server):
 *   1.  Server health & MongoDB ping
 *   2.  Email signup (customer role)
 *   3.  Duplicate email rejection
 *   4.  Login
 *   5.  Invalid password rejection
 *   6.  Session retrieval
 *   7.  Profile access & update
 *   8.  Admin role protection (customer -> 403)
 *   9.  Unauthenticated access -> 401
 *   10. Invalid session -> 401
 *   11. Admin login & user management (role change)
 *   12. Vendor approval flow
 *   13. Unapproved vendor -> 403
 *   14. Approved vendor creates a service
 *   15. Customer books the service
 *   16. Cross-user access prevention (customer/vendor)
 *   17. Vendor accept/reject booking
 *   18. JWT token issuance & Bearer access
 *   19. Tampered JWT rejection
 *   20. Google OAuth configuration (authorize redirect)
 *   21. Logout invalidates the session
 */
require("dotenv").config();

const BASE = `http://localhost:${process.env.PORT || 5000}`;

let passed = 0;
let failed = 0;
const failures = [];

const test = (name, condition, detail = "") => {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

/** Minimal fetch wrapper that keeps cookies per "client". */
const createClient = (origin = BASE) => {
  let cookieJar = [];

  return {
    async request(method, path, { body, headers = {}, bearer } = {}) {
      const h = { ...headers };
      if (cookieJar.length) h["Cookie"] = cookieJar.join("; ");
      if (bearer) h["Authorization"] = `Bearer ${bearer}`;
      if (body !== undefined) h["Content-Type"] = "application/json";
      // Better Auth CSRF protection requires Origin header
      h["Origin"] = origin;

      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });

      const setCookies = res.headers.getSetCookie?.() ?? [];
      for (const cookie of setCookies) {
        const [pair] = cookie.split(";");
        const [name] = pair.split("=");
        // Replace an existing cookie of the same name
        cookieJar = cookieJar.filter((c) => !c.startsWith(`${name}=`));
        cookieJar.push(pair);
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        /* non-JSON response (e.g. redirects) */
      }

      return { status: res.status, json, location: res.headers.get("location") };
    },
    clearCookies() {
      cookieJar = [];
    },
  };
};

const randomSuffix = Date.now() + Math.floor(Math.random() * 10000);
const email = (role) => `${role}-${randomSuffix}@wedplan-test.dev`;

const PASSWORD = "SuperSecret123";

const run = async () => {
  console.log(`\n🧪 Running WedPlan smoke tests against ${BASE}\n`);

  const customer = createClient();
  const customer2 = createClient();
  const vendor1 = createClient();
  const vendor2 = createClient();
  const admin = createClient();
  const anon = createClient();

  // ---------- 1. Health ----------
  console.log("\n[1] Health & Database");
  const health = await anon.request("GET", "/health");
  test("GET /health returns 200", health.status === 200);

  const dbTest = await anon.request("GET", "/test-db");
  test(
    "GET /test-db pings MongoDB",
    dbTest.status === 200 && dbTest.json?.success === true,
    JSON.stringify(dbTest.json)
  );
  test("Database name is correct", dbTest.json?.database === "WedPlan", dbTest.json?.database);

  // ---------- 2-3. Signup ----------
  console.log("\n[2] Email signup");
  const cust1Email = email("customer");
  const signup = await customer.request("POST", "/api/auth/sign-up/email", {
    body: { email: cust1Email, password: PASSWORD, name: "Customer One" },
  });
  test("Signup returns 200", signup.status === 200, JSON.stringify(signup.json));
  test(
    "New user has customer role",
    signup.json?.user?.role === "customer",
    signup.json?.user?.role
  );
  test(
    "vendorApproved is false by default",
    signup.json?.user?.vendorApproved === false
  );

  const signup2 = await customer.request("POST", "/api/auth/sign-up/email", {
    body: { email: cust1Email, password: PASSWORD, name: "Customer One" },
  });
  test(
    "Duplicate email rejected",
    signup2.status >= 400,
    `status ${signup2.status}`
  );

  // ---------- 4-5. Login ----------
  console.log("\n[3] Login");
  const badLogin = await createClient().request(
    "POST",
    "/api/auth/sign-in/email",
    { body: { email: cust1Email, password: "WrongPassword999" } }
  );
  test("Invalid password rejected", badLogin.status === 401, `status ${badLogin.status}`);

  const login = await customer.request("POST", "/api/auth/sign-in/email", {
    body: { email: cust1Email, password: PASSWORD },
  });
  test("Login returns 200", login.status === 200, JSON.stringify(login.json));

  // ---------- 6. Session ----------
  console.log("\n[4] Session");
  const session = await customer.request("GET", "/api/auth/get-session");
  test(
    "get-session returns the user",
    session.status === 200 && session.json?.user?.email === cust1Email,
    JSON.stringify(session.json)
  );

  // ---------- 7. Profile ----------
  console.log("\n[5] Profile");
  const profile = await customer.request("GET", "/api/v1/profile");
  test("GET /api/v1/profile works", profile.status === 200 && profile.json?.user?.id);

  const profUpdate = await customer.request("PATCH", "/api/v1/profile", {
    body: { name: "Customer One Updated" },
  });
  test(
    "PATCH /api/v1/profile updates name",
    profUpdate.status === 200 && profUpdate.json?.user?.name === "Customer One Updated",
    JSON.stringify(profUpdate.json)
  );

  // Mass-assignment attempt: customer tries to make themselves admin/vendor
  // Better Auth correctly REJECTS the request with FIELD_NOT_ALLOWED (secure behavior)
  const evilEmail = email("evil");
  const evilUpdate = await createClient().request("POST", "/api/auth/sign-up/email", {
    body: {
      email: evilEmail,
      password: PASSWORD,
      name: "Evil User",
      role: "admin",
      vendorApproved: true,
    },
  });
  test(
    "Signup rejects client-sent role (FIELD_NOT_ALLOWED)",
    evilUpdate.status === 400 &&
      evilUpdate.json?.code === "FIELD_NOT_ALLOWED" &&
      evilUpdate.json?.message?.includes("role"),
    JSON.stringify(evilUpdate.json)
  );

  // ---------- 8. Authorization failures ----------
  console.log("\n[6] Authorization failures");
  const adminAsCustomer = await customer.request("GET", "/api/v1/admin/users");
  test("Customer blocked from admin API (403)", adminAsCustomer.status === 403, `status ${adminAsCustomer.status}`);

  const noAuth = await anon.request("GET", "/api/v1/profile");
  test("Unauthenticated request -> 401", noAuth.status === 401, `status ${noAuth.status}`);

  const invalidSession = createClient();
  const fakeSession = await invalidSession.request("GET", "/api/v1/profile", {
    headers: { Cookie: "wedplan.session_token=totally-fake-token" },
  });
  test(
    "Invalid session cookie -> 401",
    fakeSession.status === 401,
    `status ${fakeSession.status}`
  );

  // ---------- Admin setup ----------
  console.log("\n[7] Admin");
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  const adminLogin = await admin.request("POST", "/api/auth/sign-in/email", {
    body: { email: adminEmail, password: adminPassword },
  });
  test(
    "Admin login works (created via create-admin script)",
    adminLogin.status === 200 && adminLogin.json?.user?.role === "admin",
    JSON.stringify(adminLogin.json?.user)
  );

  const listUsers = await admin.request("GET", "/api/v1/admin/users");
  test("Admin can list users", listUsers.status === 200, JSON.stringify(listUsers.json));

  // Promote vendor1 -> vendor, then approve; vendor2 stays unapproved
  const vendor1Id = (
    await vendor1.request("POST", "/api/auth/sign-up/email", {
      body: { email: email("vendor1"), password: PASSWORD, name: "Vendor One" },
    })
  ).json?.user?.id;
  
  const vendor2Id = (
    await vendor2.request("POST", "/api/auth/sign-up/email", {
      body: { email: email("vendor2"), password: PASSWORD, name: "Vendor Two" },
    })
  ).json?.user?.id;

  // Promote vendor2 to vendor role (unapproved) and verify
  const promoteVendor2 = await admin.request(
    "PATCH",
    `/api/v1/admin/users/${vendor2Id}/role`,
    { body: { role: "vendor" } }
  );
  test(
    "Admin promotes vendor2 to vendor role",
    promoteVendor2.status === 200 && promoteVendor2.json?.user?.role === "vendor",
    JSON.stringify(promoteVendor2.json)
  );

  const roleChange = await admin.request(
    "PATCH",
    `/api/v1/admin/users/${vendor1Id}/role`,
    { body: { role: "vendor" } }
  );
  test("Admin can set role to vendor", roleChange.status === 200, JSON.stringify(roleChange.json));

  const badRole = await admin.request(
    "PATCH",
    `/api/v1/admin/users/${vendor2Id}/role`,
    { body: { role: "hacker" } }
  );
  test("Invalid role value rejected", badRole.status === 400, `status ${badRole.status}`);

  const approve = await admin.request(
    "PATCH",
    `/api/v1/admin/vendors/${vendor1Id}/approval`,
    { body: { approved: true } }
  );
  test("Admin approves vendor", approve.status === 200, JSON.stringify(approve.json));

  const pendingList = await admin.request("GET", "/api/v1/admin/vendors/pending");
  test(
    "Pending vendor list contains vendor2",
    pendingList.status === 200 &&
      pendingList.json?.vendors?.some((v) => v.id === vendor2Id),
    JSON.stringify(pendingList.json?.vendors?.map((v) => v.id))
  );

  // Customer trying to promote themselves
  const custSelfPromote = await customer.request(
    "PATCH",
    `/api/v1/admin/users/${evilUpdate.json?.user?.id}/role`,
    { body: { role: "admin" } }
  );
  test(
    "Customer cannot change roles (403)",
    custSelfPromote.status === 403,
    `status ${custSelfPromote.status}`
  );

  // ---------- Vendor flows ----------
  console.log("\n[8] Vendor flows");
  const unapprovedService = await vendor2.request("POST", "/api/v1/services", {
    body: {
      name: "Unapproved Catering",
      category: "Catering",
      price: 5000,
    },
  });
  test(
    "Unapproved vendor cannot create services (403)",
    unapprovedService.status === 403,
    `status ${unapprovedService.status}`
  );

  const service = await vendor1.request("POST", "/api/v1/services", {
    body: {
      name: "Royal Wedding Photography",
      category: "Photography",
      price: 25000,
      description: "Full-day wedding photography package",
      location: "Dhaka",
    },
  });
  test(
    "Approved vendor creates service",
    service.status === 201 && service.json?.service?.vendorId === vendor1Id,
    JSON.stringify(service.json)
  );
  const serviceId = service.json?.service?._id;

  const publicList = await anon.request("GET", "/api/v1/services");
  test(
    "Public services list contains approved vendor's service",
    publicList.status === 200 &&
      publicList.json?.services?.some((s) => s._id === serviceId),
    JSON.stringify(publicList.json)
  );

  const updOwn = await vendor1.request("PATCH", `/api/v1/services/${serviceId}`, {
    body: { price: 27000 },
  });
  test("Vendor updates own service", updOwn.status === 200, JSON.stringify(updOwn.json));

  // ---------- Booking flows ----------
  console.log("\n[9] Booking flows");
  const booking = await customer.request("POST", "/api/v1/bookings", {
    body: {
      serviceId,
      eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      guestCount: 150,
      notes: "Outdoor ceremony",
    },
  });
  test(
    "Customer creates booking",
    booking.status === 201 && booking.json?.booking?.customerId === signup.json?.user?.id,
    JSON.stringify(booking.json)
  );
  const bookingId = booking.json?.booking?._id;

  const myBookings = await customer.request("GET", "/api/v1/bookings/mine");
  test(
    "Customer sees own bookings",
    myBookings.status === 200 && myBookings.json?.bookings?.some((b) => b._id === bookingId)
  );

  // Cross-user: customer2 cannot see customer1's booking
  const cust2Email = email("customer2");
  await customer2.request("POST", "/api/auth/sign-up/email", {
    body: { email: cust2Email, password: PASSWORD, name: "Customer Two" },
  });
  const crossView = await customer2.request("GET", `/api/v1/bookings/${bookingId}`);
  test(
    "Customer2 blocked from customer1's booking (403)",
    crossView.status === 403,
    `status ${crossView.status}`
  );

  const crossCancel = await customer2.request(
    "PATCH",
    `/api/v1/bookings/${bookingId}/cancel`
  );
  test(
    "Customer2 cannot cancel customer1's booking",
    crossCancel.status === 403 || crossCancel.status === 404,
    `status ${crossCancel.status}`
  );

  const vendorRequests = await vendor1.request("GET", "/api/v1/bookings/vendor");
  test(
    "Vendor sees requests for own services",
    vendorRequests.status === 200 &&
      vendorRequests.json?.bookings?.some((b) => b._id === bookingId)
  );

  // vendor2 is a customer (never promoted), so it must not be able to
  // accept vendor1's booking either.
  const crossAccept = await vendor2.request(
    "PATCH",
    `/api/v1/bookings/${bookingId}/status`,
    { body: { status: "accepted" } }
  );
  test(
    "Non-owner blocked from changing booking status (403)",
    crossAccept.status === 403,
    `status ${crossAccept.status}`
  );

  const accept = await vendor1.request(
    "PATCH",
    `/api/v1/bookings/${bookingId}/status`,
    { body: { status: "accepted" } }
  );
  test("Vendor accepts booking", accept.status === 200, JSON.stringify(accept.json));

  // ---------- JWT ----------
  console.log("\n[10] JWT tokens");
  const tokenRes = await customer.request("GET", "/api/auth/token");
  test("JWT issued at /api/auth/token", tokenRes.status === 200 && tokenRes.json?.token, JSON.stringify(tokenRes.json));
  const jwtToken = tokenRes.json?.token;

  const bearerProfile = await anon.request("GET", "/api/v1/profile", {
    bearer: jwtToken,
  });
  test(
    "Bearer JWT works on protected route",
    bearerProfile.status === 200 && bearerProfile.json?.user?.email === cust1Email,
    JSON.stringify(bearerProfile.json)
  );

  const tampered = jwtToken
    ? jwtToken.slice(0, -4) + "abcd"
    : "fake.token.value";
  const badBearer = await anon.request("GET", "/api/v1/profile", {
    bearer: tampered,
  });
  test(
    "Tampered JWT rejected (401)",
    badBearer.status === 401,
    `status ${badBearer.status}`
  );

  // ---------- Google OAuth ----------
  console.log("\n[11] Google OAuth");
  const google = await anon.request("POST", "/api/auth/sign-in/social", {
    body: { provider: "google" },
  });
  const googleRedirect = google.json?.url || "";
  test(
    "Google authorize redirect contains accounts.google.com",
    googleRedirect.includes("accounts.google.com"),
    `status ${google.status} location ${googleRedirect}`
  );
  test(
    "Google redirect contains configured client_id",
    googleRedirect.includes(process.env.GOOGLE_CLIENT_ID),
    ""
  );

  // ---------- Logout ----------
  console.log("\n[12] Logout");
  const logout = await customer2.request("POST", "/api/auth/sign-out");
  test("Logout returns 200", logout.status === 200, `status ${logout.status}`);

  const sessionAfterLogout = await customer2.request("GET", "/api/auth/get-session");
  test(
    "Session invalid after logout",
    !sessionAfterLogout.json?.user,
    JSON.stringify(sessionAfterLogout.json)
  );

  // ---------- Summary ----------
  console.log("\n" + "=".repeat(50));
  console.log(`🧪 RESULTS: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\nFailed tests:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exitCode = 1;
});
