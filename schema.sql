


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."adjustmenttype" AS ENUM (
    'BONUS',
    'DEDUCTION',
    'REIMBURSEMENT'
);


ALTER TYPE "public"."adjustmenttype" OWNER TO "postgres";


CREATE TYPE "public"."cashcountsource" AS ENUM (
    'kiosk',
    'web'
);


ALTER TYPE "public"."cashcountsource" OWNER TO "postgres";


CREATE TYPE "public"."cashdrawerauditaction" AS ENUM (
    'CREATE_START',
    'SET_END',
    'EDIT_START',
    'EDIT_END',
    'REVIEW',
    'VOID'
);


ALTER TYPE "public"."cashdrawerauditaction" OWNER TO "postgres";


CREATE TYPE "public"."cashdrawerstatus" AS ENUM (
    'OPEN',
    'CLOSED',
    'REVIEW_NEEDED'
);


ALTER TYPE "public"."cashdrawerstatus" OWNER TO "postgres";


CREATE TYPE "public"."leavestatus" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);


ALTER TYPE "public"."leavestatus" OWNER TO "postgres";


CREATE TYPE "public"."leavetype" AS ENUM (
    'vacation',
    'sick',
    'personal',
    'other'
);


ALTER TYPE "public"."leavetype" OWNER TO "postgres";


CREATE TYPE "public"."payratetype" AS ENUM (
    'HOURLY'
);


ALTER TYPE "public"."payratetype" OWNER TO "postgres";


CREATE TYPE "public"."payrollstatus" AS ENUM (
    'DRAFT',
    'FINALIZED',
    'VOID'
);


ALTER TYPE "public"."payrollstatus" OWNER TO "postgres";


CREATE TYPE "public"."payrolltype" AS ENUM (
    'WEEKLY',
    'BIWEEKLY'
);


ALTER TYPE "public"."payrolltype" OWNER TO "postgres";


CREATE TYPE "public"."shiftnotestatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'REVIEWED'
);


ALTER TYPE "public"."shiftnotestatus" OWNER TO "postgres";


CREATE TYPE "public"."shiftstatus" AS ENUM (
    'DRAFT',
    'PUBLISHED',
    'APPROVED',
    'CANCELLED'
);


ALTER TYPE "public"."shiftstatus" OWNER TO "postgres";


CREATE TYPE "public"."shifttemplatetype" AS ENUM (
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'NONE'
);


ALTER TYPE "public"."shifttemplatetype" OWNER TO "postgres";


CREATE TYPE "public"."timeentrysource" AS ENUM (
    'kiosk',
    'web'
);


ALTER TYPE "public"."timeentrysource" OWNER TO "postgres";


CREATE TYPE "public"."timeentrystatus" AS ENUM (
    'open',
    'closed',
    'edited',
    'approved'
);


ALTER TYPE "public"."timeentrystatus" OWNER TO "postgres";


CREATE TYPE "public"."userrole" AS ENUM (
    'ADMIN',
    'DEVELOPER',
    'MAINTENANCE',
    'FRONTDESK',
    'HOUSEKEEPING',
    'MANAGER',
    'RESTAURANT',
    'SECURITY'
);


ALTER TYPE "public"."userrole" OWNER TO "postgres";


CREATE TYPE "public"."userstatus" AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE "public"."userstatus" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_cash_drawer_sessions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_cash_drawer_sessions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "action" character varying(100) NOT NULL,
    "entity_type" character varying(50) NOT NULL,
    "entity_id" "uuid",
    "metadata_json" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_drawer_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "cash_drawer_session_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "action" "public"."cashdrawerauditaction" NOT NULL,
    "old_values_json" "jsonb",
    "new_values_json" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cash_drawer_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_drawer_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "time_entry_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "start_cash_cents" bigint NOT NULL,
    "start_counted_at" timestamp with time zone NOT NULL,
    "start_count_source" "public"."cashcountsource" DEFAULT 'kiosk'::"public"."cashcountsource" NOT NULL,
    "end_cash_cents" bigint,
    "end_counted_at" timestamp with time zone,
    "end_count_source" "public"."cashcountsource",
    "delta_cents" bigint,
    "status" "public"."cashdrawerstatus" DEFAULT 'OPEN'::"public"."cashdrawerstatus" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "collected_cash_cents" bigint,
    "beverages_cash_cents" bigint,
    "drop_amount_cents" bigint
);


