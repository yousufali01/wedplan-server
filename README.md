# 💍 WedPlan – Backend API

<p align="center">

  **Powering the WedPlan Wedding Service Marketplace**

  A secure and scalable RESTful backend API for managing wedding services, customers, vendors, bookings, authentication, and payments.

</p>

---

## 🌐 Project Overview

**WedPlan Server** is the backend application of the WedPlan Wedding Service Marketplace.

It provides RESTful APIs to support the complete marketplace functionality, including user authentication, role-based authorization, wedding service management, booking operations, vendor management, and secure online payments.

The backend is developed using **Node.js, Express.js, and MongoDB**, with Better Auth for authentication, JWT for API authorization, and Stripe for payment processing.

The system follows a role-based architecture with three primary user roles: Customer, Vendor, and Admin.

---

## ✨ Key Features

### 🔐 Authentication & Authorization
- Email and password authentication.
- Google OAuth integration.
- Better Auth integration.
- JWT-based API authentication.
- Secure session management.
- Role-based access control.
- Protected API endpoints.
- Server-side user authorization.
- Vendor and admin permission management.
- Ownership verification for protected resources.

### 👤 User Management
- User registration and authentication.
- User profile management.
- Customer and vendor role management.
- Retrieve user information.
- Admin user management.
- Blocked user access control.

### 🏪 Wedding Service Management
- Create new wedding services.
- Retrieve all available services.
- Retrieve individual service details.
- Update existing services.
- Delete services.
- Search, filter, and sort services.
- Vendor-specific service management.
- Service image upload using ImgBB.
- Admin service approval system.
- Pending and approved service status management.

### 📅 Booking Management
- Create service bookings.
- Retrieve customer bookings.
- Retrieve vendor booking requests.
- Accept or reject booking requests.
- Cancel bookings.
- Update booking statuses.
- Prevent duplicate bookings.
- Prevent vendors from booking their own services.
- Verify booking ownership and permissions.

**Booking Statuses:**

| Status | Description |
|---|---|
| Pending | Booking awaiting vendor response |
| Accepted | Booking accepted by vendor |
| Rejected | Booking rejected by vendor |
| Cancelled | Booking cancelled |

### 💎 Subscription Management
- Free and Premium vendor plans.
- Free vendors can maintain a maximum of 3 active services.
- Premium vendors can maintain unlimited active services.
- Subscription and payment management.

### 💳 Payment & Transaction Management
- Stripe Checkout integration.
- Secure payment session creation.
- Stripe webhook verification.
- Payment status verification.
- Transaction record management.
- Booking payment expiration handling.
- Payment cancellation and failure handling.
- Prevent duplicate payment processing.

### 🛡️ Security & Validation
- JWT verification middleware.
- Role-based authorization middleware.
- Resource ownership validation.
- Secure authentication handling.
- Server-side request validation.
- Protected administrative endpoints.
- Stripe webhook signature verification.
- Error handling and API response management.

---

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript Runtime |
| Express.js | Backend Framework |
| MongoDB | NoSQL Database |
| Better Auth | Authentication |
| JWT | API Authorization |
| JOSE | JWT Verification |
| Stripe | Payment Processing |
| ImgBB | Image Hosting |
| CORS | Cross-Origin Resource Sharing |
| dotenv | Environment Configuration |

---

## 📁 Project Structure

```text
WedPlan-Server/
│
├── src/
│   ├── config/
│   │
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   └── role.middleware.js
│   │
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── service.routes.js
│   │   ├── booking.routes.js
│   │   ├── admin.routes.js
│   │   ├── payment.routes.js
│   │   └── transaction.routes.js
│   │
│   ├── utils/
│   │
│   └── app.js
│
├── .env
├── .gitignore
├── package.json
├── server.js
└── README.md
```

*Note: This is a suggested structure. Adjust it to match the actual backend implementation.*

---

## ⚙️ Installation & Setup

