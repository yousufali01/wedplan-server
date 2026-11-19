/**
 * Booking routes.
 *  - Customers create bookings on available services of approved vendors.
 *  - Customers see/cancel only THEIR OWN bookings.
 *  - Vendors see bookings for THEIR OWN services and can accept/reject pending ones.
 *  - Admins can view all bookings and update any booking status.
 */
const express = require("express");

const { getDB } = require("../config/db");
const {
  requireCustomer,
  requireVendor,
  requireAdmin,
  authenticateUser,
} = require("../(auth)/middleware");
const { toId, isNonEmptyString } = require("../utils/helpers");

const router = express.Router();

const BOOKING_STATUSES = ["pending", "accepted", "rejected", "cancelled"];

const isFutureDate = (value) => {
  if (!isNonEmptyString(value, 8, 40)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
};

/** POST /api/v1/bookings - customer creates a booking */
router.post("/", requireCustomer, async (req, res, next) => {
  try {
    if (!isNonEmptyString(req.body.serviceId, 1, 64)) {
      return res
        .status(400)
        .json({ success: false, message: "serviceId is required." });
    }
    if (!isFutureDate(req.body.eventDate)) {
      return res.status(400).json({
        success: false,
        message: "eventDate is required and must be a valid future date.",
      });
    }
    if (
      req.body.guestCount !== undefined &&
      (!Number.isInteger(req.body.guestCount) || req.body.guestCount < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: "guestCount must be a positive integer.",
      });
    }

    const db = getDB();

    // Locate service by ID – support both Mongo ObjectId and raw string IDs (demo data).
    const serviceId = req.body.serviceId;
    let service = await db
      .collection("services")
      .findOne({
        $or: [
          { _id: toId(serviceId) },
          { _id: serviceId },
        ],
      });
 
    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    if (service.availability === false) {
      return res.status(400).json({
        success: false,
        message: "This service is currently unavailable for booking.",
      });
    }

// Vendor resolution: ensure the service has a valid vendor association.
    // Use the vendorId stored on the service; if missing, and the requester is a vendor, assign that vendor.
    // Do not fall back to any approved vendor, as that misroutes bookings.
    let vendorIdStr = String(service.vendorId ?? "").trim();
    let vendor = null;

    // Try to find vendor by the ID present on the service.
    if (vendorIdStr && vendorIdStr !== "null" && vendorIdStr !== "undefined") {
      vendor = await db.collection("user").findOne({
        $or: [
          { _id: toId(vendorIdStr) },
          { id: vendorIdStr },
          { _id: vendorIdStr },
        ],
      });
    }

    // If the service lacks a vendor and the requester is a vendor, treat the requester as the owner.
    if (!vendor && req.user && req.user.role === "vendor") {
      vendor = await db.collection("user").findOne({
        $or: [
          { _id: toId(req.user.id) },
          { id: req.user.id },
          { _id: req.user.id },
        ],
      });
      if (vendor) {
        vendorIdStr = vendor.id || (vendor._id && typeof vendor._id.toHexString === "function"
          ? vendor._id.toHexString()
          : String(vendor._id));
        // Persist resolved vendorId back to the service for future bookings.
        await db.collection("services").updateOne(
          { _id: service._id },
          { $set: { vendorId: vendorIdStr } }
        );
      }
    }

    // If still no vendor, return an error – the booking cannot be linked.
    if (!vendor) {
      return res.status(400).json({
        success: false,
        message: "The vendor for this service could not be found. Please ensure the service has a valid vendor.",
      });
    }

    // Normalise customerId — req.user.id is always a string after the middleware fix
    const customerId = req.user.id ?? req.user._id?.toString() ?? "";

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Could not identify your account. Please sign in again.",
      });
    }

    const now = new Date();
    const result = await db.collection("bookings").insertOne({
      customerId,
      vendorId: vendorIdStr,
      serviceId: service._id && typeof service._id.toHexString === "function"
        ? service._id.toHexString()
        : String(service._id),
      serviceName: service.name || service.title || "Wedding Service",
      servicePrice: service.price ?? 0,
      serviceImage: service.image || (service.images && service.images[0]) || null,
      serviceCategory: service.category || null,
      eventDate: req.body.eventDate.trim(),
      guestCount: req.body.guestCount ?? null,
      notes: typeof req.body.notes === "string" ? req.body.notes.trim() : "",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    const booking = await db
      .collection("bookings")
      .findOne({ _id: result.insertedId });

    res.status(201).json({
      success: true,
      message: "Booking created successfully. Waiting for vendor response.",
      booking,
    });
  } catch (error) {
    next(error);
  }
});

/** Customer booking view: only the booking owner or the owning vendor can see it. */
const loadParticipantBooking = async (req, res) => {
  const db = getDB();
  const booking = await db
    .collection("bookings")
    .findOne({
      $or: [
        { _id: toId(req.params.id) },
        { _id: req.params.id },
      ],
    });

  if (!booking) {
    res.status(404).json({ success: false, message: "Booking not found." });
    return null;
  }

  const userId = String(req.user.id ?? req.user._id ?? "");
  const isCustomer = String(booking.customerId) === userId;
  const isVendor = String(booking.vendorId) === userId;
  const isAdmin = req.user.role === "admin";

  if (!isCustomer && !isVendor && !isAdmin) {
    res.status(403).json({
      success: false,
      message: "Access denied. This booking does not belong to you.",
    });
    return null;
  }

  return booking;
};