ALTER TABLE "public"."cash_drawer_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cash_drawer_sessions"."collected_cash_cents" IS 'Total cash collected from customers (for punch-out)';



COMMENT ON COLUMN "public"."cash_drawer_sessions"."beverages_cash_cents" IS 'Cash from beverage sales (for punch-out)';



COMMENT ON COLUMN "public"."cash_drawer_sessions"."drop_amount_cents" IS 'Cash dropped/removed from drawer during shift (for punch-out)';



CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "settings_json" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kiosk_enabled" boolean DEFAULT true NOT NULL,
    "slug" character varying(50) NOT NULL
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."companies"."settings_json" IS 'JSONB company settings. Keys used by app: timezone, payroll_week_start_day, biweekly_anchor_date, overtime_enabled, overtime_threshold_hours_per_week, overtime_multiplier_default, rounding_policy, breaks_paid, cash_drawer_*, schedule_day_start_hour, schedule_day_end_hour, shift_notes_*, email_verification_required, geofence_enabled, office_latitude, office_longitude, geofence_radius_meters, kiosk_network_restriction_enabled, kiosk_allowed_ips.';



CREATE TABLE IF NOT EXISTS "public"."leave_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "type" "public"."leavetype" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "partial_day_hours" integer,
    "reason" character varying(1000),
    "status" "public"."leavestatus" DEFAULT 'pending'::"public"."leavestatus" NOT NULL,
    "reviewed_by" "uuid",
    "review_comment" character varying(1000),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."leave_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_run_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "type" "public"."adjustmenttype" NOT NULL,
    "amount_cents" bigint NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payroll_adjustments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_run_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "regular_minutes" integer DEFAULT 0 NOT NULL,
    "overtime_minutes" integer DEFAULT 0 NOT NULL,
    "total_minutes" integer DEFAULT 0 NOT NULL,
    "pay_rate_cents" integer NOT NULL,
    "overtime_multiplier" numeric(4,2) DEFAULT 1.5 NOT NULL,
    "regular_pay_cents" bigint DEFAULT 0 NOT NULL,
    "overtime_pay_cents" bigint DEFAULT 0 NOT NULL,
    "total_pay_cents" bigint DEFAULT 0 NOT NULL,
    "exceptions_count" integer DEFAULT 0 NOT NULL,
    "details_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payroll_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "payroll_type" "public"."payrolltype" NOT NULL,
    "period_start_date" "date" NOT NULL,
    "period_end_date" "date" NOT NULL,
    "timezone" character varying(50) DEFAULT 'America/Chicago'::character varying NOT NULL,
    "status" "public"."payrollstatus" DEFAULT 'DRAFT'::"public"."payrollstatus" NOT NULL,
    "generated_by" "uuid" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "total_regular_hours" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_overtime_hours" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_gross_pay_cents" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payroll_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "display_name" character varying(255) NOT NULL,
    "description" "text",
    "category" character varying(50) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role" character varying(50) NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_swaps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "original_shift_id" "uuid" NOT NULL,
    "requested_shift_id" "uuid",
    "requester_id" "uuid" NOT NULL,
    "offerer_id" "uuid",
    "status" character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "schedule_swaps_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."schedule_swaps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "refresh_token_hash" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "user_agent" character varying(500),
    "ip" character varying(45)
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_note_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "shift_note_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "comment" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_note_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "time_entry_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."shiftnotestatus" DEFAULT 'DRAFT'::"public"."shiftnotestatus" NOT NULL,
    "last_edited_at" timestamp with time zone,
    "last_edited_by" "uuid",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "beverage_sold" integer
);


