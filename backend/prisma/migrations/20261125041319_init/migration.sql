-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('donor', 'ngo', 'volunteer', 'admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'verified', 'suspended');

-- CreateEnum
CREATE TYPE "DonorType" AS ENUM ('hotel', 'restaurant', 'mess', 'caterer');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('bike', 'car', 'none');

-- CreateEnum
CREATE TYPE "FoodType" AS ENUM ('veg', 'non_veg', 'mixed');

-- CreateEnum
CREATE TYPE "FoodHolding" AS ENUM ('hot', 'room_temp', 'chilled');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('posted', 'offered', 'partially_claimed', 'fully_claimed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('active', 'delivered', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('unassigned', 'assigned', 'picked_up', 'delivered', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "OfferResponse" AS ENUM ('none', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('food_quality', 'no_show', 'wrong_quantity', 'safety', 'unmatched', 'no_volunteer', 'other');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('open', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('listing', 'claim', 'delivery', 'user', 'issue');

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "donors" (
    "donor_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_name" TEXT NOT NULL,
    "type" "DonorType" NOT NULL,
    "fssai_licence_no" TEXT,
    "licence_url" TEXT,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "geo" geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography) STORED,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "donors_pkey" PRIMARY KEY ("donor_id")
);

-- CreateTable
CREATE TABLE "ngos" (
    "ngo_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_name" TEXT NOT NULL,
    "reg_cert_no" TEXT,
    "reg_cert_url" TEXT,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "geo" geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography) STORED,
    "open_from" TEXT NOT NULL DEFAULT '00:00',
    "open_to" TEXT NOT NULL DEFAULT '23:59',
    "daily_capacity" INTEGER NOT NULL,
    "veg_only" BOOLEAN NOT NULL DEFAULT false,
    "reliability_score" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "ngos_pkey" PRIMARY KEY ("ngo_id")
);

-- CreateTable
CREATE TABLE "volunteers" (
    "volunteer_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "vehicle" "VehicleType" NOT NULL DEFAULT 'bike',
    "id_proof_url" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "is_on_call" BOOLEAN NOT NULL DEFAULT false,
    "current_lat" DOUBLE PRECISION,
    "current_lng" DOUBLE PRECISION,
    "current_geo" geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("current_lng", "current_lat"), 4326)::geography) STORED,
    "last_seen_at" TIMESTAMP(3),
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "volunteers_pkey" PRIMARY KEY ("volunteer_id")
);

-- CreateTable
CREATE TABLE "listings" (
    "listing_id" UUID NOT NULL,
    "donor_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "food_type" "FoodType" NOT NULL,
    "holding" "FoodHolding" NOT NULL DEFAULT 'hot',
    "total_servings" INTEGER NOT NULL,
    "remaining_servings" INTEGER NOT NULL,
    "packaging" TEXT,
    "cooked_at" TIMESTAMP(3) NOT NULL,
    "best_before" TIMESTAMP(3) NOT NULL,
    "pickup_from" TIMESTAMP(3) NOT NULL,
    "pickup_until" TIMESTAMP(3) NOT NULL,
    "photo_url" TEXT,
    "notes" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'posted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "food_items" (
    "listing_id" UUID NOT NULL,
    "item_no" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "food_items_pkey" PRIMARY KEY ("listing_id","item_no")
);

