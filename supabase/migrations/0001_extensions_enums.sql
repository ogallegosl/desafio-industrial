-- 0001_extensions_enums.sql
-- Base types for the evaluation platform.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.app_role as enum ('admin', 'teacher');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_type as enum (
    'single_choice',
    'multiple_choice',
    'true_false',
    'short_text',
    'numeric',
    'essay',
    'image_single_choice',
    'image_essay',
    'calculation',
    'calculation_evidence',
    'case_group',
    'attachment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_difficulty as enum ('basic', 'intermediate', 'advanced');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.exam_status as enum ('draft', 'scheduled', 'active', 'closed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attempt_status as enum (
    'created',
    'in_progress',
    'submitted',
    'time_expired',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.navigation_mode as enum ('free', 'sequential');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.result_visibility as enum (
    'confirmation_only',
    'score_only',
    'grade',
    'correct_answers',
    'full_feedback'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.enrollment_status as enum ('active', 'inactive', 'completed', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('not_required', 'pending', 'reviewed');
exception when duplicate_object then null; end $$;