ALTER TABLE "public"."shift_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "employee_id" "uuid",
    "name" character varying(255) NOT NULL,
    "description" "text",
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "break_minutes" integer DEFAULT 0 NOT NULL,
    "template_type" "public"."shifttemplatetype" DEFAULT 'NONE'::"public"."shifttemplatetype" NOT NULL,
    "day_of_week" integer,
    "day_of_month" integer,
    "week_of_month" integer,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "requires_approval" boolean DEFAULT false NOT NULL,
    "department" character varying(255),
    "job_role" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shift_templates_day_of_month_check" CHECK ((("day_of_month" >= 1) AND ("day_of_month" <= 31))),
    CONSTRAINT "shift_templates_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "shift_templates_template_type_check" CHECK ((("template_type")::"text" = ANY (ARRAY[('WEEKLY'::character varying)::"text", ('BIWEEKLY'::character varying)::"text", ('MONTHLY'::character varying)::"text", ('NONE'::character varying)::"text"]))),
    CONSTRAINT "shift_templates_week_of_month_check" CHECK ((("week_of_month" >= 1) AND ("week_of_month" <= 4)))
);


ALTER TABLE "public"."shift_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "shift_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "break_minutes" integer DEFAULT 0 NOT NULL,
    "status" "public"."shiftstatus" DEFAULT 'DRAFT'::"public"."shiftstatus" NOT NULL,
    "notes" "text",
    "job_role" character varying(255),
    "template_id" "uuid",
    "requires_approval" boolean DEFAULT false NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "series_id" "uuid",
    CONSTRAINT "shifts_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('DRAFT'::character varying)::"text", ('PUBLISHED'::character varying)::"text", ('APPROVED'::character varying)::"text", ('CANCELLED'::character varying)::"text"])))
);


ALTER TABLE "public"."shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "clock_in_at" timestamp with time zone NOT NULL,
    "clock_out_at" timestamp with time zone,
    "break_minutes" integer DEFAULT 0 NOT NULL,
    "source" "public"."timeentrysource" DEFAULT 'kiosk'::"public"."timeentrysource" NOT NULL,
    "note" character varying(500),
    "status" "public"."timeentrystatus" DEFAULT 'open'::"public"."timeentrystatus" NOT NULL,
    "edited_by" "uuid",
    "edit_reason" character varying(500),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shift_id" "uuid",
    "ip_address" character varying(45),
    "user_agent" character varying(500),
    "clock_out_ip_address" character varying(45),
    "clock_out_user_agent" character varying(500),
    "clock_in_latitude" character varying(20),
    "clock_in_longitude" character varying(20),
    "clock_out_latitude" character varying(20),
    "clock_out_longitude" character varying(20)
);


ALTER TABLE "public"."time_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "role" "public"."userrole" DEFAULT 'FRONTDESK'::"public"."userrole" NOT NULL,
    "name" character varying(255) NOT NULL,
    "email" character varying(255) NOT NULL,
    "password_hash" character varying(255) NOT NULL,
    "pin_hash" character varying(255),
    "status" "public"."userstatus" DEFAULT 'active'::"public"."userstatus" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_login_at" timestamp with time zone,
    "job_role" character varying(255),
    "pay_rate" numeric(10,2),
    "pay_rate_cents" integer DEFAULT 0 NOT NULL,
    "pay_rate_type" "public"."payratetype" DEFAULT 'HOURLY'::"public"."payratetype" NOT NULL,
    "overtime_multiplier" numeric(4,2),
    "email_verified" boolean DEFAULT false NOT NULL,
    "last_verified_at" timestamp with time zone,
    "verification_pin_hash" character varying(255),
    "verification_expires_at" timestamp with time zone,
    "verification_attempts" integer DEFAULT 0 NOT NULL,
    "last_verification_sent_at" timestamp with time zone,
    "verification_required" boolean DEFAULT true NOT NULL,
    "password_reset_otp_hash" character varying(255),
    "password_reset_otp_expires_at" timestamp with time zone,
    "password_reset_attempts" integer DEFAULT 0 NOT NULL,
    "last_password_reset_sent_at" timestamp with time zone
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_drawer_audit"
    ADD CONSTRAINT "cash_drawer_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_drawer_sessions"
    ADD CONSTRAINT "cash_drawer_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_drawer_sessions"
    ADD CONSTRAINT "cash_drawer_sessions_time_entry_id_unique" UNIQUE ("time_entry_id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_adjustments"
    ADD CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_line_items"
    ADD CONSTRAINT "payroll_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role", "permission_id", "company_id");