### 1. Clone the Repository

```bash
git clone YOUR_BACKEND_REPOSITORY_URL
```

### 2. Navigate to the Project

```bash
cd WedPlan-Server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory.

```env
PORT=5000

MONGODB_URI=your_mongodb_connection_string

BETTER_AUTH_SECRET=your_better_auth_secret
BETTER_AUTH_URL=http://localhost:5000

FRONTEND_URL=http://localhost:3000

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

IMGBB_API_KEY=your_imgbb_api_key
```

**Important:** Configure environment variable names according to the actual application configuration. Never commit `.env` files, API keys, or secret credentials to GitHub.

### 5. Start the Development Server

```bash
npm run dev
```

The backend API will run at:

```text
http://localhost:5000
```

---

## 🔗 API Endpoints

The following endpoints represent the planned API organization.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/*` | Better Auth authentication handlers |
| POST | `/api/auth/*` | Authentication operations |

### Services

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/services` | Get all services |
| GET | `/api/services/:id` | Get service details |
| POST | `/api/services` | Create a service |
| PATCH | `/api/services/:id` | Update a service |
| DELETE | `/api/services/:id` | Delete a service |

### Bookings

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/bookings` | Get bookings |
| POST | `/api/bookings` | Create a booking |
| PATCH | `/api/bookings/:id` | Update booking status |
| DELETE | `/api/bookings/:id` | Cancel or delete a booking |

### Users

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users` | Get users |
| GET | `/api/users/:id` | Get user details |
| PATCH | `/api/users/:id` | Update user information |

### Admin

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/services` | Get services for review |
| PATCH | `/api/admin/services/:id` | Approve or reject a service |

### Payments & Transactions

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/payments/checkout` | Create Stripe Checkout session |
| POST | `/api/payments/webhook` | Handle Stripe webhook events |
| GET | `/api/transactions` | Retrieve transactions |

*Note: These are proposed endpoint conventions. Match the methods and paths to the implemented Express routes before publishing.*

---

## 🗄️ Database Architecture

WedPlan uses MongoDB to store and manage marketplace data.

**Primary Collections:**

| Collection | Purpose |
|---|---|
| Users | Customer, Vendor and Admin information |
| Services | Wedding service information |
| Bookings | Customer booking records |
| Transactions | Payment and transaction records |

The database architecture supports role-based access, booking relationships, service ownership, and payment tracking.

---

## 🔄 Application Workflow

1. A user registers or signs in using Better Auth.
2. The backend authenticates the user and provides the required authentication credentials.
3. The user accesses features according to their assigned role.
4. Vendors create wedding services and submit them for approval.
5. Administrators review and approve submitted services.
6. Customers browse available services and create bookings.
7. Vendors manage incoming booking requests.
8. Customers complete payments through Stripe.
9. Verified payment events update the relevant transaction and booking records.

---

## 🌍 Frontend Integration

The backend is designed to communicate with the WedPlan frontend.

**Frontend Development URL:** `http://localhost:3000`

**Backend Development URL:** `http://localhost:5000`

The API supports authentication, service discovery, booking management, vendor operations, administration, and payment processing.

---

## 🔒 Security Practices

- Authentication and authorization are handled on the server.
- Sensitive API credentials are stored in environment variables.
- Protected routes verify user permissions.
- Resource ownership is checked before modifying records.
- Stripe webhook signatures are verified.
- Payment operations are validated before updating transactions.
- User roles cannot be trusted solely from frontend data.

---

## 🚀 Project Goals

- Build a reliable wedding service marketplace backend.
- Provide secure authentication and role-based authorization.
- Manage services, bookings, and subscriptions efficiently.
- Integrate reliable online payment processing.
- Maintain data consistency and protect user information.
- Provide scalable RESTful APIs for frontend integration.

---

<p align="center">

  **WedPlan – Making Every Wedding Special. ❤️**

</p>