/** GET /api/v1/bookings/mine - customer's own bookings with optional status filter */
router.get("/mine", requireCustomer, async (req, res, next) => {
  try {
    const db = getDB();
    const customerIdStr = String(req.user.id ?? req.user._id ?? "");

    const query = {
      $or: [
        { customerId: customerIdStr },
        { customerId: toId(customerIdStr) },
      ],
    };

    // Optional status filter: ?status=pending|accepted|rejected|cancelled
    if (req.query.status && BOOKING_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }

    const bookings = await db
      .collection("bookings")
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    // Enrich each booking with service image if not stored
    for (const booking of bookings) {
      if (!booking.serviceImage && booking.serviceId) {
        try {
          const service = await db
            .collection("services")
            .findOne({
              $or: [
                { _id: toId(booking.serviceId) },
                { _id: booking.serviceId },
              ],
            }, { projection: { image: 1, images: 1, category: 1 } });
          if (service) {
            booking.serviceImage = service.image || (service.images && service.images[0]) || null;
            booking.serviceCategory = service.category || null;
          }
        } catch {}
      }
    }

    res.status(200).json({ success: true, total: bookings.length, bookings });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/bookings/vendor - bookings for the vendor's own services */
router.get("/vendor", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();
    const vendorIdStr = String(req.user.id ?? req.user._id ?? "");
    const bookings = await db
      .collection("bookings")
      .find({
        $or: [
          { vendorId: vendorIdStr },
          { vendorId: toId(vendorIdStr) },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Enrich with the couple's details and the service snapshot so the vendor
    // can act on a request without opening another page.
    const customerIds = [
      ...new Set(bookings.map((b) => String(b.customerId)).filter(Boolean)),
    ];
    const objectIds = customerIds
      .filter((id) => /^[a-f\d]{24}$/i.test(id))
      .map(toId);

    const customers = await db
      .collection("user")
      .find({
        $or: [{ _id: { $in: objectIds } }, { id: { $in: customerIds } }],
      })
      .project({ name: 1, email: 1, image: 1 })
      .toArray();

    const customerMap = new Map(
      customers.map((customer) => [
        customer.id || (customer._id ? customer._id.toString() : ""),
        customer,
      ]),
    );

    for (const booking of bookings) {
      const customer = customerMap.get(String(booking.customerId));
      booking.customerName = customer?.name || "Couple";
      booking.customerEmail = customer?.email || null;
      booking.customerImage = customer?.image || null;
      // `price` is the numeric alias the vendor UI reads.
      booking.price = Number(booking.servicePrice) || 0;

      if (!booking.serviceImage && booking.serviceId) {
        try {
          const service = await db.collection("services").findOne(
            {
              $or: [
                { _id: toId(String(booking.serviceId)) },
                { _id: String(booking.serviceId) },
              ],
            },
            { projection: { name: 1, image: 1, images: 1, category: 1 } },
          );
          if (service) {
            booking.serviceImage = service.image || service.images?.[0] || null;
            booking.serviceCategory = service.category || null;
            booking.serviceName = booking.serviceName || service.name;
          }
        } catch {}
      }
    }

    res.status(200).json({ success: true, total: bookings.length, bookings });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/bookings - admin views all bookings */
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();

    const query = {};
    if (req.query.status && BOOKING_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }

    const total = await db.collection("bookings").countDocuments(query);
    const bookings = await db
      .collection("bookings")
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({ success: true, total, bookings });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/bookings/:id - booking details (owner customer, owning vendor or admin) */
router.get("/:id", authenticateUser, async (req, res, next) => {
  try {
    const booking = await loadParticipantBooking(req, res);
    if (!booking) return;

    // Customers never see other customers' private information in vendor context
    res.status(200).json({ success: true, booking });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/bookings/:id/cancel - customer cancels own pending booking */
router.patch("/:id/cancel", requireCustomer, async (req, res, next) => {
  try {
    const booking = await loadParticipantBooking(req, res);
    if (!booking) return;

    const userId = String(req.user.id ?? req.user._id ?? "");
    if (String(booking.customerId) !== userId && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only cancel your own bookings.",
      });
    }

    if (booking.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Only pending bookings can be cancelled (current status: ${booking.status}).`,
      });
    }

    const db = getDB();
    await db
      .collection("bookings")
      .updateOne(
        { _id: booking._id },
        { $set: { status: "cancelled", updatedAt: new Date() } }
      );

    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully.",
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/bookings/:id/status - vendor (own bookings) or admin (any) */
router.patch("/:id/status", authenticateUser, async (req, res, next) => {
  try {
    const status = req.body.status;

    if (!BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${BOOKING_STATUSES.join(", ")}.`,
      });
    }

    const booking = await loadParticipantBooking(req, res);
    if (!booking) return;

    const userId = String(req.user.id ?? req.user._id ?? "");
    const isVendor = req.user.role === "vendor" && String(booking.vendorId) === userId;
    const isAdmin = req.user.role === "admin";

    if (!isVendor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only the owning vendor or an admin can change booking status.",
      });
    }

    // Vendors may only accept or reject PENDING bookings; admins can set any status.
    if (isVendor) {
      if (!["accepted", "rejected"].includes(status)) {
        return res.status(403).json({
          success: false,
          message: "Vendors can only accept or reject bookings.",
        });
      }
      if (booking.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Only pending bookings can be accepted or rejected (current status: ${booking.status}).`,
        });
      }
    }

    const db = getDB();
    await db
      .collection("bookings")
      .updateOne(
        { _id: booking._id },
        { $set: { status, updatedAt: new Date() } }
      );

    res.status(200).json({
      success: true,
      message: `Booking ${status}.`,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