ALTER TABLE ONLY "public"."schedule_swaps"
    ADD CONSTRAINT "schedule_swaps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_refresh_token_hash_key" UNIQUE ("refresh_token_hash");



ALTER TABLE ONLY "public"."shift_note_comments"
    ADD CONSTRAINT "shift_note_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_templates"
    ADD CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_logs_company_created" ON "public"."audit_logs" USING "btree" ("company_id", "created_at");



CREATE INDEX "idx_cash_drawer_audit_actor" ON "public"."cash_drawer_audit" USING "btree" ("actor_user_id");



CREATE INDEX "idx_cash_drawer_audit_company_id" ON "public"."cash_drawer_audit" USING "btree" ("company_id");



CREATE INDEX "idx_cash_drawer_audit_created" ON "public"."cash_drawer_audit" USING "btree" ("created_at");



CREATE INDEX "idx_cash_drawer_audit_session" ON "public"."cash_drawer_audit" USING "btree" ("cash_drawer_session_id");



CREATE INDEX "idx_cash_drawer_sessions_company_employee_date" ON "public"."cash_drawer_sessions" USING "btree" ("company_id", "employee_id", "start_counted_at");



CREATE INDEX "idx_cash_drawer_sessions_company_id" ON "public"."cash_drawer_sessions" USING "btree" ("company_id");



CREATE INDEX "idx_cash_drawer_sessions_company_status" ON "public"."cash_drawer_sessions" USING "btree" ("company_id", "status");



CREATE INDEX "idx_cash_drawer_sessions_employee_id" ON "public"."cash_drawer_sessions" USING "btree" ("employee_id");



CREATE INDEX "idx_cash_drawer_sessions_time_entry" ON "public"."cash_drawer_sessions" USING "btree" ("time_entry_id");



CREATE INDEX "idx_leave_requests_company_status_created" ON "public"."leave_requests" USING "btree" ("company_id", "status", "created_at");



CREATE INDEX "idx_leave_requests_employee_company" ON "public"."leave_requests" USING "btree" ("employee_id", "company_id");



CREATE INDEX "idx_payroll_adjustments_employee" ON "public"."payroll_adjustments" USING "btree" ("employee_id");



CREATE INDEX "idx_payroll_adjustments_payroll_run" ON "public"."payroll_adjustments" USING "btree" ("payroll_run_id");



CREATE INDEX "idx_payroll_line_items_employee" ON "public"."payroll_line_items" USING "btree" ("employee_id");



CREATE INDEX "idx_payroll_line_items_payroll_run" ON "public"."payroll_line_items" USING "btree" ("payroll_run_id");



CREATE INDEX "idx_payroll_runs_company_period" ON "public"."payroll_runs" USING "btree" ("company_id", "period_start_date", "period_end_date");



CREATE INDEX "idx_sessions_user_company" ON "public"."sessions" USING "btree" ("user_id", "company_id");



CREATE INDEX "idx_shift_notes_company_employee_updated" ON "public"."shift_notes" USING "btree" ("company_id", "employee_id", "updated_at");



CREATE INDEX "idx_shift_notes_company_time_entry" ON "public"."shift_notes" USING "btree" ("company_id", "time_entry_id");



CREATE INDEX "idx_shift_notes_company_updated" ON "public"."shift_notes" USING "btree" ("company_id", "updated_at");



CREATE INDEX "idx_shifts_company_date_status" ON "public"."shifts" USING "btree" ("company_id", "shift_date", "status");



CREATE INDEX "idx_shifts_company_employee_date" ON "public"."shifts" USING "btree" ("company_id", "employee_id", "shift_date");



