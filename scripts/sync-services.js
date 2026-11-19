const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { connectDB, getDB } = require("../src/config/db");

const DEFAULT_DEMO_SERVICES = {
  "venue-rosewood": {
    name: "Rosewood Vineyard Conservatory & Estate",
    category: "Wedding Venues",
    price: 9500,
    description: "Private 18-acre vineyard estate accommodating up to 220 guests with a glass conservatory reception hall, heritage wine cellars, outdoor sunset lawn ceremony space, and luxurious bridal dressing suites.",
    location: "Sonoma, CA",
    image: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1400&q=85",
    images: [
      "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=85"
    ],
  },
  "decor-bespoke-arch": {
    name: "Bespoke Garden Arch & Candlelit Florals",
    category: "Decoration & Florist",
    price: 3400,
    description: "Custom seasonal ceremony arch installation, bridal and bridesmaid bouquets, lush runner centerpieces, ambient hurricane candle walkways, and personalized wedding floral design consultations.",
    location: "San Francisco, CA",
    image: "https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1400&q=85",
    images: [
      "https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1200&q=85"
    ],
  },
  "fashion-haute-couture": {
    name: "Haute Bridal Couture & Custom Gown Atelier",
    category: "Wedding Fashion",
    price: 2900,
    description: "Private VIP showroom appointment with European silk gowns, cathedral veils, bespoke tuxedo tailoring, custom hand-beaded lace appliques, and full bridal accessory styling.",
    location: "Beverly Hills, CA",
    image: "https://images.unsplash.com/photo-1594552072238-9c4c9a2c3a7b?auto=format&fit=crop&w=1400&q=85",
    images: [
      "https://images.unsplash.com/photo-1594552072238-9c4c9a2c3a7b?auto=format&fit=crop&w=1200&q=85"
    ],
  },
  "photography-heritage": {
    name: "Heritage Wedding Cinematic Photography",
    category: "Photography & Videography",
    price: 45000,
    description: "Capturing authentic emotions, candid laughter and timeless royal wedding portraits with 4K cinematography. Our comprehensive wedding package includes dual senior photographers, aerial drone coverage, a teaser trailer, a 30-minute cinematic feature film, and an archival heirloom photo album with 150 edited high-resolution spreads.",
    location: "Gulshan, Dhaka",
    image: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1400&q=85",
    images: [
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=1200&q=85"
    ],
  },
  "venue-grand-palace": {
    name: "The Grand Regal Palace & Convention Hall",
    category: "Wedding Venues",
    price: 180000,
    description: "A magnificent royal ballroom accommodating up to 1,200 guests with custom crystal chandeliers, state-of-the-art acoustic sound engineering, bridal dressing suites, VIP green rooms, and dedicated multi-level valet parking.",
    location: "Dhanmondi, Dhaka",
    image: "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1400&q=85",
    images: [
      "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=85"
    ],
  },
  "decor-floral-dream": {
    name: "Enchanted Garden Wedding Stage & Floral Styling",
    category: "Decoration & Florist",
    price: 65000,
    description: "Bespoke wedding stage styling featuring imported and seasonal fresh flowers, customized lighting setups, fairy light tunnels, royal bridal sofas, floral entryway gates, and themed guest table centerpieces.",
    location: "Banani, Dhaka",
    image: "https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1400&q=85",
  },
  "catering-shahi-dawat": {
    name: "Shahi Dawat Royal Gourmet Catering",
    category: "Catering Services",
    price: 850,
    description: "Signature traditional wedding banquet including authentic Basmati Kacchi Biryani with tender mutton, succulent chicken roast, seekh kebabs, borhani, jorda, firni, and live gourmet dessert counters.",
    location: "Uttara, Dhaka",
    image: "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1400&q=85",
  },
  "bridal-glamour-makeover": {
    name: "Signature Glamour Bridal Makeup & Hair Artistry",
    category: "Makeup & Styling",
    price: 25000,
    description: "Exclusive high-definition waterproof airbrush bridal makeup, luxury skin preparation, intricate bridal hairstyle with real floral accents, dupatta draping, and jewelry setting.",
    location: "Bashundhara, Dhaka",
    image: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1400&q=85",
  },
  "planning-perfect-moments": {
    name: "Full-Service Luxury Wedding Planning & Coordination",
    category: "Other",
    price: 55000,
    description: "End-to-end wedding planning from initial concept design to final vendor negotiation, timeline management, RSVP tracking, rehearsal coordination, and dedicated on-day shadow coordinators.",
    location: "Mohakhali, Dhaka",
    image: "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1400&q=85",
  },
};

async function sync() {
  await connectDB();
  const db = getDB();

  // Find the primary approved vendor
  let vendor = await db.collection("user").findOne({ email: "vendor@gmail.com" });
  if (!vendor) {
    vendor = await db.collection("user").findOne({ role: "vendor", vendorApproved: true });
  }

  if (!vendor) {
    console.error("No approved vendor found!");
    process.exit(1);
  }

  const vendorIdStr = vendor._id ? vendor._id.toString() : String(vendor.id);
  console.log("Using vendor ID:", vendorIdStr, "name:", vendor.name);

  // Update existing services that have vendorId: null or missing
  const updateResult = await db.collection("services").updateMany(
    { $or: [{ vendorId: null }, { vendorId: { $exists: false } }, { vendorId: "" }] },
    { $set: { vendorId: vendorIdStr, availability: true, status: "approved", updatedAt: new Date() } }
  );
  console.log("Updated null vendorId services:", updateResult.modifiedCount);

  // Seed demo services into MongoDB if not present
  for (const [key, svc] of Object.entries(DEFAULT_DEMO_SERVICES)) {
    const existing = await db.collection("services").findOne({
      $or: [{ _id: key }, { name: svc.name }],
    });

    if (!existing) {
      await db.collection("services").insertOne({
        _id: key,
        ...svc,
        vendorId: vendorIdStr,
        availability: true,
        status: "approved",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log("Seeded demo service:", key);
    } else if (!existing.vendorId) {
      await db.collection("services").updateOne(
        { _id: existing._id },
        { $set: { vendorId: vendorIdStr, availability: true, status: "approved" } }
      );
      console.log("Assigned vendor to existing service:", existing._id);
    }
  }

  console.log("Sync complete!");
  process.exit(0);
}

sync().catch((err) => {
  console.error("Sync error:", err);
  process.exit(1);
});
