# 1. Project Overview

- **Project Name:** Vortex ERP
- **Project Type:** Web-based ERP application
- **Business Domain:** Grocery, wholesale, and retail operations
- **Primary Purpose:** Centralizes point-of-sale, purchasing, inventory, warehouse, finance, customer, supplier, and reporting workflows.
- **Target Users:** Cashiers, warehouse staff, accountants, managers, and business owners.
- **Main Business Value:** Connects transactional operations to controlled inventory, financial records, and operational reporting within one role-aware system.

# 2. Resume Summary (Very Important)

- Built a TypeScript/React ERP platform for grocery, wholesale, and retail operations using TanStack Start, Supabase, and PostgreSQL.
- Implemented database-backed transactional workflows for sales, purchases, returns, stock transfers, customer payments, and loyalty adjustments.
- Designed role-aware data access with Supabase Auth, PostgreSQL Row Level Security, and database role helper functions.
- Delivered bilingual Arabic/English RTL/LTR operational interfaces, dashboards, analytics, printable invoices, CSV exports, barcode tools, and responsive navigation.

# 3. Core Features

- Point of sale, sales invoices, multiple payment methods, invoice printing, and PDF generation.
- Product catalog, SKU/barcode management, warehouse inventory, adjustments, stock movements, batches, expiry tracking, and transfers.
- Purchase management, sales and purchase returns, supplier balances, customer balances, payment collection, and loyalty transactions.
- Dashboards, advanced analytics, operational reports, CSV export, audit-log review, notifications, and role administration.
- Arabic/English localization, RTL/LTR direction switching, responsive mobile navigation, and persisted light/dark theme preferences.

# 4. Technical Stack

| Category | Technologies |
| --- | --- |
| Programming Languages | TypeScript, SQL |
| Frontend | React 19, TanStack Start, TanStack Router |
| Backend Runtime | TanStack Start server runtime, Nitro |
| Database | PostgreSQL via Supabase |
| Database Access | Supabase JavaScript client; PostgreSQL RPC functions |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL Row Level Security, role helpers, authenticated RPC permissions |
| State Management | TanStack React Query, React local state |
| Validation | Zod |
| UI Libraries | shadcn/ui, Radix UI, Lucide React |
| Styling | Tailwind CSS v4, CSS custom properties |
| Charts | Recharts |
| Printing and Documents | jsPDF, jspdf-autotable, browser print layouts |
| Barcode and Scanning | JsBarcode, html5-qrcode |
| Build Tools | Vite, Nitro |
| Quality Tools | ESLint, Prettier |
| Cloud / Hosting | Supabase; Vercel live URL configured in application metadata |
| Developer Tools | npm, Bun configuration, TypeScript, Lovable Vite/TanStack configuration |

# 5. Architecture Analysis

Vortex ERP is a modular monolith. File-based TanStack Start routes organize operational domains such as POS, products, inventory, purchases, sales, finance, analytics, and administration.

- `src/routes` separates feature pages by business module.
- `src/components` contains reusable shell, navigation, scanner, command palette, and UI primitives.
- `src/lib` centralizes authentication state, localization, formatting, printing, error handling, and utility functions.
- `src/integrations/supabase` isolates typed Supabase clients, server-only administration access, and authentication helpers.
- PostgreSQL owns transactional business operations through RPC functions and enforces authorization through RLS policies.

Recognizable patterns: feature-based organization, layered separation of UI/shared libraries/data integration, modular monolith, reusable component design, and database transaction functions. Repository pattern, dependency injection, CQRS, and microservices are not verified.

# 6. Software Engineering Practices

- **Modular design:** Route modules and shared components/libraries separate business concerns.
- **Reusable components:** Shared application shell, UI primitives, scanner, command palette, and page elements are reused across routes.
- **DRY:** Shared formatting, invoice printing, localization, Supabase integration, and error utilities reduce repeated implementation.
- **Validation:** Zod validates authentication inputs; PostgreSQL functions validate transactional inputs and inventory availability.
- **Error handling:** Authentication maps known failures to user-facing messages; root/server error handling normalizes SSR failures.
- **Configuration management:** Supabase URL, publishable key, and server-only service-role key are read from environment variables.
- **Documentation:** README, SQL migrations, seed definitions, screenshots, and TODO documentation are present.
- **Logging:** Dedicated application logging or monitoring integration is not verified.

# 7. Database Analysis

- **Engine:** PostgreSQL through Supabase.
- **Organization:** Separates identity, catalog master data, inventory, document headers/items, finance, loyalty, audit history, and settings.
- **Relationships:** Products connect to categories, brands, units, warehouses, inventory, invoice items, and batches; sales and purchases use header/item models.
- **Integrity:** Foreign keys, unique constraints for SKU, barcode, roles, batch identity, and product/warehouse inventory; numeric checks; trigger-maintained `updated_at` values.
- **Migrations:** SQL migrations are maintained under `supabase/migrations`.
- **Indexes:** Includes a GIN product-search index plus indexes for batch expiry, audit history, loyalty, customer payments, and stock-movement references.
- **ORM:** No ORM identified; Supabase typed client and PostgreSQL RPC are used directly.

# 8. Security Analysis