CREATE INDEX "idx_time_entries_company_employee_clock_in" ON "public"."time_entries" USING "btree" ("company_id", "employee_id", "clock_in_at");



CREATE INDEX "idx_time_entries_employee_company" ON "public"."time_entries" USING "btree" ("employee_id", "company_id");



CREATE INDEX "idx_users_company_status" ON "public"."users" USING "btree" ("company_id", "status");



CREATE INDEX "idx_users_verification_status" ON "public"."users" USING "btree" ("email_verified", "verification_required") WHERE (("email_verified" = false) OR ("verification_required" = true));



CREATE INDEX "ix_audit_logs_actor_user_id" ON "public"."audit_logs" USING "btree" ("actor_user_id");



CREATE INDEX "ix_audit_logs_company_id" ON "public"."audit_logs" USING "btree" ("company_id");



CREATE UNIQUE INDEX "ix_companies_slug" ON "public"."companies" USING "btree" ("slug");



CREATE INDEX "ix_leave_requests_company_id" ON "public"."leave_requests" USING "btree" ("company_id");



CREATE INDEX "ix_leave_requests_employee_id" ON "public"."leave_requests" USING "btree" ("employee_id");



CREATE INDEX "ix_leave_requests_status" ON "public"."leave_requests" USING "btree" ("status");



CREATE INDEX "ix_payroll_adjustments_employee_id" ON "public"."payroll_adjustments" USING "btree" ("employee_id");



CREATE INDEX "ix_payroll_adjustments_payroll_run_id" ON "public"."payroll_adjustments" USING "btree" ("payroll_run_id");



CREATE INDEX "ix_payroll_line_items_company_id" ON "public"."payroll_line_items" USING "btree" ("company_id");



CREATE INDEX "ix_payroll_line_items_employee_id" ON "public"."payroll_line_items" USING "btree" ("employee_id");



CREATE INDEX "ix_payroll_line_items_payroll_run_id" ON "public"."payroll_line_items" USING "btree" ("payroll_run_id");



CREATE INDEX "ix_payroll_runs_company_id" ON "public"."payroll_runs" USING "btree" ("company_id");



CREATE INDEX "ix_permissions_category" ON "public"."permissions" USING "btree" ("category");



CREATE INDEX "ix_permissions_name" ON "public"."permissions" USING "btree" ("name");



CREATE INDEX "ix_role_permissions_company" ON "public"."role_permissions" USING "btree" ("company_id");



CREATE INDEX "ix_role_permissions_role" ON "public"."role_permissions" USING "btree" ("role");



CREATE INDEX "ix_schedule_swaps_company_id" ON "public"."schedule_swaps" USING "btree" ("company_id");



CREATE INDEX "ix_schedule_swaps_original_shift_id" ON "public"."schedule_swaps" USING "btree" ("original_shift_id");



CREATE INDEX "ix_schedule_swaps_requester_id" ON "public"."schedule_swaps" USING "btree" ("requester_id");



CREATE INDEX "ix_sessions_company_id" ON "public"."sessions" USING "btree" ("company_id");



CREATE INDEX "ix_sessions_refresh_token_hash" ON "public"."sessions" USING "btree" ("refresh_token_hash");



CREATE INDEX "ix_sessions_user_id" ON "public"."sessions" USING "btree" ("user_id");



CREATE INDEX "ix_shift_note_comments_actor_user_id" ON "public"."shift_note_comments" USING "btree" ("actor_user_id");



CREATE INDEX "ix_shift_note_comments_company_id" ON "public"."shift_note_comments" USING "btree" ("company_id");



CREATE INDEX "ix_shift_note_comments_shift_note_id" ON "public"."shift_note_comments" USING "btree" ("shift_note_id");



CREATE INDEX "ix_shift_notes_company_id" ON "public"."shift_notes" USING "btree" ("company_id");



CREATE INDEX "ix_shift_notes_employee_id" ON "public"."shift_notes" USING "btree" ("employee_id");