-- CreateTable
CREATE TABLE "claims" (
    "claim_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "ngo_id" UUID NOT NULL,
    "servings" INTEGER NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ClaimStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "claims_pkey" PRIMARY KEY ("claim_id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "delivery_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "volunteer_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'unassigned',
    "pickup_code" TEXT NOT NULL,
    "drop_code" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "pickup_photo_url" TEXT,
    "drop_photo_url" TEXT,
    "pickup_lat" DOUBLE PRECISION,
    "pickup_lng" DOUBLE PRECISION,
    "drop_lat" DOUBLE PRECISION,
    "drop_lng" DOUBLE PRECISION,
    "distance_km" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "offers" (
    "offer_id" UUID NOT NULL,
    "listing_id" UUID,
    "delivery_id" UUID,
    "recipient_user_id" UUID NOT NULL,
    "wave_no" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "response" "OfferResponse" NOT NULL DEFAULT 'none',

    CONSTRAINT "offers_pkey" PRIMARY KEY ("offer_id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "feedback_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "food_ok" BOOLEAN NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("feedback_id")
);

-- CreateTable
CREATE TABLE "issues" (
    "issue_id" UUID NOT NULL,
    "listing_id" UUID,
    "delivery_id" UUID,
    "raised_by" UUID,
    "resolved_by" UUID,
    "type" "IssueType" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'open',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "issues_pkey" PRIMARY KEY ("issue_id")
);

-- CreateTable
CREATE TABLE "status_events" (
    "event_id" UUID NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_user_id" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "status_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'hubballi',

    CONSTRAINT "config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "donors_user_id_key" ON "donors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ngos_user_id_key" ON "ngos"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "volunteers_user_id_key" ON "volunteers"("user_id");

-- CreateIndex
CREATE INDEX "listings_status_best_before_idx" ON "listings"("status", "best_before");

-- CreateIndex
CREATE INDEX "listings_donor_id_idx" ON "listings"("donor_id");

-- CreateIndex
CREATE INDEX "claims_ngo_id_claimed_at_idx" ON "claims"("ngo_id", "claimed_at");

-- CreateIndex
CREATE INDEX "claims_listing_id_idx" ON "claims"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_claim_id_key" ON "deliveries"("claim_id");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE INDEX "deliveries_volunteer_id_idx" ON "deliveries"("volunteer_id");

-- CreateIndex
CREATE INDEX "offers_recipient_user_id_response_idx" ON "offers"("recipient_user_id", "response");

-- CreateIndex
CREATE INDEX "offers_listing_id_idx" ON "offers"("listing_id");

-- CreateIndex
CREATE INDEX "offers_delivery_id_idx" ON "offers"("delivery_id");

-- CreateIndex
CREATE INDEX "feedback_delivery_id_idx" ON "feedback"("delivery_id");

-- CreateIndex
CREATE INDEX "issues_status_idx" ON "issues"("status");

-- CreateIndex
CREATE INDEX "status_events_entity_type_entity_id_idx" ON "status_events"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "donors" ADD CONSTRAINT "donors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ngos" ADD CONSTRAINT "ngos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "donors"("donor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "ngos"("ngo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("claim_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("volunteer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("delivery_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("delivery_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("delivery_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules Prisma cannot express in schema.prisma
-- ---------------------------------------------------------------------------

-- Spatial indexes for "within 8 km" / "within 4 km" queries
CREATE INDEX "donors_geo_idx" ON "donors" USING GIST ("geo");
CREATE INDEX "ngos_geo_idx" ON "ngos" USING GIST ("geo");
CREATE INDEX "volunteers_current_geo_idx" ON "volunteers" USING GIST ("current_geo");

-- Servings can never go negative or exceed the total
ALTER TABLE "listings" ADD CONSTRAINT "listings_servings_check"
  CHECK ("total_servings" > 0 AND "remaining_servings" >= 0 AND "remaining_servings" <= "total_servings");
ALTER TABLE "listings" ADD CONSTRAINT "listings_times_check"
  CHECK ("best_before" > "cooked_at" AND "pickup_until" > "pickup_from");
ALTER TABLE "claims" ADD CONSTRAINT "claims_servings_check" CHECK ("servings" > 0);
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_quantity_check" CHECK ("quantity" > 0 AND "item_no" > 0);
ALTER TABLE "ngos" ADD CONSTRAINT "ngos_capacity_check" CHECK ("daily_capacity" > 0);
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

-- An offer points at exactly one of a listing (to an NGO) or a delivery (to a volunteer)
ALTER TABLE "offers" ADD CONSTRAINT "offers_target_check"
  CHECK (("listing_id" IS NOT NULL) <> ("delivery_id" IS NOT NULL));

-- An issue is about at least one of a listing or a delivery
ALTER TABLE "issues" ADD CONSTRAINT "issues_target_check"
  CHECK ("listing_id" IS NOT NULL OR "delivery_id" IS NOT NULL);

-- Pickup and drop codes are 4 digits
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_codes_check"
  CHECK ("pickup_code" ~ '^[0-9]{4}$' AND "drop_code" ~ '^[0-9]{4}$');

-- One active delivery per volunteer
CREATE UNIQUE INDEX "deliveries_one_active_per_volunteer"
  ON "deliveries" ("volunteer_id")
  WHERE "status" IN ('assigned', 'picked_up');