- **Authentication:** Supabase Auth email/password sign-up, sign-in, session retrieval, refresh, and sign-out.
- **Authorization / RBAC:** Owner, manager, accountant, cashier, and warehouse roles are represented in the database.
- **Database enforcement:** RLS is enabled on business tables; policies use `has_role` and `is_staff` helpers.
- **Transactional authorization:** Sensitive RPC functions validate `auth.uid()` and staff status.
- **RPC hardening:** Privileged functions are revoked from public/anonymous roles and granted to authenticated users where intended.
- **Route protection:** Protected application layout redirects unauthenticated users to `/auth`.
- **Validation:** Zod validates authentication input; database functions validate business transaction inputs.
- **Secrets management:** `.env` is ignored; `SUPABASE_SERVICE_ROLE_KEY` is isolated in a server-only Supabase client.
- **Password hashing, OAuth, rate limiting, CSRF, CORS configuration, and input sanitization:** Not verified.

# 9. API Analysis

The project does not define an application-owned REST or GraphQL API.

- **Integration style:** Supabase Auth, direct typed table queries, and authenticated PostgreSQL RPC functions.
- **Transactional RPC coverage:** Sales, purchases, sales returns, purchase returns, stock transfers, customer payments, and loyalty adjustments.
- **Validation and errors:** Transaction functions validate authentication, roles, required data, quantities, and inventory conditions; errors are raised by PostgreSQL and surfaced by route code.
- **API versioning and external API documentation:** Not verified.

# 10. Deployment & Infrastructure

- **Hosting:** Vercel live URL is configured in root metadata: `https://market-hub-two-theta.vercel.app/`.
- **Cloud platform:** Supabase provides authentication and PostgreSQL-backed data services.
- **Build process:** `npm run build` runs Vite/Nitro production build; `npm run preview` supports local production preview.
- **Environment variables:** Supabase URL, publishable key, and optional server-only service-role key.
- **Docker, reverse proxy, SSL configuration, CI/CD workflows, and infrastructure-as-code:** Not verified.
- **Domain configuration:** Not verified beyond the Vercel deployment URL.

# 11. Development Quality

- **Code organization:** Feature routes, shared libraries, typed Supabase integration, and reusable UI primitives are clearly separated.
- **Maintainability:** Shared localization, printing, formatting, auth, and shell components centralize common concerns.
- **Scalability:** Modular routing and PostgreSQL transaction functions support expansion within a single deployment unit; distributed-service scalability is not implemented.
- **Consistency:** Operational modules follow repeated route/component patterns and use shared styling/UI primitives.
- **Readability:** TypeScript, named feature routes, typed database definitions, and domain-oriented filenames support navigation.
- **Reusability:** Application shell, UI components, barcode scanner, print utilities, and localization provider are reusable.
- **Testing:** Automated test files or a configured test framework were not verified.

# 12. Engineering Competencies Demonstrated

- Full-stack TypeScript and React development
- ERP and operational workflow design
- PostgreSQL relational database modeling
- Database migrations, constraints, indexes, and transactional functions
- Supabase integration
- Authentication and role-based authorization
- Row Level Security policy design
- Inventory and warehouse workflow implementation
- Financial and invoice workflow implementation
- Responsive UI development
- Arabic RTL/LTR localization
- State and server-data management with React Query
- Data visualization and reporting
- Barcode generation and camera scanning integration
- PDF and print-document generation
- Environment-based configuration
- Production web build and deployment preparation

# 13. ATS Resume Keywords

- TypeScript
- React
- TanStack Start
- TanStack Router
- TanStack React Query
- PostgreSQL
- Supabase
- Supabase Auth
- Row Level Security
- Role-Based Access Control
- Database RPC
- SQL Migrations
- Relational Database Design
- Inventory Management
- Warehouse Management
- Point of Sale
- ERP Development
- Financial Workflows
- REST API Integration
- Zod Validation
- Tailwind CSS
- shadcn/ui
- Radix UI
- Recharts
- jsPDF
- Barcode Generation
- QR / Barcode Scanning
- Arabic Localization
- RTL Support
- Vite
- Nitro
- Vercel
- Responsive Web Design

# 14. Suggested Resume Entry

**Vortex ERP**

**Project Type**  
Web-based ERP application for grocery, wholesale, and retail operations.

Built an ERP platform that connects POS, inventory, warehouse, purchasing, finance, customer, supplier, and reporting workflows in a single role-aware application.

- Developed transactional PostgreSQL RPC workflows for sales, purchases, returns, stock transfers, payments, and loyalty adjustments.
- Implemented Supabase Auth, PostgreSQL Row Level Security, and role-based policies for owner, manager, accountant, cashier, and warehouse users.
- Built React/TanStack Start modules for POS, product catalog, inventory, finance, reporting, dashboards, and advanced analytics.
- Designed normalized PostgreSQL schemas with foreign keys, unique constraints, check constraints, migrations, GIN search indexes, and audit-oriented records.
- Delivered responsive Arabic/English RTL/LTR interfaces with charts, barcode scanning, barcode labels, invoice printing, PDF generation, and CSV exports.

**Technologies Used**  
TypeScript, React, TanStack Start, TanStack Router, TanStack React Query, PostgreSQL, Supabase, Supabase Auth, Row Level Security, SQL RPC Functions, Zod, Tailwind CSS, shadcn/ui, Radix UI, Recharts, jsPDF, JsBarcode, html5-qrcode, Vite, Nitro, Vercelv