CREATE UNIQUE INDEX "ix_shift_notes_time_entry_id" ON "public"."shift_notes" USING "btree" ("time_entry_id");



CREATE INDEX "ix_shift_templates_company_id" ON "public"."shift_templates" USING "btree" ("company_id");



CREATE INDEX "ix_shift_templates_employee_id" ON "public"."shift_templates" USING "btree" ("employee_id");



CREATE INDEX "ix_shifts_company_id" ON "public"."shifts" USING "btree" ("company_id");



CREATE INDEX "ix_shifts_employee_id" ON "public"."shifts" USING "btree" ("employee_id");



CREATE INDEX "ix_shifts_series_id" ON "public"."shifts" USING "btree" ("series_id");



CREATE INDEX "ix_shifts_shift_date" ON "public"."shifts" USING "btree" ("shift_date");



CREATE INDEX "ix_shifts_template_id" ON "public"."shifts" USING "btree" ("template_id");



CREATE INDEX "ix_time_entries_clock_in_at" ON "public"."time_entries" USING "btree" ("clock_in_at");



CREATE INDEX "ix_time_entries_company_id" ON "public"."time_entries" USING "btree" ("company_id");



CREATE INDEX "ix_time_entries_employee_id" ON "public"."time_entries" USING "btree" ("employee_id");



CREATE INDEX "ix_time_entries_shift_id" ON "public"."time_entries" USING "btree" ("shift_id");



CREATE UNIQUE INDEX "ix_users_company_email_lower" ON "public"."users" USING "btree" ("company_id", "lower"(("email")::"text"));



CREATE INDEX "ix_users_company_id" ON "public"."users" USING "btree" ("company_id");



CREATE UNIQUE INDEX "ix_users_company_pin_hash_unique" ON "public"."users" USING "btree" ("company_id", "pin_hash") WHERE ("pin_hash" IS NOT NULL);



CREATE INDEX "ix_users_email" ON "public"."users" USING "btree" ("email");



CREATE UNIQUE INDEX "uq_payroll_line_item_employee" ON "public"."payroll_line_items" USING "btree" ("payroll_run_id", "employee_id");



CREATE UNIQUE INDEX "uq_payroll_run_period" ON "public"."payroll_runs" USING "btree" ("company_id", "payroll_type", "period_start_date", "period_end_date");



CREATE OR REPLACE TRIGGER "trigger_update_cash_drawer_sessions_updated_at" BEFORE UPDATE ON "public"."cash_drawer_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_cash_drawer_sessions_updated_at"();



CREATE OR REPLACE TRIGGER "update_leave_requests_updated_at" BEFORE UPDATE ON "public"."leave_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_payroll_line_items_updated_at" BEFORE UPDATE ON "public"."payroll_line_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_payroll_runs_updated_at" BEFORE UPDATE ON "public"."payroll_runs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_swaps_updated_at" BEFORE UPDATE ON "public"."schedule_swaps" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_shift_templates_updated_at" BEFORE UPDATE ON "public"."shift_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_shifts_updated_at" BEFORE UPDATE ON "public"."shifts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_time_entries_updated_at" BEFORE UPDATE ON "public"."time_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."cash_drawer_audit"
    ADD CONSTRAINT "cash_drawer_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_drawer_audit"
    ADD CONSTRAINT "cash_drawer_audit_cash_drawer_session_id_fkey" FOREIGN KEY ("cash_drawer_session_id") REFERENCES "public"."cash_drawer_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_drawer_audit"
    ADD CONSTRAINT "cash_drawer_audit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_drawer_sessions"
    ADD CONSTRAINT "cash_drawer_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_drawer_sessions"
    ADD CONSTRAINT "cash_drawer_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_drawer_sessions"
    ADD CONSTRAINT "cash_drawer_sessions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_drawer_sessions"
    ADD CONSTRAINT "cash_drawer_sessions_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "fk_time_entries_shift_id" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."payroll_adjustments"
    ADD CONSTRAINT "payroll_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."payroll_adjustments"
    ADD CONSTRAINT "payroll_adjustments_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id");



ALTER TABLE ONLY "public"."payroll_line_items"
    ADD CONSTRAINT "payroll_line_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."payroll_line_items"
    ADD CONSTRAINT "payroll_line_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."payroll_line_items"
    ADD CONSTRAINT "payroll_line_items_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id");



ALTER TABLE ONLY "public"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_swaps"
    ADD CONSTRAINT "schedule_swaps_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_swaps"
    ADD CONSTRAINT "schedule_swaps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_swaps"
    ADD CONSTRAINT "schedule_swaps_offerer_id_fkey" FOREIGN KEY ("offerer_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_swaps"
    ADD CONSTRAINT "schedule_swaps_original_shift_id_fkey" FOREIGN KEY ("original_shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_swaps"
    ADD CONSTRAINT "schedule_swaps_requested_shift_id_fkey" FOREIGN KEY ("requested_shift_id") REFERENCES "public"."shifts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_swaps"
    ADD CONSTRAINT "schedule_swaps_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."shift_note_comments"
    ADD CONSTRAINT "shift_note_comments_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_note_comments"
    ADD CONSTRAINT "shift_note_comments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_note_comments"
    ADD CONSTRAINT "shift_note_comments_shift_note_id_fkey" FOREIGN KEY ("shift_note_id") REFERENCES "public"."shift_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_last_edited_by_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_templates"
    ADD CONSTRAINT "shift_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_templates"
    ADD CONSTRAINT "shift_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_templates"
    ADD CONSTRAINT "shift_templates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_drawer_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_drawer_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rls_authenticated_all" ON "public"."shift_note_comments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "rls_authenticated_all" ON "public"."shift_notes" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "rls_authenticated_select" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."cash_drawer_audit" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."cash_drawer_sessions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."companies" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."leave_requests" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."payroll_adjustments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."payroll_line_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."payroll_runs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."schedule_swaps" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."sessions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."shift_templates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."shifts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_authenticated_select" ON "public"."time_entries" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_service_role_all" ON "public"."audit_logs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."cash_drawer_audit" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."cash_drawer_sessions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."companies" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."leave_requests" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."payroll_adjustments" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."payroll_line_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."payroll_runs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."permissions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."role_permissions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."schedule_swaps" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."sessions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."shift_note_comments" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."shift_notes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."shift_templates" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."shifts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "rls_service_role_all" ON "public"."time_entries" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."schedule_swaps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_note_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."time_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."update_cash_drawer_sessions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_cash_drawer_sessions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_cash_drawer_sessions_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."cash_drawer_audit" TO "anon";
GRANT ALL ON TABLE "public"."cash_drawer_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_drawer_audit" TO "service_role";



GRANT ALL ON TABLE "public"."cash_drawer_sessions" TO "anon";
GRANT ALL ON TABLE "public"."cash_drawer_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_drawer_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."leave_requests" TO "anon";
GRANT ALL ON TABLE "public"."leave_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_requests" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_adjustments" TO "anon";
GRANT ALL ON TABLE "public"."payroll_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_line_items" TO "anon";
GRANT ALL ON TABLE "public"."payroll_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_runs" TO "anon";
GRANT ALL ON TABLE "public"."payroll_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_runs" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_swaps" TO "anon";
GRANT ALL ON TABLE "public"."schedule_swaps" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_swaps" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."shift_note_comments" TO "anon";
GRANT ALL ON TABLE "public"."shift_note_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_note_comments" TO "service_role";



GRANT ALL ON TABLE "public"."shift_notes" TO "anon";
GRANT ALL ON TABLE "public"."shift_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_notes" TO "service_role";



GRANT ALL ON TABLE "public"."shift_templates" TO "anon";
GRANT ALL ON TABLE "public"."shift_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_templates" TO "service_role";



GRANT ALL ON TABLE "public"."shifts" TO "anon";
GRANT ALL ON TABLE "public"."shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."shifts" TO "service_role";



GRANT ALL ON TABLE "public"."time_entries" TO "anon";
GRANT ALL ON TABLE "public"."time_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."time_entries" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































